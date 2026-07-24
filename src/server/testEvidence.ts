// ===========================================================================
// PHASE B HARDENING — deterministic EVIDENCE-SUPPORT VALIDATION.
//
// Ports the lab's (Stage 2/3) support rules into the public engine. The failure
// this exists to prevent, observed live: the assertion "Ships in the US within a
// week" passed on the quote "…$8.00 Selected Subscribe & Save save 25% … Free
// shipping Cancel anytime…" — page chrome, no timing, truncated mid-word. That is
// aboutness-blind matching (the Stage 3 TRAP: "aluminum-free packaging" credited
// as a product claim).
//
// Three gates, applied uniformly before any assertion may reach Pass:
//   1. ABOUTNESS  — the matched SENTENCE must be about the thing asserted
//                   (negation guard + veto for packaging/shipping/related-product/
//                   review/subscription-widget context; timing needs a real timing
//                   term, and a digit unless the term is self-contained).
//   2. SURFACE    — quotes may only come from PRODUCT-EVIDENCE surfaces
//                   (description, JSON-LD Product fields, FAQ, option values,
//                   title, meta description). Raw page text is never evidence:
//                   it is dominated by nav, upsell, review and widget chrome.
//   3. PRESENTABLE— whole sentences, ≤180 chars, word-boundary ellipsis, never a
//                   mid-word fragment. No clean sentence ⇒ no quote (name the
//                   surface instead).
// FAIL CLOSED: anything that can't clear all three is NOT a pass. A wrong Fail is
// recoverable; a wrong Pass destroys the product's whole differentiator.
// Pure + deterministic — no model calls, no network.
// ===========================================================================

/** Surfaces whose text is product evidence and may be quoted. Page chrome is
 *  deliberately absent — see the module header. */
export type QuotableSurface =
  | "product_description"
  | "structured_data"
  | "product_faq"
  | "product_title"
  | "product_options"
  | "meta_description";

export const SURFACE_LABEL: Record<QuotableSurface, string> = {
  product_description: "product copy",
  structured_data: "structured data",
  product_faq: "FAQ structured data",
  product_title: "product title",
  product_options: "variant options",
  meta_description: "page description",
};

export interface EvidenceSentence { surface: QuotableSurface; text: string }
export interface SupportedEvidence { surface: QuotableSurface; sentence: string; term: string; quote: string | null }

const MAX_QUOTE = 180;
/** Beyond this a "sentence" is a collapsed run of markup, not prose. Set well above
 *  any real sentence: length alone is a poor junk signal, so the real filter is the
 *  content-density check in `presentableQuote`. */
const MAX_CLEAN_SENTENCE = 1000;

export const normalize = (s: string): string =>
  s.toLowerCase().replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** Split text into sentences: after . ! ? followed by whitespace, and on newlines. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/** Build the sentence-level evidence index from typed surfaces (chrome excluded). */
export function buildEvidence(parts: Array<{ surface: QuotableSurface; text: string | null | undefined }>): EvidenceSentence[] {
  const out: EvidenceSentence[] = [];
  for (const { surface, text } of parts) {
    if (!text) continue;
    for (const sentence of splitSentences(text)) out.push({ surface, text: sentence });
  }
  return out;
}

// ---- gate 1: aboutness ------------------------------------------------------

const NEGATION_WINDOW = 14;
const NEGATION = /(^|[^a-z])(not|never|isn'?t|aren'?t|no longer|without being|free from claims of)\s*$/i;

/** True when EVERY occurrence of `term` in `sentence` is negated. Mirrors the
 *  Stage 2 negation guard: only the ~14 chars immediately preceding count. */
export function isNegated(sentence: string, term: string): boolean {
  const n = normalize(sentence);
  const t = normalize(term);
  let i = n.indexOf(t);
  if (i === -1) return true; // absent ⇒ certainly not supporting
  while (i !== -1) {
    const before = n.slice(Math.max(0, i - NEGATION_WINDOW), i);
    if (!NEGATION.test(before)) return false; // a non-negated occurrence exists
    i = n.indexOf(t, i + 1);
  }
  return true;
}

/** Nouns that, when the claim term MODIFIES them, mean the claim is about
 *  something other than the product (the Stage 3 TRAP: "aluminum-free packaging"). */
const MODIFIED_SUBJECT = /^\W{0,3}(packaging|package|packet|carton|box|wrapper|label|bag|pouch|container|bottle|shipping|delivery|mailer)\b/i;

/** Whole-sentence contexts that are never product evidence: upsell/related items,
 *  review excerpts, and subscription/purchase widgets (the live regression's source). */
const CONTEXT_VETO: Array<{ name: string; re: RegExp }> = [
  { name: "related-product", re: /\b(you may also|also available|also try|pairs? (well )?with|bundle|kit includes|shop all|related products?|recommended for you|customers also|complete the (set|routine))\b/i },
  { name: "review", re: /\b(review(s|ed)?|verified buyer|customer said|testimonial|star rating|out of 5 stars)\b/i },
  { name: "subscription-widget", re: /\b(subscribe (&|and) save|cancel anytime|pause or skip|skip anytime|auto-?renew|deliver(y|ed)? every|every \d+ (weeks?|months?))\b/i },
];

export interface AboutnessResult { ok: boolean; reason?: string }

/** Does this sentence genuinely assert `term` ABOUT the product under test? */
export function passesAboutness(sentence: string, term: string, opts: { allowLogisticsSubject?: boolean } = {}): AboutnessResult {
  if (isNegated(sentence, term)) return { ok: false, reason: "negated" };
  for (const v of CONTEXT_VETO) {
    if (v.re.test(sentence)) return { ok: false, reason: v.name };
  }
  // The term must not merely MODIFY a non-product noun ("aluminum-free packaging").
  // Logistics requirements legitimately talk about shipping, so that subject is
  // allowed there (but never for product claims).
  const n = normalize(sentence);
  const t = normalize(term);
  let i = n.indexOf(t);
  while (i !== -1) {
    const after = n.slice(i + t.length, i + t.length + 24);
    const m = MODIFIED_SUBJECT.exec(after);
    if (!m) return { ok: true }; // this occurrence stands on its own
    if (opts.allowLogisticsSubject && /^(\W{0,3})(shipping|delivery|mailer)\b/i.test(after)) return { ok: true };
    i = n.indexOf(t, i + 1);
  }
  return { ok: false, reason: "modifies-non-product-subject" };
}

// ---- gate 3: presentable quote ----------------------------------------------

/** A whole-sentence quote, ≤180 chars, cut at a WORD boundary with an ellipsis.
 *  Returns null when no clean sentence can be produced (caller names the surface). */
export function presentableQuote(sentence: string): string | null {
  const clean = sentence.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_CLEAN_SENTENCE) return null;
  // Content density, not length, is what separates prose from scraped chrome:
  if (!/[a-z]{3}/i.test(clean)) return null;                       // no real words
  if (clean.split(/\s+/).length < 3) return null;                  // a fragment, not a sentence
  if ((clean.match(/\$\s?\d/g) ?? []).length > 2) return null;     // a price list (widget)
  const letters = (clean.match(/[a-z]/gi) ?? []).length;
  if (letters / clean.length < 0.55) return null;                  // symbol/number soup
  if (clean.length <= MAX_QUOTE) return clean;
  const cut = clean.slice(0, MAX_QUOTE);
  const lastSpace = cut.lastIndexOf(" ");
  const body = (lastSpace > MAX_QUOTE * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!-]+$/, "");
  return `${body}…`;
}

// ---- the uniform support check ----------------------------------------------

/** Find the first sentence that genuinely supports one of `terms`, on a quotable
 *  product-evidence surface, and produce a presentable quote for it. */
export function findSupport(
  evidence: EvidenceSentence[],
  terms: readonly string[],
  opts: { allowLogisticsSubject?: boolean; requireDigit?: boolean } = {},
): SupportedEvidence | null {
  for (const ev of evidence) {
    const n = normalize(ev.text);
    for (const term of terms) {
      if (!n.includes(normalize(term))) continue;
      if (opts.requireDigit && !/\d/.test(ev.text)) continue; // timing needs a number
      const about = passesAboutness(ev.text, term, opts);
      if (!about.ok) continue;
      return { surface: ev.surface, sentence: ev.text, term, quote: presentableQuote(ev.text) };
    }
  }
  return null;
}

// ---- logistics / timing vocabulary ------------------------------------------

/** Timing terms that are open-ended and only state a deadline WITH a number
 *  ("ships within 2 business days"). A digit is required in the same sentence. */
export const TIMING_TERMS_NEEDING_DIGIT = [
  "ships within", "ships in", "business days", "business day", "delivery in", "arrives in",
  "arrive within", "delivered within", "delivered in", "shipping time", "ships out in", "dispatch within",
] as const;

/** Timing terms that are self-contained deadlines — no digit needed. */
export const TIMING_TERMS_SELF_CONTAINED = [
  "ships same day", "ships next day", "same-day shipping", "next-day shipping", "overnight shipping",
  "same day delivery", "next day delivery", "ships today",
] as const;

/** NOTE: "free shipping" is deliberately NOT a timing term — it states price, not
 *  speed. Crediting it was the live false positive this module exists to prevent. */

export function findTimingSupport(evidence: EvidenceSentence[]): SupportedEvidence | null {
  return (
    findSupport(evidence, TIMING_TERMS_SELF_CONTAINED, { allowLogisticsSubject: true }) ??
    findSupport(evidence, TIMING_TERMS_NEEDING_DIGIT, { allowLogisticsSubject: true, requireDigit: true })
  );
}
