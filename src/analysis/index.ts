import type { RunResults } from "../types.js";
import type { MerchantAnalysis } from "./types.js";
import { computeVisibilityScore } from "./score.js";
import { analyzeClusters } from "./queryClusters.js";
import { extractProofPoints } from "./proofPoints.js";
import {
  computeCategoryLeader,
  computeEngineWeakness,
  computeLeaderboard,
  computeLostPrompts,
  computeMentionGap,
  computeThreat,
} from "./gapAnalysis.js";
import { buildFixCards } from "./fixSuggestions.js";
import { confidenceFor, runSizeFor } from "./confidence.js";
import { fmtRate, grounded } from "./util.js";
import { engineLabel } from "../engines/labels.js";
import { isCommonWordPhrase } from "../detection/match.js";

export * from "./types.js";

const CAVEAT =
  "These are single-scan, small-sample rates. AI assistant answers vary run-to-run; " +
  "treat figures as directional signal, not settled fact. Multi-run aggregation is on the roadmap.";

/** Build the full merchant-facing analysis from a run. Pure + offline (no API calls). */
export function analyzeRun(run: RunResults): MerchantAnalysis {
  const { config: cfg, results, aggregate: agg } = run;
  const ok = grounded(results);

  const clusters = analyzeClusters(results, cfg);
  const visibilityScore = computeVisibilityScore(results, cfg);
  const mentionGap = computeMentionGap(results, cfg);
  const threat = computeThreat(results, cfg, clusters);
  const categoryLeader = computeCategoryLeader(results, cfg);
  const { engines: engineWeakness, weakest } = computeEngineWeakness(results, cfg);
  const leaderboard = computeLeaderboard(results, cfg);
  const proofPoints = extractProofPoints(results, cfg);
  const lostPrompts = computeLostPrompts(results, cfg);
  const fixCards = buildFixCards(cfg, threat, clusters, proofPoints, lostPrompts);

  // Link each lost prompt to the first fix card that references it.
  for (const lp of lostPrompts) {
    const card = fixCards.find((c) => c.relatedPrompts.includes(lp.prompt));
    if (card) lp.suggestedFixId = card.id;
  }

  const groundedEngines = agg.grounding.filter((g) => g.groundingMode === "web_grounded").map((g) => engineLabel(g.engine));
  const ungroundedEngines = agg.grounding
    .filter((g) => g.groundingMode !== "web_grounded" && g.calls - g.errors > 0)
    .map((g) => engineLabel(g.engine));

  // #3: brands whose name is entirely common words ("Made In", "Our Place") are matched
  // case-sensitively to avoid prose false-positives ("made in USA") — document it so the count is trusted.
  const commonWordBrands = [cfg.brand, ...cfg.competitors].filter((b) => isCommonWordPhrase(b.name)).map((b) => b.name);
  const caveat = commonWordBrands.length
    ? `${CAVEAT} Note: ${commonWordBrands.join(", ")} ${commonWordBrands.length === 1 ? "is a common-word name" : "are common-word names"}, so ${commonWordBrands.length === 1 ? "it is" : "they are"} counted only where an assistant capitalizes the name (as brands appear in lists) — avoiding false matches in ordinary prose.`
    : CAVEAT;

  const transactionalLost = clusters.filter((c) => c.transactional && c.absent);
  const executiveInsight = buildExecutiveInsight({
    brand: cfg.brand.name,
    mentionGap,
    threat,
    weakest,
    transactionalLostLabels: transactionalLost.map((c) => c.label),
    n: ok.length,
  });

  // Plain-English "what this means" framing (Part 7).
  const headline =
    mentionGap.mention.rate > mentionGap.recommendation.rate * 1.4
      ? `AI assistants mention ${cfg.brand.name} more than they recommend it.`
      : mentionGap.mention.rate === 0
        ? `AI assistants don't surface ${cfg.brand.name} yet.`
        : `${cfg.brand.name} has room to win more AI recommendations.`;
  const whatThisMeans: string[] = [
    `Discoverability: ${cfg.brand.name} is mentioned in ${fmtRate(mentionGap.mention)} of answers — assistants do know it exists.`,
    `Persuasion: it's recommended in only ${fmtRate(mentionGap.recommendation)} — when listed, it isn't the pick.`,
  ];
  if (transactionalLost.length) {
    whatThisMeans.push(
      `Missing where it counts: absent from high-intent buying queries (${transactionalLost.map((c) => c.label).join(", ")}).`,
    );
  }

  return {
    brand: cfg.brand.name,
    category: cfg.category,
    generatedAt: run.meta.finishedAt,
    basedOnResponses: ok.length,
    enginesUsed: run.meta.engines.map(engineLabel),
    groundedEngines,
    ungroundedEngines,
    totalCostUsd: agg.totalCost.costUsd,
    caveat,
    runSize: runSizeFor(ok.length),
    confidence: confidenceFor(ok.length),
    visibilityScore,
    executiveInsight,
    headline,
    whatThisMeans,
    threat,
    categoryLeader,
    mentionGap,
    engineWeakness,
    weakestEngine: weakest,
    clusters,
    proofPoints,
    leaderboard,
    lostPrompts,
    fixCards,
  };
}

function buildExecutiveInsight(args: {
  brand: string;
  mentionGap: ReturnType<typeof computeMentionGap>;
  threat: ReturnType<typeof computeThreat>;
  weakest: string | null;
  transactionalLostLabels: string[];
  n: number;
}): string {
  const { brand, mentionGap, threat, weakest, transactionalLostLabels, n } = args;
  const parts: string[] = [];
  parts.push(
    `Across ${n} grounded answers in this scan, AI assistants mention ${brand} ` +
      `(${fmtRate(mentionGap.mention)}) more often than they recommend it ` +
      `(${fmtRate(mentionGap.recommendation)}).`,
  );
  if (threat) {
    const mult = threat.recommendationMultiplier;
    parts.push(
      `${threat.competitor} is the biggest direct competitor` +
        (threat.sharedNiche.length ? ` in ${threat.sharedNiche.join(" / ")} queries` : "") +
        (mult != null ? `, recommended ${mult.toFixed(1)}× more often in this scan` : "") +
        ".",
    );
  }
  if (weakest) parts.push(`${weakest} is the weakest engine for ${brand}.`);
  if (transactionalLostLabels.length) {
    parts.push(
      `${brand} is absent from high-intent buying queries: ${transactionalLostLabels.join(", ")}.`,
    );
  }
  return parts.join(" ");
}
