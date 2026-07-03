import { compareProportions, engineDivergence, mean, proportion, shareOfVoice, type Comparison, type MeanMetric, type Proportion } from "./stats.js";
import { scoreCore } from "../analysis/score.js";

// Pure aggregation: a set of observations → benchmark metrics, each with a sample
// size and confidence interval. One observation = one engine answer's assessment of
// one brand/product. Multiple observations share a responseId when they came from the
// same answer (enables per-answer win/loss).

export interface ObservationLike {
  responseId?: string | null;
  engine: string;
  targetBrand: string;
  recommendationStatus: string; // recommended | mentioned_* | not_mentioned
  rank?: number | null;
  promptText: string;
  citations?: unknown[];
}

const isMentioned = (s: string) => s !== "not_mentioned" && s !== "";
const isRecommended = (s: string) => s === "recommended";
const norm = (s: string) => s.trim().toLowerCase();

export interface BenchmarkMetrics {
  brand: string;
  n: number;
  recommendationRate: Proportion;
  mentionRate: Proportion;
  topChoiceRate: Proportion;
  avgPosition: MeanMetric;
  promptCoverage: Proportion;
  citationBackedRate: Proportion;
  shareOfVoice: Array<{ key: string; count: number; share: number }>;
  byEngine: Record<string, { n: number; recommendationRate: Proportion }>;
  engineDivergence: number | null;
  winLoss: { responses: number; wins: number; losses: number; winRate: Proportion };
}

export function aggregate(observations: ObservationLike[], merchantBrand: string): BenchmarkMetrics {
  const brand = norm(merchantBrand);
  const mine = observations.filter((o) => norm(o.targetBrand) === brand);
  const n = mine.length;

  const recommended = mine.filter((o) => isRecommended(o.recommendationStatus)).length;
  const mentioned = mine.filter((o) => isMentioned(o.recommendationStatus)).length;
  const topChoice = mine.filter((o) => o.rank === 1).length;
  const ranks = mine.map((o) => o.rank).filter((r): r is number => typeof r === "number" && r > 0);
  const citationBacked = mine.filter((o) => isMentioned(o.recommendationStatus) && Array.isArray(o.citations) && o.citations.length > 0).length;

  // Prompt coverage: of distinct prompts, in how many was the merchant mentioned ≥once.
  const promptsAll = new Set(mine.map((o) => norm(o.promptText)));
  const promptsCovered = new Set(mine.filter((o) => isMentioned(o.recommendationStatus)).map((o) => norm(o.promptText)));

  // Share of voice by recommendation across all brands.
  const recCounts: Record<string, number> = {};
  for (const o of observations) if (isRecommended(o.recommendationStatus)) recCounts[o.targetBrand] = (recCounts[o.targetBrand] ?? 0) + 1;

  // Per-engine recommendation rate (for divergence).
  const byEngine: Record<string, { n: number; recommendationRate: Proportion }> = {};
  const rateByEngine: Record<string, number | null> = {};
  for (const eng of new Set(mine.map((o) => o.engine))) {
    const es = mine.filter((o) => o.engine === eng);
    const er = es.filter((o) => isRecommended(o.recommendationStatus)).length;
    const p = proportion(er, es.length);
    byEngine[eng] = { n: es.length, recommendationRate: p };
    rateByEngine[eng] = p.rate;
  }

  // Win/loss per answer (needs responseId): win = merchant recommended in that answer;
  // loss = a competitor recommended and the merchant was not.
  const byResponse = new Map<string, ObservationLike[]>();
  for (const o of observations) {
    if (!o.responseId) continue;
    (byResponse.get(o.responseId) ?? byResponse.set(o.responseId, []).get(o.responseId)!).push(o);
  }
  let wins = 0, losses = 0;
  for (const group of byResponse.values()) {
    const merchantRec = group.some((o) => norm(o.targetBrand) === brand && isRecommended(o.recommendationStatus));
    const compRec = group.some((o) => norm(o.targetBrand) !== brand && isRecommended(o.recommendationStatus));
    if (merchantRec) wins++;
    else if (compRec) losses++;
  }
  const responses = byResponse.size;

  return {
    brand: merchantBrand,
    n,
    recommendationRate: proportion(recommended, n),
    mentionRate: proportion(mentioned, n),
    topChoiceRate: proportion(topChoice, n),
    avgPosition: mean(ranks),
    promptCoverage: proportion(promptsCovered.size, promptsAll.size),
    // Denominator is the mentions (citation-backed among mentions); n=0 when never
    // mentioned — proportion() reports rate=null, not a fabricated 0/1.
    citationBackedRate: proportion(citationBacked, mentioned),
    shareOfVoice: shareOfVoice(recCounts),
    byEngine,
    engineDivergence: engineDivergence(rateByEngine),
    winLoss: { responses, wins, losses, winRate: proportion(wins, responses) },
  };
}

// AI Visibility Score from aggregated metrics — the SAME documented, deterministic
// formula as src/analysis/score.ts (the CLI path), expressed over benchmark metrics so
// a connected merchant's dashboard score is computed identically:
//
//   score = 100 × (0.50·recommendationRate + 0.20·mentionRate
//                  + 0.15·rankQuality + 0.15·competitiveStanding)
//
//   rankQuality        = avgPosition==null ? 0.5 : clamp01(1 − (avgPos−1)/5)
//   competitiveStanding = responses>0 ? 1 − losses/responses : 0.5
//                         (share of answers where no competitor out-recommended you)
//
// Never a black box: components are returned so the UI can show why.
export interface ScoreBreakdown {
  score: number | null; // NULL when n===0 (a zero-observation run has no score) — see scoreCore
  components: Array<{ key: string; label: string; weight: number; value: number; contribution: number }>;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// App-side component labels (kept as shipped — the app says "Competitive standing", the web says
// "Competitive win rate"); only the MATH is shared, via scoreCore.
const APP_SCORE_LABELS: Record<string, string> = {
  recommendation: "Recommendation rate",
  mention: "Mention rate",
  rank: "Rank quality when listed",
  win: "Competitive standing",
};

export function scoreFromMetrics(m: BenchmarkMetrics): ScoreBreakdown {
  const rec = m.recommendationRate.rate ?? 0;
  const mention = m.mentionRate.rate ?? 0;
  const avgRank = m.avgPosition.mean;
  const rankValue = avgRank == null ? 0.5 : clamp01(1 - (avgRank - 1) / 5);
  // No win/loss data → 0 (no competitive evidence earns no points). Previously 0.5 here, which made
  // the two scores diverge for sparse/no-data runs (benchmark 15 vs CLI 8). Codex A4.
  const compValue = m.winLoss.responses > 0 ? 1 - m.winLoss.losses / m.winLoss.responses : 0;

  // The SAME formula the CLI/web path uses (scoreCore) — including score:null when n===0.
  const core = scoreCore({ recommendation: rec, mention, rank: rankValue, win: compValue }, m.n);
  const components = core.components.map((c) => ({ ...c, label: APP_SCORE_LABELS[c.key] ?? c.key }));
  return { score: core.score, components };
}

/** Baseline vs verification comparison on recommendation rate (the headline metric). */
export function compareRuns(baseline: BenchmarkMetrics, current: BenchmarkMetrics): Comparison {
  return compareProportions(
    baseline.recommendationRate.successes, baseline.recommendationRate.n,
    current.recommendationRate.successes, current.recommendationRate.n,
  );
}
