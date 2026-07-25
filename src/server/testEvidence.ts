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

import { nonProductSubject } from "./subject.js";

/** Surfaces whose text is product evidence and may be quoted. Page chrome is
 *  deliberately absent — see the module header. */
export type QuotableSurface =
  | "product_description"
  | "structured_data"
  | "product_faq"
  | "product_title"
  | "product_options"
  | "meta_description"
  | "shipping_policy"
  // V2 CP2 — surfaces that exist ONLY with an authenticated store connection.
  // These are exactly the surfaces the public test honestly reports as
  // "requires store access": once installed, they become readable evidence.
  | "product_metafield"
  | "seo_description";

export const SURFACE_LABEL: Record<QuotableSurface, string> = {
  product_description: "product copy",
  structured_data: "structured data",
  product_faq: "FAQ structured data",
  product_title: "product title",
  product_options: "variant options",
  meta_description: "page description",
  shipping_policy: "shipping policy",
  product_metafield: "product metafields",
  seo_description: "SEO description",
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

/**
 * Negators, matched as whole words anywhere in the term's own CLAUSE.
 *
 * v2.4's corpus showed the previous rule — a 14-char window requiring the negator
 * to sit immediately before the term — misses the ordinary way merchants write a
 * denial. "We do not offer next-day shipping." was reported as STATING a delivery
 * speed, because `offer` sits between `not` and the term. So did "Made without
 * plastic, ever.", "This is not a 16 oz bottle." and "No part of this is made in
 * China." A denial read as an assertion is the worst class of false pass: the
 * store said the opposite of what we report.
 */
// The vocabulary is a CLOSED list and was measured, not guessed: a 41-phrase sweep
// of ordinary denial wording found 21 that the first draft silently declined.
// `nothing` was the cruellest — `not` is visibly inside it, but the `([^a-z]|$)`
// bound rejects the substring, so the commonest total denial in DTC copy read as an
// assertion. The additions below are exactly that measured set.
const NEGATOR = /(^|[^a-z])(not|never|no|none|nothing|neither|nor|zero|cannot|can'?t|do(es)?n'?t|didn'?t|won'?t|wouldn'?t|shouldn'?t|couldn'?t|mustn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|hasn'?t|haven'?t|ain'?t|without|lacks|lacking|devoid of|free from claims of|no longer|unable to|refuses?|refused|stopped|ceased|discontinued|excludes?|excluding|minus|aside from|other than|rather than|instead of|hardly|rarely)([^a-z]|$)/i;

/**
 * The span a negation can reach: backwards from the term to the nearest CLAUSE
 * boundary.
 *
 * Bounding on commas and coordinating conjunctions is load-bearing in BOTH
 * directions, and the boundary set was chosen by measuring the failures of the
 * alternatives:
 *   • Unbounded (whole sentence) turns "Our cups are not dishwasher safe, and they
 *     are made from stoneware." into a false FAIL — the negation does not scope
 *     across the conjunction, and depth pays for pretending it does.
 *   • Immediate-adjacency (the old 14 chars) misses every denial with a verb in it.
 * A negator does not normally scope past `, and` / `;` / `but`, and does normally
 * scope over "do not OFFER x".
 */
const CLAUSE_BOUNDARY = /[.!?]\s|[;:]|,\s+(and|but|or|yet|so)\s|\s+(but|however|whereas|although|though)\s/gi;

/** The text from the start of the term's clause up to the term. */
function clauseBefore(haystack: string, index: number): string {
  const head = haystack.slice(0, index);
  let start = 0;
  CLAUSE_BOUNDARY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BOUNDARY.exec(head)) !== null) start = m.index + m[0].length;
  return head.slice(start);
}

/**
 * A denial that FOLLOWS the term: "Next-day shipping is not available."
 *
 * `clauseBefore` only ever looks backwards, so the fresh adversarial pass over the
 * v2.5 rewrite found the whole post-term direction untouched — the same denial as
 * the pinned "We do not offer next-day shipping.", with the words reordered, was
 * reported as STATING a delivery window and quoted the denial as its proof.
 *
 * Deliberately narrow: a copular predicate that negates availability, not a general
 * forward scan. A broad forward rule would suppress "Made in Vermont. Not sold in
 * stores." and cost real passes.
 */
const POST_TERM_DENIAL = /^[^.;:!?]{0,40}?\b(is|are|was|were|has been|have been)\s+(not\s+\w+|un(available|offered)|no longer\s+\w+|discontinued|unavailable)\b/i;

/** True when the clause AFTER the term denies it. */
function deniedAfter(haystack: string, index: number, termLength: number): boolean {
  return POST_TERM_DENIAL.test(haystack.slice(index + termLength));
}

/** True when EVERY occurrence of `term` in `sentence` sits in a negated clause. */
export function isNegated(sentence: string, term: string): boolean {
  const n = normalize(sentence);
  const t = normalize(term);
  let i = n.indexOf(t);
  if (i === -1) return true; // absent ⇒ certainly not supporting
  while (i !== -1) {
    const negated = NEGATOR.test(clauseBefore(n, i)) || deniedAfter(n, i, t.length);
    if (!negated) return false; // a non-negated occurrence exists
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
/** Containers that ARE the product when a measurement modifies them. "16oz bottle"
 *  and "12 oz bag" are how a beverage or coffee store states its size — treating
 *  those as a non-product subject told every such store it publishes no dimensions
 *  while its copy literally said so. Packaging nouns (box, carton, wrapper, mailer)
 *  are deliberately NOT here: those really are the shipment. */
const CONTAINER_IS_PRODUCT = /^\W{0,3}(bottle|bag|pouch|container|jar|tin|can|tube|tumbler|canister)\b/i;

export function passesAboutness(sentence: string, term: string, opts: { allowLogisticsSubject?: boolean; allowContainerSubject?: boolean } = {}): AboutnessResult {
  if (isNegated(sentence, term)) return { ok: false, reason: "negated" };
  for (const v of CONTEXT_VETO) {
    if (v.re.test(sentence)) return { ok: false, reason: v.name };
  }
  // v2.5 CP2 — read the SUBJECT, not a character window. This is the gate the
  // packaging / shipment / bundled-item / competitor / review false passes needed:
  // a noun list applied to a fixed span could never reach them (see subject.ts).
  const at = sentence.toLowerCase().indexOf(term.toLowerCase());
  const subjectVeto = nonProductSubject(sentence, at >= 0 ? at : 0, opts);
  if (subjectVeto) return { ok: false, reason: subjectVeto };
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
    if (opts.allowContainerSubject && CONTAINER_IS_PRODUCT.test(after)) return { ok: true };
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

// NOTE — `containsTerm` was removed in v2.5. `termMatches` below subsumes it and
// additionally reports WHERE each term matched, which is what the overlap check
// and the longest-match rule both need. Word bounding is unchanged: boundaries are
// non-alphanumeric, so hyphen and slash compounds ("machine-wash", "9.5oz") still
// match, which is what a merchant's copy actually looks like, while "weight" no
// longer hides inside "lightweight".

/** Where a term matched, so callers can reason about OVERLAP between two term
 *  lists — the only way to tell "contains gluten" apart from the "contains
 *  gluten-free" it is a substring of. */
export interface TermMatch { term: string; index: number; end: number }

/** Every term in `terms` that occurs in `haystack` (already normalised), with
 *  positions. Longest match first, so the most specific term wins. */
export function termMatches(haystack: string, terms: readonly string[], wholeWord: boolean): TermMatch[] {
  const out: TermMatch[] = [];
  for (const term of terms) {
    const t = normalize(term);
    if (!t) continue;
    let i = haystack.indexOf(t);
    while (i !== -1) {
      const before = i === 0 ? "" : haystack[i - 1]!;
      const after = haystack[i + t.length] ?? "";
      const bounded = !wholeWord || ((!before || !/[a-z]/i.test(before)) && (!after || !/[a-z]/i.test(after)));
      if (bounded) out.push({ term, index: i, end: i + t.length });
      i = haystack.indexOf(t, i + 1);
    }
  }
  // Longest first. `findSupport` used to take the first term in LIST order, which
  // meant "Orders are not delivered within 3 business days" matched `business days`
  // (3rd in the list) before `delivered within` (10th) — and since the negation
  // guard is only ever applied to the term that matched, a working guard was
  // bypassed by list order alone. Specificity, not authoring order, decides.
  return out.sort((a, b) => (b.end - b.index) - (a.end - a.index) || a.index - b.index);
}

/** A question is not a statement. "Is same-day shipping available?" was rendered
 *  as the PROOF that a delivery window is stated; in the live FAQ shape the answer
 *  denying it is a separate sentence that was never consulted. Since `splitSentences`
 *  breaks after `?`, dropping interrogatives leaves the answer available on its own. */
const isInterrogative = (s: string): boolean => /\?\s*$/.test(s.trim());

/** Find the first sentence that genuinely supports one of `terms`, on a quotable
 *  product-evidence surface, and produce a presentable quote for it. */
export function findSupport(
  evidence: EvidenceSentence[],
  terms: readonly string[],
  opts: { allowLogisticsSubject?: boolean; allowContainerSubject?: boolean; requireDigit?: boolean; wholeWord?: boolean } = {},
): SupportedEvidence | null {
  for (const ev of evidence) {
    if (isInterrogative(ev.text)) continue;
    if (opts.requireDigit && !/\d/.test(ev.text)) continue; // timing needs a number
    const n = normalize(ev.text);
    const matches = termMatches(n, terms, opts.wholeWord === true);
    if (!matches.length) continue;
    // FAIL CLOSED ACROSS TERMS. If any matched term is negated, the sentence is a
    // denial and supports nothing — even if a shorter, unnegated term also matched.
    //
    // ⚠️ REDUNDANT FOR THE CORPUS, LOAD-BEARING ON REAL COPY. An earlier version of
    // this comment said "redundant by measurement" because the mutation proof shows
    // removing the line breaks no corpus case. The fresh adversarial pass then
    // measured it against ordinary merchant sentences and found the opposite:
    // removing it flips 12 of 86 probes from not_proven to pass_evidenced, including
    // multi-clause sentences that mix a denial with a statement. The corpus simply
    // contains no case of that shape yet.
    //
    // Recorded this way on purpose. "The mutation proof says it is redundant" was a
    // true statement about the corpus and a false one about the code, and shipping it
    // as a comment would have invited a later session to delete a working guard.
    if (matches.some((m) => isNegated(ev.text, m.term))) continue;
    const best = matches.find((m) => passesAboutness(ev.text, m.term, opts).ok);
    if (!best) continue;
    return { surface: ev.surface, sentence: ev.text, term: best.term, quote: presentableQuote(ev.text) };
  }
  return null;
}

/**
 * Find a sentence that genuinely CONTRADICTS a claim.
 *
 * Identical discipline to `findSupport`, plus the rule that makes it honest: a
 * violating term that is CONTAINED WITHIN a supporting term at the same position
 * is not a contradiction, it is the supporting phrase being read wrong.
 *
 *   "Contains gluten-free rolled oats and almonds."
 *      violating `contains gluten`  → [0, 15)
 *      supporting `gluten-free`     → [9, 20)   ← overlaps
 *
 * Without this the store is told its copy states the opposite of a claim it is
 * actually making, quoting the compliant sentence as proof.
 */
export function findViolation(
  evidence: EvidenceSentence[],
  violating: readonly string[],
  supporting: readonly string[],
  opts: { allowLogisticsSubject?: boolean; allowContainerSubject?: boolean; wholeWord?: boolean } = {},
): SupportedEvidence | null {
  const wholeWord = opts.wholeWord !== false;
  for (const ev of evidence) {
    if (isInterrogative(ev.text)) continue;
    const n = normalize(ev.text);
    const support = termMatches(n, supporting, wholeWord);
    for (const v of termMatches(n, violating, wholeWord)) {
      // The violating string is a fragment of the claim being made only when a
      // supporting match EXTENDS BEYOND it — that is what makes the support the
      // longer, more specific reading of the same characters:
      //
      //   "Contains gluten-free rolled oats"   violating `contains gluten` [0,15)
      //                                        support   `gluten-free`     [9,20)  end 20 > 15 → discard
      //   "This is a non-vegan product"        violating `non-vegan`      [10,19)
      //                                        support   `vegan`          [14,19)  end 19 = 19 → KEEP
      //
      // A plain "any overlap" test discarded the second one too, so a store saying
      // its product is NON-vegan had the violation dropped and then passed on the
      // `vegan` fragment. Found by the fresh adversarial pass over this very fix.
      if (support.some((s) => v.index < s.end && s.index < v.end && s.end > v.end)) continue;
      if (isNegated(ev.text, v.term)) continue;           // "does not contain gluten"
      if (!passesAboutness(ev.text, v.term, opts).ok) continue;
      return { surface: ev.surface, sentence: ev.text, term: v.term, quote: presentableQuote(ev.text) };
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
