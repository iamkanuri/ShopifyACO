// ---------------------------------------------------------------------------
// Pricing constants for the fake-door pricing test. These are NOT live payments —
// clicking a CTA opens an email-capture modal (see runs/leads.jsonl). We will
// test higher price points; comparable tools charge $50–$99 one-time.
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
    cta: "Weekly Monitoring — $49/mo",
  },
  {
    id: "founder_beta",
    name: "Founder beta",
    price: "$99",
    cadence: "beta",
    blurb: "Go deep + shape the product.",
    features: ["5 deep scans (30 prompts each)", "Early access to weekly monitoring", "Direct line to the founder", "Lock in beta pricing"],
    cta: "Founder Beta — $99",
  },
];

export const PAID_PLAN_IDS = ["full_report", "monitoring", "founder_beta"] as const;
