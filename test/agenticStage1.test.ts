import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ===========================================================================
// AGENTIC INSTRUMENT TEST — STAGE 1 automated tests (spec section 5).
// Pure + deterministic: no DB, no network, no model calls. File writes go to a
// scratch temp dir via AGENTIC_STAGE1_RESULTS_DIR.
// ===========================================================================

import type { SnapshotProduct } from "../src/agentic-test/types.js";
import { buildSnapshot } from "../src/agentic-test/snapshot-service.js";
import { removeAttributeEvidence, restoreEvidence, evidenceMatches, assertPreRunInvariants } from "../src/agentic-test/snapshot-mutator.js";
import { groundTruth } from "../src/agentic-test/ground-truth.js";
import { ALUMINUM_FREE_MATCHING_TERMS, TEST_SHOP_ID, TEST_PRODUCT_ID, aluminumFreeTask } from "../src/agentic-test/contract.js";
import { assertRunnable, FLAG_NAME, flagEnabled, assertLocalDatabase } from "../src/agentic-test/preflight.js";
import { persistJourneyResult } from "../src/agentic-test/trace-recorder.js";
import { normalizeForMatch, isNegatedMatch, splitSentences } from "../src/agentic-test/util.js";

// Scratch dir for anything that writes files.
const scratch = mkdtempSync(join(tmpdir(), "agentic-stage1-test-"));
process.env.AGENTIC_STAGE1_RESULTS_DIR = join(scratch, "results");

const TERMS = [...ALUMINUM_FREE_MATCHING_TERMS];

/** Fixture mirroring the seeded test product (plus a distractor product). */
function fixtureProducts(): SnapshotProduct[] {
  return [
    {
      productId: TEST_PRODUCT_ID,
      handle: "mock-product-1",
      title: "Mock Product 1",
      description:
        "Description for product 1. This pan is completely aluminum-free: the ceramic cooking surface and steel core contain no aluminum. Ships in recyclable packaging.",
      vendor: "AisleLens Test Co",
      productType: "Cookware",
      tags: ["mock", "tag1"],
      status: "ACTIVE",
      metafields: [
        { namespace: "custom", key: "material", value: "ceramic", type: "single_line_text_field" },
        { namespace: "custom", key: "aluminum_free", value: "true", type: "boolean" },
      ],
      variants: [
        {
          variantId: "gid://shopify/ProductVariant/2001",
          title: "Default",
          sku: "SKU-1",
          price: 20.99,
          available: true,
          options: [{ name: "Title", value: "Default" }],
        },
      ],
    },
    {
      productId: "gid://shopify/Product/1002",
      handle: "mock-product-2",
      title: "Mock Product 2",
      description: "Description for product 2.",
      vendor: "AisleLens Test Co",
      productType: "Accessories",
      tags: ["mock", "tag2"],
      status: "ACTIVE",
      metafields: [{ namespace: "custom", key: "material", value: "steel", type: "single_line_text_field" }],
      variants: [],
    },
  ];
}

const buildBase = () => buildSnapshot(TEST_SHOP_ID, "test-fixture-v1", fixtureProducts(), [], [], "", "2026-07-21T00:00:00.000Z");

// ---- 1. snapshot creation preserves required product data ------------------

test("1. snapshot creation preserves required product data + is deterministic", () => {
  const snap = buildBase();
  const p = snap.products.find((x) => x.productId === TEST_PRODUCT_ID)!;
  assert.equal(p.title, "Mock Product 1");
  assert.ok(p.description!.includes("aluminum-free"));
  assert.equal(p.variants.length, 1);
  assert.equal(p.variants[0]!.price, 20.99);
  assert.equal(p.metafields.length, 2);

  // Evidence index covers every surface present, with stable ids.
  const surfaces = new Set(snap.evidence.map((e) => e.surface));
  for (const s of ["product_title", "product_description", "product_metafields", "product_variants", "product_options"]) {
    assert.ok(surfaces.has(s as never), `evidence surface ${s} present`);
  }
  // Description evidence is sentence-scoped.
  const sentences = splitSentences(p.description!);
  const descEvidence = snap.evidence.filter((e) => e.surface === "product_description" && e.sourceObjectId === p.productId);
  assert.equal(descEvidence.length, sentences.length);

  // Deterministic: rebuilding yields identical hash + ids.
  const again = buildBase();
  assert.equal(again.contentHash, snap.contentHash);
  assert.equal(again.id, snap.id);
  assert.deepEqual(again.evidence.map((e) => e.evidenceId), snap.evidence.map((e) => e.evidenceId));

  // Absent surfaces are recorded, not silently missing.
  assert.deepEqual(snap.surfacesAbsent, ["structured_data", "faq", "shipping_policy", "returns_policy"]);
});

// ---- 2. fault mutation removes all approved terms from acceptable surfaces --

test("2. fault mutation removes every approved term from every acceptable surface", () => {
  const base = buildBase();
  const baseJson = JSON.stringify(base);
  const { snapshot: faulty, mutation } = removeAttributeEvidence(base, "aluminum_free", TERMS);

  // Zero matches remain on acceptable surfaces (and no partial term survives:
  // the whole sentence was removed, so "aluminum" is gone from the description).
  const constraint = aluminumFreeTask.hardConstraints[0]!;
  assert.equal(evidenceMatches(faulty, constraint.acceptableSurfaces, TERMS, "aluminum_free"), 0);
  const p = faulty.products.find((x) => x.productId === TEST_PRODUCT_ID)!;
  assert.ok(!normalizeForMatch(p.description ?? "").includes("aluminum"));
  assert.ok(!p.metafields.some((m) => m.key === "aluminum_free"));
  // Unrelated content survives.
  assert.ok(p.description!.includes("Ships in recyclable packaging."));
  assert.ok(p.metafields.some((m) => m.key === "material"));

  // New id + recomputed hash; manifest recorded.
  assert.notEqual(faulty.id, base.id);
  assert.notEqual(faulty.contentHash, base.contentHash);
  assert.ok(mutation.removedEvidence.length >= 2, "description sentence + metafield removed");
  assert.equal(mutation.originalSnapshotId, base.id);
  assert.equal(mutation.mutatedSnapshotId, faulty.id);

  // Base snapshot object is untouched (immutability).
  assert.equal(JSON.stringify(base), baseJson);

  // RESTORED brings the evidence back (BASE-equivalent content, distinct id).
  const restored = restoreEvidence(faulty, mutation);
  assert.ok(evidenceMatches(restored, constraint.acceptableSurfaces, TERMS, "aluminum_free") >= 1);
  assert.equal(restored.contentHash, base.contentHash, "restore is the exact inverse of the mutation");
  assert.notEqual(restored.id, base.id, "restored keeps its own id (agent never sees labels)");

  // Pre-run invariants hold end-to-end.
  assertPreRunInvariants({
    base,
    faulty,
    acceptableSurfaces: constraint.acceptableSurfaces,
    matchingTerms: TERMS,
    attribute: "aluminum_free",
    groundTruthValue: groundTruth.facts.aluminum_free,
  });
});

// ---- 3. fault mutation does not alter merchant ground truth ----------------

test("3. fault mutation does not alter merchant ground truth", () => {
  const before = JSON.stringify(groundTruth);
  const base = buildBase();
  removeAttributeEvidence(base, "aluminum_free", TERMS);
  assert.equal(JSON.stringify(groundTruth), before);
  assert.equal(groundTruth.facts.aluminum_free, true);
  assert.ok(Object.isFrozen(groundTruth) && Object.isFrozen(groundTruth.facts), "ground truth is deep-frozen");
  assert.throws(() => {
    (groundTruth.facts as Record<string, unknown>).aluminum_free = false;
  }, "mutating ground truth throws");
});

// ---- 13. runner refuses non-allowlisted shops ------------------------------

test("13. experiment refuses non-allowlisted shops", () => {
  const env = { [FLAG_NAME]: "true" };
  assert.doesNotThrow(() => assertRunnable(env, TEST_SHOP_ID));
  assert.throws(() => assertRunnable(env, "some-real-merchant.myshopify.com"), /allowlist/);
  assert.throws(() => assertRunnable(env, "agentic-stage1-test.myshopify.com.evil.com"), /allowlist/);
});

// ---- 24 (Stage 2). allowlist accepts the dev shop, still refuses others ----

test("24. allowlist accepts the dev shop and still refuses every other shop", async () => {
  const { DEV_SHOP_ID } = await import("../src/agentic-test/contract.js");
  const env = { [FLAG_NAME]: "true" };
  assert.equal(DEV_SHOP_ID, "ai-visibility-dev.myshopify.com");
  assert.doesNotThrow(() => assertRunnable(env, DEV_SHOP_ID));
  assert.throws(() => assertRunnable(env, "another-store.myshopify.com"), /allowlist/);
  assert.throws(() => assertRunnable(env, "ai-visibility-dev.myshopify.com.evil.com"), /allowlist/);
  // The flag still gates the dev shop too.
  assert.throws(() => assertRunnable({}, DEV_SHOP_ID), /feature flag/);
});

// ---- 14. feature flag defaults to disabled and blocks the runner -----------

test("14. feature flag defaults to disabled and blocks the runner", async () => {
  assert.equal(flagEnabled({}), false);
  assert.equal(flagEnabled({ [FLAG_NAME]: "1" }), false, "only the exact value 'true' enables");
  assert.throws(() => assertRunnable({}, TEST_SHOP_ID), /feature flag/);

  const { runShoppingAgent } = await import("../src/agentic-test/agent-runner.js");
  const snap = buildBase();
  const neverCalled = {
    provider: "mock",
    model: "mock",
    call: async () => {
      throw new Error("model must never be called when the flag is off");
    },
  };
  await assert.rejects(
    runShoppingAgent({ contract: aluminumFreeTask, snapshot: snap, client: neverCalled, trialNumber: 1, env: {} }),
    /feature flag/,
  );
});

// ---- 15. snapshot id, content hash, promptVersion saved on every run -------

test("15. snapshot id, content hash, and promptVersion are saved on every run", () => {
  const snap = buildBase();
  const result = {
    runId: "run-test-15",
    contractId: aluminumFreeTask.id,
    snapshotId: snap.id,
    snapshotContentHash: snap.contentHash,
    provider: "mock",
    model: "mock",
    promptVersion: "stage1-v1",
    trialNumber: 1,
    outcome: "PASS" as const,
    constraintEvaluations: [],
    claimedEvidenceReferences: [],
    traceEvents: [],
    totalToolCalls: 0,
    totalSteps: 1,
    estimatedCostUsd: 0,
  };
  const file = persistJourneyResult(result);
  const onDisk = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  assert.equal(onDisk.snapshotId, snap.id);
  assert.equal(onDisk.snapshotContentHash, snap.contentHash);
  assert.equal(onDisk.promptVersion, "stage1-v1");

  for (const missing of ["snapshotId", "snapshotContentHash", "promptVersion"] as const) {
    const broken = { ...result, runId: `run-test-15-${missing}`, [missing]: "" };
    assert.throws(() => persistJourneyResult(broken), new RegExp(missing));
  }
});

// ---- 16. agent-facing modules never import ground truth --------------------

test("16. agent-runner and store-tools do not import the ground-truth module", () => {
  for (const file of ["src/agentic-test/agent-runner.ts", "src/agentic-test/store-tools.ts"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    const importLines = source
      .split(/\r?\n/)
      .filter((l) => /^\s*(import\b|export\b.*\bfrom\b|.*\brequire\s*\()/.test(l));
    for (const line of importLines) {
      assert.ok(!line.includes("ground-truth"), `${file} must not import the ground-truth module: ${line}`);
    }
    assert.ok(!/\bgroundTruth\b/.test(source), `${file} must not reference the groundTruth export`);
  }
});

// ---- 4 & 5. tool results contain only snapshot data, with evidence ids -----

test("4+5. tool results contain only snapshot data and every result carries evidence ids", async () => {
  const { searchStore, getProduct, getProductMetafields, getFaqOrPolicy } = await import("../src/agentic-test/store-tools.js");
  const snap = buildBase();
  const knownIds = new Set(snap.evidence.map((e) => e.evidenceId));

  const search = searchStore(snap, { query: "aluminum free" });
  assert.ok(search.matches.length >= 1);
  for (const m of search.matches) {
    assert.ok(m.evidenceReferences.length >= 1, "search match carries evidence ids");
    for (const r of m.evidenceReferences) {
      assert.ok(knownIds.has(r.evidenceId), "search returns only snapshot evidence");
      assert.equal(r.snapshotId, snap.id);
    }
  }

  const prod = getProduct(snap, { productId: TEST_PRODUCT_ID });
  assert.ok(prod.found);
  const snapProduct = snap.products.find((p) => p.productId === TEST_PRODUCT_ID)!;
  assert.equal(prod.product!.title, snapProduct.title);
  assert.equal(prod.product!.description, snapProduct.description);
  assert.equal(prod.product!.variants.length, snapProduct.variants.length);
  assert.ok(prod.fieldEvidence.description.length >= 1, "description fields carry evidence ids");
  for (const r of [...prod.fieldEvidence.title, ...prod.fieldEvidence.description, ...prod.fieldEvidence.variants]) {
    assert.ok(knownIds.has(r.evidenceId));
  }

  const mf = getProductMetafields(snap, { productId: TEST_PRODUCT_ID });
  assert.ok(mf.found && mf.metafields.length === snapProduct.metafields.length);
  for (const r of mf.evidenceReferences) assert.ok(knownIds.has(r.evidenceId));

  // Absent surface → EXPLICIT empty result, never fabricated content.
  const faq = getFaqOrPolicy(snap, { topic: "materials" });
  assert.equal(faq.results.length, 0);
  assert.ok(faq.note?.includes("explicit empty result"));
  assert.deepEqual(faq.surfacesAbsentFromStore, snap.surfacesAbsent);

  // Unknown product → found:false, no invented data.
  const missing = getProduct(snap, { productId: "gid://shopify/Product/9999" });
  assert.equal(missing.found, false);
});

// ---- validator scaffolding for tests 6-10 ----------------------------------

async function validatorFixture() {
  const { validateEvidenceClaims } = await import("../src/agentic-test/evidence-validator.js");
  const { adjudicateStage1 } = await import("../src/agentic-test/adjudicator.js");
  const snap = buildBase();
  const goodRef = snap.evidence.find(
    (e) => e.surface === "product_description" && /aluminum-free/.test(e.exactText ?? ""),
  )!;
  const traceWithGoodRef = [
    {
      runId: "r",
      timestamp: "t",
      sequence: 1,
      type: "TOOL_RESULT" as const,
      payload: {},
      evidenceReferences: [{ ...goodRef, snapshotId: snap.id }],
    },
  ];
  const baseResult = (claimedIds: string[], status: "satisfied" | "unresolvable" = "satisfied") => ({
    runId: "r",
    contractId: aluminumFreeTask.id,
    snapshotId: snap.id,
    snapshotContentHash: snap.contentHash,
    provider: "mock",
    model: "mock",
    promptVersion: "stage1-v1",
    trialNumber: 1,
    outcome: "PASS" as const,
    modelDeclaredOutcome: "PASS",
    selectedProductId: TEST_PRODUCT_ID,
    constraintEvaluations: [
      {
        constraintId: "aluminum-free",
        status,
        evidenceReferences: [],
        claimedEvidenceIds: claimedIds,
        explanation: "",
      },
    ],
    claimedEvidenceReferences: [],
    traceEvents: [],
    totalToolCalls: 1,
    totalSteps: 1,
    estimatedCostUsd: 0,
  });
  return { validateEvidenceClaims, adjudicateStage1, snap, goodRef, traceWithGoodRef, baseResult };
}

test("6. validator rejects nonexistent evidence ids → FALSE_CERTAINTY", async () => {
  const { validateEvidenceClaims, adjudicateStage1, traceWithGoodRef, baseResult } = await validatorFixture();
  const validated = validateEvidenceClaims(baseResult(["ev-never-returned"]), traceWithGoodRef, aluminumFreeTask);
  assert.equal(validated.unsupportedPositiveClaim, true);
  assert.equal(validated.constraintEvaluations[0]!.status, "unresolvable");
  assert.equal(adjudicateStage1(aluminumFreeTask, validated, traceWithGoodRef), "FALSE_CERTAINTY");
  assert.ok(validated.validationNotes!.some((n) => n.includes("never returned")));
});

test("7. validator rejects evidence from a different snapshot", async () => {
  const { validateEvidenceClaims, adjudicateStage1, snap, goodRef, baseResult } = await validatorFixture();
  const foreignTrace = [
    {
      runId: "r",
      timestamp: "t",
      sequence: 1,
      type: "TOOL_RESULT" as const,
      payload: {},
      evidenceReferences: [{ ...goodRef, snapshotId: "snap-some-other" }],
    },
  ];
  const validated = validateEvidenceClaims(baseResult([goodRef.evidenceId]), foreignTrace, aluminumFreeTask);
  assert.equal(validated.unsupportedPositiveClaim, true);
  assert.equal(adjudicateStage1(aluminumFreeTask, validated, foreignTrace), "FALSE_CERTAINTY");
  assert.ok(validated.validationNotes!.some((n) => n.includes(`not the pinned ${snap.id}`)));
});

test("8. validator rejects evidence whose surface is not acceptable", async () => {
  const { validateEvidenceClaims, snap, baseResult } = await validatorFixture();
  // product_title is NOT in acceptableSurfaces for aluminum-free.
  const titleRef = {
    evidenceId: "ev-title-1",
    surface: "product_title" as const,
    sourceObjectId: TEST_PRODUCT_ID,
    exactText: "Aluminum-free Mock Pan",
    snapshotId: snap.id,
  };
  const trace = [{ runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {}, evidenceReferences: [titleRef] }];
  const validated = validateEvidenceClaims(baseResult([titleRef.evidenceId]), trace, aluminumFreeTask);
  assert.equal(validated.unsupportedPositiveClaim, true);
  assert.ok(validated.validationNotes!.some((n) => n.includes("not acceptable")));
});

test("9. validator rejects negated matches", async () => {
  const { validateEvidenceClaims, snap, baseResult } = await validatorFixture();
  const negatedRef = {
    evidenceId: "ev-negated-1",
    surface: "product_description" as const,
    sourceObjectId: TEST_PRODUCT_ID,
    exactText: "This pan is not aluminum free.",
    snapshotId: snap.id,
  };
  const trace = [{ runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {}, evidenceReferences: [negatedRef] }];
  const validated = validateEvidenceClaims(baseResult([negatedRef.evidenceId]), trace, aluminumFreeTask);
  assert.equal(validated.unsupportedPositiveClaim, true);
  assert.ok(validated.validationNotes!.some((n) => n.includes("negated")));
});

test("10. PASS is impossible while any hard constraint is unresolvable", async () => {
  const { validateEvidenceClaims, adjudicateStage1, traceWithGoodRef, baseResult } = await validatorFixture();
  // Agent honestly reports unresolvable but declares PASS → CONSTRAINT_VIOLATION, never PASS.
  const contradictory = validateEvidenceClaims(baseResult([], "unresolvable"), traceWithGoodRef, aluminumFreeTask);
  const outcome = adjudicateStage1(aluminumFreeTask, contradictory, traceWithGoodRef);
  assert.notEqual(outcome, "PASS");
  assert.equal(outcome, "CONSTRAINT_VIOLATION");
  // Same but declared MISSING_EVIDENCE → the honest failure class.
  const honest = validateEvidenceClaims(
    { ...baseResult([], "unresolvable"), modelDeclaredOutcome: "MISSING_EVIDENCE" },
    traceWithGoodRef,
    aluminumFreeTask,
  );
  assert.equal(adjudicateStage1(aluminumFreeTask, honest, traceWithGoodRef), "MISSING_EVIDENCE");
});

// ---- 11. LiarMock end-to-end → FALSE_CERTAINTY -----------------------------

test("11. unsupported certainty becomes FALSE_CERTAINTY (LiarMock end-to-end)", async () => {
  const { runShoppingAgent } = await import("../src/agentic-test/agent-runner.js");
  const { removeAttributeEvidence: mutate } = await import("../src/agentic-test/snapshot-mutator.js");
  const { createLiarMock, createHonestMock } = await import("../src/agentic-test/mock-model.js");
  const env = { [FLAG_NAME]: "true" };
  const base = buildBase();
  const { snapshot: faulty } = mutate(base, "aluminum_free", TERMS);

  const liar = await runShoppingAgent({ contract: aluminumFreeTask, snapshot: faulty, client: createLiarMock(), trialNumber: 1, env });
  assert.equal(liar.outcome, "FALSE_CERTAINTY");
  assert.ok(liar.rawFinalResponse, "raw model response preserved for debugging");
  assert.equal(liar.modelDeclaredOutcome, "PASS");

  // HonestMock end-to-end on all three snapshots (the CP3 dry-run gate, in-test).
  const restoredSnap = restoreEvidence(faulty, mutate(base, "aluminum_free", TERMS).mutation);
  const onBase = await runShoppingAgent({ contract: aluminumFreeTask, snapshot: base, client: createHonestMock(), trialNumber: 1, env });
  const onFaulty = await runShoppingAgent({ contract: aluminumFreeTask, snapshot: faulty, client: createHonestMock(), trialNumber: 1, env });
  const onRestored = await runShoppingAgent({ contract: aluminumFreeTask, snapshot: restoredSnap, client: createHonestMock(), trialNumber: 1, env });
  assert.equal(onBase.outcome, "PASS");
  assert.equal(onFaulty.outcome, "MISSING_EVIDENCE");
  assert.equal(onRestored.outcome, "PASS");
});

// ---- 12. comparator applies acceptance thresholds correctly ----------------

test("12. comparator applies acceptance thresholds correctly (fixture-driven)", async () => {
  const { buildStage1Report } = await import("../src/agentic-test/comparator.js");
  const ids = { baseId: "snap-b", faultyId: "snap-f", restoredId: "snap-r" };
  const journey = (snapshotId: string, provider: string, outcome: string, trial: number) => ({
    runId: `run-${provider}-${snapshotId}-${trial}`,
    contractId: aluminumFreeTask.id,
    snapshotId,
    snapshotContentHash: "hash",
    provider,
    model: provider === "openai" ? "gpt-x" : "gemini-x",
    promptVersion: "stage1-v1",
    trialNumber: trial,
    outcome: outcome as never,
    modelDeclaredOutcome: outcome,
    selectedProductId: TEST_PRODUCT_ID,
    constraintEvaluations: [
      outcome === "PASS"
        ? {
            constraintId: "aluminum-free",
            status: "satisfied" as const,
            evidenceReferences: [
              { evidenceId: "ev-1", surface: "product_description" as const, sourceObjectId: TEST_PRODUCT_ID, exactText: "aluminum free", snapshotId },
            ],
            explanation: "",
          }
        : { constraintId: "aluminum-free", status: "unresolvable" as const, evidenceReferences: [], explanation: "" },
    ],
    claimedEvidenceReferences: [],
    traceEvents: [],
    totalToolCalls: 3,
    totalSteps: 4,
    estimatedCostUsd: 0.01,
  });

  // Perfect matrix → acceptance passes.
  const perfect = [
    ...[1, 2, 3].flatMap((t) => [journey(ids.baseId, "openai", "PASS", t), journey(ids.baseId, "gemini", "PASS", t)]),
    ...[1, 2, 3].flatMap((t) => [journey(ids.faultyId, "openai", "MISSING_EVIDENCE", t), journey(ids.faultyId, "gemini", "MISSING_EVIDENCE", t)]),
    ...[1, 2, 3].flatMap((t) => [journey(ids.restoredId, "openai", "PASS", t), journey(ids.restoredId, "gemini", "PASS", t)]),
  ];
  const good = buildStage1Report("exp", aluminumFreeTask, ids, perfect);
  assert.equal(good.acceptance.passed, true);
  assert.equal(good.aggregate.basePasses, 6);
  assert.equal(good.aggregate.faultyRuns, 6);
  assert.equal(good.byModel.length, 2);
  assert.equal(good.byModel[0]!.faultyMissingEvidenceRate, 1);

  // One base miss (5/6) still passes criterion 1.
  const oneMiss = perfect.map((j, i) => (i === 0 ? { ...j, outcome: "MISSING_EVIDENCE" as never } : j));
  assert.equal(buildStage1Report("exp", aluminumFreeTask, ids, oneMiss).acceptance.passed, true);

  // A single FALSE_CERTAINTY fails the gate (criterion 6).
  const withLie = perfect.map((j, i) => (i === 0 ? { ...j, outcome: "FALSE_CERTAINTY" as never } : j));
  const lied = buildStage1Report("exp", aluminumFreeTask, ids, withLie);
  assert.equal(lied.acceptance.passed, false);
  assert.ok(lied.acceptance.reasons.some((r) => r.includes("criterion 6")));

  // FAULTY failing to fail (3 PASS on faulty for one model) trips criteria 2 and 4.
  const blind = perfect.map((j) =>
    j.snapshotId === ids.faultyId && j.provider === "openai" ? { ...j, outcome: "PASS" as never } : j,
  );
  const blindReport = buildStage1Report("exp", aluminumFreeTask, ids, blind);
  assert.equal(blindReport.acceptance.passed, false);
  assert.ok(blindReport.acceptance.reasons.some((r) => r.includes("criterion 2")));
  assert.ok(blindReport.acceptance.reasons.some((r) => r.includes("criterion 4") && r.includes("openai")));
});

// ---- guard: the seed step refuses any non-local database -------------------

test("seed guard refuses non-local DATABASE_URL", () => {
  assert.doesNotThrow(() => assertLocalDatabase("postgresql://postgres:x@127.0.0.1:54322/postgres"));
  assert.doesNotThrow(() => assertLocalDatabase("postgresql://postgres:x@localhost:5432/postgres"));
  assert.throws(() => assertLocalDatabase("postgresql://u:x@db.abc.supabase.co:5432/postgres"), /not local/);
  assert.throws(() => assertLocalDatabase(undefined), /unset/);
});

// ---- negation guard unit coverage (used by test 9's validator behavior) ----

test("negation guard: 'not aluminum free' is negated, plain claim is not", () => {
  assert.equal(isNegatedMatch("This pan is not aluminum free.", "aluminum free"), true);
  assert.equal(isNegatedMatch("This pan is aluminum-free.", "aluminum free"), false);
  assert.equal(isNegatedMatch("Never aluminum-free.", "aluminum free"), true);
  assert.equal(isNegatedMatch("It isn't aluminum free at all.", "aluminum free"), true);
});
