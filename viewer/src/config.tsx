import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface Plan {
  id: string;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  cta?: string;
  stripeUrl?: string | null;
  comingSoon?: boolean;
}

export interface AppConfig {
  brandName: string;
  baseUrl: string;
  contactEmail: string;
  tagline: string;
  demoNote: string;
  plans: Plan[];
  miniPrompts: number;
  fullReportPrompts: number;
  scanCostPerCall: Record<string, number>;
  scanCostCapUsd: number;
  appStoreUrl: string | null;
}

const DEFAULTS: AppConfig = {
  brandName: "AI Visibility",
  baseUrl: "",
  contactEmail: "",
  tagline: "See if AI shoppers recommend your store — or your competitors.",
  demoNote:
    "Sample data, shown for illustration. “Sennen” is a fictional brand; The Ordinary, CeraVe, La Roche-Posay and Paula's Choice are trademarks of their respective owners, referenced for illustration only and not affiliated with AisleLens.",
  plans: [],
  miniPrompts: 5,
  fullReportPrompts: 30,
  // Accurate per-call worst-case (token + fixed search fee); the server overrides via
  // /api/config. Fallback values so a pre-load estimate is never wildly off.
  scanCostPerCall: { openai: 0.0272, gemini: 0.0118, perplexity: 0.0058 },
  scanCostCapUsd: 0.5,
  appStoreUrl: null,
};

const Ctx = createContext<AppConfig>(DEFAULTS);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULTS);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCfg({ ...DEFAULTS, ...d }))
      .catch(() => {});
  }, []);
  return <Ctx.Provider value={cfg}>{children}</Ctx.Provider>;
}

export const useConfig = () => useContext(Ctx);
