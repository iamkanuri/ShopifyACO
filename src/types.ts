// ---------------------------------------------------------------------------
// Shared types for the ShopifyACO measurement engine.
// This is the contract every module agrees on. Keep it dependency-free.
// ---------------------------------------------------------------------------

// ---- Config (user-authored JSON) ------------------------------------------

export interface BrandConfig {
  name: string;
  storeUrl?: string;
  /** Extra spellings/variants the detector should also treat as this brand. */
  aliases?: string[];
  /** Notable product names — matched in answers and counted as a mention. */
  products?: string[];
}

export interface Config {
  brand: BrandConfig;
  category: string;
  competitors: BrandConfig[];
  buyerPersona?: string;
  location?: string;
  priceRange?: string;
  /** Named lists of placeholder fills, e.g. { use_case: ["running", "hiking"] }. */
  placeholderValues?: Record<string, string[]>;
  /** Buyer-intent templates with {placeholders}. */
  promptTemplates: string[];
  /** Which engines to run. Defaults to all configured ones. */
  engines?: string[];
  /** Max concurrent engine calls in flight. */
  concurrency?: number;
}

// ---- Engines ---------------------------------------------------------------

export type GroundingMode = "web_grounded" | "api_model_only" | "unknown";

export interface EngineUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface EngineResult {
  engine: string;
  model: string;
  /** The assistant's answer text (empty string on error). */
  text: string;
  /** The grounding mode ACTUALLY achieved on this call (fallbacks can change it). */
  groundingMode: GroundingMode;
  usage?: EngineUsage;
  /** Source URLs the assistant cited for this answer (web-grounded calls only). Powers the
   *  Phase-5 live crawl: the competitor pages to diagnose are derived from these. */
  citations?: string[];
  /** Raw API payload, retained only when --save-raw is on. */
  raw?: unknown;
  /** Set when the call failed gracefully; text will be "". */
  error?: string;
}

// ---- Detection (core IP) ---------------------------------------------------

export type RecommendationStatus =
  | "recommended"
  | "mentioned_positive" // TODO day 2-3: sentiment pass
  | "mentioned_negative" // TODO day 2-3: sentiment pass
  | "mentioned_neutral"
  | "not_mentioned";

export interface BrandDetection {
  /** Brand display name this detection is about. */
  name: string;
  /** True for the user's own brand (vs a competitor). */
  isOwn: boolean;
  mentioned: boolean;
  status: RecommendationStatus;
  /** Char offset of first mention in the answer text (-1 if none). */
  firstIndex: number;
  /** 1-based rank if the answer is a list and this brand appears in it; else null. */
  listRank: number | null;
  /** Why we decided `recommended`, for transparency in the report. */
  reason?: string;
  /** ~160 chars of surrounding context around the first mention. */
  snippet?: string;
}

export interface PromptEngineResult {
  prompt: string;
  /** Which template this expanded prompt came from. */
  template: string;
  engine: string;
  model: string;
  groundingMode: GroundingMode;
  error?: string;
  /** The engine's full answer text ("" on error). Used by the analysis layer. */
  text: string;
  usage?: EngineUsage;
  /** Detection for the brand, then each competitor. */
  detections: BrandDetection[];
  /** Source URLs the assistant cited for this answer (web-grounded only). Additive + back-compat —
   *  old runs (pre-citations) simply omit it; the citation analysis treats absence as "no data". */
  citations?: string[];
  raw?: unknown;
}

// ---- Aggregation -----------------------------------------------------------

export interface BrandStats {
  name: string;
  isOwn: boolean;
  /** Responses where this brand was mentioned at all. */
  mentions: number;
  /** Responses where this brand was `recommended`. */
  recommendations: number;
  /** Successful (non-error) responses considered = denominator. */
  responses: number;
  mentionRate: number;
  recommendationRate: number;
  /** Average list rank where it appeared in a list (null if never). */
  avgListRank: number | null;
}

export interface EngineGrounding {
  engine: string;
  model: string;
  /** The dominant grounding mode observed for this engine across the run. */
  groundingMode: GroundingMode;
  errors: number;
  calls: number;
}

export interface CostSummary {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Aggregate {
  /** Brand-level stats overall (brand first, then competitors). */
  overall: BrandStats[];
  /** Brand-level stats per engine: engine -> stats[]. */
  byEngine: Record<string, BrandStats[]>;
  grounding: EngineGrounding[];
  /** Whether any engine ran without web grounding. */
  hasUngroundedEngine: boolean;
  cost: Record<string, CostSummary>; // engine -> cost
  totalCost: CostSummary;
}

// ---- Full run artifact (results.json) --------------------------------------

export interface RunMeta {
  startedAt: string;
  finishedAt: string;
  mode: "live" | "mock";
  engines: string[];
  promptCount: number;
  totalCalls: number;
  /** Best-effort: did the scanned store look like Shopify? Drives funnel CTA routing
   *  (Install vs the one-time report). Absent on CLI/older runs → treated as false. */
  isShopify?: boolean;
  shopifySignal?: string | null;
}

export interface RunResults {
  meta: RunMeta;
  config: Config;
  results: PromptEngineResult[];
  aggregate: Aggregate;
  /** Merchant-facing analysis (added by the analysis layer). Optional for back-compat. */
  analysis?: import("./analysis/types.js").MerchantAnalysis;
}
