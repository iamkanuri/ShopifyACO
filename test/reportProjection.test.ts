import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRun } from "../src/analysis/index.js";
import { stripPaidDelta, paidReportTier } from "../src/server/reportProjection.js";
import { fashionRun } from "./support/categoryFixtures.js";

// Paid-report Phase 2 (#4 fix): a FAILED generation must serve the honest failed state, never
// "generating" (which would leave the buyer on an infinite spinner). This is the serve-path decision.
test("paidReportTier: held/refunded → failed (NOT generating — no infinite spinner)", () => {
  assert.equal(paidReportTier("held", false, true), "failed", "a held report is FAILED, not generating");
  assert.equal(paidReportTier("refunded", false, true), "failed", "a refunded report is FAILED, not generating");
  // The states that ARE still generating:
  assert.equal(paidReportTier("pending", false, true), "generating");
  assert.equal(paidReportTier("generating", false, true), "generating");
  assert.equal(paidReportTier(null, false, true), "generating", "paid but no row yet → job enqueued, still generating");
  // Complete + report present → the deep report.
  assert.equal(paidReportTier("complete", true, true), "complete");
  // No paid order → not a paid tier at all.
  assert.equal(paidReportTier("held", false, false), "none");
  assert.equal(paidReportTier(null, false, false), "none");
});

// Paid-report Phase 1: the FREE view keeps the whole diagnosis + proof + fix titles/why, but
// withholds the executed "how" (suggestedFix) and its verify note — the paid delta.

test("stripPaidDelta withholds the paid delta but keeps the free diagnosis + proof", () => {
  const run = fashionRun() as Record<string, any>;
  run.analysis = analyzeRun(fashionRun());

  // Sanity: before stripping, the comparison card carries the executed 'how'.
  const before = run.analysis.fixCards.find((c: any) => c.id === "cmp_threat");
  assert.ok(before.suggestedFix.length > 0, "fixture should have a real suggested fix pre-strip");
  assert.ok(before.verifyNote, "fixture should have a verify note pre-strip");

  const free = stripPaidDelta(run);
  const a = (free as any).analysis;

  for (const c of a.fixCards) {
    assert.equal(c.suggestedFix, "", `suggestedFix must be stripped for free (${c.id})`);
    assert.equal(c.verifyNote, undefined, `verifyNote must be stripped for free (${c.id})`);
    // The 'what' (title + one-line rationale) stays — that's the free alarm.
    assert.ok(c.title.length > 0 && c.why.length > 0, `title/why must survive (${c.id})`);
  }

  // Evidence (real lost prompts) stays free on the comparison card.
  const cmp = a.fixCards.find((c: any) => c.id === "cmp_threat");
  assert.ok(cmp.relatedPrompts.length > 0, "lost-prompt evidence must stay free");

  // The rest of the diagnosis/proof is untouched.
  assert.ok(a.leaderboard.length > 0, "leaderboard stays free");
  assert.ok(a.lostPrompts.length > 0, "lost prompts stay free");
  assert.ok(a.proofPoints.length > 0, "proof points stay free");
  assert.ok(a.visibilityScore.components.length > 0, "score components stay free");
});

test("stripPaidDelta is safe on a run with no analysis", () => {
  assert.doesNotThrow(() => stripPaidDelta({}));
  assert.doesNotThrow(() => stripPaidDelta({ analysis: {} }));
});
