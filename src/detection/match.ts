import type { BrandConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Low-level brand matching helpers. Case-insensitive, variant-aware, word-
// boundary safe. Pure + dependency-free so they stay easy to unit test as the
// detection IP grows.
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip "https://", "www.", and any path -> bare host like "allbirds.com". */
export function extractHost(url: string): string | null {
  const m = url
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/[?#].*$/, "");
  return m.includes(".") ? m.toLowerCase() : null;
}

/** All the strings that should count as a mention of this brand. */
export function buildVariants(brand: BrandConfig): string[] {
  const set = new Set<string>();
  const add = (s?: string) => {
    if (s && s.trim().length >= 2) set.add(s.trim());
  };
  add(brand.name);
  brand.aliases?.forEach(add);
  brand.products?.forEach(add);
  if (brand.storeUrl) {
    const host = extractHost(brand.storeUrl);
    if (host) add(host);
  }
  // Longest first so the most specific variant wins when reporting matched text.
  return [...set].sort((a, b) => b.length - a.length);
}

function variantRegex(variant: string): RegExp {
  // Flexible whitespace between tokens; optional trailing possessive 's.
  const body = escapeRegex(variant).replace(/\\?\s+/g, "\\s+");
  // (?<!\w) / (?!\w) act as word boundaries that also work around domains.
  return new RegExp(`(?<!\\w)${body}(?:'s)?(?!\\w)`, "gi");
}

export interface Match {
  index: number;
  text: string;
}

/** Earliest match of any variant within `text`, or null. */
export function findEarliest(text: string, variants: string[]): Match | null {
  let best: Match | null = null;
  for (const v of variants) {
    const re = variantRegex(v);
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, text: m[0] };
    }
  }
  return best;
}

/** True if any variant appears anywhere in `line`. */
export function lineMentions(line: string, variants: string[]): boolean {
  return variants.some((v) => variantRegex(v).test(line));
}
