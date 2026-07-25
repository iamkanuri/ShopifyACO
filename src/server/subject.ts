// ===========================================================================
// ABOUTNESS BY SUBJECT (v2.5 CP2) — what is this sentence ABOUT?
//
// WHY THIS EXISTS. v2.4's adversarial pass confirmed 93 false passes, and the
// largest single class was aboutness: the store states a fact about its PACKAGING,
// its SHIPMENT, a BUNDLED item, a COMPETITOR or a REVIEW, and the row credits it to
// the product. The two guards that were supposed to prevent this could not:
//
//   • `SUBJECT_BEFORE_VETO` enumerates 10 packaging nouns. 13 more escape it, as do
//     the plurals of 7 that are listed, and it only looks 48 characters back.
//   • `MODIFIED_SUBJECT` inspects the 24 characters immediately AFTER the term, so
//     one two-word adjective defeats it ("100% recycled kraft paper packaging").
//
// And neither can ever reach the third shape: "Every order is wrapped in 100%
// cotton muslin." contains no vetoed noun at all. The signal is the SUBJECT ("Every
// order") and the VERB ("is wrapped in"), and a character window has nowhere to
// read either.
//
// WHY DETERMINISTIC RATHER THAN THE SEMANTIC TIER. The honesty rule says not to use
// a model for what a lookup can decide, and v2.4 argued the lookup had been
// *demonstrated* unable to decide aboutness. That demonstration was of a character
// window and a noun list — not of reading the subject, which had never been tried.
// Two things settle it:
//   1. The adversarial corpus is the acceptance gate and runs OFFLINE with no API
//      key. `judgeClaims` returns empty without one, so a semantic aboutness gate
//      could not close a single corpus case, and the mutation proof could not reach
//      it either. A fix that cannot be measured by the gate is not a fix.
//   2. It would put a network call on the critical path of every test.
// The semantic tier remains the right tool for PARAPHRASE — recovering true
// statements no term list can match — which is what it was actually built for.
//
// This module is pure, closed-list, and auditable: you can read it and know exactly
// what will and will not be vetoed.
// ===========================================================================

export type SubjectVeto = "packaging" | "shipment" | "bundled-item" | "comparative" | "review";

/** Clause boundaries — a subject governs its own clause, not the whole sentence. */
// The sentence terminator MUST be followed by whitespace or end-of-string. A bare
// `[.!?]` matched the decimal point in "Parcel weight is 2.4 lbs.": the clause for
// `lbs` began at "4 lbs.", the subject "Parcel weight" was cut off, and a despatch
// weight passed as the product's. The veto fired for the term `weight` but not for
// `lbs`, and `findSupport` accepts the first term that clears aboutness — so one
// mis-split silently undid the whole guard.
const CLAUSE_SPLIT = /[.!?](?=\s|$)|[;:]|,\s+(and|but|or|yet|so)\s|\s+(but|however|whereas|although|though)\s/i;

/**
 * Nouns that, as the SUBJECT of a statement, mean the statement is not about the
 * product. Matched word-bounded against the subject span only, so — unlike the
 * character-window guards — an adjective or a relative clause cannot launder them.
 *
 * Container words that can BE the product (bottle, bag, jar, tin, can, tube,
 * tumbler, canister, pouch) are deliberately ABSENT: "16oz bottle" is how a
 * beverage store states its size, and `CONTAINER_IS_PRODUCT` exists to allow it.
 * Only things that are unambiguously wrapping or logistics belong here.
 */
const NON_PRODUCT_SUBJECT = /\b(packaging|package|packages|packet|packets|carton|cartons|wrapper|wrappers|wrapping|mailer|mailers|pallet|pallets|shipper|shippers|box|boxes|casing|crate|crates|label|labels|sticker|stickers|hang ?tag|hang ?tags|tag|tags|sleeve|sleeves|envelope|envelopes|tissue ?paper|poly ?bag|poly ?bags|insert|inserts|insert ?card|packing ?slip|order|orders|parcel|parcels|shipment|shipments|delivery|deliveries|shipping ?materials|gift ?wrap|gift ?box|gift ?boxes)\b/i;

/** Subjects that are a DIFFERENT item that came in the same purchase. */
// ⚠️ `free` cannot be a bare alternative here, and `extra` cannot appear at all.
// `\bfree\s+\w+` matches inside "Fragrance-free and paraben-free." — the `\b` sits
// after the hyphen — so an ordinary claim sentence was vetoed as a bundled item and
// a genuinely clean store stopped reading as clean. `extra` has the same problem via
// "extra virgin olive oil". `free` is therefore only a bundle marker behind a
// determiner ("a free sample", "your free cloth"), and the adjective branch refuses
// to start mid-compound.
const BUNDLED_SUBJECT = /(?<![\w-])(included|complimentary|bonus|accompanying|matching|spare)\s+\w+|\b(a|an|your|one|the)\s+free\s+\w+|\b(comes? with|ships? with|includes?|bundled with|paired with|also receive|throw in)\b/i;

/** The sentence is comparing to somebody else's product. */
const COMPARATIVE = /\b(unlike|compared (to|with)|versus|vs\.?|other brands?|competitors?|competing|mass-?market|most (other )?\w+ (are|use|come))\b/i;

/** The words are a customer's, not the store's. */
const REVIEW_VOICE = /\b(reviewer|testimonial|verified buyer)\b|\b(a |one |our )?(customer|buyer|shopper)s?\b[^.]{0,30}\b(wrote|said|says|noted|reported|called)\b/i;

/**
 * Verb frames whose OBJECT is the container, not the product: "ships in X",
 * "arrives in a X", "wrapped in X", "presented in a X". These are what reach the
 * shape no noun list can — the subject may be absent ("Comes in recycled kraft
 * paper packaging.") or may be the order itself.
 */
const CONTAINER_VERB = /\b(ships?|shipped|arrives?|arriving|comes?|coming|delivered|delivers?|wrapped|wraps?|packed|packs?|packaged|presented|presents?|sent|boxed|nestled|tucked)\s+(in|inside|within)\b/i;

/** Wrapping nouns as the OBJECT of a container verb. Same list as the subject rule
 *  minus the logistics abstractions, which are never a physical container. */
const CONTAINER_OBJECT = /\b(packaging|package|carton|wrapper|wrapping|mailer|box|boxes|envelope|sleeve|tissue ?paper|poly ?bag|gift ?wrap|gift ?box|kraft ?paper|muslin|cellophane|shrink ?wrap|bubble ?wrap|crate|casing)\b/i;

/** Finite verbs that separate a subject from its predicate, longest first. */
const VERB = /\b(is|are|was|were|has|have|had|comes?|arrives?|ships?|holds?|measures?|weighs?|features?|includes?|contains?|comprises?|consists?)\b/i;

/** The clause containing `index`. */
function clauseAt(sentence: string, index: number): { text: string; offset: number } {
  let start = 0;
  const re = new RegExp(CLAUSE_SPLIT.source, "gi");
  let m: RegExpExecArray | null;
  let end = sentence.length;
  while ((m = re.exec(sentence)) !== null) {
    if (m.index + m[0].length <= index) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  return { text: sentence.slice(start, end), offset: start };
}

/**
 * Decide whether the statement containing `termIndex` is about something other
 * than the product. Returns the veto class, or null when the sentence is about the
 * product OR when there is not enough signal to say.
 *
 * FAILS OPEN ON PURPOSE. Vetoing on "unknown" would suppress the ordinary
 * subject-less product copy that makes up most of a Shopify description
 * ("Machine wash cold.", "Made in Vermont.") and would gut depth — the failure
 * mode CP2's own brief warns about. Only a CONFIDENT non-product reading vetoes.
 */
export function nonProductSubject(
  sentence: string,
  termIndex: number,
  opts: { allowLogisticsSubject?: boolean } = {},
): SubjectVeto | null {
  const { text: clause, offset } = clauseAt(sentence, termIndex);
  const rel = Math.max(0, termIndex - offset);
  const before = clause.slice(0, rel);

  // Voice and comparison are properties of the whole clause: they can appear on
  // either side of the term ("...aluminum, unlike ours" / "Unlike sets made from...").
  if (REVIEW_VOICE.test(clause)) return "review";
  if (COMPARATIVE.test(clause)) return "comparative";

  // The SUBJECT is whatever precedes the first finite verb in the clause. This is
  // the whole point of the module: it is a span with a head noun, not a fixed
  // number of characters, so "Our packaging in the new 2026 range for every single
  // order we ship out" is still identifiably about packaging.
  const verbAt = clause.search(VERB);
  const subject = verbAt > 0 ? clause.slice(0, verbAt) : "";
  // The DELIVERY requirement is the one whose subject legitimately IS the shipment:
  // "Orders ship within 2 business days." is exactly the sentence it exists to find,
  // and its subject head is `orders`. Applying the subject rule there would veto the
  // canonical true statement, so logistics skips it — while every other rule below
  // (review, comparative, bundled, and the container-object rule) still applies, and
  // the container-object rule is what catches "Ships in eco-friendly packaging".
  if (subject && !opts.allowLogisticsSubject) {
    if (NON_PRODUCT_SUBJECT.test(subject)) {
      return /\b(order|orders|parcel|parcels|shipment|shipments|delivery|deliveries)\b/i.test(subject)
        ? "shipment"
        : "packaging";
    }
    // NOTE: a BUNDLED_SUBJECT check used to sit here too. The mutation proof showed
    // removing it broke nothing, and the reason is structural rather than a gap in
    // coverage: the subject span is always a prefix of the text before the term, so
    // the `before` check further down subsumes it. Removed rather than kept as
    // decoration.
  }

  // A container VERB before the term, whose object is wrapping. Reaches the shape
  // with no vetoed subject at all: "Comes in 100% recycled kraft paper packaging.",
  // "Every order is wrapped in 100% cotton muslin.", "Ships in a padded envelope
  // made from recycled paper."
  const verbMatch = CONTAINER_VERB.exec(clause);
  if (verbMatch) {
    const after = clause.slice(verbMatch.index + verbMatch[0].length);
    // Only the span up to the term: a container verb AFTER the fact being stated
    // does not make the fact about the container.
    const objectSpan = verbMatch.index < rel ? after.slice(0, Math.max(0, rel - verbMatch.index - verbMatch[0].length) + 40) : after;
    if (CONTAINER_OBJECT.test(objectSpan)) return "packaging";
  }

  // A bundled marker anywhere before the term: "Comes with a display stand made of
  // solid oak." — the composition belongs to the stand.
  if (BUNDLED_SUBJECT.test(before)) return "bundled-item";

  return null;
}
