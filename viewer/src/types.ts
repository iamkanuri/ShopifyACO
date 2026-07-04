// Self-contained mirror of the analysis output shape. Kept local (not imported
// from ../../src) so these components lift cleanly into the Shopify embedded app.

export interface RateStat {
  count: number;
  total: number;
  rate: number;
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  value: number;
  contribution: number;
  detail: string;
}

export interface VisibilityScore {
  score: number | null; // null when zero grounded observations (no data → no score)
  components: ScoreComponent[];
  formula: string;
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
  recommendationMultiplier: number | null;
  sharedNiche: string[];
  basisLabel: string;
  basisResponses: number;
  confidence: Confidence;
  summary: string;
}

export interface CategoryLeader {
  competitor: string;
  recommendation: RateStat;
  mention: RateStat;
}

export interface MentionGap {
  brand: string;
  mention: RateStat;
  recommendation: RateStat;
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
  absent: boolean;
  topWinners: { brand: string; recommendations: number }[];
}

export interface ProofPoint {
  id: string;
  label: string;
  hits: number;
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
  winners: string[];
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
  verifyNote?: string;
}

export interface DiscoveredBrand {
  name: string;
  answers: number;
}

export interface CitedSource {
  domain: string;
  count: number;
  examplePrompts: string[];
}
export interface CitedSourceBucket {
  n: number;
  sources: CitedSource[];
}
export interface CitedSourcesReport {
  overall: CitedSourceBucket;
  onLostAnswers: CitedSourceBucket;
  byEngine: Record<string, CitedSourceBucket>;
}

export interface Artifact {
  id: string;
  kind: "comparison_page" | "buying_guide" | "llms_txt" | "product_schema";
  title: string;
  format: "markdown" | "text" | "json";
  filename: string;
  body: string;
  placeholders: string[];
  drafted: "llm" | "template";
  /** Provenance tags in the body — "(fact Fn — crawled …)", "(AI answer, this scan)", "(you provide)".
   *  Optional for back-compat with reports generated before tier 2a. */
  provenance?: string[];
}
export interface ArtifactBundle {
  artifacts: Artifact[];
  bridge: string;
  costUsd: number;
  /** Count of facts the store crawl produced (tier 2a). 0 → all templates → show the honest note. */
  sourcedFacts?: number;
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
  runSize: RunSize;
  confidence: Confidence;
  visibilityScore: VisibilityScore;
  executiveInsight: string;
  headline: string;
  whatThisMeans: string[];
  threat: CompetitorThreat | null;
  categoryLeader: CategoryLeader | null;
  mentionGap: MentionGap;
  engineWeakness: EngineWeakness[];
  weakestEngine: string | null;
  clusters: QueryClusterResult[];
  proofPoints: ProofPoint[];
  leaderboard: LeaderboardRow[];
  lostPrompts: LostPrompt[];
  fixCards: FixCard[];
  citedSources?: CitedSourcesReport;
  discoveredBrands?: DiscoveredBrand[];
}

export interface RunMeta {
  startedAt: string;
  finishedAt: string;
  mode: "live" | "mock";
  engines: string[];
  promptCount: number;
  totalCalls: number;
}

export interface RunResults {
  meta: RunMeta;
  analysis?: MerchantAnalysis;
}

// ---- shared formatting helpers --------------------------------------------

export const fmtRate = (r: RateStat) => `${Math.round(r.rate * 100)}%`;
export const fmtRateN = (r: RateStat) => `${Math.round(r.rate * 100)}% (${r.count}/${r.total})`;
export const fmtUsd = (x: number) => `$${x.toFixed(4)}`;
