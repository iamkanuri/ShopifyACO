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
  gapLine: string;                   // one merchant-facing sentence — the SINGLE source of the
                                     // gap framing shared by the preview, OG card, and meta tags
                                     // (so they can never tell three different stories).
  weakestEngine: string | null;
  headline: string | null;
  isShopify: boolean;
  basedOnResponses: number;
}

const pct = (r: unknown): number | null => (typeof r === "number" ? Math.round(r * 100) : null);

/**
 * The gap sentence, story-correct for each case. Plain text (no markup) so every surface can
 * render it verbatim. The edge case that matters most: a brand AI never surfaces (0% mention)
 * has a 0-point gap — that's NOT "demand leaking to competitors", it's being invisible.
 */
function buildGapLine(brand: string, mentionRate: number | null, recommendationRate: number | null, gapPoints: number | null): string {
  const ref = brand || "this store";
  if (mentionRate == null || recommendationRate == null) {
    return `How often AI assistants recommend ${ref} versus its competitors.`;
  }
  if (mentionRate === 0) {
    return `AI assistants don't surface ${ref} for these shopping questions yet — that's demand you're invisible for.`;
  }
  if (gapPoints != null && gapPoints > 0) {
    return `Known by AI ${mentionRate}% of the time, recommended only ${recommendationRate}% — that ${gapPoints}-point gap is demand going to competitors.`;
  }
  return `AI assistants both know and recommend ${ref} — you're winning these queries.`;
}

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
  const brand = typeof a.brand === "string" ? a.brand : "";
  const gapPoints = mentionRate != null && recommendationRate != null ? mentionRate - recommendationRate : null;
  return {
    brand,
    category: typeof a.category === "string" ? a.category : "",
    score: (a.visibilityScore as { score?: number } | undefined)?.score ?? null,
    mentionRate,
    recommendationRate,
    gapPoints,
    gapLine: buildGapLine(brand, mentionRate, recommendationRate, gapPoints),
    weakestEngine: typeof a.weakestEngine === "string" ? a.weakestEngine : null,
    headline: typeof a.headline === "string" ? a.headline : null,
    isShopify: Boolean(r?.meta?.isShopify),
    basedOnResponses: typeof a.basedOnResponses === "number" ? a.basedOnResponses : 0,
  };
}
