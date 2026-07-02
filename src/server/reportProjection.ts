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
export type PaidTier = "complete" | "failed" | "generating" | "none";

/**
 * Which paid tier to serve, given the paid_report status, whether the deep report is present, and
 * whether a `paid` order still exists. PURE so the serve decision is unit-testable — in particular the
 * FAILED case (`held`/`refunded`): a generation that failed must resolve to "failed" (honest state),
 * NOT "generating" (an infinite spinner) and NOT "none" (silently reverting to the anonymous free
 * preview after a refund).
 *
 * CRITICAL ordering: the held/refunded check comes BEFORE the `!paidOrder` short-circuit. A refund
 * flips the order out of `paid` (getPaidOrderForRun then returns null → paidOrder=false), but the
 * buyer must still see the honest "your payment was refunded" banner rather than the free preview.
 * So the FAILED state is driven by the paid_report status alone, independent of the order status —
 * a paid_report row only exists because a payment happened, so held/refunded IS a paid tier.
 */
export function paidReportTier(status: string | null | undefined, hasReport: boolean, paidOrder: boolean): PaidTier {
  if (status === "complete" && hasReport) return "complete";
  if (status === "held" || status === "refunded") return "failed";
  if (!paidOrder) return "none";
  return "generating"; // pending | generating | null → the worker is (or will be) on it
}

export function stripPaidDelta(run: Record<string, unknown>): Record<string, unknown> {
  const analysis = run.analysis as MerchantAnalysis | undefined;
  if (analysis && Array.isArray(analysis.fixCards)) {
    analysis.fixCards = analysis.fixCards.map((c) => ({ ...c, suggestedFix: "", verifyNote: undefined }));
  }
  return run;
}
