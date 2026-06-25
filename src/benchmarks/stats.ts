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

// Minimum per-arm sample size before we'll call a direction. Matches the documented
// "Moderate signal" confidence tier (n>=12); below it we stay inconclusive even if the
// interval excludes 0, so tiny samples never produce false certainty / cry-wolf alerts.
export const MIN_COMPARE_N = 12;

/** Compare two proportions (baseline vs verification). Verdict is "inconclusive"
 *  ("no evidence of change") unless the 95% CI of the difference excludes 0 AND both
 *  arms have enough data — so we never report a regression/improvement the sample can't
 *  support. The difference interval uses Newcombe's method (combining the two Wilson
 *  intervals), which — unlike a Wald SE — never collapses to zero width at extreme
 *  proportions (e.g. 0/3 vs 3/3 no longer yields a [1,1] "certain" interval). */
export function compareProportions(baseSucc: number, baseN: number, curSucc: number, curN: number, z = Z95): Comparison {
  const baseline = proportion(baseSucc, baseN, z);
  const current = proportion(curSucc, curN, z);
  if (baseN <= 0 || curN <= 0) {
    return { baseline, current, diff: null, diffCiLow: 0, diffCiHigh: 0, verdict: "inconclusive" };
  }
  const pB = baseSucc / baseN;
  const pC = curSucc / curN;
  const diff = pC - pB;
  // Newcombe (1998) method 10 for the difference of independent proportions, using the
  // per-arm Wilson bounds already computed above (current = arm "C", baseline = arm "B").
  const lo = diff - Math.sqrt((pC - current.ciLow) ** 2 + (baseline.ciHigh - pB) ** 2);
  const hi = diff + Math.sqrt((current.ciHigh - pC) ** 2 + (pB - baseline.ciLow) ** 2);
  const enoughN = baseN >= MIN_COMPARE_N && curN >= MIN_COMPARE_N;
  const verdict: ChangeVerdict =
    !enoughN ? "inconclusive" : lo > 0 ? "improved" : hi < 0 ? "regressed" : "inconclusive";
  return { baseline, current, diff, diffCiLow: lo, diffCiHigh: hi, verdict };
}
