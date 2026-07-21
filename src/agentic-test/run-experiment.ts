import "dotenv/config";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { closePg } from "../db/pg.js";
import {
  ALUMINUM_FREE_MATCHING_TERMS,
  TEST_PRODUCT_ID,
  TEST_SHOP_ID,
  aluminumFreeTask,
} from "./contract.js";
import { groundTruth } from "./ground-truth.js";
import { assertRunnable } from "./preflight.js";
import { createStoreSnapshot, loadSnapshot, saveSnapshot } from "./snapshot-service.js";
import {
  assertPreRunInvariants,
  removeAttributeEvidence,
  restoreEvidence,
} from "./snapshot-mutator.js";

// ===========================================================================
// Stage 1 CLI entrypoint (spec 4.12). Dev-only; NOT reachable from any server
// route. Requires AGENTIC_INSTRUMENT_TEST_ENABLED=true and the hard-coded
// test-shop allowlist. Subcommands grow with the checkpoints:
//   prepare   — build + persist BASE/FAULTY/RESTORED snapshots, assert invariants
//
// Run: npx tsx src/agentic-test/run-experiment.ts <subcommand>
// ===========================================================================

const EXPERIMENT_DIR = join(process.cwd(), "experiments", "agentic-stage1");
const MANIFEST_FILE = join(EXPERIMENT_DIR, "experiment-manifest.json");

/** Evaluator-side map of snapshot ids → roles. The AGENT never sees this file;
 *  tools receive only the pinned snapshot, whose id is an opaque hash. */
export interface ExperimentManifest {
  experimentId: string;
  shopId: string;
  productId: string;
  snapshots: { baseId: string; faultyId: string; restoredId: string };
  mutationId: string;
  createdAt: string;
}

export async function prepare(): Promise<ExperimentManifest> {
  assertRunnable(process.env, TEST_SHOP_ID);

  const base = await createStoreSnapshot(TEST_SHOP_ID, TEST_PRODUCT_ID);
  const { snapshot: faulty, mutation } = removeAttributeEvidence(
    base,
    "aluminum_free",
    [...ALUMINUM_FREE_MATCHING_TERMS],
  );
  const restored = restoreEvidence(faulty, mutation);

  // Pre-run assertions (spec 4.4): the experiment is INVALID unless these hold.
  const constraint = aluminumFreeTask.hardConstraints[0]!;
  assertPreRunInvariants({
    base,
    faulty,
    acceptableSurfaces: constraint.acceptableSurfaces,
    matchingTerms: [...ALUMINUM_FREE_MATCHING_TERMS],
    attribute: "aluminum_free",
    groundTruthValue: groundTruth.facts.aluminum_free,
  });
  // RESTORED must carry the evidence again (same check as BASE).
  assertPreRunInvariants({
    base: restored,
    faulty,
    acceptableSurfaces: constraint.acceptableSurfaces,
    matchingTerms: [...ALUMINUM_FREE_MATCHING_TERMS],
    attribute: "aluminum_free",
    groundTruthValue: groundTruth.facts.aluminum_free,
  });

  saveSnapshot(base);
  saveSnapshot(faulty);
  saveSnapshot(restored);
  mkdirSync(EXPERIMENT_DIR, { recursive: true });
  writeFileSync(
    join(EXPERIMENT_DIR, "snapshots", `mutation-${mutation.mutationId}.json`),
    JSON.stringify(mutation, null, 2),
    "utf8",
  );

  const manifest: ExperimentManifest = {
    experimentId: `agentic-stage1-${new Date().toISOString().slice(0, 10)}`,
    shopId: TEST_SHOP_ID,
    productId: TEST_PRODUCT_ID,
    snapshots: { baseId: base.id, faultyId: faulty.id, restoredId: restored.id },
    mutationId: mutation.mutationId,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`[prepare] BASE     ${base.id} (hash ${base.contentHash.slice(0, 12)}…)`);
  console.log(`[prepare] FAULTY   ${faulty.id} (hash ${faulty.contentHash.slice(0, 12)}…, removed ${mutation.removedEvidence.length} evidence items)`);
  console.log(`[prepare] RESTORED ${restored.id} (hash ${restored.contentHash.slice(0, 12)}…)`);
  console.log("[prepare] pre-run invariants hold: BASE has evidence, FAULTY has zero matches, ground truth intact");
  return manifest;
}

export function readManifest(): ExperimentManifest {
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as ExperimentManifest;
}

export function loadSnapshotById(id: string) {
  return loadSnapshot(id);
}

// ---- single journey (CP2+) -------------------------------------------------

export type SnapshotRole = "base" | "faulty" | "restored";

export function snapshotIdForRole(manifest: ExperimentManifest, role: SnapshotRole): string {
  return role === "base" ? manifest.snapshots.baseId : role === "faulty" ? manifest.snapshots.faultyId : manifest.snapshots.restoredId;
}

/** Run ONE journey. `role` maps to a snapshot id EVALUATOR-SIDE only — the
 *  agent receives the pinned snapshot through tools and never the label. */
export async function runJourney(provider: string, role: SnapshotRole, trialNumber: number) {
  assertRunnable(process.env, TEST_SHOP_ID);
  const manifest = readManifest();
  const snapshot = loadSnapshot(snapshotIdForRole(manifest, role));
  const { createToolClient } = await import("./model-client.js");
  const { runShoppingAgent } = await import("./agent-runner.js");
  const { persistJourneyResult, readCumulativeSpend } = await import("./trace-recorder.js");

  const client = createToolClient(provider);
  const result = await runShoppingAgent({
    contract: aluminumFreeTask,
    snapshot,
    client,
    trialNumber,
  });
  const file = persistJourneyResult(result);
  console.log(
    `[journey] ${provider}/${client.model} snapshot=${snapshot.id} trial=${trialNumber} → ` +
      `${result.outcome} (model declared: ${result.modelDeclaredOutcome ?? "n/a"}) ` +
      `toolCalls=${result.totalToolCalls} steps=${result.totalSteps} cost=$${result.estimatedCostUsd.toFixed(4)}`,
  );
  console.log(`[journey] persisted ${file} · cumulative spend $${readCumulativeSpend().toFixed(4)}`);
  return result;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/run-experiment.ts");
if (isMain) {
  const cmd = process.argv[2] ?? "";
  const main = async () => {
    switch (cmd) {
      case "prepare":
        await prepare();
        break;
      case "journey": {
        const provider = process.argv[3] ?? "";
        const role = process.argv[4] as SnapshotRole;
        const trial = Number(process.argv[5] ?? 1);
        if (!provider || !["base", "faulty", "restored"].includes(role)) {
          console.error("usage: … journey <openai|gemini> <base|faulty|restored> [trial]");
          process.exitCode = 2;
          break;
        }
        await runJourney(provider, role, trial);
        break;
      }
      default:
        console.error("usage: npx tsx src/agentic-test/run-experiment.ts <prepare|journey>");
        process.exitCode = 2;
    }
  };
  main()
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[run-experiment] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
