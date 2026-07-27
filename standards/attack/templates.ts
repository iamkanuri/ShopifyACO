// ===========================================================================
// THE ATTACK TEMPLATES — the sentences, per class.
//
// Every template is CATEGORY-AGNOSTIC. Category flavour arrives through
// `CategoryContext`; nothing coffee-specific may appear below, and a test
// enforces that by scanning this file for the coffee vocabulary.
//
// Nothing here evaluates anything. See `types.ts` header.
//
// ⚠️ EVERY PHRASE BUILDER BELOW WAS CORRECTED BY RUNNING IT. Written from the
// table, the generator produced `"Ask us about carbon dioxide decaffeination
// decaf"`, `"We hope to move this lot to the decaffeinated with methylene
// chloride"` and `"Our decaf is free of decaffeinated with methylene chloride"`.
// All three are ungrammatical, and an ungrammatical attack sentence is not a
// cosmetic defect: `VOCABULARY_REVIEW.md` §2 requires VERBATIM STORE COPY
// because the one job left to the human adjudicator is judging whether a
// sentence would mislead a real shopper, and nobody can judge that about copy no
// merchant would write.
// ===========================================================================

import type { QuotableSurface } from "../../src/server/testEvidence.js";
import type { AttackClass, CategoryContext, TermRole, TermShape } from "./types.js";

// ---- term shape -------------------------------------------------------------

/**
 * Irregular English past participles common in product copy. A closed list, and
 * this project's history says closed lists are where defects live — so the
 * PRIMARY rule below is morphological and this is only the tail it cannot reach.
 * A miss here costs an awkward sentence, never a wrong verdict.
 */
const IRREGULAR_PARTICIPLE =
  /^(made|grown|built|woven|spun|sewn|blown|drawn|ground|wound|cut|set|split|knit|hand-\w+|cold-\w+|air-\w+|kiln-\w+)\b/i;

/** Terms whose HEAD NOUN names a process rather than a product or a property. */
const PROCESS_HEAD = /\b(process|processes|method|methods|decaffeination|extraction|treatment|technique|cure|finish)$/i;

/** A framed term: a participle, a preposition, then the thing itself. */
const FRAME_PREP = /^(\S+)\s+(with|using|from|on|by|via|in|of)\s+(.+)$/i;

/**
 * Four shapes, because three produced ungrammatical copy the first time this ran.
 *
 *   predicate        `decaffeinated with methylene chloride` → "is …"
 *   nominal_product  `swiss water decaf`                     → "is a …"
 *   process_name     `swiss water process`                   → "uses the …"
 *   attributive      `swiss water processed`                 → "is … {productNoun}"
 *
 * The participle rule: a first token of five or more characters ending in `ed`.
 * Five, not four, because `red`, `used` and `iced` are adjectives far more often
 * than participles in product copy, and a four-character floor mis-shapes more
 * terms than it rescues.
 */
export function termShape(term: string, ctx: CategoryContext): TermShape {
  const parts = term.trim().split(/\s+/);
  const first = parts[0] ?? "";
  if (/^[a-z-]{5,}ed$/i.test(first) || IRREGULAR_PARTICIPLE.test(first)) return "predicate";
  const last = parts.slice(-1)[0] ?? "";
  const productNouns = new Set([ctx.productNoun, ctx.productPlural, ctx.unitNoun].map((s) => s.toLowerCase()));
  if (productNouns.has(last.toLowerCase())) return "nominal_product";
  if (PROCESS_HEAD.test(term.trim())) return "process_name";
  return "attributive";
}

/**
 * Capitalise a term a store would write as a NAME.
 *
 * Purely cosmetic — `normalize` lowercases everything before matching, so this
 * changes no result. It exists because a set of sentences no merchant would
 * write is a set a human cannot judge for misleadingness. Idempotent, so an
 * ALL-CAPS orthography variant passes through unchanged.
 */
export const markCase = (t: string): string =>
  t.replace(/(^|[\s\-–—])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());

/** Sentence-initial capital only. */
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The term as a store would type it in a spec row: a NAME is capitalised, a
 *  predicate is not — "Swiss Water Process" but "decaffeinated with methylene
 *  chloride", never "Decaffeinated With Methylene Chloride". */
const asWritten = (t: string, shape: TermShape): string => (shape === "predicate" ? t : markCase(t));

/** An `-ion` nominalisation takes no article: "uses carbon dioxide
 *  decaffeination", not "uses THE carbon dioxide decaffeination". */
const nominalisation = (t: string): boolean => /ion$/i.test(t.trim());

/** The same verb phrase with a plural subject, and in the past. Both cover every
 *  shape `predicateOf` emits; a shape added without extending these produces
 *  "All of our decafs uses the …", which is why they are here rather than
 *  inline in six templates. */
const plural = (vp: string): string => vp.replace(/^is /, "are ").replace(/^uses /, "use ");
const past = (vp: string): string => vp.replace(/^is /, "was ").replace(/^uses /, "used ");

// ---- the four phrase builders -----------------------------------------------

/** The term as a verb phrase predicated of a subject: "{subject} {vp}". */
export function predicateOf(term: string, shape: TermShape): string {
  switch (shape) {
    case "predicate": return `is ${term}`;
    case "nominal_product": return `is a ${markCase(term)}`;
    case "process_name": return `uses ${nominalisation(term) ? "" : "the "}${markCase(term)}`;
    case "attributive": return `is ${markCase(term)}`;
  }
}

/**
 * The term as a noun phrase naming a product that has this property.
 *
 * `process_name` takes the ATTRIBUTIVE form — "Swiss Water Process decaf" —
 * because that is what the trade actually writes and it reproduces the known
 * corpus's product-title attack exactly. The one exception is an `-ion`
 * nominalisation (`carbon dioxide decaffeination`), where the attributive form
 * is unusable and the periphrasis is the only grammatical option.
 */
export function nounPhraseOf(term: string, shape: TermShape, ctx: CategoryContext): string {
  switch (shape) {
    case "predicate": return `${ctx.productNoun} ${term}`;
    case "nominal_product": return markCase(term);
    case "process_name":
      return nominalisation(term)
        ? `${ctx.productNoun} made with ${markCase(term)}`
        : `${markCase(term)} ${ctx.productNoun}`;
    case "attributive": return `${markCase(term)} ${ctx.productNoun}`;
  }
}

/**
 * The term as something a seller could ADOPT — "we hope to move to …", "we are
 * evaluating …", "we avoid …".
 *
 * A framed predicate term cannot take a determiner ("*the decaffeinated with
 * methylene chloride"), so it is re-nominalised through the product noun. This
 * is the builder the tense, modality and denial classes need, and writing those
 * classes against `predicateOf` is what produced the ungrammatical first run.
 */
export function adoptableOf(term: string, shape: TermShape, ctx: CategoryContext): string {
  switch (shape) {
    case "predicate": return `a ${ctx.productNoun} ${term}`;
    case "nominal_product": return `a ${markCase(term)}`;
    case "process_name": return nominalisation(term) ? markCase(term) : `the ${markCase(term)}`;
    case "attributive": return `a ${markCase(term)} ${ctx.productNoun}`;
  }
}

/**
 * The BARE THING a framed term is about — the single most valuable derivation
 * in this module.
 *
 * `VOCABULARY.md` §3.2 forces violating terms to be FRAMED
 * (`decaffeinated with methylene chloride`, never the bare substance) because an
 * unframed term reports a compliant store as stating the opposite. But the
 * violation attack needs the sentence a COMPLIANT store writes, and a compliant
 * store writes the bare substance: "Our decaf is free of methylene chloride."
 *
 * The human attacker had to think of stripping the frame. This does it by rule —
 * drop a leading participle-plus-preposition, or a trailing process head noun.
 * That is the difference between a generator that replays a corpus and one that
 * reaches shapes an author would have to invent.
 */
export function substanceOf(term: string, shape: TermShape): string {
  const t = term.trim();
  if (shape === "predicate") {
    const m = FRAME_PREP.exec(t);
    if (m) return m[3]!;
  }
  if (shape === "process_name") {
    const w = t.split(/\s+/);
    if (w.length > 1) return w.slice(0, -1).join(" ");
  }
  return t;
}

// ---- orthography transforms -------------------------------------------------

/**
 * The transforms, each measured against `normalize` at commit `e9ec942` rather
 * than guessed. `normalize` lowercases, folds Unicode dashes `[‐-―]` to `-` and
 * curly apostrophes to `'`, collapses whitespace — and does NOTHING else. In
 * particular it does not strip `®`, `™` or `℠`, and it does not fold subscript
 * digits.
 *
 * Word bounding in `termMatches` blocks only on ASCII LETTERS, so a symbol or a
 * digit adjacent to a term is not a boundary failure. That makes the POSITION of
 * a symbol decisive: a trailing `®` is harmless and an INTERNAL one defeats a
 * multi-word term outright. Both are generated, because a review that writes
 * only the harmless one learns nothing.
 */
export interface OrthographyTransform {
  subclass: string;
  intent: string;
  apply: (term: string) => string | null;
}

const words = (t: string): string[] => t.trim().split(/\s+/);

export const ORTHOGRAPHY: OrthographyTransform[] = [
  {
    subclass: "registered_symbol_internal",
    intent: "the registered mark written INSIDE a multi-word term, which is how a licensor writes it and how a careful licensee copies it",
    apply: (t) => (words(t).length > 1 ? words(t).map((w, i) => (i === 0 ? `${w}®` : w)).join(" ") : null),
  },
  {
    subclass: "tm_symbol_internal",
    intent: "the same with ™ — sellers use ™ and ® interchangeably and incorrectly, and both must be reachable",
    apply: (t) => (words(t).length > 1 ? words(t).map((w, i) => (i === 0 ? `${w}™` : w)).join(" ") : null),
  },
  {
    subclass: "registered_symbol_terminal",
    intent: "CONTROL — the mark at the END. Bounding blocks only on ASCII letters, so this one should survive where the internal form does not",
    apply: (t) => `${t}®`,
  },
  {
    subclass: "hyphenated",
    intent: "the compound-adjective spelling a careful copy editor produces",
    apply: (t) => (words(t).length > 1 ? words(t).join("-") : null),
  },
  {
    subclass: "hyphenated_first_join",
    intent: "partial hyphenation, where only the proper-noun half is joined — the commonest real form",
    apply: (t) => (words(t).length > 2 ? [words(t).slice(0, 2).join("-"), ...words(t).slice(2)].join(" ") : null),
  },
  {
    subclass: "en_dash",
    intent: "CONTROL — a typographic dash. `normalize` folds these, so this must behave exactly as the hyphen form does",
    apply: (t) => (words(t).length > 1 ? words(t).join("–") : null),
  },
  {
    subclass: "possessive",
    intent: "a possessive puts an ASCII letter against the term's right edge and defeats whole-word bounding",
    apply: (t) => `${t}'s`,
  },
  {
    subclass: "possessive_curly",
    intent: "CONTROL — the same with a typographic apostrophe, which `normalize` folds; it must behave identically to the straight form",
    apply: (t) => `${t}’s`,
  },
  {
    subclass: "plural",
    intent: "the plural. Whole-word matching means the singular term cannot reach it — the trailing `s` is an ASCII letter and blocks the boundary. Nobody swept plurals until the decaf review's refuting pass",
    apply: (t) => `${t}s`,
  },
  {
    subclass: "all_caps",
    intent: "CONTROL — a heading or a spec value in capitals. `normalize` lowercases, so this must survive",
    apply: (t) => t.toUpperCase(),
  },
  {
    subclass: "period_split",
    intent: "a period inside the term, as an abbreviation produces. `splitSentences` breaks after any period followed by whitespace, so the term becomes two fragments and is unreachable",
    apply: (t) => (words(t).length > 1 ? `${words(t).slice(0, -1).join(" ")}. ${words(t).slice(-1)[0]}` : null),
  },
];

// ---- the template table -----------------------------------------------------

export interface Template {
  attackClass: AttackClass;
  subclass: string;
  roles: TermRole[];
  shapes: TermShape[];
  surface: QuotableSurface;
  intent: string;
  /** A CONTROL: honest copy that must keep passing. */
  control?: boolean;
  build: (term: string, shape: TermShape, ctx: CategoryContext) => string;
}

const SUPPORT: TermRole[] = ["supporting"];
const VIOLATE: TermRole[] = ["violating"];
const BOTH: TermRole[] = ["supporting", "violating"];
const ALL: TermShape[] = ["predicate", "process_name", "nominal_product", "attributive"];

export const TEMPLATES: Template[] = [
  // -- 1. satisfy the letter, mislead the buyer -------------------------------
  {
    attackClass: "letter_not_spirit", subclass: "style_or_inspired", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "association without the claim: the term names something this product RESEMBLES rather than something it is",
    build: (t, s, c) => `Inspired by ${adoptableOf(t, s, c)}, at a fraction of the price.`,
  },
  {
    attackClass: "letter_not_spirit", subclass: "quantifier_hedge", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a quantifier that leaves THIS unit unstated while the sentence reads as a claim about the range",
    build: (t, s, c) => `Some of our ${c.productPlural} ${plural(predicateOf(t, s))}.`,
  },
  {
    attackClass: "letter_not_spirit", subclass: "capability_offer", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "an offer to discuss the property is not a statement that the product has it",
    build: (t, s, c) => `Ask us about ${adoptableOf(t, s, c)} before you order.`,
  },
  {
    attackClass: "letter_not_spirit", subclass: "placeholder", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "the value present but marked unconfirmed. A merchant filling a required field provisionally is the normal case, not the exception",
    build: (t, s, c) => `${c.specLabels[0] ?? "Specification"}: ${asWritten(t, s)} (to be confirmed).`,
  },
  {
    attackClass: "letter_not_spirit", subclass: "knowledge_claim", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "expertise ABOUT the property standing in for the property",
    build: (t, s, c) => `We know ${adoptableOf(t, s, c)} inside out, and we choose our ${c.productPlural} accordingly.`,
  },

  // -- 3. the wrong subject ---------------------------------------------------
  {
    attackClass: "wrong_subject", subclass: "packaging_is_subject", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "the packaging is the grammatical subject. Nonsense on its face, which is what makes it a fair test of whether the guard reads the subject or the keyword",
    build: (t, s, c) => `Our ${c.packagingNoun} ${predicateOf(t, s)}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "packaging_natural_order", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "the packaging class in the word order a merchant ACTUALLY writes, rather than the contrived form an adjacency guard happens to catch",
    build: (t, s, c) => `Our ${nounPhraseOf(t, s, c)} ${c.packagingNoun} is lined with recycled foil.`,
  },
  {
    attackClass: "wrong_subject", subclass: "shipment", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a sentence about getting the thing to the buyer is not a statement about the thing",
    build: (t, s, c) => `Your shipment of ${nounPhraseOf(t, s, c)} leaves the ${c.facilityNoun} within 24 hours.`,
  },
  {
    attackClass: "wrong_subject", subclass: "bundled_item", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "the property is named for ONE item inside a multi-item listing and the row credits it to the listing",
    build: (t, s, c) => `The ${c.bundleNoun} that goes with this one contains a ${nounPhraseOf(t, s, c)}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "competitor", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "competitor attribution credits another company's property to this product",
    build: (t, s, c) => `${c.competitor}'s ${c.productNoun} ${predicateOf(t, s)}; we do things differently.`,
  },
  {
    attackClass: "wrong_subject", subclass: "industry_generic", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a seller disparaging the industry, recorded as disclosing its own practice — the most reputationally damaging false pass available",
    build: (t, s, c) => `Most cheap ${c.productPlural} ${plural(predicateOf(t, s))}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "review_quote", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "an attributed pull-quote carrying none of the review vocabulary a keyword veto is keyed on",
    build: (t, s, c) => `"The best ${nounPhraseOf(t, s, c)} I have ever tried." — Sarah M.`,
  },
  {
    attackClass: "wrong_subject", subclass: "review_keyworded", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "CONTROL-ADJACENT — the same in the form a review veto DOES reach, which distinguishes a working veto from a decorative one",
    build: (t, s, c) => `One verified buyer said the ${nounPhraseOf(t, s, c)} is the best they have had.`,
  },
  {
    attackClass: "wrong_subject", subclass: "sibling_product", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "one line of ordinary copy about ANOTHER product, on a page for this one. Unclosable by any term list, and the class the decaf review under-weighted",
    build: (t, s, c) => `Our ${c.siblingDescriptor} ${c.productNoun} ${predicateOf(t, s)}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "sibling_with_exclusion", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a sibling named and THIS product explicitly excluded. The semicolon is a clause boundary, so the exclusion is never read",
    build: (t, s, c) => `Our house ${c.productNoun} ${predicateOf(t, s)}; this one is not.`,
  },
  {
    attackClass: "wrong_subject", subclass: "site_wide", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a statement about the range does not establish a fact about this unit, and sellers stock more than one",
    build: (t, s, c) => `All of our ${c.productPlural} ${plural(predicateOf(t, s))}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "subscription_bare", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "purchase-widget copy that avoids every cadence phrase a subscription veto is keyed on",
    build: (t, s, c) => `Choose a monthly subscription of our ${nounPhraseOf(t, s, c)}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "cross_sell", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a cross-sell verb outside the related-product veto's closed phrase list",
    build: (t, s, c) => `We also stock a ${nounPhraseOf(t, s, c)}.`,
  },
  {
    attackClass: "wrong_subject", subclass: "comparative", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a comparison to a CLASS is not a claim of membership in it",
    build: (t, s, c) => `Better value than a typical ${nounPhraseOf(t, s, c)}.`,
  },

  // -- 4. the merchant-controlled string --------------------------------------
  // NINE surfaces reach the claim branch, not six: it filters `p.evidence` on the
  // linter alone and restricts no surface (`productTest.ts` claim branch). Three
  // of the nine were unprobed by anyone until the decaf review's refuting pass.
  {
    attackClass: "merchant_controlled_string", subclass: "product_title", roles: BOTH, shapes: ALL,
    surface: "product_title",
    intent: "a title is a name the merchant chose, not a statement of fact, and naming is not evidence",
    build: (t, s, c) => `${cap(nounPhraseOf(t, s, c))} — 500g`,
  },
  {
    attackClass: "merchant_controlled_string", subclass: "variant_option", roles: BOTH, shapes: ALL,
    surface: "product_options",
    intent: "a variant option value is merchant-controlled and reaches linted output",
    build: (t, s, c) => cap(nounPhraseOf(t, s, c)),
  },
  {
    attackClass: "merchant_controlled_string", subclass: "meta_description", roles: BOTH, shapes: ALL,
    surface: "meta_description",
    intent: "the page description is written for search engines, not as a product statement",
    build: (t, s, c) => `Buy our ${nounPhraseOf(t, s, c)} online, with free delivery over $40.`,
  },
  {
    attackClass: "merchant_controlled_string", subclass: "shipping_policy", roles: BOTH, shapes: ALL,
    surface: "shipping_policy",
    intent: "a store-wide policy page, folded in as evidence for delivery and reachable by a CLAIM because the claim branch restricts no surface",
    build: (t, s, c) => `Every ${nounPhraseOf(t, s, c)} order ships free over $40.`,
  },
  {
    attackClass: "merchant_controlled_string", subclass: "product_metafield", roles: BOTH, shapes: ALL,
    surface: "product_metafield",
    intent: "an authenticated-only surface, merchant-controlled, and unprobed by anyone before the decaf review's refuter",
    build: (t, s, c) => `${c.specLabels[0] ?? "Specification"}: ${asWritten(t, s)}`,
  },
  {
    attackClass: "merchant_controlled_string", subclass: "seo_description", roles: BOTH, shapes: ALL,
    surface: "seo_description",
    intent: "the other authenticated-only merchant-controlled surface, likewise unprobed",
    build: (t, s, c) => `${cap(nounPhraseOf(t, s, c))} from an independent seller.`,
  },

  // -- 6. the violation attack ------------------------------------------------
  // For every VIOLATING term, the sentence in which a COMPLIANT store trips it.
  // These use `substanceOf`, because a violating term is FRAMED by rule
  // (`VOCABULARY.md` §3.2) and a compliant store writes the bare substance.
  {
    attackClass: "violation", subclass: "free_of", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "`free of` is not in the engine's closed negator list, so this is the exact sentence a bare violating term misreads as a contradiction",
    build: (t, s, c) => `Our ${c.productNoun} is free of ${substanceOf(t, s)}.`,
  },
  {
    attackClass: "violation", subclass: "free_from", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "the same for `free from`, likewise absent from the negator list",
    build: (t, s, c) => `Free from ${substanceOf(t, s)}, in every ${c.unitNoun} we have ever sold.`,
  },
  {
    attackClass: "violation", subclass: "x_free_compound", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "the attributive free-compound, where no supporting term overlaps the violation to trigger the discard rule",
    build: (t, s, c) => `${cap(substanceOf(t, s))} free ${c.productNoun}, made to order.`,
  },
  {
    attackClass: "violation", subclass: "avoid_verb", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "`avoid`, `reject` and `banned` read as assertions, because the negator vocabulary is a closed word list",
    build: (t, s) => `We avoid ${substanceOf(t, s)} entirely.`,
  },
  {
    attackClass: "violation", subclass: "banned_at_supplier", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "a denial the post-term denial pattern does not cover",
    build: (t, s) => `${cap(substanceOf(t, s))} is banned at the facility we use.`,
  },
  {
    attackClass: "violation", subclass: "spec_row_never", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "a colon is a clause boundary, so a trailing denial cannot reach back to the term. This is the shape that still misreports a compliant store under a shipped built-in list",
    build: (t, s) => `${cap(substanceOf(t, s))}: never.`,
  },
  {
    attackClass: "violation", subclass: "without", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "CONTROL-ADJACENT — `without` IS in the negator list, so this should be refused. It distinguishes a working negation guard from an absent one",
    build: (t, s) => `Made without ${substanceOf(t, s)} or anything like it.`,
  },
  {
    attackClass: "violation", subclass: "never_used", roles: VIOLATE, shapes: ALL,
    surface: "product_description",
    intent: "CONTROL-ADJACENT — `never` IS in the negator list; the second guard check",
    build: (t, s) => `We have never used ${substanceOf(t, s)}.`,
  },

  // -- 7. tense and modality --------------------------------------------------
  {
    attackClass: "tense_modality", subclass: "past_tense", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "past tense says the property no longer holds, and the row reports it as current",
    build: (t, s, c) => `Until 2024 this ${c.unitNoun} ${past(predicateOf(t, s))}.`,
  },
  {
    attackClass: "tense_modality", subclass: "discontinued", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "CONTROL-ADJACENT — `no longer` IS in the negator list, so this should be refused where the bare past tense is not",
    build: (t, s, c) => `We no longer offer ${adoptableOf(t, s, c)}.`,
  },
  {
    attackClass: "tense_modality", subclass: "future_intent", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "an explicit future intention says the product is NOT currently like this. The aspiration class, wide open",
    build: (t, s, c) => `We hope to move this ${c.unitNoun} to ${adoptableOf(t, s, c)} next season.`,
  },
  {
    attackClass: "tense_modality", subclass: "switching", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a transition in progress says the CURRENT state is the other one",
    build: (t, s, c) => `We are switching to ${adoptableOf(t, s, c)} later this year.`,
  },
  {
    attackClass: "tense_modality", subclass: "conditional", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "the plain meaning is that this product is NOT like this; the sentence offers to find one that is",
    build: (t, s, c) => `If you prefer ${adoptableOf(t, s, c)}, our team can source one.`,
  },
  {
    attackClass: "tense_modality", subclass: "modal_possibility", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "a modal states a possibility, not a fact",
    build: (t, s, c) => `We may use ${adoptableOf(t, s, c)} for future ${c.productPlural}.`,
  },
  {
    attackClass: "tense_modality", subclass: "on_request", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "availability on request says the DEFAULT unit is not like this",
    build: (t, s, c) => `${cap(adoptableOf(t, s, c))} is available on request.`,
  },
  {
    attackClass: "tense_modality", subclass: "under_evaluation", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "evaluating a property is not having it, and the sentence says so plainly",
    build: (t, s, c) => `We are evaluating ${adoptableOf(t, s, c)} for a future release.`,
  },
  {
    attackClass: "tense_modality", subclass: "enquiry", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "the sentence records that a question was asked. It states nothing about this product",
    build: (t, s, c) => `We asked our supplier about ${adoptableOf(t, s, c)}.`,
  },

  // -- 8. denial (of a SUPPORTING term) ---------------------------------------
  // §2's class 6 covers the denial shape for VIOLATING terms only. This is the
  // supporting-term mirror, and it is one of only two classes the decaf review
  // measured as genuinely closed.
  {
    attackClass: "denial", subclass: "do_not_offer", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a denial is the opposite of a statement, and crediting it reports the store as saying what it explicitly said it did not",
    build: (t, s, c) => `We do not offer ${adoptableOf(t, s, c)} in this range.`,
  },
  {
    attackClass: "denial", subclass: "scoped_negative", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "an honest scoped negative naming what was NOT used. Checkable, and still not an answer to the question asked",
    build: (t, s, c) => `Made without ${adoptableOf(t, s, c)} or any equivalent.`,
  },
  {
    attackClass: "denial", subclass: "spec_row_denial", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a colon is a clause boundary, so a trailing denial cannot reach back to the term",
    build: (t, s) => `${cap(asWritten(t, s))}: never.`,
  },
  {
    attackClass: "denial", subclass: "avoid_verb", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "`avoid` is outside the closed negator list, so a denial reads as an assertion",
    build: (t, s, c) => `We avoid ${adoptableOf(t, s, c)} altogether.`,
  },
  // ⚠️ THE TWO TEMPLATES BELOW WERE ADDED BY THE CORPUS PROOF, not by design.
  // `free_of` and `banned_at_supplier` existed only under `violation`, i.e. only
  // for VIOLATING terms — and `decaf-method.json` has an empty violating list, so
  // `"Our decaf is free of methylene chloride."` and `"Methylene chloride is
  // banned at the plant we use."` were unreachable there. Both are in the known
  // corpus. A supporting term naming an unflattering method is denied in exactly
  // the same words as a violating one, and the taxonomy had a hole on the
  // supporting side. Found by measuring the generator against work done by hand,
  // which is the entire reason that measurement is a test and not a paragraph.
  {
    attackClass: "denial", subclass: "free_of", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a free-of denial naming what the seller avoided. `free of` is not in the engine's closed negator list, so the denial reads as a disclosure",
    build: (t, s, c) => `Our ${c.productNoun} is free of ${substanceOf(t, s)}.`,
  },
  {
    attackClass: "denial", subclass: "banned_at_supplier", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a denial routed through the supplier, which the post-term denial pattern does not cover",
    build: (t, s) => `${cap(substanceOf(t, s))} is banned at the facility we use.`,
  },
  {
    attackClass: "denial", subclass: "explicit_refusal", roles: SUPPORT, shapes: ALL,
    surface: "product_description",
    intent: "a seller who explicitly declines to state the property. The one genuinely contrary sentence a decaf attacker produced, and the reason an empty violating list understates what a page said",
    build: (t, s, c) => `We do not disclose whether this ${c.unitNoun} ${predicateOf(t, s)}.`,
  },
  {
    attackClass: "denial", subclass: "warning_imperative", roles: BOTH, shapes: ALL,
    surface: "product_description",
    intent: "an imperative warning ABOUT the property, credited as a statement OF it",
    build: (t, s, c) => `Avoid any ${nounPhraseOf(t, s, c)}.`,
  },

  // -- CONTROLS: honest copy that must keep passing ---------------------------
  // A set that only attacks measures one direction, and one direction is how
  // v2.6 shipped a net regression: 16/16 on its own hostile set, then measured
  // by an independent pass as 7 false passes gained and 46 false fails.
  {
    attackClass: "letter_not_spirit", subclass: "control_plain_present", roles: SUPPORT, shapes: ALL,
    surface: "product_description", control: true,
    intent: "CONTROL — the plain first-person present claim. If this stops passing, the fix has broken the ordinary case",
    build: (t, s) => `This product ${predicateOf(t, s)}.`,
  },
  {
    attackClass: "letter_not_spirit", subclass: "control_spec_block", roles: SUPPORT, shapes: ALL,
    surface: "product_description", control: true,
    intent: "CONTROL — the spec-block form, which is how a specification-heavy category states a value",
    build: (t, s, c) => `${c.specLabels[0] ?? "Specification"}: ${asWritten(t, s)}.`,
  },
  {
    attackClass: "letter_not_spirit", subclass: "control_first_person", roles: SUPPORT, shapes: ALL,
    surface: "product_description", control: true,
    intent: "CONTROL — the seller's own voice, the commonest honest phrasing in any category",
    build: (t, s, c) => `Every ${c.unitNoun} we sell ${predicateOf(t, s)}.`,
  },
  {
    attackClass: "violation", subclass: "control_plain_disclosure", roles: VIOLATE, shapes: ALL,
    surface: "product_description", control: true,
    intent: "CONTROL — the honest disclosure a violating term SHOULD catch. If this stops contradicting, the violating list has stopped working",
    build: (t, s, c) => `This ${c.unitNoun} ${predicateOf(t, s)}, as disclosed by our supplier.`,
  },
];

/** Templates for one class, filtered to a term's role and shape. */
export function templatesFor(cls: AttackClass, role: TermRole, shape: TermShape): Template[] {
  return TEMPLATES.filter((t) => t.attackClass === cls && t.roles.includes(role) && t.shapes.includes(shape));
}
