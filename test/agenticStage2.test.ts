import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Trace/result writes from e2e mock runs go to a scratch dir, not the repo.
process.env.AGENTIC_STAGE1_RESULTS_DIR = join(mkdtempSync(join(tmpdir(), "agentic-stage2-test-")), "results");

// ===========================================================================
// AGENTIC INSTRUMENT TEST — STAGE 2 automated tests (spec S2 §5, tests 17–25;
// 24 lives in the Stage 1 file next to its siblings). Pure and deterministic.
// Tests that examine committed experiment artifacts (22, 25) skip when the
// artifacts have not been generated yet.
// ===========================================================================

import type { SnapshotProduct, StoreSnapshot } from "../src/agentic-test/types.js";
import { buildSnapshot, STAGE2_SURFACES_ABSENT } from "../src/agentic-test/snapshot-service.js";
import {
  injectContradiction,
  insertSentences,
  removeAttributeEvidence,
  removePolicyEvidence,
  setVariantUnavailable,
  skewStructuredPrice,
} from "../src/agentic-test/snapshot-mutator.js";
import { rootCauseFor } from "../src/agentic-test/adjudicator.js";
import {
  ALUMINUM_CONFLICT_PAIR,
  DELIVERY_TIMING_TERMS,
  RETURNS_CONFLICT_PAIR,
  stage2PrimaryContract,
  stage2SecondaryContract,
} from "../src/agentic-test/contract2.js";
import { ALUMINUM_FREE_MATCHING_TERMS } from "../src/agentic-test/contract.js";
import { matchingTermsIn } from "../src/agentic-test/util.js";

const TERMS = [...ALUMINUM_FREE_MATCHING_TERMS];
const STAGE2_DIR = join(process.cwd(), "experiments", "agentic-stage2");
const MANIFEST = join(STAGE2_DIR, "experiment-manifest.json");
const hasArtifacts = existsSync(MANIFEST);

function loadRole(role: string): StoreSnapshot {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { snapshots: Record<string, string> };
  return JSON.parse(readFileSync(join(STAGE2_DIR, "snapshots", `${manifest.snapshots[role]}.json`), "utf8")) as StoreSnapshot;
}

/** Small pure fixture mirroring the seeded store shapes (NOT the real snapshot). */
function fixtureSnapshot(): StoreSnapshot {
  const products: SnapshotProduct[] = [
    {
      productId: "gid://shopify/Product/1",
      handle: "deo",
      title: "Deo",
      description:
        "Our aluminum-free formula uses arrowroot. Every stick is a one-time purchase, no subscription required. Glides on clear.",
      vendor: "X",
      productType: "Deodorant",
      tags: [],
      status: "ACTIVE",
      metafields: [
        { namespace: "custom", key: "aluminum_free", value: "true", type: "boolean" },
        { namespace: "custom", key: "price", value: "$14.00", type: "single_line_text_field" },
      ],
      variants: [
        { variantId: "v-req", title: "Unscented / 2.5 oz", sku: null, price: 14, available: true, options: [] },
        { variantId: "v-sib", title: "Cedar / 2.5 oz", sku: null, price: 14, available: true, options: [] },
      ],
    },
  ];
  return buildSnapshot(
    "agentic-stage1-test.myshopify.com",
    "fixture-v2",
    products,
    [{ pageId: "page:faq", surface: "faq", title: "FAQ", text: "Free returns within 30 days of delivery. Everything is a one-time purchase. Every formula we sell is aluminum-free." }],
    [{ policyId: "policy:shipping", surface: "shipping_policy", text: "Orders placed before 2 PM ET ship the same day. Standard shipping arrives in 2 to 4 business days anywhere." }],
    "",
    "2026-07-22T00:00:00.000Z",
    STAGE2_SURFACES_ABSENT,
  );
}

// ---- 17. each mutator changes exactly its target and nothing else ----------

test("17a. injectContradiction (F2) appends only the contradiction sentence", () => {
  const base = fixtureSnapshot();
  const baseJson = JSON.stringify(base);
  const { snapshot: f2, mutation } = injectContradiction(base, "gid://shopify/Product/1", "Please note: all natural products are final sale.");
  assert.equal(JSON.stringify(base), baseJson, "base immutable");
  const p = f2.products[0]!;
  assert.ok(p.description!.endsWith("Please note: all natural products are final sale."));
  assert.deepEqual(p.metafields, base.products[0]!.metafields);
  assert.deepEqual(p.variants, base.products[0]!.variants);
  assert.deepEqual(f2.pages, base.pages);
  assert.deepEqual(f2.policies, base.policies);
  assert.notEqual(f2.contentHash, base.contentHash);
  assert.equal(mutation.type, "INJECT_CONTRADICTION");
  // Both conflict-pair sides now present (faq affirmative + injected negative).
  const texts = f2.evidence.map((e) => e.exactText ?? "");
  assert.ok(texts.some((t) => matchingTermsIn(t, RETURNS_CONFLICT_PAIR.affirmative).length > 0));
  assert.ok(texts.some((t) => matchingTermsIn(t, RETURNS_CONFLICT_PAIR.negative).length > 0));
});

test("17b. setVariantUnavailable (F3) flips only the required variant", () => {
  const base = fixtureSnapshot();
  const { snapshot: f3, mutation } = setVariantUnavailable(base, "v-req");
  const p = f3.products[0]!;
  assert.equal(p.variants.find((v) => v.variantId === "v-req")!.available, false);
  assert.equal(p.variants.find((v) => v.variantId === "v-sib")!.available, true);
  assert.equal(p.description, base.products[0]!.description);
  assert.deepEqual(p.metafields, base.products[0]!.metafields);
  assert.equal(mutation.targetVariantId, "v-req");
  // Refuses to strand the product with no purchasable sibling.
  const single = fixtureSnapshot();
  single.products[0]!.variants = [single.products[0]!.variants[0]!];
  assert.throws(() => setVariantUnavailable(single, "v-req"), /sibling/);
});

test("17c. skewStructuredPrice (F4 fallback) changes only the price metafield", () => {
  const base = fixtureSnapshot();
  const { snapshot: f4, mutation } = skewStructuredPrice(base, "gid://shopify/Product/1", "$24.00");
  const p = f4.products[0]!;
  assert.equal(p.metafields.find((m) => m.key === "price")!.value, "$24.00");
  assert.equal(p.metafields.find((m) => m.key === "aluminum_free")!.value, "true");
  assert.equal(p.variants[0]!.price, 14, "variant price untouched");
  assert.equal(p.description, base.products[0]!.description);
  assert.equal(mutation.priceSkew?.from, "$14.00");
  assert.equal(mutation.priceSkew?.to, "$24.00");
  assert.ok(mutation.priceSkew?.substitutionNote?.includes("fallback"), "substitution recorded per Appendix B");
});

test("17d. removePolicyEvidence (F5) strips exactly the timing sentences", () => {
  const base = fixtureSnapshot();
  const { snapshot: f5, mutation } = removePolicyEvidence(base, [...DELIVERY_TIMING_TERMS]);
  const remaining = [...f5.pages.map((x) => x.text), ...f5.policies.map((x) => x.text)];
  assert.ok(remaining.every((t) => matchingTermsIn(t, [...DELIVERY_TIMING_TERMS]).length === 0));
  // Non-timing FAQ content survives; product surfaces untouched.
  assert.ok(f5.pages[0]!.text.includes("Free returns within 30 days"));
  assert.deepEqual(f5.products, base.products);
  assert.ok(mutation.removedEvidence.length >= 2, "policy + any timing FAQ sentence recorded");
});

test("17e. removeAttributeEvidence (F1) on the v2 shape clears description, metafield, AND faq", () => {
  const base = fixtureSnapshot();
  const { snapshot: f1 } = removeAttributeEvidence(base, "aluminum_free", TERMS);
  const c1 = stage2PrimaryContract.hardConstraints[0]!;
  const texts = f1.evidence.filter((e) => c1.acceptableSurfaces.includes(e.surface)).map((e) => e.exactText ?? "");
  assert.ok(texts.every((t) => matchingTermsIn(t, TERMS).length === 0));
  assert.ok(!f1.products[0]!.metafields.some((m) => m.key === "aluminum_free"));
  assert.ok(f1.pages[0]!.text.includes("Free returns"), "unrelated FAQ sentences survive");
});

// ---- 19. root-cause mapping is exhaustive for the contract -----------------

test("19. rootCauseCode mapping is exhaustive for every v2 constraint", () => {
  const statuses = ["unresolvable", "violated", "conflicting"] as const;
  const all = [
    ...stage2PrimaryContract.hardConstraints,
    ...(stage2PrimaryContract.softConstraints ?? []),
    ...stage2SecondaryContract.hardConstraints,
  ];
  for (const c of all) {
    for (const s of statuses) {
      assert.doesNotThrow(() => rootCauseFor(c.attribute, s), `${c.attribute} × ${s} must be mapped`);
    }
  }
  assert.equal(rootCauseFor("aluminum_free", "unresolvable"), "EVIDENCE_GAP");
  assert.equal(rootCauseFor("required_variant_in_stock", "violated"), "INVENTORY_MISMATCH");
  assert.equal(rootCauseFor("variant_price", "violated", { priceDisagree: true }), "STALE_STRUCTURED_DATA");
  assert.equal(rootCauseFor("variant_price", "violated", { priceDisagree: false }), "PRICE_VIOLATION");
  assert.equal(rootCauseFor("variant_price", "conflicting", { priceDisagree: true }), "STALE_STRUCTURED_DATA");
  assert.equal(rootCauseFor("delivery_timing", "unresolvable"), "POLICY_OPACITY");
  assert.equal(rootCauseFor("returns_policy_consistent", "conflicting"), "CONTRADICTION");
  assert.throws(() => rootCauseFor("unknown_attribute", "violated"), /exhaustive/);
});

// ---- 22. PARA/TRAP fixture assertions (committed artifacts) ----------------

test("22. PARA/TRAP snapshots match their probe design", { skip: !hasArtifacts }, () => {
  const c1 = stage2PrimaryContract.hardConstraints[0]!;
  const para = loadRole("para");
  const trap = loadRole("trap");
  const primaryOf = (s: StoreSnapshot) => s.products.find((p) => p.productId === stage2PrimaryContract.productScope.productId)!;

  // PARA: original evidence (metafield + seeded sentence) gone; the three exact
  // paraphrases present; sentence 3 invisible to the lexical tier. DISCLOSED
  // fixture reality (AUDIT.md): sentences 1–2 DO contain term-list bigrams, so
  // the spec's blanket "zero term-list matches" is unsatisfiable as written.
  assert.ok(!primaryOf(para).metafields.some((m) => m.key === "aluminum_free"));
  const paraDesc = primaryOf(para).description ?? "";
  for (const s of ["Formulated without aluminum salts of any kind.", "Contains no aluminum compounds.", "Zero aluminum in the formula."]) {
    assert.ok(paraDesc.includes(s), `PARA paraphrase present: ${s}`);
  }
  assert.equal(matchingTermsIn("Zero aluminum in the formula.", TERMS).length, 0);

  // TRAP: ≥1 lexical term-list match on c1 surfaces — and every match is the
  // packaging sentence (no genuine product-level claim exists).
  const trapMatches = trap.evidence.filter(
    (e) => c1.acceptableSurfaces.includes(e.surface) && e.exactText && matchingTermsIn(e.exactText, TERMS).length > 0,
  );
  assert.ok(trapMatches.length >= 1, "TRAP lexically matches the term list (that is the trap)");
  assert.ok(trapMatches.every((e) => e.exactText!.includes("recyclable packaging")));
});

// ---- 25. real-ingestion snapshot preserves the audited surfaces ------------

test("25. real-ingestion BASE snapshot has variants+availability and audited surfaces", { skip: !hasArtifacts }, () => {
  const base = loadRole("base");
  const primary = base.products.find((p) => p.productId === stage2PrimaryContract.productScope.productId)!;
  assert.ok(primary, "primary product present");
  assert.equal(primary.variants.length, 4);
  for (const v of primary.variants) {
    assert.equal(typeof v.available, "boolean", "availability captured per variant");
    assert.equal(v.price, 14);
    assert.ok(v.options.length >= 2, "selectedOptions captured");
  }
  assert.ok(primary.metafields.length >= 2, "metafields captured");
  const surfaces = new Set(base.evidence.map((e) => e.surface));
  for (const s of ["product_title", "product_description", "product_metafields", "product_variants", "product_options", "faq", "shipping_policy"]) {
    assert.ok(surfaces.has(s as never), `surface ${s} present`);
  }
  assert.deepEqual(base.surfacesAbsent, ["structured_data", "returns_policy"]);
  assert.ok(base.products.length > 2, "whole real catalog captured (seeded + pre-existing)");
  assert.ok(base.sourceVersion.startsWith("real-ingestion("));
});

// ---- 18. conflict-pair detection forces `conflicting` ----------------------

test("18. conflict-pair rule forces conflicting when both sides are retrieved", async () => {
  const { validateEvidenceClaims } = await import("../src/agentic-test/evidence-validator.js");
  const { adjudicateStage2 } = await import("../src/agentic-test/adjudicator.js");
  const snapId = "snap-test-18";
  const trace = [
    {
      runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {},
      evidenceReferences: [
        { evidenceId: "ev-aff", surface: "faq" as const, sourceObjectId: "page:faq", exactText: "Free returns within 30 days of delivery.", snapshotId: snapId },
        { evidenceId: "ev-neg", surface: "product_description" as const, sourceObjectId: "p1", exactText: "Please note: all natural products are final sale.", snapshotId: snapId },
      ],
    },
  ];
  const result = {
    runId: "r", contractId: stage2PrimaryContract.id, snapshotId: snapId, snapshotContentHash: "h",
    provider: "mock", model: "mock", promptVersion: "stage2-v1", trialNumber: 1,
    outcome: "PASS" as const, modelDeclaredOutcome: "PASS",
    selectedProductId: stage2PrimaryContract.productScope.productId,
    selectedVariantId: stage2PrimaryContract.productScope.variantId,
    constraintEvaluations: [], claimedEvidenceReferences: [], traceEvents: [],
    totalToolCalls: 1, totalSteps: 1, estimatedCostUsd: 0,
  };
  const validated = validateEvidenceClaims(result, trace, stage2PrimaryContract);
  const soft = validated.constraintEvaluations.find((e) => e.constraintId === "soft-returns-consistent");
  assert.equal(soft?.status, "conflicting", "soft constraint forced conflicting regardless of the model");
  const verdict = adjudicateStage2(stage2PrimaryContract, validated, trace);
  assert.equal(verdict.outcome, "CONTRADICTION");
  assert.equal(verdict.rootCause, "CONTRADICTION");
});

// ---- 20/21. Substitute/Conflict mocks end-to-end on committed artifacts ----

const FLAG_ENV = { AGENTIC_INSTRUMENT_TEST_ENABLED: "true" };

test("20. SubstituteMock end-to-end → WRONG_PRODUCT", { skip: !hasArtifacts }, async () => {
  const { runShoppingAgent } = await import("../src/agentic-test/agent-runner.js");
  const { createSubstituteMock } = await import("../src/agentic-test/mock-model.js");
  const f3 = loadRole("f3");
  const result = await runShoppingAgent({
    contract: stage2PrimaryContract, snapshot: f3, client: createSubstituteMock(), trialNumber: 1, env: FLAG_ENV,
  });
  assert.equal(result.outcome, "WRONG_PRODUCT_SELECTED");
  assert.equal(result.rootCauseCode, "WRONG_PRODUCT");
  assert.notEqual(result.selectedVariantId, stage2PrimaryContract.productScope.variantId);
  assert.equal(result.modelDeclaredOutcome, "PASS", "the substitution was silent (claimed success)");
});

test("21. ConflictMock end-to-end → CONTRADICTION", { skip: !hasArtifacts }, async () => {
  const { runShoppingAgent } = await import("../src/agentic-test/agent-runner.js");
  const { createConflictMock } = await import("../src/agentic-test/mock-model.js");
  const f2 = loadRole("f2");
  const result = await runShoppingAgent({
    contract: stage2PrimaryContract, snapshot: f2, client: createConflictMock(), trialNumber: 1, env: FLAG_ENV,
  });
  assert.equal(result.outcome, "CONTRADICTION");
  assert.equal(result.modelDeclaredOutcome, "PASS", "the model ignored the contradiction it retrieved");
});

// ---- 23. observational runs are excluded from gate aggregation -------------

test("23. observational runs (PARA/TRAP/secondary) never affect the gate", async () => {
  const { buildStage2Report } = await import("../src/agentic-test/comparator2.js");
  const manifest = {
    experimentId: "t", shopId: "s", primaryProductId: stage2PrimaryContract.productScope.productId,
    requiredVariantId: stage2PrimaryContract.productScope.variantId!,
    secondaryProductId: stage2SecondaryContract.productScope.productId,
    snapshots: {
      base: "sn-base", f1: "sn-f1", f2: "sn-f2", f3: "sn-f3", f4: "sn-f4", f5: "sn-f5",
      "restored-f1": "sn-rest", para: "sn-para", trap: "sn-trap",
    },
    mutationIds: {}, createdAt: "t",
  } as never;
  const j = (snapshotId: string, provider: string, trial: number, outcome: string, rootCauseCode?: string, contractId = stage2PrimaryContract.id) => ({
    runId: `${snapshotId}-${provider}-${trial}-${contractId}`, contractId, snapshotId, snapshotContentHash: "h",
    provider, model: "m", promptVersion: "stage2-v1", trialNumber: trial,
    outcome: outcome as never, rootCauseCode: rootCauseCode as never,
    modelDeclaredOutcome: outcome === "PASS" ? "PASS" : "MISSING_EVIDENCE",
    selectedProductId: stage2PrimaryContract.productScope.productId,
    selectedVariantId: stage2PrimaryContract.productScope.variantId,
    constraintEvaluations: [], claimedEvidenceReferences: [],
    traceEvents: [
      { runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {},
        evidenceReferences: [
          { evidenceId: "e1", surface: "faq" as const, sourceObjectId: "page:faq", exactText: "Free returns within 30 days.", snapshotId },
          { evidenceId: "e2", surface: "product_description" as const, sourceObjectId: "p", exactText: "all natural products are final sale.", snapshotId },
        ] },
    ],
    totalToolCalls: 3, totalSteps: 4, estimatedCostUsd: 0.01,
  });
  const perfect = [
    ...["openai", "gemini"].flatMap((p) => [1, 2, 3].flatMap((t) => [
      j("sn-base", p, t, "PASS"),
      j("sn-f1", p, t, "MISSING_EVIDENCE", "EVIDENCE_GAP"),
      j("sn-f2", p, t, "CONTRADICTION", "CONTRADICTION"),
      j("sn-f3", p, t, "CONSTRAINT_VIOLATION", "INVENTORY_MISMATCH"),
      j("sn-f4", p, t, "CONTRADICTION", "STALE_STRUCTURED_DATA"),
      j("sn-f5", p, t, "MISSING_EVIDENCE", "POLICY_OPACITY"),
      j("sn-rest", p, t, "PASS"),
    ])),
    ...["openai", "gemini"].flatMap((p) => [1, 2].map((t) => j("sn-base", p, t, "PASS", undefined, stage2SecondaryContract.id))),
  ];
  const clean = buildStage2Report("exp", manifest, perfect);
  assert.equal(clean.acceptance.passed, true, clean.acceptance.reasons.join("; "));

  // FALSE_CERTAINTY on PARA/TRAP (observational) must NOT trip the gate…
  const withProbes = [
    ...perfect,
    ...["openai", "gemini"].flatMap((p) => [1, 2].map((t) => j("sn-para", p, t, "FALSE_CERTAINTY"))),
    ...["openai", "gemini"].flatMap((p) => [1, 2].map((t) => j("sn-trap", p, t, "FALSE_CERTAINTY"))),
  ];
  const probed = buildStage2Report("exp", manifest, withProbes);
  assert.equal(probed.gate.falseCertaintyCount, 0, "probe runs excluded from gate FC count");
  assert.equal(probed.acceptance.passed, true);

  // …while the SAME outcome on a gate run fails criterion 4.
  const poisoned = perfect.map((x, i) => (i === 0 ? { ...x, outcome: "FALSE_CERTAINTY" as never } : x));
  const bad = buildStage2Report("exp", manifest, poisoned);
  assert.equal(bad.acceptance.passed, false);
  assert.ok(bad.acceptance.reasons.some((r) => r.includes("criterion 4") || r.includes("criterion 1")));
});

// ---- conflict-pair fixtures sanity -----------------------------------------

test("conflict pairs: affirmative and negative sides are disjoint vocabularies", () => {
  for (const pair of [ALUMINUM_CONFLICT_PAIR, RETURNS_CONFLICT_PAIR]) {
    for (const a of pair.affirmative) {
      for (const n of pair.negative) {
        assert.ok(!a.includes(n) && !n.includes(a), `"${a}" vs "${n}" must not contain each other`);
      }
    }
  }
});
