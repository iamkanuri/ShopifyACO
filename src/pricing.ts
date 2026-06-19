// ---------------------------------------------------------------------------
// Plan definitions. A CTA opens the plan's Stripe Payment Link when its
// STRIPE_*_URL env var is set (real payment, recorded via the Stripe webhook);
// if the URL is missing it falls back to email capture. Prices are constants we
// can A/B; comparable tools charge $50–$99 one-time.
// ---------------------------------------------------------------------------

export interface PlanDef {
  id: string;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta?: string;
}

export const PLANS: PlanDef[] = [
  {
    id: "free_mini",
    name: "Free mini scan",
    price: "$0",
    cadence: "",
    blurb: "See if AI assistants know you.",
    features: ["5 buyer-intent prompts", "3 engines (ChatGPT, Gemini, Perplexity)", "Visibility score + competitor leaderboard"],
  },
  {
    id: "full_report",
    name: "Full report",
    price: "$29",
    cadence: "one-time",
    blurb: "The complete picture + how to fix it.",
    features: [
      "25+ buyer-intent prompts, deeper clusters",
      "Competitor proof-point gap + lost-prompt analysis",
      "Prioritized fix roadmap + downloadable report",
      "Manually reviewed during beta — delivered by email within 24h",
    ],
    cta: "Full Report — $29",
  },
  {
    id: "monitoring",
    name: "Weekly monitoring",
    price: "$49",
    cadence: "/mo",
    blurb: "Track and defend your AI share of voice.",
    features: ["Automatic weekly scans", "Visibility & share-of-voice trends", "Alerts on new lost prompts", "Everything in Full report"],
    // No `cta` by default: until STRIPE_WEEKLY_MONITORING_URL is set the UI shows a
    // "Coming soon" badge + waitlist join (the fulfillment loop isn't ready yet).
    cta: "Weekly Monitoring — $49/mo",
  },
  {
    id: "founder_beta",
    name: "Founder beta",
    price: "$99",
    cadence: "beta",
    blurb: "5 deep scans + direct founder review.",
    features: [
      "5 deep scans (30 prompts each)",
      "Each report reviewed personally by the founder",
      "Direct line to shape the product",
      "Lock in beta pricing",
    ],
    cta: "Founder Beta — $99",
  },
];

export const PAID_PLAN_IDS = ["full_report", "monitoring", "founder_beta"] as const;
