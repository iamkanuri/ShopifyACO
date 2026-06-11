import type { BrandDetection, PromptEngineResult } from "../types.js";
import type { RateStat } from "./types.js";

export function rate(count: number, total: number): RateStat {
  return { count, total, rate: total > 0 ? count / total : 0 };
}

/** Format a rate with its raw counts, e.g. "5% (2/39)". */
export function fmtRate(r: RateStat): string {
  return `${Math.round(r.rate * 100)}% (${r.count}/${r.total})`;
}

/** Successful (non-error) responses — the only ones detection ran on. */
export function grounded(results: PromptEngineResult[]): PromptEngineResult[] {
  return results.filter((r) => !r.error);
}

export function detOf(r: PromptEngineResult, brand: string): BrandDetection | undefined {
  return r.detections.find((d) => d.name === brand);
}

/** Visibility score for a single detection: recommended=2, mentioned=1, absent=0. */
export function detScore(d: BrandDetection | undefined): number {
  if (!d || !d.mentioned) return 0;
  return d.status === "recommended" ? 2 : 1;
}

export function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, c) => a + c, 0) / nums.length : null;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
