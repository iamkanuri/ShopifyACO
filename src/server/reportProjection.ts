import type { MerchantAnalysis } from "../analysis/types.js";

// ---------------------------------------------------------------------------
// The FREE / PAID re-cut (paid-report Phase 1). The free view is intentionally
// generous — the whole DIAGNOSIS + PROOF so a shared report is the full alarm:
// score + components, leaderboard, engine breakdown, gap analysis, the real lost
// prompts with the AI's own words, AND every fix card's TITLE + one-line rationale
// (what to fix). What it WITHHOLDS is the paid delta: the executed "how"
// (`suggestedFix`) and its verify caveat — and, from Phase 2, the done-for-you
// artifacts (drafted comparison page, llms.txt, schema). Paid access is granted by
// a paid order for the run (never by email — email must not gate viewing/sharing).
//
// These operate on the request-scoped run object returned by getResults (freshly
// parsed per request), so in-place edits are safe and mirror redactRun's style.
// ---------------------------------------------------------------------------

/**
 * Strip the paid delta from a run's analysis for the FREE view. Keeps titles, `why`,
 * impact, tier, and the evidence (relatedPrompts/relatedSnippets) — removes the
 * step-by-step `suggestedFix` and its `verifyNote`. Idempotent.
 */
export function stripPaidDelta(run: Record<string, unknown>): Record<string, unknown> {
  const analysis = run.analysis as MerchantAnalysis | undefined;
  if (analysis && Array.isArray(analysis.fixCards)) {
    analysis.fixCards = analysis.fixCards.map((c) => ({ ...c, suggestedFix: "", verifyNote: undefined }));
  }
  return run;
}
