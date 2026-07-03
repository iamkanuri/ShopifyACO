import type { BrandConfig } from "../types.js";

// ---------------------------------------------------------------------------
// Low-level brand matching helpers. Case-insensitive, variant-aware, word-
// boundary safe. Pure + dependency-free so they stay easy to unit test as the
// detection IP grows.
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Very common English words (function words + a few ultra-common ones). A brand whose name is
// ENTIRELY made of these — "Made In", "Our Place", "Away" — collides with ordinary prose ("made in
// USA", "put it away") under case-insensitive matching, inflating its mention count with false hits.
// Such a variant is matched CASE-SENSITIVELY instead: assistants reliably Title-Case brand names in
// lists ("1. Made In …"), so the real mention still matches while the lowercase prose match is dropped.
// Kept to FUNCTION words + a handful of ultra-common terms so a distinctive name ("Great Jones",
// "Big Blanket") is never flagged — only genuinely all-common-word names are.
const COMMON_WORDS = new Set<string>([
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "our", "their", "its", "his", "her",
  "i", "we", "you", "they", "it", "he", "she", "me", "us", "them", "who", "what", "which",
  "and", "or", "but", "so", "nor", "yet", "as", "if", "than", "then",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "up", "out", "off", "over", "under",
  "into", "onto", "about", "away", "back", "down", "near", "through", "around",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "make", "made", "do", "does", "did", "go", "get", "got", "have", "has", "had", "put", "keep",
  "best", "good", "great", "new", "old", "first", "last", "next", "only", "all", "more", "most",
  "well", "way", "home", "place", "one", "two", "here", "there", "now", "no", "yes", "not",
  "real", "true", "free", "open", "big", "little", "high", "low", "right", "left", "day", "time",
]);

/** True when EVERY whitespace-separated token of `s` is a very common English word (so the name
 *  collides with prose and must be matched case-sensitively). Empty / no real tokens → false. */
export function isCommonWordPhrase(s: string): boolean {
  const tokens = s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => COMMON_WORDS.has(t));
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
  // All-common-word names ("Made In") match case-SENSITIVELY to avoid prose false-positives; every
  // other name stays case-insensitive. (?<!\w) / (?!\w) act as word boundaries that also work around domains.
  const flags = isCommonWordPhrase(variant) ? "g" : "gi";
  return new RegExp(`(?<!\\w)${body}(?:'s)?(?!\\w)`, flags);
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

/** ALL matches of any variant within `text`, sorted by position. Used to scope proof-point
 *  extraction to the clauses that are actually about a given brand. */
export function findAll(text: string, variants: string[]): Match[] {
  const out: Match[] = [];
  for (const v of variants) {
    const re = variantRegex(v); // global (g/gi)
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ index: m.index, text: m[0] });
      if (m.index === re.lastIndex) re.lastIndex++; // guard against any zero-width match
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** True if any variant appears anywhere in `line`. */
export function lineMentions(line: string, variants: string[]): boolean {
  return variants.some((v) => variantRegex(v).test(line));
}
