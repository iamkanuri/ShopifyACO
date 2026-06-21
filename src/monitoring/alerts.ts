import { compareProportions, type Comparison } from "../benchmarks/stats.js";
import type { BenchmarkMetrics } from "../benchmarks/metrics.js";

// ===========================================================================
// Monitoring alert evaluation (Phase 8) — PURE. After a scheduled re-run we compare
// it to the PREVIOUS run and raise alerts. The cardinal rule (same as Phase 7): we
// only fire a regression/improvement alert when the 95% CI of the difference
// excludes 0 — never on run-to-run noise, so we don't cry wolf. "Inconclusive" is
// silent. We never claim causation; an alert says "your measured visibility moved",
// with the CI-backed comparison attached, not "X caused it".
// ===========================================================================

export type Cadence = "daily" | "weekly" | "biweekly" | "monthly";
export const CADENCES: Cadence[] = ["daily", "weekly", "biweekly", "monthly"];

/** Next run time for a cadence from `from` (defaults to now). Deterministic. */
export function nextRunAt(cadence: Cadence, from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  switch (cadence) {
    case "daily": d.setUTCDate(d.getUTCDate() + 1); break;
    case "weekly": d.setUTCDate(d.getUTCDate() + 7); break;
    case "biweekly": d.setUTCDate(d.getUTCDate() + 14); break;
    case "monthly": d.setUTCMonth(d.getUTCMonth() + 1); break;
  }
  return d;
}

export type AlertType = "regression" | "improvement" | "threshold" | "competitor_overtake";
export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertDraft {
  type: AlertType;
  severity: AlertSeverity;
  metric?: string;
  title: string;
  detail: string;
  comparison: Comparison | Record<string, unknown>;
}

const norm = (s: string) => s.trim().toLowerCase();
const pct = (r: number | null) => (r == null ? "n/a" : `${(r * 100).toFixed(0)}%`);

export interface AlertOptions {
  /** Optional floor for the primary metric; below it raises a threshold warning. */
  floorRate?: number;
  primaryMetric?: "recommendationRate" | "mentionRate" | "topChoiceRate";
}

/** Compare a new run to the previous one and draft any alerts worth sending. */
export function evaluateAlerts(current: BenchmarkMetrics, previous: BenchmarkMetrics | null, opts: AlertOptions = {}): AlertDraft[] {
  const metric = opts.primaryMetric ?? "recommendationRate";
  const drafts: AlertDraft[] = [];
  const cur = current[metric];

  // 1) Change vs previous — only when statistically credible (CI excludes 0).
  if (previous) {
    const prev = previous[metric];
    const cmp = compareProportions(prev.successes, prev.n, cur.successes, cur.n);
    if (cmp.verdict === "regressed") {
      drafts.push({
        type: "regression", severity: "critical", metric,
        title: `AI visibility dropped: ${metric} ${pct(prev.rate)} → ${pct(cur.rate)}`,
        detail: `Your ${metric} fell from ${pct(prev.rate)} (n=${prev.n}) to ${pct(cur.rate)} (n=${cur.n}). The 95% CI of the change excludes 0, so this is a credible decline — not run-to-run noise. This is a measured change, not a diagnosis of cause; open a diagnosis to investigate.`,
        comparison: cmp,
      });
    } else if (cmp.verdict === "improved") {
      drafts.push({
        type: "improvement", severity: "info", metric,
        title: `AI visibility improved: ${metric} ${pct(prev.rate)} → ${pct(cur.rate)}`,
        detail: `Your ${metric} rose from ${pct(prev.rate)} to ${pct(cur.rate)} with a CI that excludes 0. Confirm durability on the next run before treating it as permanent.`,
        comparison: cmp,
      });
    }
    // verdict === "inconclusive" → intentionally silent (no evidence of change).
  }

  // 2) Absolute floor breach (optional, configurable).
  if (opts.floorRate != null && cur.rate != null && cur.rate < opts.floorRate) {
    drafts.push({
      type: "threshold", severity: "warning", metric,
      title: `${metric} below target (${pct(cur.rate)} < ${pct(opts.floorRate)})`,
      detail: `Your ${metric} is ${pct(cur.rate)} (n=${cur.n}), under your ${pct(opts.floorRate)} target.`,
      comparison: { rate: cur.rate, floor: opts.floorRate, n: cur.n },
    });
  }

  // 3) Competitor overtake — the share-of-voice lead flipped from you to a rival.
  const curLeader = current.shareOfVoice[0];
  const prevLeader = previous?.shareOfVoice[0];
  const brand = norm(current.brand);
  if (curLeader && prevLeader && norm(prevLeader.key) === brand && norm(curLeader.key) !== brand) {
    drafts.push({
      type: "competitor_overtake", severity: "warning", metric: "shareOfVoice",
      title: `${curLeader.key} overtook you in share of voice`,
      detail: `You led share of voice last run; this run ${curLeader.key} leads (${pct(curLeader.share)} vs your nearest). Share of voice is recommendation-weighted and varies between runs — corroborate before acting.`,
      comparison: { previousLeader: prevLeader.key, currentLeader: curLeader.key, currentShare: curLeader.share },
    });
  }

  return drafts;
}
