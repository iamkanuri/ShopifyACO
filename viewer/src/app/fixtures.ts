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

export interface AppScheduleRow { id: number; kind: string; cadence: string; enabled: boolean; next_run_at: string; last_run_at: string | null; }
export interface AppAlertRow { id: number; type: string; severity: string; metric: string | null; title: string; detail: string; status: string; created_at: string; }
export interface AppProductRow { product_gid: string; title: string; vendor: string | null; product_type: string | null; status: string | null; seo_title: string | null; seo_description: string | null; variant_count: number; metafield_count: number; }
export interface AppRunRow { id: number; tier: string; status: string; observation_count: number; cost_usd: string | number; prompt_count: number; started_at: string; }

const p = (successes: number, n: number): Proportion => {
  const rate = n ? successes / n : null;
  const z = 1.96, ph = rate ?? 0, denom = 1 + z * z / n;
  const center = (ph + z * z / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((ph * (1 - ph)) / n + z * z / (4 * n * n));
  return { successes, n, rate, ciLow: Math.max(0, center - half), ciHigh: Math.min(1, center + half) };
};

export const DEMO = {
  shop: "caraway-demo.myshopify.com",
  brand: "Caraway",
  category: "non-toxic ceramic cookware",

  dashboard: {
    score: 41, // /100 AI visibility score
    recommendationRate: p(3, 60),
    mentionRate: p(20, 60),
    shareOfVoice: [
      { key: "All-Clad", share: 0.31 },
      { key: "GreenPan", share: 0.24 },
      { key: "Caraway", share: 0.12 },
      { key: "Our Place", share: 0.10 },
    ],
    weakestEngine: "ChatGPT",
    topThreat: "GreenPan",
    lastRunAt: "2026-06-20T15:00:00Z",
    openFindings: 5,
    pendingFixes: 3,
    openAlerts: 1,
  },

  findings: <AppFindingRow[]>[
    {
      id: 1, kind: "evidence_backed", signal: "reviews", intent: "comparison",
      prompt_text: "best ceramic non-toxic sauté pan?", engine: "openai", winning_competitor: "GreenPan",
      ai_answer_snippet: "For non-toxic ceramic, GreenPan's Valencia Pro is the top pick — it's been tested by America's Test Kitchen and has thousands of strong reviews.",
      citations: ["https://greenpan.us/products/valencia-pro", "https://www.americastestkitchen.com/reviews"],
      merchant_gap: ["No review count / rating in structured data (AggregateRating)"],
      competitor_advantage: ["Exposes 3,284 reviews at 4.7★ in AggregateRating schema"],
      confidence_level: "moderate", basis_n: 8,
      limits: "Based on 8 lost responses in this scan. AI answers vary run-to-run, and a competitor exposing this signal is correlation, not proof of cause. Verify the effect with a follow-up benchmark.",
      recommended_intervention: "Publish Product + AggregateRating JSON-LD reflecting your real, verifiable review counts and average rating.",
      expected_mechanism: "Assistants frequently cite ratings and review volume as a decision factor and preferentially draw from pages that expose them in machine-readable schema. Making your real review data visible MAY raise the chance you're surfaced and cited. Mechanism, not a guarantee.",
    },
    {
      id: 2, kind: "evidence_backed", signal: "shipping", intent: "budget",
      prompt_text: "non-toxic cookware set with free shipping under $400?", engine: "perplexity", winning_competitor: "Our Place",
      ai_answer_snippet: "Our Place's Always Pan set ships free and falls under $400, making it an easy recommendation here.",
      citations: ["https://fromourplace.com/products/always-pan"],
      merchant_gap: ["Shipping terms are not in the Offer (no shippingDetails)"],
      competitor_advantage: ["Declares free shipping in OfferShippingDetails"],
      confidence_level: "directional", basis_n: 4,
      limits: "Based on 4 lost responses in this scan; treat as a directional hypothesis and re-verify.",
      recommended_intervention: "Add OfferShippingDetails to your Offer schema so shipping cost/speed is machine-readable.",
      expected_mechanism: "Buyer-intent answers often compare shipping; assistants can only weigh terms they can read. Structuring yours MAY make you eligible for shipping-sensitive answers — a mechanism to test, not a promised lift.",
    },
    {
      id: 3, kind: "general_hygiene", signal: "indexable", intent: null, prompt_text: null, engine: null,
      winning_competitor: null, ai_answer_snippet: null, citations: [],
      merchant_gap: ["Product page is set to noindex (excluded from indexing)"],
      competitor_advantage: [],
      confidence_level: "directional", basis_n: 0,
      limits: "General readiness item, not checked against a specific lost query. Best practice for machine readability.",
      recommended_intervention: "Remove the noindex directive so the product page can be indexed and retrieved.",
      expected_mechanism: "Content excluded from indexing generally cannot be retrieved or cited by assistants that rely on indexed sources. Necessary, though not on its own sufficient.",
    },
  ],

  proposals: <AppProposalRow[]>[
    {
      id: 11, kind: "write_products", target: "seo.description", label: "Backfill the SEO description from the product description",
      current_value: null, proposed_value: "Caraway non-toxic ceramic sauté pan — naturally slick, PTFE & PFAS-free coating, oven-safe to 550°F.",
      rationale: "The SEO description is empty; it's a primary machine-readable summary. This only reuses your existing product description.",
      status: "proposed", evidence: { mechanism: "Exposes a clean machine-readable summary assistants and search can quote." },
    },
    {
      id: 12, kind: "copy_ready", target: "jsonld:Product", label: "Add Product structured data (built from your catalog)",
      current_value: null, proposed_value: '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Product",\n  "name": "Ceramic Sauté Pan",\n  "brand": { "@type": "Brand", "name": "Caraway" }\n}\n</script>',
      rationale: "Add Product JSON-LD (name, brand, offers, identifiers) to the product page.",
      status: "proposed", evidence: { mechanism: "Structured product data is the most machine-readable form of your catalog." },
    },
    {
      id: 13, kind: "copy_ready", target: "guidance:reviews", label: "Add review structured data (fill in your REAL counts)",
      current_value: null, proposed_value: '"aggregateRating": {\n  "@type": "AggregateRating",\n  "ratingValue": "<YOUR_AVERAGE_RATING>",\n  "reviewCount": "<YOUR_REVIEW_COUNT>"\n}',
      rationale: "Publish AggregateRating reflecting your real, verifiable review counts.",
      status: "applied", evidence: { mechanism: "Assistants cite ratings/volume as a decision factor." },
    },
  ],

  experiments: <AppExperimentRow[]>[
    {
      id: 21, verdict: "improved", primary_metric: "recommendationRate", verification_run_id: 142,
      result: {
        primary: { metric: "recommendationRate", baseline: p(3, 60), current: p(11, 60), diff: 0.133, diffCiLow: 0.04, diffCiHigh: 0.23, verdict: "improved" },
        secondary: [
          { metric: "mentionRate", baseline: p(20, 60), current: p(28, 60), verdict: "inconclusive" },
          { metric: "topChoiceRate", baseline: p(1, 60), current: p(4, 60), verdict: "inconclusive" },
        ],
        comparability: [{ code: "low_power", message: "Small sample (n=60 on the primary metric). At this size only a large effect is detectable." }],
        caveats: [
          "Association, not proof: a change measured alongside your intervention is not causal evidence. Confounders (assistant model updates, retrieval/index refreshes, competitor changes, run-to-run variance) can move these numbers on their own.",
          "The measured increase on recommendationRate is the best estimate from this pair; the true effect lies within the reported CI and should be re-confirmed on a later run before being treated as durable.",
        ],
      },
    },
    {
      id: 22, verdict: "inconclusive", primary_metric: "recommendationRate", verification_run_id: 151,
      result: {
        primary: { metric: "recommendationRate", baseline: p(11, 60), current: p(12, 60), diff: 0.017, diffCiLow: -0.11, diffCiHigh: 0.14, verdict: "inconclusive" },
        secondary: [{ metric: "mentionRate", baseline: p(28, 60), current: p(29, 60), verdict: "inconclusive" }],
        comparability: [{ code: "low_power", message: "Small sample (n=60). An 'inconclusive' result likely reflects low power, not a confirmed null." }],
        caveats: ['"Inconclusive" means no change was detectable at this sample size — NOT proof the intervention had no effect. Add prompts/repetitions for more power, then re-verify.'],
      },
    },
  ],

  pendingExperiment: <AppExperimentRow>{
    id: 23, verdict: "pending", primary_metric: "recommendationRate", verification_run_id: null,
    result: {
      primary: { metric: "recommendationRate", baseline: p(12, 60), current: p(0, 0), diff: null, diffCiLow: 0, diffCiHigh: 0, verdict: "pending" },
      secondary: [], comparability: [], caveats: [],
    },
  },

  schedules: <AppScheduleRow[]>[
    { id: 31, kind: "benchmark", cadence: "weekly", enabled: true, next_run_at: "2026-06-28T15:00:00Z", last_run_at: "2026-06-21T15:00:00Z" },
  ],

  alerts: <AppAlertRow[]>[
    {
      id: 41, type: "competitor_overtake", severity: "warning", metric: "shareOfVoice",
      title: "All-Clad overtook you in share of voice",
      detail: "You led share of voice in the use-case cohort last run; this run All-Clad leads. Share of voice is recommendation-weighted and varies between runs — corroborate before acting.",
      status: "open", created_at: "2026-06-21T15:05:00Z",
    },
  ],

  runs: <AppRunRow[]>[
    { id: 142, tier: "monitoring", status: "completed", observation_count: 86, cost_usd: 0.04, prompt_count: 12, started_at: "2026-06-21T15:00:00Z" },
    { id: 131, tier: "monitoring", status: "completed", observation_count: 84, cost_usd: 0.04, prompt_count: 12, started_at: "2026-06-14T15:00:00Z" },
  ],

  catalog: {
    total: 7, lastSyncAt: "2026-06-21T14:50:00Z",
    products: <AppProductRow[]>[
      { product_gid: "gid://shopify/Product/1001", title: "Ceramic Sauté Pan", vendor: "Caraway", product_type: "Cookware", status: "ACTIVE", seo_title: "Caraway Ceramic Sauté Pan", seo_description: null, variant_count: 4, metafield_count: 2 },
      { product_gid: "gid://shopify/Product/1002", title: "Fry Pan", vendor: "Caraway", product_type: "Cookware", status: "ACTIVE", seo_title: null, seo_description: null, variant_count: 4, metafield_count: 1 },
      { product_gid: "gid://shopify/Product/1003", title: "Dutch Oven", vendor: "Caraway", product_type: "Cookware", status: "ACTIVE", seo_title: "Caraway Dutch Oven", seo_description: "Non-toxic enameled Dutch oven.", variant_count: 5, metafield_count: 3 },
      { product_gid: "gid://shopify/Product/1004", title: "Cookware Set", vendor: "Caraway", product_type: "Cookware", status: "ACTIVE", seo_title: null, seo_description: null, variant_count: 6, metafield_count: 0 },
    ],
  },
};
