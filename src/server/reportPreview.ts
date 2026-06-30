// The ungated, no-PII slice of a report — shared by the value-first preview API, the OG
// share card, and the per-report meta tags so they can never disagree. Derived purely from
// the analysis of public AI queries about public brands; contains no email/PII.

export interface ReportPreview {
  brand: string;
  category: string;
  score: number | null;
  mentionRate: number | null;        // 0..100
  recommendationRate: number | null; // 0..100
  gapPoints: number | null;          // mention% − recommendation%
  weakestEngine: string | null;
  headline: string | null;
  isShopify: boolean;
  basedOnResponses: number;
}

const pct = (r: unknown): number | null => (typeof r === "number" ? Math.round(r * 100) : null);

/** Extract the preview from a loaded results.json (or null if it has no analysis yet). */
export function reportPreview(results: unknown): ReportPreview | null {
  const r = results as { analysis?: Record<string, unknown>; meta?: { isShopify?: boolean } } | null;
  const a = r?.analysis;
  if (!a) return null;
  const gap = a.mentionGap as { mention?: { rate?: number }; recommendation?: { rate?: number } } | undefined;
  const mr = gap?.mention?.rate;
  const rr = gap?.recommendation?.rate;
  const mentionRate = pct(mr);
  const recommendationRate = pct(rr);
  return {
    brand: typeof a.brand === "string" ? a.brand : "",
    category: typeof a.category === "string" ? a.category : "",
    score: (a.visibilityScore as { score?: number } | undefined)?.score ?? null,
    mentionRate,
    recommendationRate,
    gapPoints: mentionRate != null && recommendationRate != null ? mentionRate - recommendationRate : null,
    weakestEngine: typeof a.weakestEngine === "string" ? a.weakestEngine : null,
    headline: typeof a.headline === "string" ? a.headline : null,
    isShopify: Boolean(r?.meta?.isShopify),
    basedOnResponses: typeof a.basedOnResponses === "number" ? a.basedOnResponses : 0,
  };
}
