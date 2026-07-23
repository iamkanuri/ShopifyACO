import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { closePg } from "../db/pg.js";
import { ALUMINUM_FREE_MATCHING_TERMS, DEV_SHOP_ID } from "./contract.js";
import { stage2PrimaryContract } from "./contract2.js";
import { assertRunnable } from "./preflight.js";
import { loadSnapshot, saveSnapshot } from "./snapshot-service.js";
import { insertSentences, removeAttributeEvidence } from "./snapshot-mutator.js";
import { scanStore } from "./store-diagnostic.js";
import { readStage2Manifest } from "./run-experiment2.js";
import { matchingTermsIn } from "./util.js";
import type { StoreSnapshot } from "./types.js";

// ===========================================================================
// STAGE 3 CLI. Labels live only here + the report layer (Rule: label
// blindness). Subcommands grow with the checkpoints:
//   prepare3     — build PARA-v2; reuse stage2 BASE/F1/TRAP; write manifest
//   scan-stage2  — Store Diagnostic Scan over Stage 2 snapshots + assertions
// ===========================================================================

const EXPERIMENT_DIR = join(process.cwd(), "experiments", "agentic-stage3");
const STAGE2_SNAP_DIR = join(process.cwd(), "experiments", "agentic-stage2", "snapshots");
const STAGE3_SNAP_DIR = join(EXPERIMENT_DIR, "snapshots");
const MANIFEST_FILE = join(EXPERIMENT_DIR, "experiment-manifest.json");

export const PROMPT_VERSION_STAGE3 = "stage3-v1"; // journey prompt (stage1-v1 text, new label)
export const SEM_PROMPT_VERSION = "sem-v1";

/** PARA-v2 sentences — spec 4.3, verbatim. Genuinely outside the term list. */
export const PARA_V2_SENTENCES = [
  "You won't find aluminum anywhere in our ingredient list.",
  "Aluminum never makes it into this formula.",
  "We skip the aluminum entirely and rely on arrowroot instead.",
];

export interface Stage3Manifest {
  experimentId: string;
  shopId: string;
  snapshots: { base: string; f1: string; trap: string; paraV2: string };
  createdAt: string;
}

export function loadStage3Snapshot(id: string): StoreSnapshot {
  try {
    return loadSnapshot(id, STAGE3_SNAP_DIR);
  } catch {
    return loadSnapshot(id, STAGE2_SNAP_DIR);
  }
}

export function readStage3Manifest(): Stage3Manifest {
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as Stage3Manifest;
}

export function useStage3ResultsDir(): void {
  process.env.AGENTIC_STAGE1_RESULTS_DIR = join(EXPERIMENT_DIR, "results");
}

export async function prepare3(): Promise<Stage3Manifest> {
  assertRunnable(process.env, DEV_SHOP_ID);
  const s2 = readStage2Manifest();
  const base = loadSnapshot(s2.snapshots.base, STAGE2_SNAP_DIR);

  // PARA-v2: strip ALL explicit c1 evidence, then insert the three genuine
  // paraphrases. The Stage 2 PARA flaw (term-list bigrams inside the
  // "paraphrases") must not recur — asserted here and in test 30.
  const stripped = removeAttributeEvidence(base, "aluminum_free", [...ALUMINUM_FREE_MATCHING_TERMS]);
  const { snapshot: paraV2 } = insertSentences(
    stripped.snapshot,
    stage2PrimaryContract.productScope.productId,
    PARA_V2_SENTENCES,
  );
  for (const s of PARA_V2_SENTENCES) {
    if (matchingTermsIn(s, [...ALUMINUM_FREE_MATCHING_TERMS]).length > 0) {
      throw new Error(`EXPERIMENT INVALID: PARA-v2 sentence lexically matches the term list: ${s}`);
    }
  }
  const c1 = stage2PrimaryContract.hardConstraints[0]!;
  const explicitHits = scanStore(paraV2, stage2PrimaryContract).perConstraint.find(
    (c) => c.constraintId === c1.id,
  )!;
  if (explicitHits.verdict !== "absent") {
    throw new Error(`EXPERIMENT INVALID: PARA-v2 c1 must be 'absent' at the explicit tier, got '${explicitHits.verdict}'`);
  }

  mkdirSync(STAGE3_SNAP_DIR, { recursive: true });
  saveSnapshot(paraV2, STAGE3_SNAP_DIR);

  const manifest: Stage3Manifest = {
    experimentId: `agentic-stage3-${new Date().toISOString().slice(0, 10)}`,
    shopId: DEV_SHOP_ID,
    snapshots: {
      base: s2.snapshots.base,
      f1: s2.snapshots.f1,
      trap: s2.snapshots.trap,
      paraV2: paraV2.id,
    },
    createdAt: new Date().toISOString(),
  };
  mkdirSync(EXPERIMENT_DIR, { recursive: true });
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[prepare3] paraV2 ${paraV2.id} (hash ${paraV2.contentHash.slice(0, 12)}…) — zero explicit c1 matches`);
  console.log(`[prepare3] reusing stage2 base/f1/trap: ${s2.snapshots.base} / ${s2.snapshots.f1} / ${s2.snapshots.trap}`);
  return manifest;
}

/** Spec 4.1 gate: the scan must detect F1, F2, F5 exactly, with quotes. */
export async function scanStage2(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  const s2 = readStage2Manifest();
  const load = (id: string) => loadSnapshot(id, STAGE2_SNAP_DIR);
  const scan = (id: string) => scanStore(load(id), stage2PrimaryContract);
  const get = (d: ReturnType<typeof scanStore>, cid: string) => d.perConstraint.find((c) => c.constraintId === cid)!;
  const fail = (msg: string): never => {
    throw new Error(`SCAN GATE FAILED: ${msg}`);
  };

  // BASE: every hard constraint evidenced; no conflicts anywhere.
  const base = scan(s2.snapshots.base);
  for (const c of stage2PrimaryContract.hardConstraints) {
    if (get(base, c.id).verdict !== "evidenced") fail(`BASE ${c.id} should be evidenced, got ${get(base, c.id).verdict}`);
  }
  if (base.perConstraint.some((c) => c.verdict === "conflicted")) fail("BASE shows a conflict");
  console.log(`[scan-stage2] BASE: all ${stage2PrimaryContract.hardConstraints.length} constraints evidenced ✓`);

  // F1: c1 absent (evidence gap), everything else still evidenced.
  const f1 = scan(s2.snapshots.f1);
  if (get(f1, "c1-aluminum-free").verdict !== "absent") fail("F1 c1 should be absent");
  console.log(`[scan-stage2] F1: c1-aluminum-free = absent ✓ (evidence gap detected without any journey)`);

  // F2: soft returns constraint conflicted, BOTH sides quoted.
  const f2 = scan(s2.snapshots.f2);
  const f2soft = get(f2, "soft-returns-consistent");
  if (f2soft.verdict !== "conflicted" || f2soft.conflictHits.length < 1) fail("F2 soft-returns should be conflicted with quotes");
  const hit = f2soft.conflictHits[0]!;
  if (!hit.affirmativeQuote || !hit.negativeQuote) fail("F2 conflict quotes missing");
  console.log(`[scan-stage2] F2: conflicted ✓ — "${hit.affirmativeQuote.slice(0, 50)}…" (${hit.affirmativeSurface}) vs "${hit.negativeQuote.slice(0, 50)}…" (${hit.negativeSurface})`);

  // F5: c5 absent.
  const f5 = scan(s2.snapshots.f5);
  if (get(f5, "c5-delivery-resolvable").verdict !== "absent") fail("F5 c5 should be absent");
  console.log(`[scan-stage2] F5: c5-delivery-resolvable = absent ✓ (policy opacity detected without any journey)`);

  // F3/F4 recorded (not gated by spec, reported): contrary + price conflict.
  const f3 = scan(s2.snapshots.f3);
  const f3c3 = get(f3, "c3-variant-purchasable");
  console.log(`[scan-stage2] F3 (recorded): c3 verdict=${f3c3.verdict}, contraryHits=${f3c3.contraryHits.length}`);
  const f4 = scan(s2.snapshots.f4);
  console.log(`[scan-stage2] F4 (recorded): c2 verdict=${get(f4, "c2-price").verdict} (price-source conflict)`);

  console.log("[scan-stage2] GATE ✓ — F1/F2/F5 detected deterministically from the full snapshot, with quotes");
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/run-experiment3.ts");
if (isMain) {
  const cmd = process.argv[2] ?? "";
  const main = async () => {
    switch (cmd) {
      case "prepare3":
        await prepare3();
        break;
      case "scan-stage2":
        await scanStage2();
        break;
      default:
        console.error("usage: npx tsx src/agentic-test/run-experiment3.ts <prepare3|scan-stage2>");
        process.exitCode = 2;
    }
  };
  main()
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[run-experiment3] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
