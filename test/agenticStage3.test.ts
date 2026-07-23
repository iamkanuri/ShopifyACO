import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ===========================================================================
// AGENTIC INSTRUMENT TEST — STAGE 3 automated tests (spec S3 §5, tests 26–35).
// Pure and deterministic; artifact-reading tests skip when artifacts are absent.
// ===========================================================================

process.env.AGENTIC_STAGE1_RESULTS_DIR = join(mkdtempSync(join(tmpdir(), "agentic-stage3-test-")), "results");

import type { StoreSnapshot, JourneyResult } from "../src/agentic-test/types.js";
import { scanStore, computeCoverage } from "../src/agentic-test/store-diagnostic.js";
import { stage2PrimaryContract } from "../src/agentic-test/contract2.js";
import { ALUMINUM_FREE_MATCHING_TERMS } from "../src/agentic-test/contract.js";
import { matchingTermsIn } from "../src/agentic-test/util.js";

const S2_DIR = join(process.cwd(), "experiments", "agentic-stage2");
const S3_DIR = join(process.cwd(), "experiments", "agentic-stage3");
const hasS2 = existsSync(join(S2_DIR, "experiment-manifest.json"));
const hasS3 = existsSync(join(S3_DIR, "experiment-manifest.json"));

function loadS2Role(role: string): StoreSnapshot {
  const m = JSON.parse(readFileSync(join(S2_DIR, "experiment-manifest.json"), "utf8")) as { snapshots: Record<string, string> };
  return JSON.parse(readFileSync(join(S2_DIR, "snapshots", `${m.snapshots[role]}.json`), "utf8")) as StoreSnapshot;
}
function loadS3(role: "base" | "f1" | "trap" | "paraV2"): StoreSnapshot {
  const m = JSON.parse(readFileSync(join(S3_DIR, "experiment-manifest.json"), "utf8")) as { snapshots: Record<string, string> };
  const id = m.snapshots[role]!;
  const p3 = join(S3_DIR, "snapshots", `${id}.json`);
  const p2 = join(S2_DIR, "snapshots", `${id}.json`);
  return JSON.parse(readFileSync(existsSync(p3) ? p3 : p2, "utf8")) as StoreSnapshot;
}

// ---- 26. diagnostic scan detects each Stage 2 fault with quotes ------------

test("26. Store Diagnostic Scan detects F1/F2/F5 deterministically with quoted evidence", { skip: !hasS2 }, () => {
  const get = (snap: StoreSnapshot, cid: string) =>
    scanStore(snap, stage2PrimaryContract).perConstraint.find((c) => c.constraintId === cid)!;

  // BASE: everything evidenced, with quotes.
  for (const c of stage2PrimaryContract.hardConstraints) {
    const d = get(loadS2Role("base"), c.id);
    assert.equal(d.verdict, "evidenced", `BASE ${c.id}`);
    assert.ok(d.explicitHits.length >= 1 && d.explicitHits[0]!.quote.length > 0, `BASE ${c.id} has a quote`);
  }
  // F1: evidence gap.
  assert.equal(get(loadS2Role("f1"), "c1-aluminum-free").verdict, "absent");
  // F2: cross-surface contradiction with BOTH sides quoted.
  const f2 = get(loadS2Role("f2"), "soft-returns-consistent");
  assert.equal(f2.verdict, "conflicted");
  assert.ok(f2.conflictHits[0]!.affirmativeQuote.includes("Free returns"));
  assert.ok(f2.conflictHits[0]!.negativeQuote.includes("final sale"));
  assert.notEqual(f2.conflictHits[0]!.affirmativeSurface, f2.conflictHits[0]!.negativeSurface);
  // F5: policy opacity.
  assert.equal(get(loadS2Role("f5"), "c5-delivery-resolvable").verdict, "absent");
  // F4 (recorded): price-source conflict visible snapshot-wide.
  assert.equal(get(loadS2Role("f4"), "c2-price").verdict, "conflicted");
});

// ---- 30. PARA-v2 zero explicit matches; TRAP ≥1 ----------------------------

test("30. PARA-v2 has zero explicit-tier matches; TRAP has at least one", { skip: !hasS3, }, () => {
  const terms = [...ALUMINUM_FREE_MATCHING_TERMS];
  const c1 = stage2PrimaryContract.hardConstraints[0]!;

  const para = loadS3("paraV2");
  const paraScan = scanStore(para, stage2PrimaryContract).perConstraint.find((c) => c.constraintId === c1.id)!;
  assert.equal(paraScan.verdict, "absent", "PARA-v2 must be invisible to the explicit tier");
  const paraProduct = para.products.find((p) => p.productId === stage2PrimaryContract.productScope.productId)!;
  for (const s of [
    "You won't find aluminum anywhere in our ingredient list.",
    "Aluminum never makes it into this formula.",
    "We skip the aluminum entirely and rely on arrowroot instead.",
  ]) {
    assert.ok(paraProduct.description!.includes(s), `paraphrase present: ${s}`);
    assert.equal(matchingTermsIn(s, terms).length, 0, `no term-list bigram in: ${s}`);
  }

  const trap = loadS3("trap");
  const trapScan = scanStore(trap, stage2PrimaryContract).perConstraint.find((c) => c.constraintId === c1.id)!;
  assert.equal(trapScan.verdict, "evidenced", "TRAP lexically matches (that is the trap)");
  assert.ok(trapScan.explicitHits.every((h) => h.quote.includes("recyclable packaging")));
});

// ---- 27–29. semantic tier: wrapper, veto, grant ----------------------------

function semanticFixture(status: "satisfied" | "unresolvable", evidenceText: string) {
  const ref = {
    evidenceId: "ev-sem-1",
    surface: "product_description" as const,
    sourceObjectId: "p1",
    exactText: evidenceText,
    snapshotId: "snap-sem",
  };
  const result = {
    runId: "r", contractId: stage2PrimaryContract.id, snapshotId: "snap-sem", snapshotContentHash: "h",
    provider: "mock", model: "mock", promptVersion: "stage3-v1", trialNumber: 1,
    outcome: "PASS" as const, modelDeclaredOutcome: "PASS",
    selectedProductId: stage2PrimaryContract.productScope.productId,
    selectedVariantId: stage2PrimaryContract.productScope.variantId,
    constraintEvaluations: [
      {
        constraintId: "c1-aluminum-free",
        status,
        evidenceReferences: status === "satisfied" ? [ref] : [],
        explanation: "",
      },
    ],
    claimedEvidenceReferences: [],
    traceEvents: [
      { runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {}, evidenceReferences: [ref] },
    ],
    totalToolCalls: 1, totalSteps: 1, estimatedCostUsd: 0,
  };
  return result;
}

test("27. semantic wrapper discards non-substring quotes (SemanticLiarMock)", async () => {
  const { verifySemanticCandidates, applySemanticTier, createSemanticLiarMock } = await import("../src/agentic-test/semantic-tier.js");
  const { verified, fabrications } = verifySemanticCandidates("The formula is gentle.", [
    { exactQuote: "The formula is gentle", verdict: "supports", subject: "product" },
    { exactQuote: "certified aluminum-free by a lab", verdict: "supports", subject: "product" },
  ]);
  assert.equal(verified.length, 1);
  assert.equal(fabrications, 1);

  // End-to-end: liar semantic client grants NOTHING on an unresolvable constraint.
  const out = await applySemanticTier(
    semanticFixture("unresolvable", "Aluminum never makes it into this formula.") as never,
    stage2PrimaryContract,
    createSemanticLiarMock(),
  );
  const c1 = out.result.constraintEvaluations[0]!;
  assert.equal(c1.status, "unresolvable", "fabricated quote must not grant");
  assert.ok((out.result.semanticFabricationsDiscarded ?? 0) >= 1);
});

test("28. veto path: explicit match judged about_other_subject → REJECTED_ABOUTNESS", async () => {
  const { applySemanticTier, createScriptedSemanticMock } = await import("../src/agentic-test/semantic-tier.js");
  const out = await applySemanticTier(
    semanticFixture("satisfied", "Ships in 100% aluminum-free recyclable packaging.") as never,
    stage2PrimaryContract,
    createScriptedSemanticMock(),
  );
  const c1 = out.result.constraintEvaluations[0]!;
  assert.equal(c1.status, "unresolvable");
  assert.equal(c1.rejectedAboutness, true);
  assert.equal(c1.evidenceReferences.length, 0, "vetoed evidence is withdrawn, not kept");
});

test("29. grant path: verified supporting quote → SEMANTIC_VERIFIED satisfied", async () => {
  const { applySemanticTier, createScriptedSemanticMock } = await import("../src/agentic-test/semantic-tier.js");
  const out = await applySemanticTier(
    semanticFixture("unresolvable", "Aluminum never makes it into this formula.") as never,
    stage2PrimaryContract,
    createScriptedSemanticMock(),
  );
  const c1 = out.result.constraintEvaluations[0]!;
  assert.equal(c1.status, "satisfied");
  assert.equal(c1.confidenceTier, "SEMANTIC_VERIFIED");
  assert.equal(c1.evidenceReferences.length, 1, "grant is trace-backed");

  // The floor still wins: a run that cited FABRICATED evidence gets NO grants
  // (real-but-lexically-unsupported citations go through claim-rescue instead).
  const flagged = {
    ...semanticFixture("unresolvable", "Aluminum never makes it into this formula."),
    unsupportedPositiveClaim: true,
    fabricatedEvidenceClaim: true,
  };
  const skipped = await applySemanticTier(flagged as never, stage2PrimaryContract, createScriptedSemanticMock());
  assert.equal(skipped.result.constraintEvaluations[0]!.status, "unresolvable");
  assert.equal(skipped.result.unsupportedPositiveClaim, true, "fabrication flag survives untouched");
});

// ---- Gate A bug regressions (found by paid smoke, fixed with disclosure) ----

test("veto never applies to structured support (variant availability / price)", async () => {
  const { applySemanticTier } = await import("../src/agentic-test/semantic-tier.js");
  // A judge that calls EVERYTHING about_other_subject must still be unable to
  // veto c3's structured availability evidence.
  const paranoidJudge = {
    provider: "mock", model: "paranoid", promptVersion: "sem-mock",
    propose: async (text: string) => ({
      candidates: text.split("\n").map((s) => ({ exactQuote: s, verdict: "about_other_subject" as const, subject: "something else" })),
      costUsd: 0,
    }),
  };
  const variantRef = {
    evidenceId: "ev-var", surface: "product_variants" as const, sourceObjectId: "v-req",
    exactText: "Unscented / 2.5 oz",
    structuredValue: { variantId: stage2PrimaryContract.productScope.variantId, available: true, price: 14 },
    snapshotId: "snap-sem",
  };
  const result = {
    runId: "r", contractId: stage2PrimaryContract.id, snapshotId: "snap-sem", snapshotContentHash: "h",
    provider: "mock", model: "mock", promptVersion: "stage3-v1", trialNumber: 1,
    outcome: "PASS" as const, modelDeclaredOutcome: "PASS",
    selectedProductId: stage2PrimaryContract.productScope.productId,
    selectedVariantId: stage2PrimaryContract.productScope.variantId,
    constraintEvaluations: [
      { constraintId: "c3-variant-purchasable", status: "satisfied" as const, evidenceReferences: [variantRef], explanation: "" },
    ],
    claimedEvidenceReferences: [], traceEvents: [], totalToolCalls: 1, totalSteps: 1, estimatedCostUsd: 0,
  };
  const out = await applySemanticTier(result as never, stage2PrimaryContract, paranoidJudge);
  const c3 = out.result.constraintEvaluations[0]!;
  assert.equal(c3.status, "satisfied", "structured evidence is not an aboutness question");
  assert.equal(c3.confidenceTier, "EXPLICIT");
});

test("claim-rescue: real in-scope paraphrase citation → SEMANTIC_VERIFIED, not FALSE_CERTAINTY", async () => {
  const { validateEvidenceClaims } = await import("../src/agentic-test/evidence-validator.js");
  const { applySemanticTier, createScriptedSemanticMock } = await import("../src/agentic-test/semantic-tier.js");
  const { adjudicateStage2 } = await import("../src/agentic-test/adjudicator.js");
  const ref = {
    evidenceId: "ev-para", surface: "product_description" as const, sourceObjectId: "p",
    exactText: "Aluminum never makes it into this formula.", snapshotId: "snap-x",
  };
  const trace = [{ runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {}, evidenceReferences: [ref] }];
  const claimed = {
    runId: "r", contractId: stage2PrimaryContract.id, snapshotId: "snap-x", snapshotContentHash: "h",
    provider: "mock", model: "mock", promptVersion: "stage3-v1", trialNumber: 1,
    outcome: "PASS" as const, modelDeclaredOutcome: "PASS",
    selectedProductId: stage2PrimaryContract.productScope.productId,
    selectedVariantId: stage2PrimaryContract.productScope.variantId,
    constraintEvaluations: [
      { constraintId: "c1-aluminum-free", status: "satisfied" as const, evidenceReferences: [], claimedEvidenceIds: ["ev-para"], explanation: "" },
    ],
    claimedEvidenceReferences: [], traceEvents: [], totalToolCalls: 1, totalSteps: 1, estimatedCostUsd: 0,
  };
  const validated = validateEvidenceClaims(claimed as never, trace, stage2PrimaryContract);
  assert.equal(validated.unsupportedPositiveClaim, true, "deterministic-only view still flags it");
  assert.ok(!validated.fabricatedEvidenceClaim, "but it is NOT a fabricated claim");
  const out = await applySemanticTier(validated, stage2PrimaryContract, createScriptedSemanticMock());
  const c1 = out.result.constraintEvaluations[0]!;
  assert.equal(c1.status, "satisfied");
  assert.equal(c1.confidenceTier, "SEMANTIC_VERIFIED");
  assert.equal(out.result.unsupportedPositiveClaim, false, "rescued claim clears the flag");
  assert.notEqual(adjudicateStage2(stage2PrimaryContract, out.result, trace).outcome, "FALSE_CERTAINTY");
});

// ---- 32/33. compiler rejection rules + schema validity ---------------------

const NO_DETERMINISTIC = { merchantPresent: false, competitors: [], pricesMentioned: [], citationHosts: [] };

test("32. compiler rejection rules fire on fixture prompts", async () => {
  const { draftContract } = await import("../src/agentic-test/compiler.js");
  const d = (over: Record<string, unknown>) => ({
    objective: "x", targetBrand: null, hardConstraints: [], softPreferences: [], ambiguityFlags: [], impossibleDataConstraints: [], ...over,
  });

  const subjective = draftContract("t-subj", "deodorant", d({}) as never, NO_DETERMINISTIC, "mock");
  assert.equal(subjective.status, "rejected");
  assert.ok(subjective.rejectionReason!.includes("subjective"));

  const navigational = draftContract("t-nav", "deodorant", d({ targetBrand: "SomeBrand" }) as never, NO_DETERMINISTIC, "mock");
  assert.equal(navigational.status, "rejected");
  assert.ok(navigational.rejectionReason!.includes("brand-navigational"));

  const impossible = draftContract(
    "t-imp", "deodorant",
    d({
      hardConstraints: [{ attribute: "other:neighborhood_popularity", operator: "must_be_true", phrasing: "popular with my neighbors" }],
      impossibleDataConstraints: ["popular with my neighbors"],
    }) as never,
    NO_DETERMINISTIC, "mock",
  );
  assert.equal(impossible.status, "rejected");
  assert.ok(impossible.rejectionReason!.includes("cannot possess"));

  const valid = draftContract(
    "t-ok", "deodorant",
    d({
      hardConstraints: [
        { attribute: "aluminum_free", operator: "must_be_true", value: true, phrasing: "aluminum-free" },
        { attribute: "variant_price", operator: "less_than", value: 20, phrasing: "under $20" },
        { attribute: "subscription_required", operator: "must_be_false", value: false, phrasing: "no subscription" },
      ],
    }) as never,
    NO_DETERMINISTIC, "mock",
  );
  assert.equal(valid.status, "compiled");
  assert.equal(valid.contract!.hardConstraints.length, 3);
  assert.equal(valid.contract!.productScope.productId, stage2PrimaryContract.productScope.productId);
});

test("33. compiled contracts validate; UNCONFIRMED constraints are excluded", async () => {
  const { draftContract, validateCompiledContract } = await import("../src/agentic-test/compiler.js");
  const draft = {
    objective: "unscented aluminum-free deodorant", targetBrand: null,
    hardConstraints: [
      { attribute: "aluminum_free", operator: "must_be_true", value: true, phrasing: "aluminum-free" },
      { attribute: "fragrance_free", operator: "must_be_true", value: true, phrasing: "unscented" },
    ],
    softPreferences: [], ambiguityFlags: [], impossibleDataConstraints: [],
  };
  const out = draftContract("t-unconf", "deodorant", draft as never, NO_DETERMINISTIC, "mock");
  assert.equal(out.status, "compiled");
  // fragrance_free is deliberately absent from the confirmable facts (variant-
  // specific in the seeded copy) → excluded from hard constraints, recorded.
  assert.ok(!out.contract!.hardConstraints.some((c) => c.attribute === "fragrance_free"));
  assert.equal(out.unconfirmed.length, 1);
  assert.equal(out.unconfirmed[0]!.attribute, "fragrance_free");
  assert.ok(out.unconfirmed[0]!.wouldHaveAskedMerchant.includes("fragrance_free"));
  assert.deepEqual(validateCompiledContract(out.contract!), []);

  const invalid = { ...out.contract!, hardConstraints: [{ id: "z", attribute: "made_up_attr", operator: "must_be_true" as const, evidenceRequired: true, acceptableSurfaces: [] as never[] }] };
  assert.ok(validateCompiledContract(invalid).length >= 2);
});

// ---- 35. probe persistence shape (artifact-gated) --------------------------

const PROBE_FILE = join(process.cwd(), "experiments", "agentic-stage3", "probes", "probe-battery.jsonl");

test("35. probe persistence records channel, model, citations, batch tag", { skip: !existsSync(PROBE_FILE) }, () => {
  const records = readFileSync(PROBE_FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(records.length >= 2);
  for (const r of records) {
    assert.equal(r.batchTag, "stage3");
    assert.ok(["openai", "gemini", "perplexity"].includes(r.channel));
    assert.ok(typeof r.model === "string" && r.model.length > 0);
    assert.ok(Array.isArray(r.citations));
    assert.ok(typeof r.promptId === "string" && typeof r.repeat === "number");
    assert.ok(typeof r.responseText === "string");
  }
  const channels = new Set(records.map((r) => r.channel));
  assert.ok(channels.size >= 2, "at least two channels probed");
});

// ---- 34. pre-registration guard (mechanical Rule 5) ------------------------

test("34. probe-parsing refuses to run without the pre-registration record", async () => {
  const { assertPreregistered } = await import("../src/agentic-test/preregistration.js");
  const prev = process.env.AGENTIC_STAGE3_PREREG;

  // Missing file → hard refusal.
  process.env.AGENTIC_STAGE3_PREREG = join(tmpdir(), "nonexistent-prereg.json");
  assert.throws(() => assertPreregistered(), /PRE-REGISTRATION GUARD/);

  // The real record (when present) verifies: files exist + hashes match.
  process.env.AGENTIC_STAGE3_PREREG = prev ?? "";
  delete process.env.AGENTIC_STAGE3_PREREG;
  const realPrereg = join(process.cwd(), "experiments", "agentic-stage3", "preregistration.json");
  if (existsSync(realPrereg)) {
    const reg = assertPreregistered();
    assert.ok(reg.gitCommit.length >= 7);
    assert.ok(Object.keys(reg.files).includes("src/agentic-test/manual-contracts.ts"));
  }

  // Hash mismatch → refusal (doctored copy in a temp dir).
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "prereg-test-"));
  mkdirSync(dir, { recursive: true });
  const doctored = join(dir, "prereg.json");
  writeFileSync(doctored, JSON.stringify({
    gitCommit: "deadbeef",
    registeredAt: "t",
    files: { "src/agentic-test/manual-contracts.ts": "0".repeat(64) },
  }));
  process.env.AGENTIC_STAGE3_PREREG = doctored;
  assert.throws(() => assertPreregistered(), /hash mismatch/);
  delete process.env.AGENTIC_STAGE3_PREREG;
  if (prev) process.env.AGENTIC_STAGE3_PREREG = prev;
});

// ---- 31. coverage metric on a constructed case -----------------------------

test("31. coverage metric computes missed-relevant surfaces correctly", () => {
  const diagnostic = {
    snapshotId: "s",
    contractId: "c",
    perConstraint: [
      { constraintId: "a", attribute: "x", verdict: "evidenced" as const, explicitHits: [], outOfScopeHits: [], contraryHits: [], conflictHits: [], relevantSurfaces: ["product_description" as const, "faq" as const] },
      { constraintId: "b", attribute: "y", verdict: "evidenced" as const, explicitHits: [], outOfScopeHits: [], contraryHits: [], conflictHits: [], relevantSurfaces: ["product_variants" as const] },
    ],
  };
  const result = {
    traceEvents: [
      {
        runId: "r", timestamp: "t", sequence: 1, type: "TOOL_RESULT" as const, payload: {},
        evidenceReferences: [
          { evidenceId: "e1", surface: "product_description" as const, sourceObjectId: "p", snapshotId: "s" },
          { evidenceId: "e2", surface: "product_variants" as const, sourceObjectId: "v", snapshotId: "s" },
          { evidenceId: "e3", surface: "product_title" as const, sourceObjectId: "p", snapshotId: "s" },
        ],
      },
    ],
  } as unknown as JourneyResult;
  const cov = computeCoverage(diagnostic, result);
  assert.equal(cov.coverageRatio, 2 / 3);
  assert.deepEqual(cov.missedRelevantSurfaces, ["faq"]);
  assert.ok(cov.retrievedSurfaces.includes("product_title"), "out-of-scope retrievals tracked but not penalized");

  // Empty relevant set → perfect coverage by definition.
  const empty = computeCoverage({ snapshotId: "s", contractId: "c", perConstraint: [] }, result);
  assert.equal(empty.coverageRatio, 1);
});
