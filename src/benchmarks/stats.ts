// Pure statistics for benchmarks (Phase 4). Every rate ships with a sample size and
// a confidence interval so we never imply false precision. Wilson score intervals are
// used for proportions (well-behaved at small n — important for mini scans).

const Z95 = 1.959963984540054; // z for 95% CI

export interface Proportion {
  successes: number;
  n: number;
  rate: number | null; // null when n === 0 (no evidence, not zero)
  ciLow: number;
  ciHigh: number;
}

/** Wilson score interval for a binomial proportion. n=0 → rate null, widest CI. */
export function proportion(successes: number, n: number, z = Z95): Proportion {
  if (n <= 0) return { successes, n: 0, rate: null, ciLow: 0, ciHigh: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { successes, n, rate: p, ciLow: Math.max(0, center - half), ciHigh: Math.min(1, center + half) };
}

export interface MeanMetric {
  mean: number | null;
  n: number;
  stdErr: number | null;
}

/** Sample mean + standard error (e.g. average recommendation position). */
export function mean(values: number[]): MeanMetric {
  const n = values.length;
  if (n === 0) return { mean: null, n: 0, stdErr: null };
  const m = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean: m, n, stdErr: null };
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  return { mean: m, n, stdErr: Math.sqrt(variance / n) };
}

/** Population standard deviation — used for visibility volatility across runs. */
export function volatility(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / n);
}

/** Share of voice: each key's count over the total. Returns sorted desc. */
export function shareOfVoice(counts: Record<string, number>): Array<{ key: string; count: number; share: number }> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => b.share - a.share);
}

/** Engine divergence: spread (max-min) of a rate across engines. 0 = engines agree. */
export function engineDivergence(ratesByEngine: Record<string, number | null>): number | null {
  const vals = Object.values(ratesByEngine).filter((v): v is number => v != null);
  if (vals.length < 2) return null;
  return Math.max(...vals) - Math.min(...vals);
}

export type ChangeVerdict = "improved" | "regressed" | "inconclusive";

export interface Comparison {
  baseline: Proportion;
  current: Proportion;
  diff: number | null; // current.rate - baseline.rate
  diffCiLow: number;
  diffCiHigh: number;
  verdict: ChangeVerdict;
}

/** Compare two proportions (baseline vs verification). Verdict is "inconclusive"
 *  ("no evidence of change") unless the 95% CI of the difference excludes 0 — so we
 *  never report a regression/improvement that the sample size can't support. */
export function compareProportions(baseSucc: number, baseN: number, curSucc: number, curN: number, z = Z95): Comparison {
  const baseline = proportion(baseSucc, baseN, z);
  const current = proportion(curSucc, curN, z);
  if (baseN <= 0 || curN <= 0) {
    return { baseline, current, diff: null, diffCiLow: 0, diffCiHigh: 0, verdict: "inconclusive" };
  }
  const p1 = baseSucc / baseN;
  const p2 = curSucc / curN;
  const diff = p2 - p1;
  const se = Math.sqrt((p1 * (1 - p1)) / baseN + (p2 * (1 - p2)) / curN);
  const lo = diff - z * se;
  const hi = diff + z * se;
  const verdict: ChangeVerdict = lo > 0 ? "improved" : hi < 0 ? "regressed" : "inconclusive";
  return { baseline, current, diff, diffCiLow: lo, diffCiHigh: hi, verdict };
}
