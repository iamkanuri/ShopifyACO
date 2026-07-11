// Fixture data for the embedded /app experience. Mirrors the real /app/api/* shapes
// so every screen renders identically whether served live (a connected shop) or from
// these demos (local preview / a prospect who hasn't connected yet). When a screen
// falls back to fixtures it shows a "Demo data" badge — we never imply it's live.

export interface AppFindingRow {
  id: number; kind: string; signal?: string; intent: string | null; prompt_text: string | null;
  engine: string | null; winning_competitor: string | null; ai_answer_snippet: string | null;
  citations: string[]; merchant_gap: string[]; competitor_advantage: string[];
  confidence_level: string; basis_n: number; limits: string;
  recommended_intervention: string; expected_mechanism: string;
}

export interface AppProposalRow {
  id: number; kind: string; target: string; label: string; current_value: string | null;
  proposed_value: string; rationale: string | null; status: string;
  evidence: { mechanism?: string; intervention?: string };
  /** Live store value for the target field (from the webhook-synced catalog), so the card
   *  always agrees with the Shopify admin. Absent on copy_ready rows and demo fixtures. */
  live_current_value?: string | null;
  product_title?: string | null;
  /** True when the store value changed under a still-actionable proposal (apply would conflict). */
  drifted?: boolean;
}

export interface AppExperimentRow {
  id: number; verdict: string; primary_metric: string; verification_run_id: number | null;
  result: {
    primary: { metric: string; baseline: Proportion; current: Proportion; diff: number | null; diffCiLow: number; diffCiHigh: number; verdict: string };
    secondary: Array<{ metric: string; baseline: Proportion; current: Proportion; verdict: string }>;
    comparability: Array<{ code: string; message: string }>;
    caveats: string[];
  };
}
export interface Proportion { successes: number; n: number; rate: number | null; ciLow: number; ciHigh: number; }

export interface AppShopInfo { shop: string; status: string; plan: string | null; scopes: string[]; writeProducts: boolean; }
export interface AppScheduleRow { id: number; kind: string; cadence: string; enabled: boolean; next_run_at: string; last_run_at: string | null; benchmark_name?: string | null; brand?: string | null; category?: string | null; }
export interface AppAlertRow { id: number; type: string; severity: string; metric: string | null; title: string; detail: string; status: string; created_at: string; }
export interface AppProductRow { product_gid: string; title: string; vendor: string | null; product_type: string | null; status: string | null; seo_title: string | null; seo_description: string | null; variant_count: number; metafield_count: number; nested_truncated?: boolean; }
export interface AppRunRow { id: number; benchmark_id: number | null; tier: string; status: string; mode?: string; observation_count: number; cost_usd: string | number; prompt_count: number; started_at: string; }

export interface AppDashboardData {
  score: number;
  scoreComponents?: Array<{ key: string; label: string; weight: number; value: number; contribution: number }>;
  recommendationRate: Proportion;
  mentionRate: Proportion;
  shareOfVoice: Array<{ key: string; share: number }>;
  weakestEngine: string | null;
  topThreat: string | null;
  lastRunAt: string | null;
  openFindings: number;
  pendingFixes: number;
  openAlerts: number;
}
export interface AppDashboard {
  connected: boolean;
  hasData: boolean;
  brand: string;
  category: string;
  runId: number | null;
  data: AppDashboardData | null;
}

export interface AppPlanLimits { benchmarksPerMonth: number; monitoringSchedules: number; feeds: number; }
export interface AppEntitlement {
  id: string; label: string; status: string; active: boolean; source: string; tier: number; recurring: boolean;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  features: Record<string, boolean>; limits: AppPlanLimits;
}
export interface AppPlanCard {
  id: string; name: string; price: string; cadence: string; blurb: string; features: string[];
  limits: AppPlanLimits; tier: number; stripeUrl: string | null; current: boolean;
}
export interface AppBilling {
  plan: AppEntitlement;
  usage: { benchmarksLast30d: number; monitoringSchedules: number; feeds: number };
  enforced: boolean;
  /** Shopify Managed Pricing page (compliant upgrade/manage). Null until configured. */
  managedPricingUrl: string | null;
  plans: AppPlanCard[];
}

export interface AppAttributionSource { aiSource: string; sessions: number; productViews: number; checkouts: number; }
export interface AppAttribution {
  windowDays: number;
  totals: { sessions: number; productViews: number; checkouts: number };
  bySource: AppAttributionSource[];
  note?: string;
}
export interface AppPixelHealth {
  webPixelId: string | null;
  activated: boolean;
  hasScope: boolean;
  ingestTokenSet?: boolean;
  lastEventAt: string | null;
  totalEvents: number;
  eventsLast7d: number;
  sessionsLast7d: number;
}

const p = (successes: number, n: number): Proportion => {
  const rate = n ? successes / n : null;
  const z = 1.96, ph = rate ?? 0, denom = 1 + z * z / n;
  const center = (ph + z * z / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((ph * (1 - ph)) / n + z * z / (4 * n * n));
  return { successes, n, rate, ciLow: Math.max(0, center - half), ciHigh: Math.min(1, center + half) };
};

export const DEMO = {
  shop: "olipop-demo.myshopify.com",
  brand: "Olipop",
  category: "prebiotic soda",

  dashboard: {
    score: 72, // /100 AI visibility score (real scan on gpt-5.4-mini, 2026-06-28)
    recommendationRate: p(28, 48),
    mentionRate: p(41, 48),
    shareOfVoice: [
      { key: "Olipop", share: 0.58 },
      { key: "Poppi", share: 0.15 },
      { key: "Culture Pop", share: 0.02 },
      { key: "Health-Ade", share: 0.02 },
    ],
    weakestEngine: "ChatGPT",
    topThreat: "Poppi",
    lastRunAt: "2026-06-28T15:00:00Z",
    openFindings: 4,
    pendingFixes: 2,
    openAlerts: 1,
  },

  findings: <AppFindingRow[]>[
    {
      id: 1, kind: "evidence_backed", signal: "reviews", intent: "comparison",
      prompt_text: "What are the best prebiotic soda brands?", engine: "ChatGPT", winning_competitor: "Poppi",
      ai_answer_snippet: "Poppi is a standout in the category — it's heavily reviewed, leans into bold fruit-forward flavors, and is frequently called out for taste.",
      citations: ["https://drinkpoppi.com", "https://www.healthline.com/nutrition/prebiotic-soda"],
      merchant_gap: ["No review count / rating in structured data (AggregateRating)"],
      competitor_advantage: ["Poppi exposes review counts + average rating in machine-readable schema"],
      confidence_level: "moderate", basis_n: 9,
      limits: "Based on 9 ChatGPT answers in this scan where Poppi was chosen over you. AI answers vary run-to-run, and a competitor exposing this signal is correlation, not proof of cause. Verify with a follow-up benchmark.",
      recommended_intervention: "Publish Product + AggregateRating JSON-LD reflecting your real, verifiable review counts and average rating.",
      expected_mechanism: "Assistants frequently cite ratings and review volume as a decision factor and preferentially draw from pages that expose them in machine-readable schema. Making your real review data visible MAY raise the chance ChatGPT surfaces and recommends you. Mechanism, not a guarantee.",
    },
    {
      id: 2, kind: "evidence_backed", signal: "health_claims", intent: "use_case",
      prompt_text: "What's the healthiest soda I can drink?", engine: "ChatGPT", winning_competitor: "Health-Ade",
      ai_answer_snippet: "For gut health, options like Health-Ade and Poppi often come up for their probiotic/prebiotic positioning and clearly stated benefits.",
      citations: ["https://health-ade.com", "https://www.eatingwell.com"],
      merchant_gap: ["Prebiotic fiber + nutrition facts aren't in structured data; health framing is thin on the indexed page"],
      competitor_advantage: ["Competitors state the health benefit prominently on indexable pages"],
      confidence_level: "directional", basis_n: 5,
      limits: "Based on 5 health-intent answers in this scan; treat as a directional hypothesis and re-verify.",
      recommended_intervention: "Surface your prebiotic-fiber content + nutrition facts in structured data and clear on-page copy.",
      expected_mechanism: "Health-intent answers weigh benefits the assistant can read. Making yours explicit + machine-readable MAY make you eligible for ‘healthiest soda’ answers — a mechanism to test, not a promised lift.",
    },
    {
      id: 3, kind: "general_hygiene", signal: "indexable", intent: null, prompt_text: null, engine: null,
      winning_competitor: null, ai_answer_snippet: null, citations: [],
      merchant_gap: ["Several flavor pages have no Product structured data"],
      competitor_advantage: [],
      confidence_level: "directional", basis_n: 0,
      limits: "General readiness item, not checked against a specific lost query. Best practice for machine readability.",
      recommended_intervention: "Add Product JSON-LD to each flavor page (name, brand, offers, identifiers).",
      expected_mechanism: "Structured product data is the most machine-readable form of your catalog; assistants preferentially draw from pages that expose it. Necessary, though not on its own sufficient.",
    },
  ],

  proposals: <AppProposalRow[]>[
    {
      id: 11, kind: "write_products", target: "seo.description", label: "Backfill the SEO description from the product description",
      current_value: null, proposed_value: "Olipop Vintage Cola — a prebiotic soda with plant fiber and botanicals, just 2–3g sugar, classic cola taste.",
      rationale: "The SEO description is empty; it's a primary machine-readable summary. This only reuses your existing product description.",
      status: "proposed", evidence: { mechanism: "Exposes a clean machine-readable summary assistants and search can quote." },
    },
    {
      id: 12, kind: "copy_ready", target: "jsonld:Product", label: "Add Product structured data (built from your catalog)",
      current_value: null, proposed_value: '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Product",\n  "name": "Olipop Vintage Cola",\n  "brand": { "@type": "Brand", "name": "Olipop" }\n}\n</script>',
      rationale: "Add Product JSON-LD (name, brand, offers, identifiers) to the flavor page.",
      status: "proposed", evidence: { mechanism: "Structured product data is the most machine-readable form of your catalog." },
    },
    {
      id: 13, kind: "copy_ready", target: "guidance:reviews", label: "Add review structured data (fill in your REAL counts)",
      current_value: null, proposed_value: '"aggregateRating": {\n  "@type": "AggregateRating",\n  "ratingValue": "<YOUR_AVERAGE_RATING>",\n  "reviewCount": "<YOUR_REVIEW_COUNT>"\n}',
      rationale: "Publish AggregateRating reflecting your real, verifiable review counts — the signal Poppi wins on in ChatGPT.",
      status: "applied", evidence: { mechanism: "Assistants cite ratings/volume as a decision factor." },
    },
  ],

  experiments: <AppExperimentRow[]>[
    {
      id: 21, verdict: "improved", primary_metric: "recommendationRate", verification_run_id: 142,
      result: {
        primary: { metric: "recommendationRate", baseline: p(23, 48), current: p(33, 48), diff: 0.21, diffCiLow: 0.02, diffCiHigh: 0.39, verdict: "improved" },
        secondary: [
          { metric: "mentionRate", baseline: p(41, 48), current: p(43, 48), verdict: "inconclusive" },
          { metric: "topChoiceRate", baseline: p(9, 48), current: p(15, 48), verdict: "inconclusive" },
        ],
        comparability: [{ code: "low_power", message: "Small sample (n=48 on the primary metric). At this size only a large effect is detectable." }],
        caveats: [
          "Association, not proof: a change measured alongside your intervention is not causal evidence. Confounders (assistant model updates, retrieval/index refreshes, competitor changes, run-to-run variance) can move these numbers on their own.",
          "The measured increase on recommendationRate is the best estimate from this pair; the true effect lies within the reported CI and should be re-confirmed on a later run before being treated as durable.",
        ],
      },
    },
    {
      id: 22, verdict: "inconclusive", primary_metric: "recommendationRate", verification_run_id: 151,
      result: {
        primary: { metric: "recommendationRate", baseline: p(33, 48), current: p(34, 48), diff: 0.02, diffCiLow: -0.16, diffCiHigh: 0.20, verdict: "inconclusive" },
        secondary: [{ metric: "mentionRate", baseline: p(43, 48), current: p(43, 48), verdict: "inconclusive" }],
        comparability: [{ code: "low_power", message: "Small sample (n=48). An 'inconclusive' result likely reflects low power, not a confirmed null." }],
        caveats: ['"Inconclusive" means no change was detectable at this sample size — NOT proof the intervention had no effect. Add prompts/repetitions for more power, then re-verify.'],
      },
    },
  ],

  pendingExperiment: <AppExperimentRow>{
    id: 23, verdict: "pending", primary_metric: "recommendationRate", verification_run_id: null,
    result: {
      primary: { metric: "recommendationRate", baseline: p(34, 48), current: p(0, 0), diff: null, diffCiLow: 0, diffCiHigh: 0, verdict: "pending" },
      secondary: [], comparability: [], caveats: [],
    },
  },

  schedules: <AppScheduleRow[]>[
    { id: 31, kind: "benchmark", cadence: "weekly", enabled: true, next_run_at: "2026-06-29T15:00:00Z", last_run_at: "2026-06-22T15:00:00Z", benchmark_name: "Olipop — AI visibility", brand: "Olipop", category: "prebiotic soda" },
  ],

  alerts: <AppAlertRow[]>[
    {
      id: 41, type: "threshold", severity: "warning", metric: "recommendationRate",
      title: "ChatGPT recommends Olipop the least (50%)",
      detail: "Perplexity and Gemini both recommend you 63%, but ChatGPT only 50% — your weakest engine. Engine results vary run-to-run; corroborate before acting.",
      status: "open", created_at: "2026-06-22T15:05:00Z",
    },
  ],

  runs: <AppRunRow[]>[
    { id: 142, benchmark_id: 7, tier: "monitoring", status: "completed", mode: "live", observation_count: 240, cost_usd: 0.06, prompt_count: 16, started_at: "2026-06-22T15:00:00Z" },
    { id: 131, benchmark_id: 7, tier: "monitoring", status: "completed", mode: "live", observation_count: 234, cost_usd: 0.06, prompt_count: 16, started_at: "2026-06-15T15:00:00Z" },
  ],

  billing: <AppBilling>{
    plan: {
      id: "free", label: "Free", status: "active", active: true, source: "default", tier: 0, recurring: false,
      currentPeriodEnd: null, cancelAtPeriodEnd: false,
      features: { evidence: true, live_benchmarks: false, fixes: false, experiments: false, monitoring: false, feeds: true, attribution: true },
      limits: { benchmarksPerMonth: 3, monitoringSchedules: 0, feeds: 1 },
    },
    usage: { benchmarksLast30d: 2, monitoringSchedules: 0, feeds: 1 },
    enforced: false,
    managedPricingUrl: null,
    plans: [
      { id: "free_mini", name: "Free mini scan", price: "$0", cadence: "", blurb: "See if AI assistants know you.", features: ["5 buyer-intent prompts", "3 engines", "Visibility score + competitor leaderboard"], limits: { benchmarksPerMonth: 3, monitoringSchedules: 0, feeds: 1 }, tier: 0, stripeUrl: null, current: true },
      { id: "full_report", name: "Full report", price: "$29", cadence: "one-time", blurb: "The complete picture + how to fix it.", features: ["Comprehensive buyer-intent analysis (up to 30 prompts)", "Competitor gap + lost-prompt analysis", "Fix roadmap + report"], limits: { benchmarksPerMonth: 25, monitoringSchedules: 0, feeds: 3 }, tier: 1, stripeUrl: null, current: false },
      { id: "monitoring", name: "Weekly monitoring", price: "$49", cadence: "/mo", blurb: "Track and defend your AI share of voice.", features: ["Automatic weekly scans", "Share-of-voice trends", "Alerts on new lost prompts"], limits: { benchmarksPerMonth: 60, monitoringSchedules: 5, feeds: 10 }, tier: 2, stripeUrl: null, current: false },
      { id: "founder_beta", name: "Founder beta", price: "$99", cadence: "beta", blurb: "5 deep scans + direct founder review.", features: ["5 deep scans", "Founder review", "Shape the product"], limits: { benchmarksPerMonth: 100, monitoringSchedules: 10, feeds: 25 }, tier: 3, stripeUrl: null, current: false },
    ],
  },

  shopInfo: <AppShopInfo>{
    shop: "olipop-demo.myshopify.com", status: "active", plan: null,
    scopes: ["read_products", "read_customer_events", "write_pixels", "write_products"], writeProducts: true,
  },

  catalog: {
    total: 8, lastSyncAt: "2026-06-22T14:50:00Z",
    products: <AppProductRow[]>[
      { product_gid: "gid://shopify/Product/1001", title: "Vintage Cola", vendor: "Olipop", product_type: "Prebiotic Soda", status: "ACTIVE", seo_title: "Olipop Vintage Cola", seo_description: null, variant_count: 2, metafield_count: 2 },
      { product_gid: "gid://shopify/Product/1002", title: "Strawberry Vanilla", vendor: "Olipop", product_type: "Prebiotic Soda", status: "ACTIVE", seo_title: null, seo_description: null, variant_count: 2, metafield_count: 1 },
      { product_gid: "gid://shopify/Product/1003", title: "Classic Root Beer", vendor: "Olipop", product_type: "Prebiotic Soda", status: "ACTIVE", seo_title: "Olipop Classic Root Beer", seo_description: "Prebiotic root beer with plant fiber, 2–3g sugar.", variant_count: 2, metafield_count: 3 },
      { product_gid: "gid://shopify/Product/1004", title: "Cherry Cola", vendor: "Olipop", product_type: "Prebiotic Soda", status: "ACTIVE", seo_title: null, seo_description: null, variant_count: 2, metafield_count: 0 },
    ],
  },

  attribution: <AppAttribution>{
    windowDays: 30,
    totals: { sessions: 214, productViews: 96, checkouts: 12 },
    bySource: [
      { aiSource: "ChatGPT", sessions: 128, productViews: 61, checkouts: 8 },
      { aiSource: "Perplexity", sessions: 57, productViews: 24, checkouts: 3 },
      { aiSource: "Gemini", sessions: 29, productViews: 11, checkouts: 1 },
    ],
    note: "Directional: identifiable AI-referred sessions (referrer/UTM), not causal attribution. AI assistants often strip the referrer, so this undercounts; treat as a floor.",
  },

  pixelHealth: <AppPixelHealth>{
    webPixelId: "gid://shopify/WebPixel/2247262310",
    activated: true,
    hasScope: true,
    ingestTokenSet: true,
    lastEventAt: "2026-06-22T15:04:00Z",
    totalEvents: 318,
    eventsLast7d: 214,
    sessionsLast7d: 214,
  },
};
