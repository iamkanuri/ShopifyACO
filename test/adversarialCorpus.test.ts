import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssertionStatus, Requirement } from "../src/server/productTest.js";
import {
  statusOf, verdictOf, requirementsFor, mkExtracted, verdictOfIds,
  attr, claimReq, deliveryReq, idsReq, type HostileClass, type MkOptions,
} from "./support/adversarial.js";

// ===========================================================================
// THE ADVERSARIAL CORPUS (v2.4 CP1).
//
// v2.3 audited 7 real stores, found zero false positives, and that was close to
// worthless as a general claim: an adversarial pass that EXECUTED the matcher
// against chosen sentences then found six more defects on copy those stores
// merely happened not to write. This session ran 959 such probes across every
// matcher and confirmed 131 defects by independent re-execution.
//
// Sampling real stores catches ARTEFACTS. Only executing the matcher against
// deliberately chosen input catches LOGIC. This file is the second thing, made
// permanent.
//
// ---------------------------------------------------------------------------
// HOW A CASE WORKS — read this before adding one.
//
//   correct : the honest answer, argued in `why` from evidence availability.
//   actual  : present ONLY when the engine currently disagrees with `correct`.
//             It records a KNOWN, MEASURED GAP.
//
// The test asserts `actual ?? correct`. That makes the suite green on today's
// behaviour while pinning every defect in code, and it fails in BOTH directions:
//   • fix a gap  -> the case fails, telling you to delete its `actual`;
//   • regress    -> the case fails.
// `openGaps` is asserted against an exact count, so gaps cannot quietly multiply.
//
// A case with `actual` is NOT an accepted behaviour. It is a debt with a
// receipt. Never add one without `why` stating what the honest answer would be.
// ===========================================================================

interface Case {
  sentence: string;
  requirement: Requirement;
  correct: AssertionStatus;
  actual?: AssertionStatus;
  why: string;
  cls: HostileClass | string;
  opts?: MkOptions;
}

const C = (
  sentence: string, requirement: Requirement, correct: AssertionStatus,
  cls: string, why: string, actual?: AssertionStatus, opts?: MkOptions,
): Case => ({ sentence, requirement, correct, cls, why, actual, opts });

// ---------------------------------------------------------------------------
// MATERIALS — "Materials are stated" claims the PRODUCT's composition is stated.
// ---------------------------------------------------------------------------
const MATERIALS: Case[] = [
  // --- the v2.3 regression set (all fixed, all must stay fixed) ---
  C("Made with love in small batches.", attr("materials"), "not_proven", "marketing-idiom",
    "A composition FRAME with no material. The commonest artisan-DTC sentence there is."),
  C("Every bar is made with care by hand.", attr("materials"), "not_proven", "marketing-idiom",
    "Same class; `made with` + no MATERIAL_NOUN."),
  C("Our packaging is made from 100% recycled cardboard.", attr("materials"), "not_proven", "packaging-subject",
    "States what the PACKAGING is made of. SUBJECT_BEFORE_VETO catches this exact noun."),
  C("The box it ships in is made of recycled kraft paper.", attr("materials"), "not_proven", "shipment-subject",
    "Subject is the shipping box."),
  C("The handle is crafted from solid walnut.", attr("materials"), "pass_evidenced", "canonical-true",
    "A real composition statement about a product part. Must never regress."),

  // --- CONFIRMED GAPS: the packaging-subject class (13 nouns escape a closed list) ---
  C("Our label is made from recycled paper.", attr("materials"), "not_proven", "packaging-subject",
    "SUBJECT_BEFORE_VETO is a closed 10-noun list. `label` is not on it, and 13 packaging nouns " +
    "(gift box, box, label, hang tag, tag, sleeve, envelope, tin, tissue paper, poly bag, " +
    "shipping materials, wrapping, insert card) pass with the packaging sentence as the quote.",
    "pass_evidenced"),
  C("Our packages are made from recycled paper.", attr("materials"), "not_proven", "packaging-subject",
    "The veto nouns are mostly un-pluralised, so the PLURAL of 7 of the 10 listed nouns escapes.",
    "pass_evidenced"),
  C("Comes in 100% recycled kraft paper packaging.", attr("materials"), "not_proven", "packaging-subject",
    "MODIFIED_SUBJECT is anchored to the 24 chars immediately AFTER the term, so one two-word " +
    "adjective defeats it. `Shipped in 100% recycled packaging.` correctly returns not_proven.",
    "pass_evidenced"),
  C("Every order is wrapped in 100% cotton muslin.", attr("materials"), "not_proven", "packaging-subject",
    "Structurally the worst of the class: the subject is the ORDER and no vetoed noun is present " +
    "at all, so no extension of a noun list can reach it. The verb (wrapped in / arrives in / " +
    "ships in) is the signal the matcher never reads.",
    "pass_evidenced"),
  C("Let's talk about our packaging. It is made from 100% recycled cardboard.", attr("materials"), "not_proven", "packaging-subject",
    "Sentence-scoped matching means a pronoun subject in the NEXT sentence loses the veto.",
    "pass_evidenced"),

  // --- CONFIRMED GAPS: other subjects ---
  C("Comes with a display stand made of solid oak.", attr("materials"), "not_proven", "bundled-item",
    "States the material of a BUNDLED item, not the product.", "pass_evidenced"),
  C("Unlike sets made from aluminum, ours holds its shape.", attr("materials"), "not_proven", "competitor",
    "The composition stated is a COMPETITOR's.", "pass_evidenced"),
  C("A reviewer wrote that the strap is made from full-grain leather.", attr("materials"), "not_proven", "review-quote",
    "CONTEXT_VETO's review list does not include `a reviewer wrote`; a review is not the store stating a fact.",
    "pass_evidenced"),
  C("Polish with a cloth made of cotton — never use steel wool.", attr("materials"), "not_proven", "care-instruction",
    "The material belongs to a CARE TOOL, not the product.", "pass_evidenced"),
  C("Made with pride by our team in a converted iron foundry.", attr("materials"), "not_proven", "marketing-idiom",
    "`iron` is matched from the FOUNDRY, not the product. MATERIAL_NOUN is satisfied anywhere in the sentence.",
    "pass_evidenced"),
  C("Available in Steel Blue and Denim Wash — made with care.", attr("materials"), "not_proven", "colour-or-style",
    "`Steel` and `Denim` are COLOUR names. MATERIAL_NOUN cannot tell a colour from a composition.",
    "pass_evidenced"),
  C("Made without plastic, ever.", attr("materials"), "not_proven", "negation",
    "States what the product is NOT made of. NEGATION only looks back 14 chars from the term.",
    "pass_evidenced"),
  C("This strap is not ever made from leather.", attr("materials"), "not_proven", "negation",
    "`not ever` puts the negator outside the 14-char window.", "pass_evidenced"),

  // --- canonical TRUE phrasings that must keep passing ---
  C("Forged from a single billet of high-carbon steel.", attr("materials"), "pass_evidenced", "canonical-true",
    "A real composition statement that fails: `forged from` is not one of the composition frames, " +
    "though it is the standard verb for knives and cast iron — whole categories the tool targets.",
    "not_proven"),
  C("Stainless steel body, silicone lid.", attr("materials"), "pass_evidenced", "canonical-true",
    "The commonest spec-style composition line on a drinkware product; no composition FRAME, so " +
    "the frame-based term list cannot see it. A false FAIL, not a false pass.",
    "not_proven"),
  C("95% cotton, 5% elastane.", attr("materials"), "pass_evidenced", "canonical-true",
    "The `% cotton` frame exists precisely for this."),

  // MUTATION ANCHOR — a packaging sentence the guards DO catch. Without one of
  // these the mutation proof reports MODIFIED_SUBJECT as decorative, because every
  // other packaging case in this file is already a known gap.
  C("Shipped in 100% recycled packaging.", attr("materials"), "not_proven", "packaging-subject",
    "MODIFIED_SUBJECT catches the noun when it is adjacent to the term. This is the control that " +
    "proves the guard works, and the contrast that makes the `kraft paper` gap above a real defect."),
];

// ---------------------------------------------------------------------------
// ORIGIN — "Country of origin is stated".
// ---------------------------------------------------------------------------
const ORIGIN: Case[] = [
  C("Made in small batches in our studio.", attr("origin"), "not_proven", "marketing-idiom",
    "ORIGIN_STOP catches the lowercase form."),
  C("Roasted in small batches every Tuesday.", attr("origin"), "not_proven", "marketing-idiom",
    "Same, via the `roasted in` frame."),
  C("Made in the USA.", attr("origin"), "pass_evidenced", "canonical-true", "A stated country."),
  C("Country of Origin: Japan", attr("origin"), "pass_evidenced", "canonical-true", "The explicit field form."),
  C("Handmade in Vermont from local clay.", attr("origin"), "pass_evidenced", "canonical-true", "A stated place."),

  // --- CONFIRMED GAPS: statesAPlace requires a CAPITALISED token ---
  C("Made in Very Small Batches.", attr("origin"), "not_proven", "cap-non-place",
    "ORIGIN_STOP is `^`-anchored after ONE article strip, so any inserted word moves the stop word " +
    "out of range. `Made in Small Batches.` correctly fails; one adverb flips it. Capitalisation is " +
    "merchant-controlled Title Case, not evidence of a place.",
    "pass_evidenced"),
  C("Handcrafted in Truly Limited Runs.", attr("origin"), "not_proven", "cap-non-place",
    "Same mechanism as above with a different filler adverb — `Truly` displaces `Limited` past the " +
    "`^`-anchored ORIGIN_STOP, so a production-volume statement reads as a country.",
    "pass_evidenced"),
  C("Made in the Same Facility As Our Nut Butters.", attr("origin"), "not_proven", "cap-non-place",
    "A shared-facility allergen disclosure, not a country of origin — and an extremely common line " +
    "in exactly the food categories this tool targets.",
    "pass_evidenced"),
  C("Roasted in Our Roastery every Monday.", attr("origin"), "not_proven", "cap-non-place",
    "`Our` is stripped as an article, exposing the capitalised `Roastery`.", "pass_evidenced"),
  C("Made in Heaven, worn on Earth.", attr("origin"), "not_proven", "marketing-idiom",
    "A pure marketing idiom whose capitalised token is a place only in a sense no customs form " +
    "recognises. Shows the capitalisation heuristic is not measuring place-ness at all.",
    "pass_evidenced"),
  C("Our gift box is made in Vietnam.", attr("origin"), "not_proven", "packaging-subject",
    "`gift box` is not in SUBJECT_BEFORE_VETO — the origin of the PACKAGING.", "pass_evidenced"),
  C("The included travel case is made in China.", attr("origin"), "not_proven", "bundled-item",
    "States the origin of an ACCESSORY in the box. The product's own origin remains unstated, and " +
    "the row is rendered with this sentence as its proof.",
    "pass_evidenced"),
  C("Unlike mass-market pans made in China, ours are forged by hand.", attr("origin"), "not_proven", "competitor",
    "The only origin in the sentence is a competitor's, and the contrastive `Unlike … ours` makes " +
    "that explicit — yet it is quoted as this store's origin evidence.",
    "pass_evidenced"),
  C("No part of this is made in China.", attr("origin"), "not_proven", "negation",
    "A denial of an origin is not a stated origin; the negator is outside the 14-char window.",
    "pass_evidenced"),
  C("Country of origin: Unknown", attr("origin"), "not_proven", "placeholder",
    "`Unknown` is capitalised, so statesAPlace accepts it as a place.", "pass_evidenced"),

  // --- CONFIRMED GAPS in the other direction: real places rejected ---
  C("Each mug is hand-thrown and made in vermont.", attr("origin"), "pass_evidenced", "casing",
    "A store writing lowercase copy states its origin just as much as one writing Title Case. " +
    "Requiring a capital is a false FAIL on ordinary casing.",
    "not_proven"),
  C("Origin: Italy", attr("origin"), "pass_evidenced", "canonical-true",
    "`origin:` is not in the term list — only `country of origin`. A very common spec label.",
    "not_proven"),
  C("Handmade in small batches in Vermont.", attr("origin"), "pass_evidenced", "first-occurrence",
    "statesAPlace inspects only the FIRST occurrence of the frame, sees `small`, and stops — " +
    "even though the same sentence names Vermont.",
    "not_proven"),
];

// ---------------------------------------------------------------------------
// DIMENSIONS — "Measurements are stated" claims the PRODUCT's own size.
// ---------------------------------------------------------------------------
const DIMENSIONS: Case[] = [
  C("Available in 3 colors with a relaxed length.", attr("dimensions"), "not_proven", "marketing-idiom",
    "A digit and a unit-word, but no number BOUND to a unit."),
  C("Rated for a 300 lbs weight capacity on the shipping pallet.", attr("dimensions"), "not_proven", "shipment-subject",
    "shipmentVeto: a sentence about the shipment is not about the product's size."),
  C("16oz bottle of cold brew.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "allowContainerSubject: this is how a beverage store states its size."),
  C("Each bottle stands 8 inches tall.", attr("dimensions"), "pass_evidenced", "canonical-true", "A real measurement."),

  // --- CONFIRMED GAPS: not the product's measurement ---
  C("Arrives in 12 x 9 inch boxes.", attr("dimensions"), "not_proven", "shipment-subject",
    "SHIPMENT_CONTEXT has no `arrives`/`box` term, so the shipment veto never fires.", "pass_evidenced"),
  C("Parcel weight is 2.4 lbs.", attr("dimensions"), "not_proven", "shipment-subject",
    "`parcel` is absent from SHIPMENT_CONTEXT, so the shipment veto never fires and a despatch " +
    "weight is reported as the product's weight.",
    "pass_evidenced"),
  C("Minimum order 5 kg.", attr("dimensions"), "not_proven", "threshold",
    "An ORDER THRESHOLD, not a product measurement.", "pass_evidenced"),
  C("Discount applies to purchases over 10 lbs.", attr("dimensions"), "not_proven", "threshold",
    "A pricing threshold about ORDERS. `orders? (over|above|exceed)` is in SHIPMENT_CONTEXT but " +
    "`purchases over` is not, so the same idea in different words escapes.",
    "pass_evidenced"),
  C("Comes with a free 8 oz sample of our conditioner.", attr("dimensions"), "not_proven", "bundled-item",
    "The measurement belongs to a bundled item.", "pass_evidenced"),
  C("Steep in 8 oz of hot water for 3 minutes.", attr("dimensions"), "not_proven", "usage-quantity",
    "A usage instruction quantity, not the product's capacity.", "pass_evidenced"),
  C("This is not a 16 oz bottle.", attr("dimensions"), "not_proven", "negation",
    "A denial. The negator sits outside the 14-char window.", "pass_evidenced"),
  C("Unlike the 32 oz competitor bottle, ours fits a cup holder.", attr("dimensions"), "not_proven", "competitor",
    "The only capacity named belongs to a competitor; the sentence's own contrast says so, and " +
    "this store's capacity is never stated.",
    "pass_evidenced"),

  // --- CONFIRMED GAPS: canonical measurements that FAIL ---
  C("Measures 12 x 9 x 4 in.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "No term in the dimensions list appears: `in` is not a term (only `inch`/`inches`). The most " +
    "standard spec line there is returns not_proven.",
    "not_proven"),
  C("This mug holds 12 fl oz of coffee.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "`fl oz` matches as a term, but MEASUREMENT requires the digit adjacent to the unit and `12 fl oz` " +
    "has `fl` in between, so the valueGuard rejects it.",
    "not_proven"),
  C("A 12-oz mug in matte ceramic.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "MEASUREMENT allows an optional SPACE between number and unit but not a HYPHEN.", "not_proven"),
  C("The cord is 6 ft long.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "`ft`/`feet`/`foot` are in MEASUREMENT but absent from the dimensions term list.", "not_proven"),
  C("Holds 2 L of water.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "`l` is in MEASUREMENT but the term list has only `liters`/`litres`/`ml`.", "not_proven"),
  C("Weighs 3 lbs and ships free.", attr("dimensions"), "pass_evidenced", "shipment-veto-overreach",
    "A genuine product weight is vetoed because the sentence also mentions shipping. The veto is " +
    "whole-sentence by design, and here that design costs a true statement.",
    "not_proven"),

  // MUTATION ANCHOR for `wholeWord`. Without it the term `weight` matches inside
  // `Lightweight`, and MEASUREMENT is satisfied by the unrelated `5 ft`, so the row
  // passes on a sentence that states no measurement of anything.
  C("Lightweight frame, 5 ft of reach.", attr("dimensions"), "not_proven", "unit-substring",
    "`ft` is not in the dimensions term list, so the ONLY thing that can match is `weight` hiding " +
    "inside `Lightweight`. wholeWord is what stops that, and this is the case that proves it."),
];

// ---------------------------------------------------------------------------
// CARE — and the category gate that decides whether the row is asked at all.
// ---------------------------------------------------------------------------
const CARE: Case[] = [
  C("Machine wash cold, tumble dry low.", attr("care"), "pass_evidenced", "canonical-true", "Real care instructions."),
  C("Learn how to use our rewards program in 3 steps.", attr("care"), "not_proven", "marketing-idiom",
    "Site chrome, not care. `how to use` was removed from the term list for exactly this."),

  C("Spot clean the packaging before recycling it.", attr("care"), "not_proven", "packaging-subject",
    "MODIFIED_SUBJECT is anchored to the text right after the term, so the article in `the packaging` " +
    "defeats it — `Spot clean packaging before recycling.` correctly fails.",
    "pass_evidenced"),
  C("The reusable tin it comes in is dishwasher safe.", attr("care"), "not_proven", "packaging-subject",
    "Care instructions for the CONTAINER. The subject precedes the term, where MODIFIED_SUBJECT " +
    "never looks, and `tin` is a container the matcher elsewhere treats as the product.",
    "pass_evidenced"),
  C("The included tote bag is machine washable.", attr("care"), "not_proven", "bundled-item",
    "Care for a bundled accessory, quoted as care for the product. Nothing in the pipeline reads " +
    "the subject `The included tote bag`.",
    "pass_evidenced"),
  C("Care instructions: TBD.", attr("care"), "not_proven", "placeholder",
    "A placeholder. The term `care instructions` matches and nothing checks for an actual instruction.",
    "pass_evidenced"),
  C("Full care instructions are included in the box.", attr("care"), "not_proven", "placeholder",
    "A POINTER to instructions is not instructions an AI buyer can read — which is the whole claim.",
    "pass_evidenced"),
  C("Do not machine wash.", attr("care"), "pass_evidenced", "negation",
    "A prohibition IS a care instruction. The negation guard, correct elsewhere, is wrong here — " +
    "`do not tumble` and `do not bleach` are already in the term list for this reason.",
    "not_proven"),
];

// ---------------------------------------------------------------------------
// CLAIMS.
// ---------------------------------------------------------------------------
const CLAIMS: Case[] = [
  C("Certified gluten-free.", claimReq("gluten_free"), "pass_evidenced", "canonical-true", "A stated claim."),
  C("Our packaging is BPA-free.", claimReq("bpa_free"), "not_proven", "packaging-subject",
    "The Stage-3 TRAP the whole evidence module was written to prevent, still reachable: " +
    "`is BPA-free` puts the subject BEFORE the term, where MODIFIED_SUBJECT never looks.",
    "pass_evidenced"),
  C("The tube is BPA-free.", claimReq("bpa_free"), "not_proven", "packaging-subject",
    "Same shape; the container, not the contents.", "pass_evidenced"),
  C("Includes a vegan travel pouch for your gym bag.", claimReq("vegan"), "not_proven", "bundled-item",
    "The claim attaches to an included ACCESSORY. `Includes a …` is as clear a bundled-item marker " +
    "as exists, and nothing in CONTEXT_VETO reads it.",
    "pass_evidenced"),
  C("Made with inorganic mineral pigments.", claimReq("organic"), "not_proven", "substring-single-word-term",
    "`organic` is matched WITHOUT wholeWord (only attributes set that flag), so it matches inside " +
    "`inorganic` — a word that asserts the opposite.",
    "pass_evidenced"),
  C("Is this vegan? See our FAQ for the full ingredient list.", claimReq("vegan"), "not_proven", "question",
    "A QUESTION is not a statement. splitSentences breaks on `?`, so the question stands alone and " +
    "is rendered as the proof.",
    "pass_evidenced"),
  C("This product has no organic certification.", claimReq("organic"), "not_proven", "negation",
    "An explicit denial of the claim. `no` sits 1 char before `organic` so it is inside the " +
    "negation window, but `no` is not in the NEGATION alternation at all.",
    "pass_evidenced"),
  C("Our closest competitor is cruelty-free; we are still working on it.", claimReq("cruelty_free"), "not_proven", "competitor",
    "The claim belongs to a competitor and the sentence says so.", "pass_evidenced"),
  C("\"Love that it's fragrance-free!\" — a customer in Portland.", claimReq("fragrance_free"), "not_proven", "review-quote",
    "A customer's words are not the store's statement.", "pass_evidenced"),
  C("We believe fair trade should be the industry standard.", claimReq("fair_trade"), "not_proven", "marketing-idiom",
    "An aspiration, not a claim about this product.", "pass_evidenced"),
  C("Contains gluten-free rolled oats and almonds.", claimReq("gluten_free"), "pass_evidenced", "contrary",
    "The violating term `contains gluten` is a plain SUBSTRING of `contains gluten-free`, and the " +
    "violating list is checked FIRST — so a store stating the claim is told it states the opposite.",
    "not_proven"),
  C("No added fragrance, ever.", claimReq("fragrance_free"), "pass_evidenced", "contrary",
    "`added fragrance` is a violating term and matches inside the support phrase `no added fragrance`.",
    "not_proven"),
];

// ---------------------------------------------------------------------------
// DELIVERY.
// ---------------------------------------------------------------------------
const DELIVERY: Case[] = [
  C("Orders ship within 2 business days.", deliveryReq(), "pass_evidenced", "canonical-true",
    "The exact phrasing the product's own correction line tells merchants to publish."),
  C("Returns are accepted within 30 business days of receipt.", deliveryReq(), "not_proven", "wrong-window",
    "A RETURNS window read as a delivery window: `business days` matches with no subject check.",
    "pass_evidenced"),
  C("We cannot guarantee delivery in 2 business days.", deliveryReq(), "not_proven", "negation",
    "An explicit refusal to state a window. findSupport iterates TERMS in list order, so " +
    "`business days` matches before `delivery in` is ever considered and the negation guard is " +
    "bypassed structurally.",
    "pass_evidenced"),
  C("We do not offer next-day shipping.", deliveryReq(), "not_proven", "negation",
    "A denial of a delivery speed reported as stating one.", "pass_evidenced"),
  C("Orders are not delivered within 3 business days during the holidays.", deliveryReq(), "not_proven", "negation",
    "Same term-order bypass: `business days` (3rd in the list) wins over `delivered within` (10th).",
    "pass_evidenced"),
  C("Is same-day shipping available?", deliveryReq(), "not_proven", "question",
    "A question rendered as the proof. In the live FAQ shape the ANSWER that denies it is never consulted.",
    "pass_evidenced"),
  C("Ships in eco-friendly packaging, 100% recycled.", deliveryReq(), "not_proven", "packaging-subject",
    "requireDigit is satisfied by the `100` in `100%`, and MODIFIED_SUBJECT is one adjective wide.",
    "pass_evidenced"),

  // MUTATION ANCHOR for CONTEXT_VETO — a subscription-widget sentence it DOES catch.
  // MUTATION ANCHOR for CONTEXT_VETO. Two things had to be right for this to
  // actually exercise the veto, and the first attempt got both wrong:
  //  • `policyStatus: readable`, else the row returns requires_store_access (we
  //    never read the policy) and the veto is never reached;
  //  • a term that genuinely MATCHES. "Delivered every 4 weeks, arrives within 30
  //    days." looked like a subscription-widget case but returns not_proven for an
  //    unrelated reason — "arrives within" is not in the term list ("arrive within"
  //    is), so nothing matches and the veto is irrelevant. Removing CONTEXT_VETO
  //    changed nothing, which is how the miss was caught.
  C("Subscribe & Save — ships within 2 business days.", deliveryReq(), "not_proven", "subscription-widget",
    "`ships within` matches and requireDigit is satisfied, so only CONTEXT_VETO's subscription-widget " +
    "rule stands between this purchase widget and a rendered delivery proof. This is the case that " +
    "proves that rule still fires.",
    undefined, { policyStatus: "readable" }),
];

// ---------------------------------------------------------------------------
// IDENTIFIERS — fixed this session; these lock the fix in.
// ---------------------------------------------------------------------------
const IDENTIFIERS: Array<{ label: string; opts: { gtin?: string | null; mpn?: string | null }; correct: AssertionStatus; why: string }> = [
  { label: "mpn N/A.", opts: { mpn: "N/A." }, correct: "not_proven", why: "Placeholder with a trailing period — the old anchored regex missed every affixed form." },
  { label: "mpn 'N/A - see description'", opts: { mpn: "N/A - see description" }, correct: "not_proven", why: "Placeholder plus a note." },
  { label: "mpn TBD-001", opts: { mpn: "TBD-001" }, correct: "not_proven", why: "Placeholder plus a sequence number." },
  { label: "mpn test123", opts: { mpn: "test123" }, correct: "not_proven", why: "Placeholder plus digits." },
  { label: "mpn 'n / a'", opts: { mpn: "n / a" }, correct: "not_proven", why: "Separators carry no identifying information." },
  { label: "mpn NA/NA", opts: { mpn: "NA/NA" }, correct: "not_proven", why: "A repeated placeholder token." },
  { label: "mpn PLACEHOLDER", opts: { mpn: "PLACEHOLDER" }, correct: "not_proven", why: "Says so." },
  { label: "mpn YOUR-MPN-HERE", opts: { mpn: "YOUR-MPN-HERE" }, correct: "not_proven", why: "Unfilled template value." },
  { label: "mpn 123", opts: { mpn: "123" }, correct: "not_proven", why: "Too short to match a catalogue entry." },
  { label: "mpn 0-0", opts: { mpn: "0-0" }, correct: "not_proven", why: "A single repeated character once separators are stripped." },
  { label: "mpn MB-4471-X", opts: { mpn: "MB-4471-X" }, correct: "pass_evidenced", why: "A real MPN. Must never be caught by the placeholder rule." },
  { label: "mpn WH-1000XM5", opts: { mpn: "WH-1000XM5" }, correct: "pass_evidenced", why: "A real MPN containing digits and letters." },
  { label: "gtin 12345670 (GTIN-8)", opts: { gtin: "12345670" }, correct: "pass_evidenced", why: "Valid check digit." },
  { label: "gtin 036000291452 (GTIN-12)", opts: { gtin: "036000291452" }, correct: "pass_evidenced", why: "Valid check digit." },
  { label: "gtin 4006381333931 (GTIN-13)", opts: { gtin: "4006381333931" }, correct: "pass_evidenced", why: "Valid check digit." },
  { label: "gtin 12345678901231 (GTIN-14)", opts: { gtin: "12345678901231" }, correct: "pass_evidenced", why: "Valid check digit." },
  { label: "gtin 4006381333930 (bad check digit)", opts: { gtin: "4006381333930" }, correct: "not_proven", why: "Right length, wrong check digit." },
  { label: "gtin all zeros", opts: { gtin: "0000000000000" }, correct: "not_proven", why: "Passes the check-digit arithmetic and identifies nothing." },
  { label: "gtin 0-36000-29145-2 (hyphenated)", opts: { gtin: "0-36000-29145-2" }, correct: "pass_evidenced", why: "The separators printed on the barcode. Rejecting it told stores that DO publish an identifier that they don't." },
  { label: "gtin '400 638 133 3931' (spaced)", opts: { gtin: "400 638 133 3931" }, correct: "pass_evidenced", why: "Same number, spaced." },
];

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------
const ALL: Array<[string, Case[]]> = [
  ["materials", MATERIALS], ["origin", ORIGIN], ["dimensions", DIMENSIONS],
  ["care", CARE], ["claims", CLAIMS], ["delivery", DELIVERY],
];

for (const [group, cases] of ALL) {
  for (const c of cases) {
    const gap = c.actual !== undefined;
    test(`[${group}/${c.cls}]${gap ? " KNOWN GAP —" : ""} ${JSON.stringify(c.sentence).slice(0, 76)}`, () => {
      const got = statusOf(c.sentence, c.requirement, c.opts ?? {});
      assert.equal(
        got, c.actual ?? c.correct,
        gap
          ? `KNOWN GAP CHANGED. Corpus records actual=${c.actual} (honest answer: ${c.correct}). Got ${got}. ` +
            `If this gap is now FIXED, delete its \`actual\` and decrement openGaps. Why: ${c.why}`
          : `REGRESSION. Expected ${c.correct}, got ${got}. Why: ${c.why}`,
      );
    });
  }
}

for (const i of IDENTIFIERS) {
  test(`[identifiers] ${i.label}`, () => {
    assert.equal(verdictOfIds(i.opts).status, i.correct, `${i.label} — ${i.why}`);
  });
}

// ---------------------------------------------------------------------------
// CATEGORY GATING — whether a requirement is asked at all.
//
// A row asked of the wrong category is the cruelty-free failure that this whole
// line of work exists to remove: not false, but irrelevant, identical across
// unrelated merchants, and enough to make a specific diagnosis read like a
// template. These also serve as the mutation anchor for `care.onlyFor`.
// ---------------------------------------------------------------------------

const asksCare = (title: string, productType: string): boolean =>
  requirementsFor({ title, productType, description: "A thing made of olive oil.", minPriceUsd: 20 })
    .some((r) => r.attribute === "care");

test("[gating] care is asked of things a buyer actually launders or seasons", () => {
  for (const [title, type] of [["Merino Wool Sweater", "Sweater"], ["Cast Iron Skillet", "Cookware"], ["Leather Boots", "Footwear"]] as const) {
    assert.ok(asksCare(title, type), `care row missing for ${title}`);
  }
});

test("[gating] care is NOT asked because a category word hides inside another word", () => {
  // v2.3 fixed Company/Japanese/Potato/Arugula/Rugged by word-bounding `onlyFor`.
  // These are the same class and must stay out.
  for (const [title, type] of [
    // Deliberately invented names. The point is the word-boundary escape ("pan"
    // inside "Company", "pot" inside "Potato"), and a tracked test file must not
    // carry a string that resolves to somebody's real store.
    ["Soap | Harborline Soap Company", "Soap"],
    ["Snacks | Salted Potato Chips", "Snacks"],
    ["Notebook | Rugged Field Journal", "Notebook"],
    ["Graphite Pencil", "Pencil"],
  ] as const) {
    assert.equal(asksCare(title, type), false, `care row wrongly asked for ${title}`);
  }
});

// --- the corpus must not be vacuous, and gaps must not multiply silently ------

test("every case states WHY its expectation is correct", () => {
  for (const [, cases] of ALL) {
    for (const c of cases) {
      // A GAP entry carries a debt, so it must explain the mechanism well enough
      // for a later session to fix it. A canonical-true entry only has to say what
      // it is protecting, which is legitimately short ("A stated country.").
      const min = c.actual !== undefined ? 40 : 12;
      assert.ok(c.why.length > min, `case "${c.sentence}" needs a fuller justification (${c.why.length} chars, need >${min})`);
    }
  }
});

test("the open-gap count is exactly what was measured — a new gap fails here", () => {
  const gaps = ALL.flatMap(([g, cs]) => cs.filter((c) => c.actual !== undefined).map((c) => `${g}: ${c.sentence}`));
  // Measured 2026-07-25 by executing every case. Each is a confirmed defect that
  // was independently re-executed by an adversarial verifier. Lowering this number
  // is progress; raising it without a decision is a regression.
  const EXPECTED_OPEN_GAPS = 65;
  assert.equal(
    gaps.length, EXPECTED_OPEN_GAPS,
    `open gaps changed (${gaps.length} vs ${EXPECTED_OPEN_GAPS}).\n${gaps.join("\n")}`,
  );
});

test("the corpus covers every requirement kind that can produce a false pass", () => {
  const kinds = new Set(ALL.flatMap(([, cs]) => cs.map((c) => c.requirement.attribute ?? c.requirement.kind)));
  for (const k of ["materials", "dimensions", "origin", "care", "claim", "delivery"]) {
    assert.ok(kinds.has(k), `no adversarial coverage for ${k}`);
  }
  assert.ok(IDENTIFIERS.length >= 15, "identifiers coverage is too thin to be meaningful");
});
