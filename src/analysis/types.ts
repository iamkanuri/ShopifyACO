// ---------------------------------------------------------------------------
// Merchant-facing analysis types. PURE — no Node imports — so these (and the
// modules that build them) can be lifted straight into the Shopify embedded app.
// Every rate carries its raw counts (n=) for statistical honesty.
// ---------------------------------------------------------------------------

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
  score: number; // 0..100, rounded
  components: ScoreComponent[];
  formula: string; // documented, deterministic
  basedOnResponses: number;
}

export interface CompetitorThreat {
  competitor: string;
  ownRecommendation: RateStat;
  competitorRecommendation: RateStat;
  ownMention: RateStat;
  competitorMention: RateStat;
  /** competitorRecRate / ownRecRate, null if own rate is 0 (avoid div-by-zero). */
  recommendationMultiplier: number | null;
  sharedNiche: string[]; // cluster labels where they compete
  summary: string; // relative-framed, scan-scoped
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
  visibilityScore: VisibilityScore;
  executiveInsight: string;
  threat: CompetitorThreat | null;
  mentionGap: MentionGap;
  engineWeakness: EngineWeakness[];
  weakestEngine: string | null;
  clusters: QueryClusterResult[];
  proofPoints: ProofPoint[];
  leaderboard: LeaderboardRow[];
  lostPrompts: LostPrompt[];
  fixCards: FixCard[];
}
