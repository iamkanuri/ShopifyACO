// Viewer copy of the pricing test plans (kept local so /demo works without the
// backend). Mirrors src/pricing.ts — these are fake-door prices, no live payments.

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
    features: ["25+ prompts across buyer journeys", "Full gap analysis + proof points", "Prioritized fix cards", "Downloadable report"],
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
];
