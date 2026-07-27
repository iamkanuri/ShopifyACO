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

// ---- v3.1 CP2a: two denial forms, on the VIOLATION side only ----------------
//
// THE DEFECT. `cruelty_free`'s violating list is ["tested on animals"], and
//     "Tested on animals: never."
// was returned as PROOF that the store states the violating claim — the compliant
// sentence quoted back as evidence of the opposite. Same class as the `gluten_free`
// / `contains gluten-free` overlap, still live in a shipped built-in.
//
// ⚠️ BOTH FORMS ARE DELIBERATELY ONE-DIRECTIONAL, and that is the whole design.
// `isNegated` serves BOTH `findSupport` and `findViolation`, so widening the shared
// NEGATOR would have suppressed genuine claims:
//   • `free of` — "This oil is free of parabens and is 100% organic." No clause
//     boundary sits between them (` and ` without a comma is not one), so the frame
//     would reach `organic` and delete a real claim.
//   • post-term `never` — "Gluten-free: never any wheat." The `never` scopes over
//     `wheat`, not over the claim it follows.
// On the violation side neither ambiguity exists: an absence frame or a flat denial
// attached to a VIOLATING term can only ever mean the store is denying it. v2.6
// built a general negation-scope rewrite, measured it as a net regression against
// the code it replaced, and reverted. This is a vocabulary gap in one direction.

/** "free of parabens", "free from animal testing" — frames that only ever deny. */
// ⚠️ ANCHORED TO THE TERM, and the first version was not. `clauseBefore` is bounded by
// CLAUSE_BOUNDARY, which does not cut on a bare comma or on ` and ` — so an unanchored
// frame reached a DIFFERENT substance later in the sentence and suppressed a genuine
// violation. An independent adversarial pass confirmed sixteen of these, and they are
// the commonest shape in personal-care copy there is:
//     "Free from parabens, this antiperspirant contains aluminum chlorohydrate."
//     "This shampoo is free of parabens and contains sulfates."
//     "Our newer tumblers are free of BPA while this legacy model contains BPA."
// The store states BOTH things, and production correctly reports the violation.
// "free of X" negates X, not whatever is mentioned eight words later.
const ABSENCE_FRAME = /(^|[^a-z])free\s+(of|from)\s*$/i;

/**
 * The violating term used as a LABEL whose value is a flat denial:
 * "Tested on animals: never." / "Animal testing — none."
 *
 * The separator is REQUIRED, which is what keeps this narrow. `no` and `zero` are
 * deliberately excluded even here: "Contains gluten: no wheat flour" is a sentence
 * whose `no` governs the noun after it rather than the label before it, and the
 * separator alone cannot tell those apart.
 */
// ⚠️ THE DENIAL MUST BE THE WHOLE VALUE. An unanchored version suppressed real
// violations whose denial is immediately qualified away:
//     "Tested on animals: never by us, always by our EU distributor."
//     "Contains gluten — none of our facilities are certified."
//     "Made with aluminum: none other than USP grade."
// Each of those ADMITS the thing. A label denial is only a denial when nothing
// follows it, which is what the terminator requires.
const LABEL_DENIAL = /^\s*[:–—-]\s*(never|none|nope)\s*[.!?;]?\s*$/i;

/** True when EVERY occurrence of `term` in `sentence` sits in a negated clause.
 *
 *  `absenceFrames` opts into the two violation-only forms above. Callers on the
 *  support side must not set it — see the block above for the measured reason. */
export function isNegated(sentence: string, term: string, opts: { absenceFrames?: boolean } = {}): boolean {
  const n = normalize(sentence);
  const t = normalize(term);
  let i = n.indexOf(t);
  if (i === -1) return true; // absent ⇒ certainly not supporting
  while (i !== -1) {
    const before = clauseBefore(n, i);
    const after = n.slice(i + t.length);
    const negated = NEGATOR.test(before)
      || deniedAfter(n, i, t.length)
      || (opts.absenceFrames === true && (ABSENCE_FRAME.test(before) || LABEL_DENIAL.test(after)));
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
  opts: {
    allowLogisticsSubject?: boolean; allowContainerSubject?: boolean; requireDigit?: boolean; wholeWord?: boolean;
    /** A term occurring is not the thing being stated. Same contract as the
     *  attribute rows' `valueGuard`: it reads the ORIGINAL sentence, case intact,
     *  and a rejected sentence skips to the next one rather than failing the row. */
    valueGuard?: (sentence: string) => boolean;
  } = {},
): SupportedEvidence | null {
  for (const ev of evidence) {
    if (isInterrogative(ev.text)) continue;
    if (opts.requireDigit && !/\d/.test(ev.text)) continue; // timing needs a number
    if (opts.valueGuard && !opts.valueGuard(ev.text)) continue;
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
      // `absenceFrames` is set HERE and nowhere else — the violation side is the one
      // place "free of X" and "X: never" are unambiguous denials (v3.1 CP2a).
      if (isNegated(ev.text, v.term, { absenceFrames: true })) continue; // "does not contain gluten"
      if (!passesAboutness(ev.text, v.term, opts).ok) continue;
      return { surface: ev.surface, sentence: ev.text, term: v.term, quote: presentableQuote(ev.text) };
    }
  }
  return null;
}

// ---- logistics / timing vocabulary ------------------------------------------

/** Timing terms that are open-ended and only state a deadline WITH a number
 *  ("ships within 2 business days"). A digit is required in the same sentence.
 *
 *  ⚠️ `shipping times` is listed EXPLICITLY (v3.1 CP2b). These terms are now matched
 *  whole-word, and the plural is by far the commoner merchant spelling — without its
 *  own entry, `shipping time` stops matching inside `shipping times` and the row
 *  loses a real class of finding. Every other term either has no inflection that
 *  occurs in real copy or already carries both forms (`business day` / `business
 *  days`). Checked term by term before the boundary change, not after. */
export const TIMING_TERMS_NEEDING_DIGIT = [
  "ships within", "ships in", "business days", "business day", "delivery in", "arrives in",
  "arrive within", "delivered within", "delivered in", "shipping time", "shipping times",
  "shipping timeframe", "shipping timeframes", "arrive in", "working days", "working day",
  "ships out in", "dispatch within",
] as const;

/** Timing terms that are self-contained deadlines — no digit needed. */
export const TIMING_TERMS_SELF_CONTAINED = [
  "ships same day", "ships next day", "same-day shipping", "next-day shipping", "overnight shipping",
  "same day delivery", "next day delivery", "ships today",
] as const;

/** NOTE: "free shipping" is deliberately NOT a timing term — it states price, not
 *  speed. Crediting it was the live false positive this module exists to prevent. */

// ---- v3.1 CP2c: a DIGIT is not a DURATION ------------------------------------
//
// `requireDigit` asked only that the sentence contain some digit, so a POSTCODE
// satisfied it:
//     "Shipping times vary depending on your proximity to our Los Angeles origin
//      zip code: 90038."
// was returned as a stated delivery window, on a sentence whose actual content is
// that delivery times VARY. Strip the digits and it correctly fails — which is the
// same weakness `dimensions` had ("Available in 3 colors with a relaxed length")
// and closed with a UNIT-BOUND number. `delivery` was the last digit-bearing
// requirement without one, and it is the highest-discrimination row in the engine,
// so recall matters more here than anywhere else.
//
// WRITTEN AGAINST THE 55 PASSING DELIVERY ROWS in the 172-store capture, not in the
// abstract — v2.9's first quantity guard cost four real positives for exactly that
// reason. Two shapes cover all 55, and both are needed:
//   • a NUMBER bound to a time unit, tolerating the modifiers merchants actually
//     write between them ("5 business days", "6-7 working days", "1–10 business
//     days", "5-7 Business Days", "1 to 4 business days");
//   • a WORDED window with no digit at all ("will ship the next business day"),
//     which is 2 of the 55 and passes today only by accident — the digit that
//     satisfied `requireDigit` in both was a CLOCK TIME ("after 2:00pm PST",
//     "after 9 AM"). A digit-only guard would delete them.
// ⚠️ THE GAP BETWEEN THE NUMBER AND THE UNIT IS NOT ALWAYS A SPACE, and the first
// version assumed it was. An independent pass confirmed seven real windows the guard
// deleted, every one over punctuation the merchant chose:
//     "3-Business Days"   "10+ business days"   "(3-5) business days"
//     "1-2 wks."          "3 workdays"          "7 to 10 days"   "3-5 *business days*"
// `[^a-zA-Z]{0,6}` spans a hyphen, a plus, a closing bracket, an asterisk, an en dash
// and a second number in a range — while still refusing a bare postcode, because what
// stops "…zip code: 90038." is the absence of a TIME UNIT, not the spacing.
const DURATION_NUMBER =
  /\d[^a-zA-Z]{0,6}(?:\w+[\s\-*]+){0,2}(?:business\s+|working\s+|calendar\s+)?(?:minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|workdays?|working\s+days?)\b/i;
const DURATION_WORDED =
  /\b(?:same|next|following)\s+(?:business\s+|working\s+)?day\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(?:\w+\s+){0,2}(?:business\s+|working\s+)?(?:days?|weeks?|hours?)\b/i;

/** True when the sentence states a duration, not merely a number. */
export function statesDeliveryWindow(sentence: string): boolean {
  return DURATION_NUMBER.test(sentence) || DURATION_WORDED.test(sentence);
}

export function findTimingSupport(evidence: EvidenceSentence[]): SupportedEvidence | null {
  return (
    // ⚠️ `wholeWord` (v3.1 CP2b). Without it `ships in` matched inside "Ships
    // internationally to 40 countries." and reported a delivery window nobody
    // stated — with the country count satisfying `requireDigit`. Every sibling
    // matcher bounds its terms; this one never did.
    findSupport(evidence, TIMING_TERMS_SELF_CONTAINED, { allowLogisticsSubject: true, wholeWord: true }) ??
    findSupport(evidence, TIMING_TERMS_NEEDING_DIGIT, {
      allowLogisticsSubject: true, requireDigit: true, wholeWord: true,
      valueGuard: statesDeliveryWindow,
    })
  );
}
