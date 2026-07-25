// ---------------------------------------------------------------------------
// Merchant-facing analysis types. PURE — no Node imports — so these (and the
// modules that build them) can be lifted straight into the Shopify embedded app.
// Every rate carries its raw counts (n=) for statistical honesty.
// ---------------------------------------------------------------------------

import type { CitedSourcesReport } from "./citedSources.js"; // type-only (no runtime cycle)
export type { CitedSource, CitedSourceBucket, CitedSourcesReport } from "./citedSources.js";
import type { SubstitutionFrame } from "./substitutionFrame.js"; // type-only (no runtime cycle)
export type { SubstitutionFrame, FrameBucket, FrameRival, FrameSeverity } from "./substitutionFrame.js";

export interface RateStat {
  count: number;
  total: number;
  rate: number; // count / total (0 when total === 0)
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number; // 0..1, weights sum to 1
  value: number; // normalized 0..1
  contribution: number; // weight * value * 100 (points added to the score)
  detail: string; // human explanation, includes n=
}

export interface VisibilityScore {
  score: number | null; // 0..100 rounded; NULL when there are zero grounded observations (no data → no score)
  components: ScoreComponent[];
  formula: string; // documented, deterministic
  basedOnResponses: number;
}

export type ConfidenceTier = "high" | "medium" | "directional";

export interface Confidence {
  tier: ConfidenceTier;
  label: string;
  basedOnResponses: number;
}

export type RunSize = "mini" | "standard" | "deep";

export interface CompetitorThreat {
  competitor: string;
  ownRecommendation: RateStat;
  competitorRecommendation: RateStat;
  ownMention: RateStat;
  competitorMention: RateStat;
  /** competitorRecRate / ownRecRate, null if own rate is 0 (avoid div-by-zero). */
  recommendationMultiplier: number | null;
  sharedNiche: string[]; // cluster labels where they compete
  /** The slice the niche-threat verdict rests on, e.g. "13 ceramic/non-toxic prompts". */
  basisLabel: string;
  basisResponses: number;
  confidence: Confidence;
  summary: string; // relative-framed, scan-scoped
}

/** The category-wide recommendation leader — distinct from the in-niche threat. */
export interface CategoryLeader {
  competitor: string;
  recommendation: RateStat;
  mention: RateStat;
}

export interface MentionGap {
  brand: string;
  mention: RateStat;
  recommendation: RateStat;
  /** mentioned but NOT recommended. */
  mentionedNotChosen: RateStat;
  summary: string;
}

export interface EngineWeakness {
  engine: string;
  mention: RateStat;
  recommendation: RateStat;
  avgRankWhenMentioned: number | null;
  isWeakest: boolean;
  summary: string;
}

export interface QueryClusterResult {
  cluster: string;
  label: string;
  transactional: boolean;
  prompts: string[];
  responses: number;
  brandMention: RateStat;
  brandRecommendation: RateStat;
  absent: boolean; // brand never mentioned anywhere in this cluster
  topWinners: { brand: string; recommendations: number }[];
}

export interface ProofPoint {
  id: string;
  label: string;
  hits: number; // competitor-winning responses that contain this proof point
  competitors: string[];
  examplePrompt?: string;
  exampleSnippet?: string;
}

export interface LeaderboardRow {
  brand: string;
  isOwn: boolean;
  mention: RateStat;
  recommendation: RateStat;
  avgRankWhenMentioned: number | null;
  strongestEngines: string[];
  topWinningPrompts: string[];
}

export interface LostPrompt {
  prompt: string;
  template: string;
  engine: string;
  brandMentioned: boolean;
  brandRecommended: boolean;
  brandRank: number | null;
  winners: string[]; // recommended competitors (fallback: mentioned competitors)
  snippet?: string;
  suggestedFixId?: string;
}

/** A brand the AI recommended that the merchant did NOT configure as a competitor. DISCOVERED
 *  + DIRECTIONAL — frequency-of-appearance only (never rates/rank; never a first-class competitor). */
export interface DiscoveredBrand {
  name: string;
  /** Number of grounded answers it appeared in as a recommendation (≥2 — hallucination floor). */
  answers: number;
}

export type FixTier = "evidence_backed" | "general_hygiene";
export type FixImpact = "high" | "medium" | "low";

export interface FixCard {
  id: string;
  tier: FixTier;
  impact: FixImpact;
  title: string;
  why: string;
  relatedPrompts: string[];
  relatedSnippets: string[];
  suggestedFix: string;
  /** Present when the fix asserts a factual claim that must be verified first. */
  verifyNote?: string;
}

export interface MerchantAnalysis {
  brand: string;
  category: string;
  generatedAt: string;
  basedOnResponses: number;
  enginesUsed: string[];
  groundedEngines: string[];
  ungroundedEngines: string[];
  totalCostUsd: number;
  caveat: string;
  /** Overall run-size badge + confidence derived from the grounded-answer count. */
  runSize: RunSize;
  confidence: Confidence;
  visibilityScore: VisibilityScore;
  executiveInsight: string;
  /** Plain-English "what this means" framing for the merchant. */
  headline: string;
  whatThisMeans: string[];
  threat: CompetitorThreat | null;
  categoryLeader: CategoryLeader | null;
  /** True when the MERCHANT out-recommends the top competitor — i.e. the merchant is the category's
   *  most-recommended brand. When set, `categoryLeader` is the NEAREST CHALLENGER (to watch), not the
   *  leader, and `threat` is typically null — renderers must present a "you lead" story, never call a
   *  rival "the leader" (a self-contradiction with the winning hero). */
  ownLeadsCategory: boolean;
  mentionGap: MentionGap;
  engineWeakness: EngineWeakness[];
  weakestEngine: string | null;
  clusters: QueryClusterResult[];
  proofPoints: ProofPoint[];
  leaderboard: LeaderboardRow[];
  lostPrompts: LostPrompt[];
  fixCards: FixCard[];
  /** The "AI trust graph": source domains assistants CITED while answering, conditioned on outcome
   *  (all / lost / per-engine). Observed, never causal. Empty buckets when the run has no citations. */
  citedSources: CitedSourcesReport;
  /** Brands the AI recommended that weren't in the configured competitor list (Fix 1).
   *  Populated by a live LLM pass in the scan orchestration — NOT by the pure analyzeRun. */
  discoveredBrands?: DiscoveredBrand[];
  /** The substitution frame — how the report LEADS: where the merchant stands in AI's
   *  recommendation decision, naming who AI recommends instead, severity-selected (brutal
   *  number-led / mild reframe-led). Populated by the scan orchestration (needs the recommendation-
   *  verified rivals + discovered brands) — NOT the pure analyzeRun. Absent → renderers fall back to
   *  the legacy score-led headline (back-compat with pre-frame results.json). */
  substitutionFrame?: SubstitutionFrame;
}
