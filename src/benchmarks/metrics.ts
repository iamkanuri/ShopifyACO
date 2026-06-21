import { compareProportions, engineDivergence, mean, proportion, shareOfVoice, type Comparison, type MeanMetric, type Proportion } from "./stats.js";

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
  const mentionedCount = Math.max(1, mentioned);

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
    citationBackedRate: proportion(citationBacked, mentionedCount),
    shareOfVoice: shareOfVoice(recCounts),
    byEngine,
    engineDivergence: engineDivergence(rateByEngine),
    winLoss: { responses, wins, losses, winRate: proportion(wins, responses) },
  };
}

/** Baseline vs verification comparison on recommendation rate (the headline metric). */
export function compareRuns(baseline: BenchmarkMetrics, current: BenchmarkMetrics): Comparison {
  return compareProportions(
    baseline.recommendationRate.successes, baseline.recommendationRate.n,
    current.recommendationRate.successes, current.recommendationRate.n,
  );
}
