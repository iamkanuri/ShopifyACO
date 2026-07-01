import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRun } from "../src/analysis/index.js";
import { stripPaidDelta } from "../src/server/reportProjection.js";
import { fashionRun } from "./support/categoryFixtures.js";

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
