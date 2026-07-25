import type { RunResults } from "../types.js";
import type { MerchantAnalysis } from "./types.js";
import { computeVisibilityScore } from "./score.js";
import { analyzeClusters } from "./queryClusters.js";
import { extractProofPoints } from "./proofPoints.js";
import { analyzeCitedSources } from "./citedSources.js";
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
  // The merchant leads the category when it out-recommends the top competitor. In that case the "category
  // leader" is the merchant, not a rival — so the renderers reframe (you lead / nearest challenger to
  // watch) instead of contradicting the winning hero by crowning a competitor.
  const ownLeadsCategory =
    mentionGap.recommendation.count > 0 &&
    mentionGap.recommendation.rate > (categoryLeader?.recommendation.rate ?? 0);
  // For the category LEADER, the mention→recommend gap is HEADROOM, not a "known but not chosen" deficit —
  // reframe the summary so the gap section doesn't misframe the leader's upside as a loss.
  if (ownLeadsCategory) {
    mentionGap.summary =
      `Even as the most-recommended brand in ${cfg.category}, ${cfg.brand.name} is mentioned ${fmtRate(mentionGap.mention)} of answers ` +
      `but recommended ${fmtRate(mentionGap.recommendation)} — ${fmtRate(mentionGap.mentionedNotChosen)} name it without yet picking it. ` +
      `Converting that awareness is how you extend the lead.`;
  }
  const { engines: engineWeakness, weakest } = computeEngineWeakness(results, cfg);
  const leaderboard = computeLeaderboard(results, cfg);
  const proofPoints = extractProofPoints(results, cfg);
  const lostPrompts = computeLostPrompts(results, cfg);
  const citedSources = analyzeCitedSources(results, cfg);
  const fixCards = buildFixCards(cfg, threat, clusters, proofPoints, lostPrompts, citedSources, ownLeadsCategory);

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
    category: cfg.category,
    ownLeadsCategory,
    mentionGap,
    threat,
    weakest,
    transactionalLostLabels: transactionalLost.map((c) => c.label),
    n: ok.length,
  });

  // Plain-English "what this means" framing (Part 7). The headline is also copied verbatim into the
  // "Copy summary" clipboard text (ExportBar), so it must cohere with the winning hero for a leader.
  const headline =
    ownLeadsCategory
      ? `${cfg.brand.name} is AI's most-recommended ${cfg.category} brand — with a mention-to-recommendation gap to close.`
      : mentionGap.mention.rate > mentionGap.recommendation.rate * 1.4
        ? `AI assistants mention ${cfg.brand.name} more than they recommend it.`
        : mentionGap.mention.rate === 0
          ? `AI assistants don't surface ${cfg.brand.name} yet.`
          : `${cfg.brand.name} has room to win more AI recommendations.`;
  const whatThisMeans: string[] = [
    `Discoverability: ${cfg.brand.name} is mentioned in ${fmtRate(mentionGap.mention)} of answers — assistants do know it exists.`,
    ownLeadsCategory
      ? `Persuasion: recommended in ${fmtRate(mentionGap.recommendation)} of answers — the most of any brand in the category. Keep the lead.`
      : `Persuasion: it's recommended in only ${fmtRate(mentionGap.recommendation)} — when listed, it isn't the pick.`,
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
    ownLeadsCategory,
    mentionGap,
    engineWeakness,
    weakestEngine: weakest,
    clusters,
    proofPoints,
    leaderboard,
    lostPrompts,
    fixCards,
    citedSources,
  };
}

function buildExecutiveInsight(args: {
  brand: string;
  category: string;
  ownLeadsCategory: boolean;
  mentionGap: ReturnType<typeof computeMentionGap>;
  threat: ReturnType<typeof computeThreat>;
  weakest: string | null;
  transactionalLostLabels: string[];
  n: number;
}): string {
  const { brand, category, ownLeadsCategory, mentionGap, threat, weakest, transactionalLostLabels, n } = args;
  const parts: string[] = [];
  // A category leader's executive insight must OPEN on the win, then note the gap — never lead with the
  // mention>recommend "known but not chosen" framing (which reads as a losing brand and contradicts the hero).
  parts.push(
    ownLeadsCategory
      ? `Across ${n} grounded answers in this scan, AI assistants recommend ${brand} (${fmtRate(mentionGap.recommendation)}) — ` +
          `more than any rival in ${category}. The gap to close: it's mentioned more often (${fmtRate(mentionGap.mention)}) ` +
          `than it's recommended, so some answers name it without yet picking it.`
      : `Across ${n} grounded answers in this scan, AI assistants mention ${brand} ` +
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
