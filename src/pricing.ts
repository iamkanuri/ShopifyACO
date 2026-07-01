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
  // Show the card greyed with a "Coming soon" badge and NO call-to-action (not even a
  // waitlist) — used for tiers we want to signal but not take inbound requests for yet.
  comingSoon?: boolean;
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
      "Comprehensive buyer-intent analysis across your category (up to 30 prompts)",
      "Competitor proof-point gap + lost-prompt analysis",
      "Prioritized fix roadmap + downloadable report",
      "Generated automatically — your deep report + done-for-you fixes on screen in minutes",
    ],
    cta: "Full Report — $29",
  },
  // NOTE: ongoing monitoring is now part of the Shopify "Pro" subscription, so the old
  // standalone "$49/mo Weekly monitoring" web plan was retired (it was redundant with Pro
  // and priced higher). Pro ($29.99/mo on Shopify) is the canonical recurring product.
  {
    // Concierge / done-with-you tier. Kept `comingSoon` (greyed, no CTA) on purpose: we
    // signal it exists but don't solicit audit requests yet. id stays "founder_beta" so the
    // existing event/entitlement plumbing is untouched; only the public-facing copy changed.
    id: "founder_beta",
    name: "Founder Audit",
    price: "$99",
    cadence: "",
    blurb: "A senior, human teardown of your AI visibility — done with you.",
    features: [
      "5 deep scans (30 prompts each)",
      "Personally reviewed and walked through with you",
      "A prioritized, store-specific action plan",
    ],
    comingSoon: true,
  },
];

export const PAID_PLAN_IDS = ["full_report", "founder_beta"] as const;
