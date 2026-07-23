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

  // The floor still wins: a run with an unsupported positive claim gets NO grants.
  const flagged = { ...semanticFixture("unresolvable", "Aluminum never makes it into this formula."), unsupportedPositiveClaim: true };
  const skipped = await applySemanticTier(flagged as never, stage2PrimaryContract, createScriptedSemanticMock());
  assert.equal(skipped.result.constraintEvaluations[0]!.status, "unresolvable");
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
