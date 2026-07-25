import type { Config, PromptEngineResult } from "../types.js";
import type { ScoreComponent, VisibilityScore } from "./types.js";
import { avg, detOf, detScore, grounded, rate } from "./util.js";

// ---------------------------------------------------------------------------
// AI Visibility Score — a documented, deterministic 0..100 formula. NOT a black
// box: every component (weight, normalized value, points contributed) is exposed
// so a merchant can see exactly why they got the number.
//
//   score = 100 × Σ (weight_i × value_i)
//
//   Recommendation rate   weight 0.50   value = recommended / responses
//   Mention rate          weight 0.20   value = mentioned   / responses
//   Rank quality          weight 0.15   value = listed ? clamp(1 − (avgRank−1)/5) : 0.5
//   Competitive win rate  weight 0.15   value = 1 − (responses_a_competitor_beats_us / responses)
// ---------------------------------------------------------------------------

// The single source of truth for the AI Visibility Score weights. Both the CLI path
// (computeVisibilityScore over PromptEngineResult[]) and the benchmark path
// (scoreFromMetrics in benchmarks/metrics.ts over BenchmarkMetrics) consume these so the
// documented formula can never silently diverge between the two.
export const SCORE_WEIGHTS = {
  recommendation: 0.5,
  mention: 0.2,
  rank: 0.15,
  win: 0.15,
} as const;
const WEIGHTS = SCORE_WEIGHTS;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export type ScoreKey = keyof typeof SCORE_WEIGHTS;
export interface ScoreCoreComponent { key: ScoreKey; weight: number; value: number; contribution: number }
export interface ScoreCoreResult { score: number | null; components: ScoreCoreComponent[] }

/**
 * THE single scoring formula. Both the CLI/web path (computeVisibilityScore, over raw results) and
 * the app path (scoreFromMetrics in benchmarks/metrics.ts, over aggregated metrics) call this, so the
 * documented math can never diverge — not just the weights, the whole computation. Callers attach
 * their own component labels/detail (the app keeps "Competitive standing", the web "Competitive win
 * rate"); only the numbers live here.
 *
 * `n` is the observation count. A run with ZERO observations returns score:null — NOT a fabricated
 * ~8 (which the neutral rank default 0.5 would otherwise contribute for a run that measured nothing).
 */
export function scoreCore(
  values: { recommendation: number; mention: number; rank: number; win: number },
  n: number,
): ScoreCoreResult {
  const components: ScoreCoreComponent[] = (Object.keys(WEIGHTS) as ScoreKey[]).map((key) => {
    const weight = WEIGHTS[key];
    const value = values[key] ?? 0;
    return { key, weight, value, contribution: weight * value * 100 };
  });
  const score = n === 0 ? null : Math.round(components.reduce((s, c) => s + c.contribution, 0));
  return { score, components };
}

export function computeVisibilityScore(
  results: PromptEngineResult[],
  cfg: Config,
): VisibilityScore {
  const ok = grounded(results);
  const n = ok.length;

  let mentioned = 0;
  let recommended = 0;
  let beaten = 0;
  const ranks: number[] = [];

  for (const r of ok) {
    const own = detOf(r, cfg.brand.name);
    const ownScore = detScore(own);
    if (own?.mentioned) mentioned++;
    if (own?.status === "recommended") recommended++;
    if (own?.listRank != null) ranks.push(own.listRank);
    const beatenHere = cfg.competitors.some((c) => detScore(detOf(r, c.name)) > ownScore);
    if (beatenHere) beaten++;
  }

  const recRate = rate(recommended, n);
  const mentionRate = rate(mentioned, n);
  const avgRank = avg(ranks);
  const rankValue = avgRank == null ? 0.5 : clamp01(1 - (avgRank - 1) / 5);
  const winValue = n > 0 ? 1 - beaten / n : 0;

  // Shared math (scoreCore): score:null when n===0, identical to the app path.
  const core = scoreCore({ recommendation: recRate.rate, mention: mentionRate.rate, rank: rankValue, win: winValue }, n);
  const labels: Record<ScoreKey, string> = {
    recommendation: "Recommendation rate",
    mention: "Mention rate",
    rank: "Rank quality when listed",
    win: "Competitive win rate",
  };
  const details: Record<ScoreKey, string> = {
    recommendation: `Explicitly recommended in ${recommended}/${n} grounded answers.`,
    mention: `Mentioned at all in ${mentioned}/${n} grounded answers.`,
    rank: avgRank == null
      ? "Never appeared in a ranked list (neutral 0.5 applied)."
      : `Average list position ${avgRank.toFixed(1)} when ranked (lower is better).`,
    win:
      beaten === 0
        ? `Out-ranked every competitor in all ${n} answers.`
        : `Out-ranked every competitor in ${n - beaten}/${n} answers (a rival edged ahead in ${beaten}).`,
  };
  const components: ScoreComponent[] = core.components.map((c) => ({
    ...c, label: labels[c.key], detail: details[c.key],
  }));

  return {
    score: core.score,
    components,
    formula:
      "score = 100 × (0.50·recommendationRate + 0.20·mentionRate + " +
      "0.15·rankQuality + 0.15·competitiveWinRate)",
    basedOnResponses: n,
  };
}
