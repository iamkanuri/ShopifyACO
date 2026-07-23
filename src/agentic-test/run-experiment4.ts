import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePg } from "../db/pg.js";
import { DEV_SHOP_ID } from "./contract.js";
import { PRIMARY_PRODUCT_ID } from "./contract2.js";
import { safeConstraintId } from "./compiler.js";
import { assertRunnable } from "./preflight.js";
import { createStage2Snapshot } from "./snapshot-service.js";
import { loadSnapshot, saveSnapshot } from "./snapshot-service.js";
import { scanStore } from "./store-diagnostic.js";
import {
  assertDevStoreIdentity,
  deleteMetafield,
  readProductState,
  setMetafield,
  writeDescriptionHtml,
} from "./dev-store-client.js";
import {
  clearMarker,
  injectFault,
  readMarker,
  revertFault,
  defaultMarkerWriter,
  assertStateMatchesGroundTruth,
  type FaultIO,
} from "./store-fault.js";
import type { ShoppingTaskContract, StoreSnapshot } from "./types.js";

// ===========================================================================
// STAGE 4 CLI — loop closure on the REAL dev store. Rule 4 discipline: the
// pending-revert marker precedes any fault write; `revert-fault` is always
// available; the stage may not end with the store faulted.
// ===========================================================================

const EXPERIMENT_DIR = join(process.cwd(), "experiments", "agentic-stage4");
const SNAP_DIR = join(EXPERIMENT_DIR, "snapshots");
const MANIFEST_FILE = join(EXPERIMENT_DIR, "experiment-manifest.json");
export const PROMPT_VERSION_STAGE4 = "stage4-v1"; // same text lineage as stage1-v1

/** The Case contract: compiled p1 (telemetry-born) with round-trip-safe ids. */
export const stage4CaseContract: ShoppingTaskContract = {
  id: "stage4-case-p1",
  version: "2",
  objective: "select_purchase_ready_product",
  productScope: { shopId: DEV_SHOP_ID, productId: PRIMARY_PRODUCT_ID },
  hardConstraints: [
    {
      id: safeConstraintId("aluminum_free", 0),
      attribute: "aluminum_free",
      operator: "must_be_true",
      expectedValue: true,
      evidenceRequired: true,
      acceptableSurfaces: ["product_description", "product_metafields", "structured_data", "faq"],
    },
    {
      id: safeConstraintId("variant_price", 1),
      attribute: "variant_price",
      operator: "less_than",
      expectedValue: 20.0,
      evidenceRequired: true,
      acceptableSurfaces: ["product_variants", "structured_data"],
    },
    {
      id: safeConstraintId("subscription_required", 2),
      attribute: "subscription_required",
      operator: "must_be_false",
      expectedValue: false,
      evidenceRequired: true,
      acceptableSurfaces: ["product_description", "faq"],
    },
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
};

export interface Stage4Manifest {
  experimentId: string;
  snapshots: { base?: string; faulted?: string; fixed?: string };
  createdAt: string;
}

export function readStage4Manifest(): Stage4Manifest {
  if (!existsSync(MANIFEST_FILE)) {
    return { experimentId: `agentic-stage4-${new Date().toISOString().slice(0, 10)}`, snapshots: {}, createdAt: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as Stage4Manifest;
}
function writeManifest(m: Stage4Manifest): void {
  mkdirSync(EXPERIMENT_DIR, { recursive: true });
  writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2), "utf8");
}

export function useStage4ResultsDir(): void {
  process.env.AGENTIC_STAGE1_RESULTS_DIR = join(EXPERIMENT_DIR, "results");
}

export function loadAnySnapshot(id: string): StoreSnapshot {
  for (const dir of [SNAP_DIR, join(process.cwd(), "experiments", "agentic-stage3", "snapshots"), join(process.cwd(), "experiments", "agentic-stage2", "snapshots")]) {
    try {
      return loadSnapshot(id, dir);
    } catch {
      /* try next */
    }
  }
  throw new Error(`snapshot ${id} not found in stage 2/3/4 dirs`);
}

const realFaultIO: FaultIO = {
  writeMarker: defaultMarkerWriter,
  writeDescription: writeDescriptionHtml,
  setMetafield,
  deleteMetafield,
};

// ---- commands ---------------------------------------------------------------

/** Snapshot the CURRENT live catalog under a stage-4 role. */
export async function snapshot4(role: "base" | "faulted" | "fixed"): Promise<StoreSnapshot> {
  assertRunnable(process.env, DEV_SHOP_ID);
  const snap = await createStage2Snapshot(DEV_SHOP_ID, PRIMARY_PRODUCT_ID);
  mkdirSync(SNAP_DIR, { recursive: true });
  saveSnapshot(snap, SNAP_DIR);
  const m = readStage4Manifest();
  m.snapshots[role] = snap.id;
  writeManifest(m);
  const scan = scanStore(snap, stage4CaseContract);
  const c1 = scan.perConstraint.find((c) => c.attribute === "aluminum_free")!;
  console.log(`[snapshot4] ${role} = ${snap.id} (hash ${snap.contentHash.slice(0, 12)}…) · scan c1=${c1.verdict} (${c1.explicitHits.length} hits, surfaces: ${c1.relevantSurfaces.join(",") || "none"})`);
  return snap;
}

export async function injectFaultCmd(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  if (readMarker()) throw new Error("a pending-revert marker already exists — resolve it first");
  await assertDevStoreIdentity();
  const live = await readProductState(PRIMARY_PRODUCT_ID);
  const pre = assertStateMatchesGroundTruth({ descriptionHtml: live.descriptionHtml, metafield: live.metafield });
  if (!pre.ok) throw new Error(`refusing to fault: store is not at truthful baseline: ${pre.problems.join("; ")}`);
  const marker = await injectFault(realFaultIO, live);
  // Verify the fault took effect.
  const after = await readProductState(PRIMARY_PRODUCT_ID);
  if (after.descriptionHtml.includes("aluminum") || after.metafield) {
    throw new Error("fault verification failed — store may be partially faulted; run revert-fault");
  }
  console.log(`[inject-fault] fault applied (marker first, ${marker.createdAt}). Store now fails to evidence aluminum_free; ground truth untouched.`);
}

/** Extend the fault to the FAQ page (disclosed spec-reality correction: the
 *  seeded live FAQ also evidences c1, so "store fails to evidence" requires
 *  removing its aluminum Q&A). Marker updated BEFORE the page write. */
export async function faultFaqCmd(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  const marker = readMarker();
  if (!marker) throw new Error("no pending-revert marker — run inject-fault first");
  if (marker.faq) {
    console.log("[fault-faq] already applied");
    return;
  }
  await assertDevStoreIdentity();
  const { gqlDevStore } = await import("./dev-store-client.js");
  const { FAQ_ALUMINUM_QA } = await import("./store-fault.js");
  const pages = await gqlDevStore<{ pages?: { nodes?: Array<{ id: string; title: string; body?: string }> } }>(
    `query($q: String!) { pages(first: 5, query: $q) { nodes { id title body } } }`,
    { q: "title:'FAQ'" },
  );
  const faq = pages.pages?.nodes?.find((n) => n.title === "FAQ");
  if (!faq?.body) throw new Error("FAQ page not found on the store");
  if (!faq.body.includes("aluminum-free")) throw new Error("FAQ has no aluminum claim — nothing to fault");
  const faultedBody = faq.body.replace(FAQ_ALUMINUM_QA, "").replace(/\s{2,}/g, " ").trim();
  if (/alumin/i.test(faultedBody)) throw new Error("FAQ fault would leave an aluminum fragment — expected verbatim Q&A not found");

  const fixtureFile = join(process.cwd(), "experiments", "agentic-stage2", "fixtures", "store-pages.json");
  const fixtureJson = readFileSync(fixtureFile, "utf8");

  // Marker FIRST (Rule 4), then the page write, then the fixture mirror.
  const updated = { ...marker, faq: { pageId: faq.id, restoreBody: faq.body, faultedBody, fixtureFile, restoreFixtureJson: fixtureJson } };
  defaultMarkerWriter(updated);
  const upd = await gqlDevStore<{ pageUpdate?: { userErrors?: Array<{ message?: string }> } }>(
    `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { message } } }`,
    { id: faq.id, page: { body: faultedBody } },
  );
  const errs = upd.pageUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(`pageUpdate userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
  const fixture = JSON.parse(fixtureJson) as { faq: { text: string } };
  fixture.faq.text = faultedBody;
  writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2), "utf8");
  console.log("[fault-faq] FAQ aluminum Q&A removed on the live page + fixture mirrored; marker carries restoration");
}

export async function revertFaultCmd(how = "standalone-revert"): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  const marker = readMarker();
  if (!marker) {
    console.log("[revert-fault] no pending-revert marker — nothing to do");
    return;
  }
  await assertDevStoreIdentity();
  const { gqlDevStore } = await import("./dev-store-client.js");
  await revertFault(realFaultIO, marker, {
    async writePageBody(pageId, body) {
      const upd = await gqlDevStore<{ pageUpdate?: { userErrors?: Array<{ message?: string }> } }>(
        `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { message } } }`,
        { id: pageId, page: { body } },
      );
      const errs = upd.pageUpdate?.userErrors ?? [];
      if (errs.length) throw new Error(`FAQ restore userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
    },
    writeFixture(file, json) {
      writeFileSync(file, json, "utf8");
    },
  });
  const after = await readProductState(PRIMARY_PRODUCT_ID);
  const check = assertStateMatchesGroundTruth({ descriptionHtml: after.descriptionHtml, metafield: after.metafield });
  if (!check.ok) throw new Error(`revert verification FAILED: ${check.problems.join("; ")} — store needs manual attention`);
  clearMarker(how);
  console.log("[revert-fault] store restored to truthful baseline and verified; marker cleared");
}

/** Journeys for the case contract on a given snapshot (semantic tier active). */
export async function journeys4(snapshotId: string, trials: number): Promise<void> {
  useStage4ResultsDir();
  const snapshot = loadAnySnapshot(snapshotId);
  const { createToolClient } = await import("./model-client.js");
  const { runShoppingAgent } = await import("./agent-runner.js");
  const { persistJourneyResult, readCumulativeSpend } = await import("./trace-recorder.js");
  const { createGeminiSemanticClient } = await import("./semantic-tier.js");
  const { computeCoverage } = await import("./store-diagnostic.js");
  const diagnostic = scanStore(snapshot, stage4CaseContract);

  for (const provider of ["openai", "gemini"]) {
    for (let t = 1; t <= trials; t++) {
      const client = createToolClient(provider);
      let result = await runShoppingAgent({
        contract: stage4CaseContract,
        snapshot,
        client,
        trialNumber: t,
        promptVersion: PROMPT_VERSION_STAGE4,
        semanticClient: createGeminiSemanticClient(),
      });
      const cov = computeCoverage(diagnostic, result);
      result = { ...result, coverageRatio: cov.coverageRatio, missedRelevantSurfaces: cov.missedRelevantSurfaces };
      persistJourneyResult(result);
      console.log(
        `[journeys4] ${provider} snap=${snapshot.id.slice(0, 16)} t${t} → ${result.outcome}${result.rootCauseCode ? `/${result.rootCauseCode}` : ""} ` +
          `(declared: ${result.modelDeclaredOutcome ?? "n/a"}) cost=$${result.estimatedCostUsd.toFixed(4)} · cumulative $${readCumulativeSpend().toFixed(4)}`,
      );
    }
  }
}

// ---- CP3: the fix, through Fix Studio's production machinery ---------------

export async function fixStudioCmd(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  const marker = readMarker();
  if (!marker) throw new Error("no pending-revert marker — nothing to fix");
  await assertDevStoreIdentity(); // Amendment 1: before every write step

  const { buildRestorationProposal } = await import("./fix-adapter.js");
  const { createProposal, getProposal } = await import("../db/fixes.js");
  const { approveProposal, applyProposal } = await import("../fixes/apply.js");
  const { pgQuery } = await import("../db/pg.js");

  // Data steps (disclosed): (1) the physical token has write scopes; the local
  // shops row recorded read_products only — update the ROW so the scope GATE is
  // exercised against the truth; (2) re-encrypt the token under THIS process's
  // APP_ENCRYPTION_KEY so Fix Studio's own getAccessToken() decryption path is
  // exercised (earlier syncs used ephemeral keys; production has a stable one).
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY must be set for this command");
  await pgQuery("update shops set scopes='read_products,write_products' where shop_domain=$1", [DEV_SHOP_ID]);
  const { storeCredentials } = await import("../db/shops.js");
  await storeCredentials(DEV_SHOP_ID, process.env.SHOPIFY_DEV_STORE_TOKEN!.trim(), "read_products,write_products");

  // Diagnosis from the faulted snapshot's scan + journey traces.
  const m = readStage4Manifest();
  const faulted = loadAnySnapshot(m.snapshots.faulted!);
  const scan = scanStore(faulted, stage4CaseContract);
  const proposal = buildRestorationProposal(
    {
      constraintId: safeConstraintId("aluminum_free", 0),
      attribute: "aluminum_free",
      rootCause: "EVIDENCE_GAP",
      scan,
      searchedSurfaces: ["product description", "product details (metafields)", "store FAQ", "store search"],
    },
    marker,
  );
  const id = await createProposal(DEV_SHOP_ID, null, null, proposal);
  console.log(`[fix-studio] proposal #${id} created (target ${proposal.target})`);

  const approved = await approveProposal(DEV_SHOP_ID, id, "experiment-auto-approved");
  if (!approved.ok) throw new Error(`approval failed: ${approved.detail}`);
  console.log(`[fix-studio] approved by 'experiment-auto-approved' (disclosure: production renders this as the merchant checkpoint)`);

  const applied = await applyProposal(DEV_SHOP_ID, id, "experiment-auto-approved");
  console.log(`[fix-studio] apply → ${applied.status}${applied.detail ? ` (${applied.detail})` : ""}${applied.conflict ? " CONFLICT" : ""}`);
  if (!applied.ok) throw new Error(`Fix Studio apply failed: ${applied.detail}`);
  const row = await getProposal(id);
  console.log(`[fix-studio] proposal status=${row?.status}; conflict check compared based_on (normalized) and passed; snapshot recorded for rollback`);

  // The fix IS the description revert, executed by the PRODUCTION actuator.
  // Complete the restoration for surfaces outside Fix Studio's writable set
  // (metafield + FAQ page + fixture), via the tagged experiment mechanism.
  await assertDevStoreIdentity();
  await setMetafield(marker.productGid, marker.restore.metafield);
  if (marker.faq) {
    const { gqlDevStore } = await import("./dev-store-client.js");
    const upd = await gqlDevStore<{ pageUpdate?: { userErrors?: Array<{ message?: string }> } }>(
      `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { message } } }`,
      { id: marker.faq.pageId, page: { body: marker.faq.restoreBody } },
    );
    const errs = upd.pageUpdate?.userErrors ?? [];
    if (errs.length) throw new Error(`FAQ restore userErrors: ${JSON.stringify(errs).slice(0, 300)}`);
    writeFileSync(marker.faq.fixtureFile, marker.faq.restoreFixtureJson, "utf8");
  }

  // Verify the full truthful baseline, then clear the marker.
  const after = await readProductState(PRIMARY_PRODUCT_ID);
  const check = assertStateMatchesGroundTruth({ descriptionHtml: after.descriptionHtml, metafield: after.metafield });
  if (!check.ok) throw new Error(`post-fix verification FAILED: ${check.problems.join("; ")}`);
  clearMarker("fix-studio-apply(description) + experiment-completion(metafield,faq)");
  console.log("[fix-studio] store verified at truthful baseline; pending-revert marker cleared (the fix IS the revert)");
}

/** Rollback capability demo on a SEPARATE innocuous change (spec 4.3.4).
 *  Uses seo.description — a fully-mapped Fix Studio field with REAL conflict
 *  semantics (the spec's metafield example is outside Fix Studio's writable
 *  set; substitution disclosed). The store keeps its truthful fixed state. */
export async function rollbackDemoCmd(): Promise<void> {
  assertRunnable(process.env, DEV_SHOP_ID);
  await assertDevStoreIdentity();
  const { createProposal } = await import("../db/fixes.js");
  const { approveProposal, applyProposal, rollbackProposal } = await import("../fixes/apply.js");
  const { gqlDevStore } = await import("./dev-store-client.js");
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY must be set for this command");
  const { storeCredentials } = await import("../db/shops.js");
  const { pgQuery } = await import("../db/pg.js");
  // The intervening catalog sync resets shops.scopes to read_products — restore
  // the truthful scope row so the gate is exercised against reality.
  await pgQuery("update shops set scopes='read_products,write_products' where shop_domain=$1", [DEV_SHOP_ID]);
  await storeCredentials(DEV_SHOP_ID, process.env.SHOPIFY_DEV_STORE_TOKEN!.trim(), "read_products,write_products");

  const readSeo = async () => {
    const d = await gqlDevStore<{ product?: { seo?: { description?: string | null } } }>(
      `query($id: ID!) { product(id: $id) { seo { description } } }`,
      { id: PRIMARY_PRODUCT_ID },
    );
    return d.product?.seo?.description ?? null;
  };
  const before = await readSeo();
  const id = await createProposal(DEV_SHOP_ID, null, null, {
    productGid: PRIMARY_PRODUCT_ID,
    kind: "write_products",
    target: "seo.description",
    label: "Stage 4 rollback-capability probe (innocuous, reverted immediately)",
    currentValue: before,
    proposedValue: "Aluminum-free natural deodorant — small-batch, one-time purchase. (stage4 rollback probe)",
    basedOn: before,
    rationale: "capability demonstration only",
    evidence: { findingKind: "rollback_probe" },
  });
  const ok1 = await approveProposal(DEV_SHOP_ID, id, "experiment-auto-approved");
  if (!ok1.ok) throw new Error(ok1.detail);
  const ok2 = await applyProposal(DEV_SHOP_ID, id, "experiment-auto-approved");
  if (!ok2.ok) throw new Error(`probe apply failed: ${ok2.detail}`);
  const mid = await readSeo();
  console.log(`[rollback-demo] probe applied: seo.description now ${JSON.stringify(mid?.slice(0, 60))}`);
  const ok3 = await rollbackProposal(DEV_SHOP_ID, id, "experiment-auto-approved");
  if (!ok3.ok) throw new Error(`probe rollback failed: ${ok3.detail}`);
  const after = await readSeo();
  const restored = (after ?? "") === (before ?? "");
  console.log(`[rollback-demo] rolled back via Fix Studio; API re-read matches pre-change state: ${restored}`);
  if (!restored) throw new Error(`rollback verification failed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
}

/** Before/after diff with version pins asserted (spec 4.3.5 / test 40). */
export async function rerunDiffCmd(): Promise<void> {
  useStage4ResultsDir();
  const { resultsDir } = await import("./trace-recorder.js");
  const { assertIdenticalRunConfig } = await import("./fix-adapter.js");
  const m = readStage4Manifest();
  const idx = readFileSync(join(resultsDir(), "index.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as { runId: string; contractId: string; snapshotId: string; provider: string; trialNumber: number; promptVersion: string; outcome: string });
  const faulted = idx.filter((e) => e.snapshotId === m.snapshots.faulted && e.contractId === stage4CaseContract.id);
  const fixed = idx.filter((e) => e.snapshotId === m.snapshots.fixed && e.contractId === stage4CaseContract.id);
  if (!faulted.length || !fixed.length) throw new Error("missing faulted/fixed journey sets");
  const pin = (runs: typeof idx) => ({
    contractId: runs[0]!.contractId,
    promptVersion: runs[0]!.promptVersion,
    providers: [...new Set(runs.map((r) => r.provider))],
  });
  assertIdenticalRunConfig(pin(faulted), pin(fixed));

  const rate = (runs: typeof idx, provider: string, outcome: string) => {
    const mine = runs.filter((r) => r.provider === provider);
    return `${mine.filter((r) => r.outcome === outcome).length}/${mine.length}`;
  };
  const diff = {
    contract: stage4CaseContract.id,
    promptVersion: PROMPT_VERSION_STAGE4,
    semanticPromptVersion: (await import("./semantic-tier.js")).SEM_PROMPT_VERSION,
    snapshots: { faulted: m.snapshots.faulted, fixed: m.snapshots.fixed },
    before: {
      openai: { MISSING_EVIDENCE: rate(faulted, "openai", "MISSING_EVIDENCE"), PASS: rate(faulted, "openai", "PASS") },
      gemini: { MISSING_EVIDENCE: rate(faulted, "gemini", "MISSING_EVIDENCE"), PASS: rate(faulted, "gemini", "PASS") },
    },
    after: {
      openai: { MISSING_EVIDENCE: rate(fixed, "openai", "MISSING_EVIDENCE"), PASS: rate(fixed, "openai", "PASS") },
      gemini: { MISSING_EVIDENCE: rate(fixed, "gemini", "MISSING_EVIDENCE"), PASS: rate(fixed, "gemini", "PASS") },
    },
  };
  writeFileSync(join(EXPERIMENT_DIR, "before-after-diff.json"), JSON.stringify(diff, null, 2), "utf8");
  console.log(JSON.stringify(diff, null, 2));
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/run-experiment4.ts");
if (isMain) {
  const cmd = process.argv[2] ?? "";
  const main = async () => {
    switch (cmd) {
      case "snapshot4":
        await snapshot4((process.argv[3] as "base" | "faulted" | "fixed") ?? "base");
        break;
      case "inject-fault":
        await injectFaultCmd();
        break;
      case "fault-faq":
        await faultFaqCmd();
        break;
      case "fix-studio":
        await fixStudioCmd();
        break;
      case "rollback-demo":
        await rollbackDemoCmd();
        break;
      case "rerun-diff":
        await rerunDiffCmd();
        break;
      case "revert-fault":
        await revertFaultCmd();
        break;
      case "journeys4":
        await journeys4(process.argv[3]!, Number(process.argv[4] ?? 2));
        break;
      default:
        console.error("usage: npx tsx src/agentic-test/run-experiment4.ts <snapshot4|inject-fault|revert-fault|journeys4>");
        process.exitCode = 2;
    }
  };
  main()
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[run-experiment4] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
