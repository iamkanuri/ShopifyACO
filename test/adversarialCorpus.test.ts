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
    "shipping materials, wrapping, insert card) pass with the packaging sentence as the quote."),
  C("Our packages are made from recycled paper.", attr("materials"), "not_proven", "packaging-subject",
    "The veto nouns are mostly un-pluralised, so the PLURAL of 7 of the 10 listed nouns escapes."),
  C("Comes in 100% recycled kraft paper packaging.", attr("materials"), "not_proven", "packaging-subject",
    "MODIFIED_SUBJECT is anchored to the 24 chars immediately AFTER the term, so one two-word " +
    "adjective defeats it. `Shipped in 100% recycled packaging.` correctly returns not_proven."),
  C("Every order is wrapped in 100% cotton muslin.", attr("materials"), "not_proven", "packaging-subject",
    "Structurally the worst of the class: the subject is the ORDER and no vetoed noun is present " +
    "at all, so no extension of a noun list can reach it. The verb (wrapped in / arrives in / " +
    "ships in) is the signal the matcher never reads."),
  C("Let's talk about our packaging. It is made from 100% recycled cardboard.", attr("materials"), "not_proven", "packaging-subject",
    "Sentence-scoped matching means a pronoun subject in the NEXT sentence loses the veto.",
    "pass_evidenced"),

  // --- CONFIRMED GAPS: other subjects ---
  C("Comes with a display stand made of solid oak.", attr("materials"), "not_proven", "bundled-item",
    "States the material of a BUNDLED item, not the product."),
  C("Unlike sets made from aluminum, ours holds its shape.", attr("materials"), "not_proven", "competitor",
    "The composition stated is a COMPETITOR's."),
  C("A reviewer wrote that the strap is made from full-grain leather.", attr("materials"), "not_proven", "review-quote",
    "CONTEXT_VETO's review list does not include `a reviewer wrote`; a review is not the store stating a fact."),
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
    "`not ever` puts the negator outside the 14-char window."),

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

  // MUTATION ANCHORS for the two LEGACY guards, which v2.5's subject rule does NOT
  // subsume. Both of these have no finite verb, so `nonProductSubject` has nothing
  // to delimit a subject with and returns null — `SUBJECT_BEFORE_VETO` is the only
  // thing standing between them and a packaging composition credited to the product.
  // Without these cases the mutation proof reported that guard as decorative.
  C("Our packaging: made from recycled cardboard.", attr("materials"), "not_proven", "packaging-subject",
    "A colon-delimited spec line. The clause splitter cuts at the colon, so the subject is not in " +
    "the term's clause at all and only the backward-looking legacy veto can see it."),
  C("Gift box materials: made of recycled kraft paper.", attr("materials"), "not_proven", "packaging-subject",
    "Found while testing whether the legacy guard was redundant: `gift box` was on no list, so " +
    "this passed as the product's composition. The alternation now covers unambiguous packaging " +
    "compounds — but still not bare `box`, because a keepsake box IS the product for some stores."),

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
// ---------------------------------------------------------------------------
// ORIGIN — REMOVED FROM THE SHIPPED LIBRARY (v2.8 CP2).
//
// The requirement is gone, so there are no `attr("origin")` cases to run: building
// one would now throw, which is itself the strongest possible pin. What remains is
// the structural assertion that it cannot come back by accident, plus the sentences
// that decided it — kept verbatim in the comments so a future session inherits the
// evidence rather than the conclusion.
//
// It was removed because it was wrong in BOTH directions on real merchant copy:
//   FALSE PASS  "Made in Georgia pine."      (a wood, read as a US state)
//   FALSE FAIL  "Made in the U.S.A."         (the clause splitter cuts on the dots)
//   FALSE FAIL  "Handcrafted in Nepal."      "Grown in Panama."  "Milled in Japan."
//   FALSE FAIL  "Made in Los Angeles."       (the gazetteer holds no cities)
//   FALSE FAIL  "Origin — Italy"             (only `:` was accepted as a separator)
// and because at a 0.91 production fail rate it carried little information even when
// right. Full record and the measured path back: experiments/v2-8/FITNESS.md.
//
// ⚠️ Removing a requirement DELETED 3 open gaps rather than fixing them. They were
// real defects; they are now unreachable because the feature that carried them does
// not ship. Do not read the drop in EXPECTED_OPEN_GAPS as three defects repaired.
//
// ⚠️ OWED: a replacement control for `termMatches` longest-match-first ordering.
// The mutation proof measured that guard LOAD-BEARING before this removal and DEAD
// after it — its only anchor was the origin case "Roasted in small batches; grown in
// Colombia.", and deleting the requirement deleted the anchor. The guard is NOT
// redundant; it is now uncovered, which is a corpus hole this session created and did
// not close. It is hard to anchor via the surviving requirements because no remaining
// attribute `valueGuard` consumes the matched term (origin's `statesAPlace` was the
// only one that did), so ordering now only shows up through `findViolation` overlap
// and per-term aboutness. Write that case before trusting the mutation proof's count
// again. Sibling precedent: `findSupport rejects if ANY matched term is negated` has
// been corpus-DEAD and real-copy load-bearing since v2.5, and says so in its comment.
// ---------------------------------------------------------------------------

test("[origin] the origin requirement is NOT in the shipped library", () => {
  // Copy that plainly states an origin, from a category that would happily carry the
  // row. If `origin` ever returns, this is where it announces itself.
  const reqs = requirementsFor({
    title: "Merino Wool Sweater", productType: "Sweater",
    description: "Made in Portugal from a merino blend. Handcrafted in Nepal by a small team. Origin: Italy.",
    minPriceUsd: 120,
  });
  assert.equal(reqs.some((r) => r.attribute === "origin"), false, "an origin requirement was asked");
  assert.equal(
    reqs.some((r) => /country of origin/i.test(r.label)), false,
    "a requirement is still labelled as a country-of-origin claim",
  );
});

test("[origin] no requirement anywhere claims to read a country of origin", () => {
  // Across categories, so a category-gated resurrection is caught too.
  for (const [title, productType] of [
    ["Cast Iron Skillet", "Cookware"], ["Single Origin Coffee", "Coffee"],
    ["Leather Boots", "Footwear"], ["Ceramic Mug", "Drinkware"], ["Graphite Pencil", "Pencil"],
  ] as const) {
    const reqs = requirementsFor({
      title, productType, minPriceUsd: 40,
      description: "Made in Italy. Roasted in small batches. Country of origin: Japan.",
    });
    // NB: bare /origin/ is the WRONG test and caught its own false alarm here — the
    // `single_origin` CLAIM row is a different, surviving feature ("Single-origin"
    // coffee sourcing), not the removed country-of-origin attribute.
    assert.equal(
      reqs.some((r) => r.attribute === "origin" || /country of origin/i.test(r.label)), false,
      `origin row resurfaced for ${title}`,
    );
  }
});


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
    "SHIPMENT_CONTEXT has no `arrives`/`box` term, so the shipment veto never fires."),
  C("Parcel weight is 2.4 lbs.", attr("dimensions"), "not_proven", "shipment-subject",
    "`parcel` is absent from SHIPMENT_CONTEXT, so the shipment veto never fires and a despatch " +
    "weight is reported as the product's weight."),
  C("Minimum order 5 kg.", attr("dimensions"), "not_proven", "threshold",
    "An ORDER THRESHOLD, not a product measurement.", "pass_evidenced"),
  C("Discount applies to purchases over 10 lbs.", attr("dimensions"), "not_proven", "threshold",
    "A pricing threshold about ORDERS. `orders? (over|above|exceed)` is in SHIPMENT_CONTEXT but " +
    "`purchases over` is not, so the same idea in different words escapes.",
    "pass_evidenced"),
  C("Comes with a free 8 oz sample of our conditioner.", attr("dimensions"), "not_proven", "bundled-item",
    "The measurement belongs to a bundled item."),
  // CLOSED v2.9 CP1 — `nonProductQuantity` reads the USAGE verb governing the clause.
  C("Steep in 8 oz of hot water for 3 minutes.", attr("dimensions"), "not_proven", "usage-quantity",
    "A usage instruction quantity, not the product's capacity."),
  C("This is not a 16 oz bottle.", attr("dimensions"), "not_proven", "negation",
    "A denial. The negator sits outside the 14-char window."),
  C("Unlike the 32 oz competitor bottle, ours fits a cup holder.", attr("dimensions"), "not_proven", "competitor",
    "The only capacity named belongs to a competitor; the sentence's own contrast says so, and " +
    "this store's capacity is never stated."),

  // --- CONFIRMED GAPS: canonical measurements that FAIL ---
  C("Measures 12 x 9 x 4 in.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "No term in the dimensions list appears: `in` is not a term (only `inch`/`inches`). The most " +
    "standard spec line there is returns not_proven.",
    "not_proven"),
  // CLOSED v2.8 CP1 — the `fl` insertion. Fluid ounces put a token between the number
  // and the unit, which digit-adjacency read as no measurement at all.
  C("This mug holds 12 fl oz of coffee.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "Fluid ounces put a token between the number and the unit. Closed by the `fl` insertion in MEASUREMENT."),
  // MUTATION ANCHOR for the `\b` in the FL group — the one guard that makes the `fl`
  // insertion safe. Without it `\d+\s?fl` + `ounces?` matches inside ordinary words.
  C("Midi length, 3 flounces, side pockets.", attr("dimensions"), "not_proven", "unit-substring",
    "`flounce` is routine apparel copy, and the first draft of the `fl` insertion matched `fl`+`ounce` " +
    "inside it, passing a qualitative `Midi length` sentence as a stated measurement. The `\\b` after " +
    "`fl` is the whole guard; this case is what proves it. Sibling: `12 flinches` via `fl`+`inch`."),
  // STILL OPEN, and this is a DECISION. A hyphen branch was built here and removed:
  C("A 12-oz mug in matte ceramic.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "MEASUREMENT allows an optional SPACE between number and unit but not a HYPHEN. A hyphen branch " +
    "was built in v2.8 and REMOVED after 334 independent probes attributed four false-pass mechanisms " +
    "to it that the legacy tree did not have: a one-letter unit as the tail of a hyphenated token " +
    "(`Case dimensions match every 4-G and Wi-Fi tablet.` — MEASUREMENT is tested on the WHOLE " +
    "sentence, so the matched term and the matched measurement need not be the same span); an all-caps " +
    "style code whose unit ends the token (`Style 16-OZ is the black colourway.`, which also DISPLACED " +
    "the quote off a real weight onto the colourway); a new surface for the already-pinned aboutness " +
    "gaps (usage quantity, bundled item, threshold, fitment); and a thousands separator satisfying the " +
    "lookbehind (`A 1,200-lb rated ceiling hook.`). The guards could not be tightened without also " +
    "refusing `A 12-inch-tall vase`, the commonest compound-adjective form of a real dimension.",
    "not_proven"),
  // NEW GAP, found by the v2.8 CP1 probe set. Not caused by the `fl` change —
  // it is a sentence-splitting limit the change made visible.
  C("This mug holds 12 fl. oz. of coffee.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "The abbreviated form. `splitSentences` breaks after any `. ` and does not know `fl.` is an " +
    "abbreviation, so this becomes three sentences — `This mug holds 12 fl.` / `oz.` / `of coffee.` — " +
    "and the fragment carrying the unit no longer carries the digit. MEASUREMENT matches the joined " +
    "text fine; the tokenizer never lets it see it. Fixing this means abbreviation-aware splitting, " +
    "which can MERGE genuinely separate sentences and is a false-pass risk of its own — deliberately " +
    "not attempted inside an adjacency-only change.",
    "not_proven"),
  // DELIBERATELY STILL OPEN after v2.8 CP1. Closing these needs `ft`/`l` in the
  // TERM list, and 196 independent probes attributed six false-pass mechanisms to
  // exactly that: `l` and `ft` are letters before they are units, so "Only 2 L left
  // in stock." passed as a measurement and `ft.` matched "featuring". Two lost rows
  // of depth cost less than a false statement. This is a decision, not a backlog item.
  C("The cord is 6 ft long.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "`ft`/`feet`/`foot` are in MEASUREMENT but absent from the dimensions term list, and v2.8 " +
    "deliberately left them out — adding them measured six false-pass mechanisms in v2.7.", "not_proven"),
  C("Holds 2 L of water.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "`l` is in MEASUREMENT but the term list has only `liters`/`litres`/`ml`, and v2.8 deliberately " +
    "left `l` out: as a term it made \"Only 2 L left in stock.\" pass as a measurement.", "not_proven"),
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
    "the subject `The included tote bag`."),
  C("Care instructions: TBD.", attr("care"), "not_proven", "placeholder",
    "A placeholder. CLOSED in v3.0 CP1 — and this is the MUTATION ANCHOR for the " +
    "CARE_DIRECTIVE half of `statesCareInstruction`: no reference frame fires here, so " +
    "only the requirement that a meta-term sentence carry an actual care ACTION closes it. " +
    "Delete that half and this case passes again."),
  C("Full care instructions are included in the box.", attr("care"), "not_proven", "placeholder",
    "A POINTER to instructions is not instructions an AI buyer can read — which is the whole " +
    "claim. CLOSED in v3.0 CP1 by CARE_REFERENCE (`included`)."),
  C("Do not machine wash.", attr("care"), "pass_evidenced", "negation",
    "A prohibition IS a care instruction. The negation guard, correct elsewhere, is wrong here — " +
    "`do not tumble` and `do not bleach` are already in the term list for this reason. " +
    "NOT the valueGuard's doing: `statesCareInstruction` returns true here (an instructive term " +
    "is present) and the veto happens earlier, in `findSupport`'s cross-term negation rule. " +
    "Verified against the pre-v3.0 engine, which fails it identically.",
    "not_proven"),

  // ── v3.0 CP1 — the `care` valueGuard ───────────────────────────────────────
  // Every sentence a comment in productTest.ts names as a must-pass owes a case
  // here, in the same commit. This is that debt paid.
  C("Care instructions: machine wash cold.", attr("care"), "pass_evidenced", "canonical-true",
    "THE LONGEST-MATCH TRAP, and the reason `statesCareInstruction` reads the whole sentence " +
    "instead of `matchedTerm`. `termMatches` sorts longest-first, so the term handed to the " +
    "valueGuard here is the META one (`care instructions`, 17) and not `machine wash` (12). A " +
    "guard that branched on the matched term would delete this real instruction — the over-tight " +
    "shape that cost v2.9's first quantity guard four real positives."),
  C("Care instructions: store in a cool dry place.", attr("care"), "pass_evidenced", "canonical-true",
    "`store` is deliberately ABSENT from CARE_DIRECTIVE — it is the merchant noun on nearly " +
    "every page. (`condition` was absent too, on the `conditions apply` argument, until v3.1 " +
    "measured that it cost a real positive; it is now admitted only as a transitive verb.) The " +
    "comment claims the cost is nil because this still passes on `dry`. This is that claim, " +
    "executed — and writing it corrected the comment, which had asserted the BARE sentence " +
    "\"Store in a cool dry place away from sunlight.\" passes. It does not and never did: it " +
    "carries no CARE_TERMS entry, so it is not_proven before the guard is ever reached."),
  C("Store in a cool dry place away from sunlight.", attr("care"), "not_proven", "canonical-true",
    "The counterpart to the case above, pinned so the correction cannot rot back into the " +
    "comment. No care TERM occurs, so no valueGuard runs. This is a term-list limit, not a " +
    "guard defect — recorded rather than fixed, because widening CARE_TERMS to bare `store` " +
    "is the collision the directive list already refuses."),
  C("Failure to follow the care instructions when washing will void this warranty.",
    attr("care"), "not_proven", "marketing-idiom",
    "MUTATION ANCHOR for CARE_REFERENCE. This sentence DOES carry a care action (`washing`), so " +
    "the CARE_DIRECTIVE half alone would pass it — only the reference frame (`follow`, `failure " +
    "to`, `void`) closes it. Without this case the reference veto reads as decorative in the " +
    "mutation proof, which is a corpus hole rather than a useless guard.",
    undefined, { title: "Ceramic Pan", productType: "Cookware" }),
  C("Care instructions are printed on the label.", attr("care"), "not_proven", "placeholder",
    "The instructions exist; they are not on any surface we read. Reference-to-elsewhere is the " +
    "CLASS the v2.9 false positive belonged to, not just the one warranty sentence."),
  // ── THE RESIDUAL CLASS the v3.0 independent pass measured, pinned not fixed ──
  C("Washing and care instructions are on the label.", attr("care"), "not_proven", "placeholder",
    "A PURE POINTER that still passes. CARE_REFERENCE carries no frame for `are on the label` " +
    "(`labell?ed` matches the adjective, not the noun), so control reaches CARE_DIRECTIVE — which " +
    "fires on the DEVERBAL NOUN `Washing`. The guard's own weak point: the -ing/-s inflections that " +
    "make a verb list readable are exactly the forms English uses to NAME a topic rather than give " +
    "an instruction, so the guard can fire on the category name it was built to reject. Measured by " +
    "an independent attacker: 46 of 70 hand-written pointer phrasings leak this way, 0 of 26 " +
    "canonical positives lost.\n" +
    "NOT A REGRESSION — verified mechanically, not argued: this sentence returns pass_evidenced " +
    "identically on the pre-guard engine.\n" +
    "⚠️ THE SENTENCE AFTER THAT ONE USED TO BE FALSE, and correcting it is why v3.1 exists. It " +
    "claimed the A/B found ZERO status changes across all 53 attacker claims. Re-run from two " +
    "independently built worktrees, the same A/B finds NINE — every one a real care instruction " +
    "the guard deleted, because CARE_REFERENCE was tested against the whole sentence and the " +
    "commonest way to write an instruction is `<pointer frame>: <the instruction>`. The claim was " +
    "not a judgement call that aged badly; it was an instrument returning the flattering answer, " +
    "which is the failure mode src/measure/completion.ts exists for. Closed in v3.1 CP0 by " +
    "scoping the frame to its own clause. Record: experiments/v3-1/AB_CARE.md.\n" +
    "NOT FIXED HERE, and the reason is the v2.8 `origin` precedent rather than fatigue. The " +
    "narrowing that closes it (drop the inflections, match instructive terms whole-word) would cost " +
    "real positives — \"Care instructions: we recommend hand washing.\" — to close a class with " +
    "ZERO occurrences across 8,046 real product descriptions plus every body in the 172-store " +
    "capture (58,237 sentences; 12 contain the meta term). Losing true statements to fix something " +
    "that does not occur is the exact trade v2.8 measured and refused.",
    "pass_evidenced", { title: "Merino Crew", productType: "apparel" }),

  C("Care instructions are printed on the tag: machine wash cold, tumble dry low.",
    attr("care"), "pass_evidenced", "canonical-true",
    "CONTROL CASE for the whole-sentence instructive read, which the first mutation run reported " +
    "DECORATIVE — every case written for it also passed through CARE_DIRECTIVE, so removing it " +
    "changed nothing. That is a corpus coverage hole, not a useless guard (same finding shape as " +
    "v2.4, where 4 of 12 guards read decorative for exactly this reason). Here the sentence " +
    "carries BOTH a reference frame (`printed`) and a real instruction. Without the instructive " +
    "read, CARE_REFERENCE fires first and deletes a merchant's genuine care instructions — a " +
    "false FAIL on ordinary hangtag copy."),

  // ── v3.1 CP0 — the nine true statements the whole-sentence frame deleted ────
  // The case above only survived because `machine wash` is an INSTRUCTIVE term, so
  // it never reached the narrow branch. Once the instruction after the colon is
  // phrased with ordinary verbs, the pre-v3.1 guard read the pointer frame in the
  // FIRST clause and answered "no care instructions stated" — about copy that
  // states them in the second. Nine of these were confirmed by A/B against the
  // pre-guard commit; the shapes below are one per splitting rule, so a future
  // narrowing of CARE_CLAUSE_SPLIT fails here instead of on a merchant.
  C("Follow the machine wash symbol on the label.", attr("care"), "pass_evidenced", "canonical-true",
    "MUTATION ANCHOR for the instructive-term shortcut, RE-ANCHORED in v3.1. Its old case " +
    "(\"Care instructions: machine wash cold.\") stopped discriminating the moment the reference " +
    "frame became clause-scoped — the clause after the colon carries a bare directive, so the " +
    "sentence passes with or without the shortcut, and the mutation proof read the guard as " +
    "decorative. Here the instructive term and the pointer frame share ONE clause, which is the " +
    "only shape where the shortcut decides anything. A guard whose anchor a later fix has " +
    "subsumed is a guard that has silently stopped being proved.",
    undefined, { title: "Merino Crew", productType: "apparel" }),
  C("Care instructions are printed on the tag: rinse in cool water and dry immediately.",
    attr("care"), "pass_evidenced", "canonical-true",
    "COLON. The frame (`printed`) is true of the first clause and says nothing about the second. " +
    "This is the commonest hangtag shape there is, and it returned not_proven before v3.1."),
  C("Per the care instructions, sanitize the board with diluted vinegar weekly.",
    attr("care"), "pass_evidenced", "canonical-true",
    "COMMA. `per the` is a frame; the instruction follows it in the same sentence. A splitter that " +
    "only cut on terminal punctuation could not reach this, which is why CARE_CLAUSE_SPLIT cuts on " +
    "a bare comma — over-splitting makes this guard MORE permissive, the direction it is documented " +
    "to fail in.",
    undefined, { title: "Oak Board", productType: "Cutting Boards" }),
  C("Our care instructions are void of jargon — rinse, dry, done.",
    attr("care"), "pass_evidenced", "canonical-true",
    "EM DASH. `void` is in CARE_REFERENCE because of the warranty sentence in the v2.9 sample; here " +
    "it is an idiom meaning `free of`, and the instruction is on the other side of the dash."),
  C("Care instructions: condition the leather twice a year.",
    attr("care"), "pass_evidenced", "canonical-true",
    "The measured cost of keeping `condition` out of CARE_DIRECTIVE. Admitted in v3.1 only as a " +
    "TRANSITIVE verb (`condition the …`), which is what the two cases below hold the line on.",
    undefined, { title: "Leather Belt", productType: "Accessories" }),
  C("Care instructions and warranty conditions apply.", attr("care"), "not_proven", "marketing-idiom",
    "THE COLLISION the `condition` exclusion was written to avoid, kept closed by requiring an " +
    "object after the verb. `conditions apply` has none. Without this case the transitive frame " +
    "reads as decorative and a later session widens it back to a bare word."),
  // -- v3.1, found by the INDEPENDENT pass, against the fix itself ------------
  C("Care instructions are printed on the hangtag, and a washing symbol guide is on our site.",
    attr("care"), "not_proven", "placeholder",
    "THE CLASS THE FIRST VERSION OF THE v3.1 FIX REOPENED, and the reason the rule is now " +
    "grammatical rather than positional. Clause-scoping the pointer frame and then accepting any " +
    "CARE_DIRECTIVE match in an unframed clause hands the guard a NOUN PHRASE: the pointer sits " +
    "before the comma and `washing symbol guide` sits after it. Four independent attackers found " +
    "nine sentences of this shape and a separate refuter re-executed every one. Closed by " +
    "requiring a framed sentence to carry an IMPERATIVE clause — verb first, base form — which " +
    "`washing`/`cleaning`/`seasoning` cannot satisfy because those are the deverbal nouns that " +
    "name a topic instead of giving an instruction.",
    undefined, { title: "Merino Crew", productType: "apparel" }),
  C("Care instructions are supplied with your order — washing guidance is on the label.",
    attr("care"), "not_proven", "placeholder",
    "Same class across a DASH rather than a comma, which is why the imperative rule is applied to " +
    "every boundary and not just the one the attackers happened to use. Without it, narrowing the " +
    "comma alone would have left this open and looked like a complete fix.",
    undefined, { title: "Merino Crew", productType: "apparel" }),
  C("Care instructions are included in the box, along with a cleaning cloth.",
    attr("care"), "not_proven", "bundled-item",
    "The bundled-accessory variant: the only care word belongs to a DIFFERENT ITEM in the box. " +
    "MUTATION ANCHOR for CARE_IMPERATIVE_CLAUSE — restore the plain CARE_DIRECTIVE test here and " +
    "this passes.",
    undefined, { title: "Merino Crew", productType: "apparel" }),
  C("Per the care instructions, sanitize the board with diluted vinegar weekly.",
    attr("care"), "pass_evidenced", "canonical-true",
    "THE RECALL ANCHOR for the same rule, and the reason a comma is still a boundary at all. This " +
    "is a real instruction introduced by a pointer frame, and it is the ONE shape of the nine " +
    "restored in CP0 that needs the comma. It is duplicated deliberately from the CP0 block: a " +
    "future tightening of the comma rule must fail here, next to the case that motivated it.",
    undefined, { title: "Oak Board", productType: "Cutting Boards" }),
  C("Care instructions: polish with the included beeswax balm.",
    attr("care"), "pass_evidenced", "canonical-true",
    "MUTATION ANCHOR for NOT re-testing CARE_REFERENCE inside an imperative clause. That extra " +
    "test looked like cheap safety and an independent pass measured it deleting ordinary " +
    "instructions, because the objects a care verb takes are exactly the frame's vocabulary — " +
    "`the INCLUDED balm`, `the PROVIDED oil`. A verb-initial clause is an instruction; what it " +
    "acts on does not change that.",
    undefined, { title: "10in Skillet", productType: "cookware" }),
  C("Read the care instructions and wash separately in cold water before first wear.",
    attr("care"), "pass_evidenced", "canonical-true",
    "MUTATION ANCHOR for ` and ` as a clause boundary. The pointer and the instruction share one " +
    "comma-less sentence, which no punctuation-only splitter can separate. Adding the conjunction " +
    "cannot reopen the noun-phrase class, because `and a washing symbol guide` fails the " +
    "imperative test either way — which is the property that makes this safe rather than lucky.",
    undefined, { title: "Merino Crew", productType: "apparel" }),
  C("Care instructions are below. Rinse in cool water and dry immediately.",
    attr("care"), "pass_evidenced", "canonical-true",
    "KNOWN GAP, and the measured price of having a `care` value guard AT ALL. The pointer and the " +
    "instruction are in DIFFERENT SENTENCES, and evidence is sentence-scoped by construction, so " +
    "no formulation of this guard can see both. The v3.0 guard fails it identically. It is " +
    "recorded rather than fixed because the alternative is no guard: the guard closes one measured " +
    "false positive on a real store plus twelve independently-confirmed pointer false passes, and " +
    "costs this one shape. Closing it needs cross-sentence scope, which is a different piece of " +
    "work and would touch every row, not just this one.",
    "not_proven", { title: "Merino Crew", productType: "apparel" }),
  C("Care instructions: follow the wash symbols printed on the label.",
    attr("care"), "not_proven", "placeholder",
    "CLAUSE SCOPING IS NOT THE SAME AS DELETING THE FRAME. Here the pointer (`follow`, `printed`) " +
    "and the care word (`wash`) are in the SAME clause, so the frame still governs and the row " +
    "correctly fails. If this ever passes, the fix has become a removal."),
];

// ---------------------------------------------------------------------------
// CLAIMS.
// ---------------------------------------------------------------------------
const CLAIMS: Case[] = [
  C("Certified gluten-free.", claimReq("gluten_free"), "pass_evidenced", "canonical-true", "A stated claim."),
  // MUTATION ANCHOR for MODIFIED_SUBJECT — the original Stage-3 TRAP shape, where
  // the claim term directly modifies a packaging noun and there is no finite verb
  // for the subject rule to work with. Also not subsumed by v2.5's subject rule.
  C("This fragrance-free packaging protects the bar.", claimReq("fragrance_free"), "not_proven", "packaging-subject",
    "`fragrance-free` modifies `packaging` directly. MODIFIED_SUBJECT reads the noun immediately " +
    "after the term, which is the one position the subject rule cannot reach here."),
  C("Our packaging is BPA-free.", claimReq("bpa_free"), "not_proven", "packaging-subject",
    "The Stage-3 TRAP the whole evidence module was written to prevent, still reachable: " +
    "`is BPA-free` puts the subject BEFORE the term, where MODIFIED_SUBJECT never looks."),
  C("The tube is BPA-free.", claimReq("bpa_free"), "not_proven", "packaging-subject",
    "Same shape; the container, not the contents.", "pass_evidenced"),
  C("Includes a vegan travel pouch for your gym bag.", claimReq("vegan"), "not_proven", "bundled-item",
    "The claim attaches to an included ACCESSORY. `Includes a …` is as clear a bundled-item marker " +
    "as exists, and nothing in CONTEXT_VETO reads it."),
  C("Made with inorganic mineral pigments.", claimReq("organic"), "not_proven", "substring-single-word-term",
    "`organic` is matched WITHOUT wholeWord (only attributes set that flag), so it matches inside " +
    "`inorganic` — a word that asserts the opposite."),
  C("Is this vegan? See our FAQ for the full ingredient list.", claimReq("vegan"), "not_proven", "question",
    "A QUESTION is not a statement. splitSentences breaks on `?`, so the question stands alone and " +
    "is rendered as the proof."),
  C("This product has no organic certification.", claimReq("organic"), "not_proven", "negation",
    "An explicit denial of the claim. `no` sits 1 char before `organic` so it is inside the " +
    "negation window, but `no` is not in the NEGATION alternation at all."),
  C("Our closest competitor is cruelty-free; we are still working on it.", claimReq("cruelty_free"), "not_proven", "competitor",
    "The claim belongs to a competitor and the sentence says so."),
  C("\"Love that it's fragrance-free!\" — a customer in Portland.", claimReq("fragrance_free"), "not_proven", "review-quote",
    "A customer's words are not the store's statement.", "pass_evidenced"),
  C("We believe fair trade should be the industry standard.", claimReq("fair_trade"), "not_proven", "marketing-idiom",
    "An aspiration, not a claim about this product.", "pass_evidenced"),
  C("Contains gluten-free rolled oats and almonds.", claimReq("gluten_free"), "pass_evidenced", "contrary",
    "The violating term `contains gluten` is a plain SUBSTRING of `contains gluten-free`, and the " +
    "violating list is checked FIRST — so a store stating the claim is told it states the opposite."),
  C("No added fragrance, ever.", claimReq("fragrance_free"), "pass_evidenced", "contrary",
    "`added fragrance` is a violating term and matches inside the support phrase `no added fragrance`."),

  // ── v3.1 CP2a — the gluten_free damage class, still live in a shipped built-in ──
  C("Tested on animals: never.", claimReq("cruelty_free"), "not_proven", "negation",
    "THE WORST CLASS OF FALSE PASS: a compliant store told its own copy states the OPPOSITE, with " +
    "that compliant sentence quoted as the proof. `tested on animals` is cruelty_free's only " +
    "violating term; `clauseBefore` sees nothing before it and POST_TERM_DENIAL wants a copular " +
    "predicate (`is not available`), so a bare post-term `never` reached neither. Closed by " +
    "LABEL_DENIAL — the term used as a LABEL whose value is a flat denial. The separator is " +
    "REQUIRED, which is what keeps it narrow."),
  C("Free of added fragrance.", claimReq("fragrance_free"), "not_proven", "negation",
    "The same defect on a second built-in, found by sweeping all nine claim keys that carry a " +
    "violating list rather than fixing the one that was reported. `free of` is an absence frame " +
    "the NEGATOR list never had."),
  C("This product is tested on animals.", claimReq("cruelty_free"), "not_proven", "canonical-true",
    "THE RECALL ANCHOR, and the reason CP2a is one-directional. A genuine violation must still be " +
    "reported as contrary — if this ever returns anything else, the denial forms have stopped " +
    "discriminating and the row has become unable to fail."),
  C("This oil is free of parabens and is 100% organic.", claimReq("organic"), "pass_evidenced", "canonical-true",
    "WHY `free of` IS NOT IN THE SHARED NEGATOR LIST. `isNegated` serves findSupport as well as " +
    "findViolation, and ` and ` without a comma is not a CLAUSE_BOUNDARY — so a shared frame would " +
    "reach `organic` and delete a real claim on ordinary copy. The frame is opted into by " +
    "findViolation alone, where an absence frame can only ever mean denial."),
  C("Cruelty-free — tested on animals: never.", claimReq("cruelty_free"), "pass_evidenced", "contrary",
    "MUTATION ANCHOR for the absence frames, and the reason the two cases above could not be one. " +
    "The damage this guard prevents lives in the DETAIL and the QUOTE (\"your copy states the " +
    "opposite\", quoting the compliant sentence), and the row's STATUS is not_proven either way — " +
    "so the corpus, which asserts status, could not see the guard working and the mutation proof " +
    "read it as decorative. Here the store ALSO states the claim, so suppressing the false " +
    "contradiction lets findSupport reach `cruelty-free` and the status genuinely flips. Same " +
    "corpus-hole shape v2.4 found in 4 of 12 guards: write the control case, keep the guard."),
  C("Free of parabens, this cream is cruelty-free but is tested on animals in China.",
    claimReq("cruelty_free"), "not_proven", "contrary",
    "MUTATION ANCHOR for anchoring ABSENCE_FRAME to the term, and a REGRESSION an independent pass " +
    "caught in the CP2a fix itself. `clauseBefore` is bounded by CLAUSE_BOUNDARY, which cuts on " +
    "neither a bare comma nor ` and `, so an unanchored `free of` reached a DIFFERENT substance " +
    "later in the sentence and suppressed a genuine violation. Sixteen sentences of this shape were " +
    "confirmed, and they are the commonest thing personal-care copy does: deny one ingredient, " +
    "admit another. The status flips because the sentence ALSO states the claim — suppress the " +
    "violation and findSupport passes it on `cruelty-free`, telling a store that tests on animals " +
    "that it is cruelty-free."),
  C("Our cruelty-free line is tested on animals: never by us, always by our EU distributor.",
    claimReq("cruelty_free"), "not_proven", "contrary",
    "MUTATION ANCHOR for LABEL_DENIAL's terminator. `X: never` is a denial only when nothing " +
    "follows it; here the denial is immediately qualified away and the sentence ADMITS the testing. " +
    "Without the terminator the violation is suppressed and the row passes on `cruelty-free`."),
  C("Gluten-free: never any wheat.", claimReq("gluten_free"), "pass_evidenced", "canonical-true",
    "The same asymmetry for the post-term form. Here `never` scopes over `wheat`, not over the " +
    "claim it follows, so applying LABEL_DENIAL on the support side would cost this pass."),
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
  // `policyStatus: readable` on the four below is load-bearing. Without it the row
  // correctly returns requires_store_access — we never read the shipping policy, so
  // we cannot say the store states nothing — and that masks whether the MATCHER did
  // the right thing. These cases are about the matcher, so the policy is made
  // readable to isolate it.
  C("We cannot guarantee delivery in 2 business days.", deliveryReq(), "not_proven", "negation",
    "An explicit refusal to state a window. findSupport iterated TERMS in list order, so " +
    "`business days` matched before `delivery in` was ever considered and the negation guard was " +
    "bypassed structurally.",
    undefined, { policyStatus: "readable" }),
  C("We do not offer next-day shipping.", deliveryReq(), "not_proven", "negation",
    "A denial of a delivery speed reported as stating one.",
    undefined, { policyStatus: "readable" }),
  C("Orders are not delivered within 3 business days during the holidays.", deliveryReq(), "not_proven", "negation",
    "Same term-order bypass: `business days` (3rd in the list) won over `delivered within` (10th).",
    undefined, { policyStatus: "readable" }),
  C("Is same-day shipping available?", deliveryReq(), "not_proven", "question",
    "A question rendered as the proof. In the live FAQ shape the ANSWER that denies it is never consulted.",
    undefined, { policyStatus: "readable" }),
  C("Ships in eco-friendly packaging, 100% recycled.", deliveryReq(), "not_proven", "packaging-subject",
    "requireDigit is satisfied by the `100` in `100%`, and MODIFIED_SUBJECT was one adjective wide. " +
    "Closed by the container-object rule: `ships in` + a wrapping noun is not a delivery window. " +
    "Note delivery SKIPS the subject-head rule (its subject legitimately is the shipment), so this " +
    "case is what proves the container-object half still applies there.",
    undefined, { policyStatus: "readable" }),

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

  // ── v3.1 CP2b — word boundaries on the timing matcher ─────────────────────
  C("Ships internationally to 40 countries.", deliveryReq(), "not_proven", "substring-single-word-term",
    "`findTimingSupport` never set `wholeWord`, so the term `ships in` matched inside `Ships " +
    "internationally` and the country count satisfied `requireDigit` — a delivery window rendered " +
    "from a sentence about geography. Every sibling matcher word-bounds its terms; this one, on the " +
    "engine's best-discriminating row, did not. Each term was checked for a legitimate substring " +
    "need before the change: only `shipping time` had one (the plural), which is now its own entry.",
    undefined, { policyStatus: "readable" }),
  C("Ships internationally, and the beans stay fresh for 6 months after roasting.",
    deliveryReq(), "not_proven", "substring-single-word-term",
    "MUTATION ANCHOR for the timing wholeWord flag, and it took THREE attempts. Each failure is " +
    "worth recording, because each is a way a control case can look right and prove nothing. " +
    "(1) \"Ships internationally to 40 countries.\" is the defect exactly as reported, and it is " +
    "useless here: the CP2c value guard rejects it first (a country count is not a duration), so " +
    "removing the boundary changes nothing. " +
    "(2) \"...our 6 month guarantee starts on delivery.\" clears the value guard but is dropped by " +
    "G-08's lint pre-filter before any matching happens, because `guarantee` is an unrenderable " +
    "word. The row returned not_proven for a reason with nothing to do with this guard. " +
    "(3) This one. `ships in` matches only inside `Ships internationally`; `6 months` is a real " +
    "duration, so the value guard passes; and the sentence is lint-clean. With the boundary " +
    "removed the row renders a SHELF-LIFE statement as proof of a delivery window; with it, the " +
    "row correctly finds nothing.",
    undefined, { policyStatus: "readable" }),
  C("Ships in (3-5) business days.", deliveryReq(), "pass_evidenced", "canonical-true",
    "RECALL ANCHOR for the CP2c value guard's number-to-unit gap, which the first version got " +
    "wrong. It required whitespace, and an independent pass confirmed SEVEN real windows deleted " +
    "over punctuation the merchant chose: `3-Business Days`, `10+ business days`, `1-2 wks.`, " +
    "`3 workdays`, `(3-5) business days`, `3-5 *business days*`, `7 to 10 days`. What refuses a " +
    "postcode is the absence of a TIME UNIT, never the spacing — conflating the two cost recall " +
    "on the row the engine can least afford to lose it on.",
    undefined, { policyStatus: "readable" }),
  C("Ships in 1-2 wks.", deliveryReq(), "pass_evidenced", "canonical-true",
    "The abbreviation half of the same finding. `wks`, `mos` and `workdays` were absent from the " +
    "unit list, so an abbreviated window read as no window at all.",
    undefined, { policyStatus: "readable" }),
  C("Delivery information: allow 7 to 10 days for your order to arrive.",
    deliveryReq(), "pass_evidenced", "surface-scoping",
    "KNOWN GAP, and an honest cost of CP2b rather than a defect it introduced. Production passes " +
    "this by matching the term `delivery in` INSIDE the word `Delivery information` — the same " +
    "substring accident that let `ships in` match inside `Ships internationally` and render a " +
    "geography sentence as a delivery window. The boundary cannot be added for one and not the " +
    "other. No listed term matches `7 to 10 days`, and the obvious repairs are worse: a bare " +
    "`days` term would pass `30 days to return`, and `delivery information` is a HEADING that " +
    "would pass `30 day returns` sitting under it. A missed finding is recoverable; a false " +
    "statement about a store is not.",
    "not_proven", { policyStatus: "readable" }),
  C("Shipping times: 3-5 business days.", deliveryReq(), "pass_evidenced", "canonical-true",
    "THE RECALL ANCHOR for the boundary change. `shipping times` is the commoner merchant spelling " +
    "and stopped matching inside itself once terms were bounded; without its own list entry this " +
    "class of finding silently disappears.",
    undefined, { policyStatus: "readable" }),

  // ── v3.1 CP2c — a digit is not a duration ─────────────────────────────────
  C("Our shipping times are listed on page 12 of the catalogue.", deliveryReq(), "not_proven", "placeholder",
    "A POINTER, with a page number carrying the digit requirement. Same shape as the ZIP code found " +
    "on a real store, and pinned separately because the postcode case could be dismissed as one " +
    "unlucky sentence — the class is `any digit at all, anywhere`.",
    undefined, { policyStatus: "readable" }),
  C("Most orders received after 2:00pm PST will ship the next business day.",
    deliveryReq(), "pass_evidenced", "canonical-true",
    "THE CASE THAT SHAPED THE GUARD. This states a real window IN WORDS, and the digit satisfying " +
    "`requireDigit` is a CLOCK TIME. A guard that demanded a number bound to a time unit — the " +
    "obvious design — would have deleted this and one other of the 55 passing delivery rows in the " +
    "172-store capture. Hence the worded arm. It is here so a future tightening has to fail a test " +
    "rather than a merchant.",
    undefined, { policyStatus: "readable" }),
  C("In stock items dispatch within 6-7 working days after payment has cleared.",
    deliveryReq(), "pass_evidenced", "canonical-true",
    "The intervening-modifier shape (`working`, `business`, `calendar`) that real policies write " +
    "between the number and the unit. Anchors the {0,2} word window in DURATION_NUMBER.",
    undefined, { policyStatus: "readable" }),
];

// ---------------------------------------------------------------------------
// v2.5 — DEFECTS FOUND BY THE FRESH ADVERSARIAL PASS OVER THE v2.5 FIXES.
//
// 517 probes across the four changed surfaces, each claim re-executed by an
// independent verifier. 41 confirmed, 15 of them false passes. The tractable ones
// were fixed in-session (post-term denial, the NEGATOR vocabulary, the violation
// containment rule, ambiguous place names). These are what remains — recorded here
// rather than left to be rediscovered.
//
// The honest summary of the class: `CLAUSE_BOUNDARY` is serving two incompatible
// jobs. The boundaries that stop a negation leaking forward onto an unrelated
// statement ("Our cups are not dishwasher safe, and they are made from stoneware.")
// are the same boundaries that stop it reaching a coordinated conjunct it genuinely
// governs ("We do not offer weekend pickup, or overnight shipping."). One boundary
// set cannot serve both. Fixing it needs scope, not another list.
// ---------------------------------------------------------------------------
const V25_FOUND: Case[] = [
  // --- FIXED in-session. These are also the mutation anchors for the four
  //     post-adversarial fixes; without them those guards read as decorative. ---
  C("Next-day shipping is not available.", deliveryReq(), "not_proven", "post-term-denial",
    "The pinned sibling (\"We do not offer next-day shipping.\") was fixed by the clause-scoped " +
    "negation, but `clauseBefore` only looks BACKWARDS — so the same denial with the words " +
    "reordered still passed, quoting the denial as its proof. `deniedAfter` closes that direction.",
    undefined, { policyStatus: "readable" }),
  C("Nothing in this jacket is made from wool.", attr("materials"), "not_proven", "negator-vocabulary",
    "`nothing` is the commonest total denial in DTC copy and the cruellest miss: `not` is visibly " +
    "inside it, but the word bound rejects the substring. A 41-phrase sweep found 21 such misses; " +
    "the NEGATOR alternation now carries the measured set."),
  C("This is a non-vegan product made with beeswax.", claimReq("vegan"), "not_proven", "violation-containment",
    "The overlap rule that fixed \"contains gluten-free\" backfired here: `vegan` sits INSIDE " +
    "`non-vegan`, so the violation was discarded and the fragment passed. A support match now only " +
    "cancels a violation when it EXTENDS BEYOND it."),

  C("We do not offer weekend pickup, or overnight shipping.", deliveryReq(), "not_proven", "negation-coordination",
    "English negation DISTRIBUTES over a coordination, so the second conjunct is denied too. But " +
    "`, or ` is a clause boundary, so the negator is not in the term's clause and the denial reads " +
    "as a stated delivery speed. Removing the comma correctly returns not_proven.",
    "pass_evidenced", { policyStatus: "readable" }),
  C("We do not guarantee the following: delivery in 2 business days.", deliveryReq(), "not_proven", "negation-colon",
    "⚠️ CLOSED IN v3.0 CP2 BY ACCIDENT, AND THE REASON MATTERS MORE THAN THE FACT. The negation " +
    "logic is UNCHANGED. This sentence now returns the honest answer only because it contains the " +
    "word `guarantee`, which the claim linter forbids, so v3.0's new lint pre-filter drops it from " +
    "delivery's evidence before matching. Nothing about the colon-boundary defect was repaired. The " +
    "sibling case below carries the identical shape WITHOUT a linter word and still false-passes — " +
    "keep both, or a future session reads this row as 'negation-colon fixed' and deletes a guard " +
    "that was never doing this work.",
    undefined, { policyStatus: "readable" }),
  C("We do not offer the following: delivery in 2 business days.", deliveryReq(), "not_proven", "negation-colon",
    "THE REAL CLASS, pinned with a sentence the linter has no opinion about. `[;:]` is an " +
    "unconditional boundary, so any colon between the negator and the term resets the clause and " +
    "the denial reads as a stated delivery speed. Executed siblings that also still pass: " +
    "\"What we don't do: delivery in 2 business days.\" and \"Services we no longer provide: " +
    "delivery in 2 business days.\" — the ordinary FAQ and spec-label shapes the original case named.",
    "pass_evidenced", { policyStatus: "readable" }),
  C("We don't offer this in blue, or in a 16 oz size.", attr("dimensions"), "not_proven", "negation-coordination",
    "The same coordination reset on the dimensions row. It fires only when the second conjunct " +
    "carries a FRESH occurrence of a list term, which makes it silent and shape-dependent.",
    "pass_evidenced"),
];

// ---------------------------------------------------------------------------
// v2.8 — found by the fresh adversarial pass over the CP1/CP2 surfaces.
//
// This one was found while attacking `origin`, and it OUTLIVED the origin removal:
// `nonProductSubject` is shared by every requirement, so the hole is general. It is
// recorded here rather than lost with the requirement that exposed it.
// ---------------------------------------------------------------------------
const V28_FOUND: Case[] = [
  // --- the two false positives the v2.8 FITNESS run found on real stores ---------
  // Both reproduce byte-identically at 44fd4e0, so neither was introduced by v2.8.
  // They are the first defects this project has found by measuring real merchant
  // copy rather than by attacking the matcher: v2.3 (37 rows) and v2.5 (18 rows)
  // both reported zero, and both were too small to reach these shapes.
  C("Each serving contains 12 grams of protein.", attr("dimensions"), "not_proven", "usage-quantity",
    "A NUTRITION quantity, not the product's size, capacity, weight or fit. `grams` is a dimensions " +
    "term and MEASUREMENT is satisfied by any number bound to a unit, so a nutrient measured INSIDE " +
    "the product reads as a measurement OF the product. Found on a real store, which was told its " +
    "measurements are stated on the strength of a protein-content sentence. Same root as the pinned " +
    "\"Steep in 8 oz of hot water for 3 minutes.\", but that case is a usage instruction and this is " +
    "product content, so the shape a fix has to cover is wider than the existing case shows. " +
    "CLOSED v2.9 CP1: every measurement occurrence is now judged in its own window, and a nutrient " +
    "noun in the `of …` complement vetoes that occurrence while leaving any genuine size in the same " +
    "sentence free to pass."),
  C("A gift bundle of our house blends.", claimReq("organic"), "not_proven", "surface-scoping",
    "The product copy makes NO organic claim. The pass comes entirely from the SHIPPING POLICY, whose " +
    "text carries the store's own SEO page title (\"…: Organic Loose Leaf Teas…\"). Two mechanisms " +
    "compound: attribute rows filter `shipping_policy` out of their evidence (productTest.ts) and " +
    "CLAIM rows do not, so a claim about the product can be proven from a document about orders; and " +
    "the policy fold-in carries nav/SEO chrome, which is precisely what the product-surface rule " +
    "exists to keep out. The merchant is told \"Organic — stated in your shipping policy\" with NO " +
    "quote, because presentableQuote rejects the chrome it matched on. " +
    "CLOSED v2.9 CP1 by BOTH halves: claim rows now apply the same product-surface filter the " +
    "attribute rows always did, and `htmlToBlockText` drops <head>/<nav>/<footer> and segments the " +
    "policy document so its chrome can no longer arrive as a sentence at all.",
    undefined,
    { evidence: [
      { surface: "product_description", text: "A gift bundle of our house blends." },
      { surface: "shipping_policy", text: "Shipping policy Sennen Tea: Organic Loose Leaf Teas, Tea Bags & Tea Gift Free Shipping over $60." },
    ] as never }),

  // ── v2.9 — the must-pass anchors for the positional quantity guard ─────────
  // These exist because the guard's FIRST draft broke them while its own comment named
  // the first one as a sentence that "must still pass". `grep` for it found exactly one
  // hit — the comment. No test, no corpus entry, and all 157 tests passed. A rule stated
  // only in a comment is not a rule, so it is stated here instead.
  //
  // The mechanism: the forward window was a raw 60-char slice, so a nutrient belonging to
  // a SECOND measurement vetoed the FIRST one. These are the "16oz bottle / 12 oz bag"
  // shapes testEvidence.ts documents as how a beverage or coffee store states its size.
  C("Each 12 oz bag contains 8 g of protein.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "States a real pack size AND a nutrient. The size is the product's own extent, so the row is " +
    "true however the nutrient reads — the nutrient veto must attach to ITS OWN measurement only."),
  C("This 16 oz bottle contains 25 g of sugar.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "Same shape, and `sugar` is both a nutrient and a product, which is why the veto has to be " +
    "positional rather than a whole-sentence keyword test."),
  C("Each 750 ml bottle is 12% ABV.", attr("dimensions"), "pass_evidenced", "canonical-true",
    "750 ml is the bottle's volume. `abv` sits three tokens away, outside the complement window."),

  // ── v2.9 CP4 — the ONE false positive the 172-store measurement found ──────
  C("If you follow our easy care instructions, we'll help out if anything goes wrong within three years from your date of purchase.",
    attr("care"), "not_proven", "marketing-idiom",
    "The sentence REFERS to care instructions; it does not state any. A buyer asking how to " +
    "look after this learns nothing, so the row's claim that care instructions are stated is " +
    "false. Found on a real cookware store in the v2.9 audit of 506 pass rows — the only " +
    "confirmed false positive in that sample. The mechanism was that `care` had NO valueGuard: " +
    "`materials` requires a MATERIAL_NOUN and `dimensions` requires a real measurement, but the " +
    "care terms match their own name, so a warranty sentence mentioning the phrase passed. " +
    "CLOSED in v3.0 CP1 by `statesCareInstruction` — the sentence carries no care ACTION at all, " +
    "so it is closed by the CARE_DIRECTIVE half and would also be closed by CARE_REFERENCE " +
    "(`follow`). The class, not the instance, is what the guard is designed to: see the four " +
    "sibling cases in the CARE block.",
    undefined, { title: "Ceramic Pan", productType: "Cookware" }),

  // ── v3.0 CP5 — the two false passes found by RUNNING A PUBLISHED STANDARD ──
  // Both were found by auditing all 43 pass_evidenced rows from Coffee Standard v1.0
  // executed against 25 real coffee stores. Both are PRE-EXISTING — nothing in v3.0
  // touches timing matching or quantity aboutness — and neither appeared in the v2.9
  // audit of 507 rows across 172 general-sample stores. That is the finding behind the
  // finding: a CATEGORY-SCOPED sample surfaces defects a general sample does not, so
  // the v2.9 bound is a floor rather than an estimate.
  C("Shipping times vary depending on your proximity to our Los Angeles origin zip code: 90038.",
    deliveryReq(), "not_proven", "marketing-idiom",
    "THE SENTENCE STATES NO WINDOW — it says times VARY. The row claims a dispatch or " +
    "delivery window is stated, and a shopper reading this learns nothing about when their " +
    "coffee arrives. MECHANISM, isolated by a minimal pair: `shipping times` is a " +
    "TIMING_TERMS_NEEDING_DIGIT term, and the only digits in the sentence are a ZIP CODE. " +
    "Strip them (\"…proximity to our origin.\") and the row correctly returns not_proven, so " +
    "the postcode alone is carrying the pass. `requireDigit` asks that SOME digit exists — " +
    "the identical weakness that let \"Available in 3 colors\" satisfy a measurement before " +
    "`dimensions` got a valueGuard. Found on a real store.\n" +
    "CLOSED in v3.1 CP2c by `statesDeliveryWindow`: the number must be bound to a time unit, " +
    "or the sentence must state a worded window (\"the next business day\"). The worded arm is " +
    "not decoration — 2 of the 55 passing delivery rows in the 172-store capture state their " +
    "window in words and satisfy `requireDigit` only by accident, on a CLOCK TIME (\"after " +
    "2:00pm PST\"). A digit-only guard would have deleted both. The guard was written against " +
    "all 55 real quotes rather than in the abstract, and the replay confirms it costs none.",
    undefined, { policyStatus: "readable" }),
  C("For 4 ounces water and 4 ounces ice.", attr("dimensions"), "not_proven", "usage-quantity",
    "A BREWING RECIPE quantity read as the product's own measurement. Found on a real coffee " +
    "store whose product copy embeds an iced-coffee method; the row quoted the water and ice " +
    "amounts as proof that the bag's weight is stated. `nonProductQuantity` already vetoes " +
    "this class through USAGE_VERB — \"Brew with 8 ounces of water.\" and the pinned \"Steep " +
    "in 8 oz of hot water\" both correctly fail — but the veto needs a VERB, and a bare " +
    "preposition introduces the same quantity with nothing to match. The gap is the frame, " +
    "not the concept, which is why it is pinned rather than patched with one more word: a " +
    "term added to a veto list without an adversarial pass is how v2.9's `case` regression " +
    "reached a real watch store.",
    "pass_evidenced"),

  // ── v2.9 CP2 — THE OWED MUTATION ANCHOR, now closed ────────────────────────
  // Removing `origin` in v2.8 deleted the only corpus case that failed when
  // `termMatches`'s longest-match-first sort was reverted, so the mutation proof
  // reported that guard DEAD while it remained load-bearing. This is the replacement,
  // and it is natural rather than constructed: a combinatorial sweep of 198,744
  // rank-flipping term pairs found 78,472 status divergences, of which this is the
  // clearest. Mechanism — the sentence carries two composition terms at different
  // positions, `% recycled` at 18 and `made of` at 94:
  //   longest-first  → picks `% recycled`, whose 18-char prefix puts the packaging
  //                    subject inside SUBJECT_BEFORE_VETO's 48-char reach → vetoed.
  //   sort removed   → picks `made of` at 94, prefix now 81 chars, the veto cannot
  //                    reach the subject → pass_evidenced, quoting a sentence that is
  //                    entirely about the packaging (the Stage-3 TRAP).
  C("Our packaging: 100% recycled kraft, printed with soy ink, folded by hand and sealed with tape made of cornstarch.",
    attr("materials"), "not_proven", "packaging-subject",
    "Every clause is about the PACKAGING; the store never says what the product is made of. The " +
    "packaging clause has no finite verb, so `nonProductSubject` has no subject span to read — " +
    "SUBJECT_BEFORE_VETO is the only guard that reaches it, and it only reaches the term that " +
    "`termMatches`'s longest-first sort selects. This case is the mutation anchor for that sort."),

  // ── v2.9 — DELIBERATELY LEFT OPEN, with the reason ────────────────────────
  // Both are head-noun problems: telling them apart needs to know whether the measured
  // substance IS the product, which no term list can decide. `origin` was removed after
  // three attempts at exactly that shape, so these are pinned rather than guessed at.
  C("A 500 ml refill pouch is included.", attr("dimensions"), "not_proven", "bundled-item",
    "The capacity of a BUNDLED item, not the product. `nonProductQuantity` closed the usage, " +
    "nutrition, dose, density and pack-weight classes, but bundled-component capacity needs the " +
    "existing BUNDLED_SUBJECT rule in subject.ts, which handles a leading marker (\"Comes with a " +
    "500 ml jar\") and not a trailing one (\"… is included.\"). 15 of the 21 surviving false passes " +
    "in the independent 412-probe set are this shape.",
    "pass_evidenced"),
  C("Formulated with 2 grams of salicylic acid.", attr("dimensions"), "not_proven", "usage-quantity",
    "An INGREDIENT concentration, not the product's size. Structurally identical to the canonical " +
    "TRUE \"Each tin contains 250 g of loose leaf tea.\" — same frame, same `<n> <unit> of <noun>` " +
    "shape, opposite answer — and the only thing separating them is whether the noun IS the product. " +
    "That is a head-noun judgement, the class `origin` was removed for failing three times. Not " +
    "attempted; 6 of the 21 surviving false passes are this shape.",
    "pass_evidenced"),

  C("Most cheap versions are made from thin stamped steel.", attr("materials"), "not_proven", "competitor",
    "A COMPETITOR's composition, credited to this product and quoted as its proof. `subject.ts`'s " +
    "comparative veto is `most (other )?\\w+ (are|use|come)`, which tolerates exactly ONE word between " +
    "`most` and the verb — so `Most competitors are …` is correctly vetoed and any TWO-word noun " +
    "phrase (`cheap versions`, `budget models`) walks straight through. Shape-dependent and therefore " +
    "silent. The dimensions row has the identical hole: `Most cheap versions are 12 oz at most.` passes.",
    "pass_evidenced"),
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
  ["materials", MATERIALS], ["dimensions", DIMENSIONS],
  ["care", CARE], ["claims", CLAIMS], ["delivery", DELIVERY], ["v2.5-found", V25_FOUND],
  ["v2.8-found", V28_FOUND],
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
  // v2.4 opened at 65.
  // v2.5 CP1 closed 21 mechanical defects (term-order first-match-wins, substring
  //         collisions, capitalisation-as-place, interrogatives)            -> 44
  // v2.5 CP2 closed 19 aboutness defects by reading the SUBJECT (subject.ts) -> 25
  // v2.5 fresh adversarial pass ADDED 6 newly-found gaps (V25_FOUND)          -> 31
  //         (517 probes, 41 confirmed, 15 false passes; 11 were fixed in-session,
  //          these 6 are what remains and they are NOT accepted behaviour)
  // v2.6/v2.7 closed nothing: three headline changes were built, each measured as a
  //         success by its author, and each reverted after an independent
  //         adversarial pass contradicted it.                                 -> 31
  // v2.8 CP1 closed 1 dimensions recall gap (intervening `12 fl oz`) and ADDED 1
  //         newly-found gap (`12 fl. oz.` — a sentence-splitting limit the change
  //         made visible, not one it caused).                                 -> 31
  //         A hyphen branch closing `12-oz` was built, measured by its author as
  //         clean, and withdrawn when 334 independent probes attributed four
  //         false-pass mechanisms to it.
  // v2.8 CP2 REMOVED the `origin` requirement, which DELETED 3 gaps.           -> 28
  // v2.8     +1 newly-found gap: the shared comparative veto in subject.ts.    -> 29
  //
  // ⚠️ READ THE -3 CORRECTLY. Those three defects were not fixed; the feature that
  // carried them no longer ships, so they became unreachable. Counting a removal as
  // three repairs is exactly the kind of flattering arithmetic this session exists to
  // stop. The only gap genuinely CLOSED by engineering this session is `12 fl oz`.
  // v2.8 CP4 the FITNESS run over 35 real stores found 2 confirmed false positives,
  //         both pre-existing (byte-identical at 44fd4e0). Pinned.               -> 31
  //
  // v2.9 CP1 CLOSED 3 BY ENGINEERING — the two production false positives, plus the
  //          usage-quantity gap the nutrition one generalised:
  //            · "Steep in 8 oz of hot water for 3 minutes."   (usage quantity)
  //            · "Each serving contains 12 grams of protein."  (nutrition quantity)
  //            · "A gift bundle of our house blends."          (policy-chrome claim)
  //          and ADDED 2 that the independent probe sets found and this session
  //          deliberately did NOT attempt, both head-noun problems of the class
  //          `origin` was removed for failing three times:
  //            · "A 500 ml refill pouch is included."          (bundled capacity)
  //            · "Formulated with 2 grams of salicylic acid."  (ingredient conc.)
  //                                                                             -> 30
  // v2.9 CP4 the 172-store measurement found ONE false positive (a warranty sentence
  //          referring to care instructions rather than stating any). Pinned, not fixed.
  //                                                                             -> 31
  // v3.0 CP1 the `care` valueGuard CLOSED three: that warranty sentence, the pointer
  //          "Full care instructions are included in the box.", and the placeholder
  //          "Care instructions: TBD." All three ran through the one term that names
  //          the category without giving a member of it.
  //                                                                             -> 28
  // v3.0 CP1 the independent adversarial pass (1,145 probes, 53 claims, 53/53
  //          adjudicated by separate refuters) measured a RESIDUAL class the guard
  //          claims but does not close: a pointer whose only care word is a deverbal
  //          noun. Pinned with its natural-frequency measurement and the reason it is
  //          not narrowed. It is NOT a regression — the A/B against b8a1fff^ found
  //          zero status changes across all 53 claims.
  //                                                                             -> 29
  // v3.0 CP5 running Coffee Standard v1.0 against 25 real coffee stores and auditing
  //          all 43 pass rows found TWO false passes, both pre-existing and neither
  //          seen in the v2.9 general sample: a ZIP CODE satisfying delivery's
  //          requireDigit, and a brewing-recipe quantity read as the product's weight.
  //                                                                             -> 31
  // 31 -> 30: v3.1 CP2c closed the ZIP-code delivery false pass. A gap count that
  // only ever rises is a backlog; this is the second direction the corpus asserts in.
  // 30 -> 32: and then it rose, which is the honest record of a trade rather than a
  // clean win. Both new gaps are FALSE FAILS accepted to close FALSE PASSES, and both
  // are named at their case: a care instruction in the sentence AFTER its pointer, and
  // a delivery window whose only match in production was a substring accident.
  const EXPECTED_OPEN_GAPS = 32;
  assert.equal(
    gaps.length, EXPECTED_OPEN_GAPS,
    `open gaps changed (${gaps.length} vs ${EXPECTED_OPEN_GAPS}).\n${gaps.join("\n")}`,
  );
});

test("the corpus covers every requirement kind that can produce a false pass", () => {
  const kinds = new Set(ALL.flatMap(([, cs]) => cs.map((c) => c.requirement.attribute ?? c.requirement.kind)));
  // `origin` is deliberately absent: the requirement was removed in v2.8 CP2, and the
  // pin for it is structural (it must never be ASKED) rather than a set of cases.
  for (const k of ["materials", "dimensions", "care", "claim", "delivery"]) {
    assert.ok(kinds.has(k), `no adversarial coverage for ${k}`);
  }
  assert.ok(IDENTIFIERS.length >= 15, "identifiers coverage is too thin to be meaningful");
});
