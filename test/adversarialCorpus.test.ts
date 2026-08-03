import { test } from "node:test";
import assert from "node:assert/strict";
import type { AssertionStatus, Requirement } from "../src/server/productTest.js";
import {
  statusOf, verdictOf, requirementsFor, mkExtracted, verdictOfIds, verdictOfLd, verdictOfPage,
  attr, claimReq, deliveryReq, idsReq, priceReq, stockReq, type HostileClass, type MkOptions,
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
  // --- v3.2 CP1c: the term is a DIFFERENT SENSE of the word ---
  C("The farm's volcanic soils are described as rich in organic matter, while narrow canyons channel warm winds through the surrounding landscape.",
    claimReq("organic"), "not_proven", "different-sense-compound",
    "A SOIL-SCIENCE SENTENCE RENDERED AS A CERTIFICATION CLAIM. Measured on a real coffee store " +
    "(hydrangea.coffee, CERT-001). `organic` is matched whole-word, which is what stops " +
    "`inorganic` — and nothing stopped `organic matter`.\n" +
    "This is a THIRD veto shape, which is why SENSE_SHIFT is its own list rather than more nouns " +
    "in MODIFIED_SUBJECT. There the term keeps its meaning and attaches to the wrong thing " +
    "(\"aluminum-free PACKAGING\" is a true claim about the box). Here the compound changes what " +
    "the word MEANS: organic matter is not a weaker organic claim, it is not an organic claim.\n" +
    "⚠️ SENSE_SHIFT closed this and was REVERTED — 98 measured regressions, the worst of any guard " +
    "this session. `reach` is a homograph of the EU chemicals regulation (\"BPA-free, REACH " +
    "compliant\") and of the commonest closing clause in DTC copy (\"reach out with any " +
    "questions\"); `growth` is a product BENEFIT (\"certified organic growth serum\"); `chemistry` " +
    "is ordinary beauty copy; `compounds` is the FDA's own wording for an antiperspirant active, " +
    "so it broke the VIOLATION path — a store that states the violating claim was reported silent, " +
    "and status-only comparison cannot see that because both answers are not_proven. It did not " +
    "close the class either: one adjective (\"organic plant matter\") or one synonym (\"organic " +
    "material\") walks past it. Adjacency is not headship.",
    "pass_evidenced"),
  C("The soil is high in organic compounds.", claimReq("organic"), "not_proven", "different-sense-compound",
    "Same sense shift, chemistry rather than soil science. Kept as a separate gap because the fix " +
    "for it is exactly what broke \"Contains aluminum compounds for all-day protection.\" — the " +
    "FDA's own wording for an antiperspirant active, on the VIOLATION side.",
    "pass_evidenced"),
  C("Made from organic beans.", claimReq("organic"), "pass_evidenced", "different-sense-control",
    "THE CONTROL THE MUTATION PROOF NEEDS. A guard whose removal breaks nothing reads as " +
    "decorative; this is the case SENSE_SHIFT must NOT touch. `beans` is not in the list and must " +
    "never be — an over-wide sense list deletes the commonest true organic claim a roaster makes."),
  C("Made from organic materials.", claimReq("organic"), "pass_evidenced", "different-sense-control",
    "⚠️ `material(s)` IS DELIBERATELY ABSENT from SENSE_SHIFT and this case is why. It is the " +
    "nearest miss to `matter` in the whole English list and it is a REAL product claim. Nothing " +
    "enters that list that has a second reading on a product page."),
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
    "reached a real watch store.\n" +
    "⚠️ v3.2 ATTEMPTED THIS AND REVERTED IT, and the attempt is the most useful thing anyone " +
    "has learned about this gap. RECIPE_FRAME + RECIPE_SUBSTANCE closed this sentence and the " +
    "second brewing sentence on the same store. A 216-store replay then reported ZERO real " +
    "positives lost — and two independent attackers, re-executed mechanically against the " +
    "parent commit, found 192. The frame reaches any price near a substance " +
    "(\"Our 16 oz water bottle sells for 19.99.\"); the substance reaches every stock pot, " +
    "milk frother, ice cream scoop and water-resistant shell. It also does not close the " +
    "CLASS: \"Pour 6 oz of hot water over the grounds.\" still passes, because USAGE_VERB " +
    "lists steep/brew/dissolve and coffee copy says pour, heat, fill, boil, bloom.\n" +
    "The gap is the FRAME, and a frame is not a word list. Do not attempt a fourth veto term.",
    "pass_evidenced"),
  // --- v3.2 CP1b: the minimal pairs that force the guard to stay conjoined ---
  C("Rated for 300 lbs.", attr("dimensions"), "pass_evidenced", "usage-quantity-control",
    "THE FRAME ALONE IS NOT ENOUGH, and this is the case that proves it. `for <number>` is " +
    "also how a product states a weight capacity. If RECIPE_FRAME ever fires without the " +
    "substance complement, this real positive dies."),
  C("The pitcher holds 12 oz milk.", attr("dimensions"), "pass_evidenced", "usage-quantity-control",
    "THE SUBSTANCE ALONE IS NOT ENOUGH. A vessel's capacity is stated in terms of what it " +
    "holds, so a consumable complement is ordinary product copy on any drinkware store."),
  C("A 32 oz water bottle for everyday carry.", attr("dimensions"), "pass_evidenced", "usage-quantity-control",
    "The hardest of the three: it contains the substance AND the word `for`. It survives only " +
    "because `for` is not followed by a digit. A looser frame deletes a product name."),
  C("One ounce of water by volume weighs 1 ounce, so it's easy to weigh the ice and then measure the water by volume.",
    attr("dimensions"), "not_proven", "usage-quantity",
    "THE SECOND BREWING SENTENCE ON THE SAME REAL STORE, and it is here because of HOW it was " +
    "found. Closing the bare-preposition frame moved groundsforchange.com's pass from one " +
    "brewing sentence to ANOTHER in the same copy — the row still passed, on a different quote. " +
    "A status-only diff called that closed. Only comparing the RENDERED QUOTE showed it was not.\n" +
    "SUBSTANCE_WEIGHED closed it and was REVERTED: mechanically re-executed against the parent " +
    "commit it carried 45 regressions of its own, because `stock`, `ice`, `cream` and `water` " +
    "are product words. \"Our stock pot measures 10 inches across.\" is the commonest cookware " +
    "SKU there is, and \"Water-resistant shell measures 28 inches\" loses to a hyphen the vessel " +
    "lookahead cannot see. Kept as a measured gap.",
    "pass_evidenced"),
  C("Our water bottle weighs 12 oz.", attr("dimensions"), "pass_evidenced", "usage-quantity-control",
    "THE CONTROL FOR SUBSTANCE_WEIGHED, and the reason it carries a negative lookahead. A brew " +
    "substance sits within a few words of `weighs` here too — but it MODIFIES a container that " +
    "is the product. Only an unmodified substance counts."),
  C("The kettle measures 8 inches across.", attr("dimensions"), "pass_evidenced", "usage-quantity-control",
    "Same shape, `measures` rather than `weighs`, and the substance word is absent entirely — " +
    "pinned so a future widening of the verb list has something to break."),
  // --- v3.2 CP1a: a serving size read as the product's own weight ---
  C("Based on a standard 6oz serving.", attr("dimensions"), "not_proven", "serving-size-quantity",
    "A SERVING SIZE READ AS THE PRODUCT'S WEIGHT. Found on a real coffee store (WEIGHT-001) " +
    "in the form \"…contain approximately 210mg of caffeine … based on a standard 6oz serving " +
    "when brewed following package instructions.\"\n" +
    "⚠️ THE PUBLISHED DIAGNOSIS WAS WRONG. The v3.1 writeup and the v3.2 brief both say this " +
    "survives because \"NUTRIENT does not carry caffeine\". It does, since d730ea2 — before " +
    "the commit serving production — and \"Contains 6oz of caffeine.\" already failed. " +
    "Executing the sentence rather than reading the source found the real cause: the nutrient " +
    "is sought in the measurement's own complement, and here it is 45 characters away on a " +
    "different quantity.\n" +
    "⚠️ SERVING_HEAD closed this and was REVERTED — 23 measured regressions. Its protection was " +
    "a closed list of serveware nouns (bowl, board, platter, tray…) and such a list can never be " +
    "complete: pitcher, jug, cup, glass, carafe, mug, crock, tureen, ramekin, basket, vessel and " +
    "cone all died, as did every `dose bottle` and `portion container`. Same shape as the " +
    "head-noun rule v2.8 removed from `origin` after four attempts — a closed list used as the " +
    "PROTECTOR fails open in the damaging direction.",
    "pass_evidenced"),
  C("Acacia serving board, 18 inches long.", attr("dimensions"), "pass_evidenced", "serving-size-control",
    "`serving` IS A PRODUCT WORD on any kitchen store. This is why SERVING_HEAD requires the " +
    "noun to be THIS measurement's complement rather than adding \"a\" to PER_SERVING's " +
    "quantifier list — here the measurement is `18 inches` and `serving` is nowhere near it."),
  C("Stoneware serving bowl, 9 inches across.", attr("dimensions"), "pass_evidenced", "serving-size-control",
    "Same class, different vessel. Pinned separately because `bowl` and `board` reach different " +
    "arms of the negative lookahead."),
  C("A 12 oz serving bowl in matte glaze.", attr("dimensions"), "pass_evidenced", "serving-size-control",
    "THE ONE SHAPE WHERE THE CONSUMPTION NOUN IS GENUINELY ADJACENT to the measurement — " +
    "because it modifies a vessel, which is the thing being sold. The negative lookahead in " +
    "SERVING_HEAD exists for this sentence and nothing else."),

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
// v3.7-FOUND — from the first COMPLETE row-by-row audit of the general sample.
//
// 488 pass rows over 172 real stores, every one adjudicated individually and every
// confirmed defect re-executed against the raw captured bytes. 18 confirmed, where the
// published figure recorded ZERO — because that zero came from checking ONE class.
//
// ⚠️ AND ONLY THREE OF THE SEVEN CLASSES CAN BE PINNED HERE AT ALL. This corpus probes
// `evaluate` — the matcher. Four of the seven live UPSTREAM of it, in
// `fetchPublicProduct` / `priceToUsd`, where the product is normalised before any
// requirement sees it:
//
//   • a non-USD price rendered with a "$"  — `PublicProduct` has no currency field, so
//     the defect is structurally unrepresentable in this file;
//   • integer CENTS read as dollars        — `priceToUsd`'s guard, `p > 1000 &&
//     isInteger(p)`, before `minPriceUsd` exists;
//   • a MISSING `available` field defaulted to purchasable — `v.available !== false`
//     resolves the absence into a `true` that reaches `evaluate` indistinguishable
//     from a stated one;
//   • "lowest readable price" that is the page's MAXIMUM — the JSON-LD-offer fallback
//     when no variant list was reached.
//
// So the corpus count rises by 3 and the honest reading is NOT "4 defects went
// unrecorded". It is that **the fetch and normalisation layer has no adversarial corpus
// at all**, and this is the first measurement that needed one. Filed as ENGINE_GAPS
// P-17 with the numbers rather than fixed here — this session designs nothing.
// ---------------------------------------------------------------------------
const V37_FOUND: Case[] = [
  C("Looking for a smaller size? Try our 1/2lb. Cocoa Nib Pouch.", attr("dimensions"), "not_proven", "bundled-item",
    "askinosie.com, reproduced from its captured bytes. The ONLY quantity in the quoted structured " +
    "data is a SIBLING SKU's size, reached by a cross-reference link, while the product under test is " +
    "the 1lb. The merchant is shown another product's weight as proof that this one states its own. " +
    "`bundled-item` is the least-wrong existing class and is not exact — a cross-sell is not in the " +
    "box — which is itself a coverage note: this corpus has no cross-sell class.",
    "pass_evidenced"),

  C("", priceReq(10), "requires_store_access", "placeholder",
    "$0.00 IS NOT A PRICE, and five real stores are told it is: knifewear.com (a Shopify `Referral` " +
    "record), kosas.com (`GWP`, template_suffix `gwp`, compare_at 26.00), partakefoods.com, " +
    "studioneat.com (whose own title is SYDNEY TEST PRODUCT) and tenthousand.cc (a real garment with " +
    "18 GS1 barcodes and a masked price), plus branchbasics.com's `unsearchable` fulfillment stub. " +
    "`price_under` compares `minPriceUsd < capUsd` and 0 is below every cap, so the row passes and " +
    "renders `Lowest readable price is $0.00.` The honest answer is the one the branch beside it " +
    "already gives when no price is exposed at all: requires_store_access. Three further stores " +
    "(puracy, supergoop, voluspa) publish a deliberate 0.00 free gift and were adjudicated BORDERLINE, " +
    "counted as passes — which is why the fix is a decision about zero and not a filter on it. " +
    "CLOSED v4.5: `zeroAwareMin` refuses at the constructor and `evaluate` re-tests the zero at the " +
    "branch that renders. ⚠️ THE SECOND GUARD IS WHAT MAKES THIS CASE MEAN ANYTHING — it hands " +
    "`evaluate` a `minPriceUsd: 0` DIRECTLY, a value the constructor can no longer produce, so with " +
    "only the constructor fixed this case would have gone on asserting `pass_evidenced` and the gap " +
    "count would still have reported P-19 open. An independent verifier found that; the case was " +
    "vacuous with respect to its own fix, which is v3.4's lesson understating the work this time.",
    undefined, { minPriceUsd: 0 }),

  C("", stockReq(), "not_proven", "surface-scoping",
    "lesserevil.com, reproduced from its captured bytes. JSON-LD says `InStock`; the page's own inline " +
    "product object says `\"available\":false` and nothing anywhere on the page says true. LD wins by " +
    "the documented precedence (structured data -> variants), so a sold-out product is reported in " +
    "stock and the merchant is told their own data is wrong by omission. The precedence is deliberate " +
    "and defensible; what has no answer is a CONTRADICTION between the two surfaces, which the order " +
    "resolves silently instead of reporting. Note this case is reachable here only because the variant " +
    "list can be handed in already resolved — the sibling defect (a MISSING `available` field defaulted " +
    "to purchasable on kytebaby.com, two rows) happens in the fetch layer and cannot be expressed.",
    "pass_evidenced", { ldAvailability: "InStock", variants: [{ title: "Default", priceUsd: 12, available: false, options: ["Default"] }] }),
];

// ---------------------------------------------------------------------------
// IDENTIFIERS — fixed this session; these lock the fix in.
//
// v3.5 CP2a added `actual` and `detail` here. `actual` exists for the same reason it
// exists on a Case: an identifier defect the engine has and the standard names is a
// DEBT WITH A RECEIPT, and until this session an identifier gap could not be recorded
// at all — the array had no field for one, so `openGaps` structurally could not count
// it. `detail` exists because the row renders no quote: a status-only assertion cannot
// tell a pass that names its value from one that names nothing, which is exactly how
// 18 false passes survived an audit that read all 507 rendered rows (v3.2 CP3).
// ---------------------------------------------------------------------------
interface IdCase {
  label: string;
  opts: { gtin?: string | null; mpn?: string | null };
  correct: AssertionStatus;
  why: string;
  /** Present ONLY when the engine currently disagrees with `correct`. Counted in openGaps. */
  actual?: AssertionStatus;
  /** Substring the rendered `detail` must contain — usually the value itself. */
  detail?: string;
  /** The WHOLE rendered `detail`, byte for byte. `detail` cannot see a clause APPENDED
   *  to a correct sentence, which is exactly what CP2a's provenance caveat was. */
  detailExact?: string;
}
const IDENTIFIERS: IdCase[] = [
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

  // --- v3.5 CP2a: THE ROW MUST NAME THE VALUE IT PASSED ON --------------------
  { label: "detail names the GTIN it passed on", opts: { gtin: "4006381333931" }, correct: "pass_evidenced",
    detail: "4006381333931",
    why: "The row rendered \"Your structured data publishes GTIN.\" and no quote, so an auditor reading rendered evidence had nothing to be suspicious of. One mechanical check of this one class found 18 false passes in a 507-row sample already audited row by row." },
  { label: "detail names the MPN it passed on", opts: { mpn: "WH-1000XM5" }, correct: "pass_evidenced",
    detail: "WH-1000XM5",
    why: "Same rule for the MPN branch, which is the branch that carried every measured defect." },
  // v3.5 CP2c — THE PASS COPY CARRIES NO PROVENANCE CLAUSE, because there is no
  // provenance left to state. CP2a rendered " That GTIN sits on the first variant
  // listed rather than on the product itself…" for a GTIN read out of a nested node;
  // reverting the descent made every such clause unreachable, and an unreachable
  // branch that renders merchant-facing copy is a sentence nobody can test.
  { label: "the pass copy states no provenance caveat", opts: { gtin: "4006381333931" }, correct: "pass_evidenced",
    detailExact: "Your structured data publishes a GTIN (4006381333931).",
    why: "Asserted as the WHOLE sentence, not a substring, because `includes` cannot see an APPENDED clause — the shape of the thing being pinned. The value is on the product node, the only place the extractor now reads one, so there is nothing to qualify. If the descent ever returns, its caveat returns with it and this case is what says so." },

  // --- merchant-controlled text reaching a LINTED output ----------------------
  { label: "mpn GUARANTEE-001 (linter-tripping value)", opts: { mpn: "GUARANTEE-001" }, correct: "pass_evidenced",
    detail: "can't reproduce the value here",
    why: "`lintStrings` runs over `detail` as a BLOCKING gate: printing this value verbatim would return the whole report as `unreachable` for a store we read perfectly well — the exact failure the `warranty` requirement was dropped for in v2.3. Fail closed per ROW: the row still passes and still names the reason." },
  { label: "mpn MISSING-PRICE-TAG-2 (second linter family)", opts: { mpn: "MISSING-PRICE-TAG-2" }, correct: "pass_evidenced",
    detail: "can't reproduce the value here",
    why: "A second family (price-is-always-public), so the fallback is not pinned to one regex. MEASURED, not assumed: an identifier is a single token, and 15 of the linter's 17 rules require whitespace, so `guarantee` and this one are the only families a hyphenated value can reach. `RANK-HIGHER-2` was the first candidate written for this case and it lints CLEAN — the ranking rule needs a space." },
  { label: "mpn RANK-HIGHER-2 is NOT redacted", opts: { mpn: "RANK-HIGHER-2" }, correct: "pass_evidenced",
    detail: "RANK-HIGHER-2",
    why: "The two-sided canary for the redaction fallback. A guard that redacted every value would satisfy the two cases above while destroying the whole point of naming the value, and a one-sided assertion cannot tell the difference." },
];

// ---------------------------------------------------------------------------
// GTIN SELECTION, exercised through the REAL `extractPage` (added v3.5 CP2a;
// REWRITTEN at CP2c, which reverted the widening these cases were written for).
//
// `verdictOfIds` sets `product.gtin` directly and therefore cannot see a selection
// bug at all. These run actual JSON-LD through the production extractor.
//
// ⚠️ WHAT THIS BLOCK IS NOW FOR. CP2a widened `selectGtin` to descend into `offers[]`,
// `hasVariant[]` and `isVariantOf[]` and take the first publishable value. It was
// measured purely additive over a 338-store replay — 32 real merchants who publish a
// valid GTIN their theme emits per offer or per variant, 0 rows lost — and an
// independent adversarial pass over 78 constructed cases in three worktrees then
// attributed **11 regressions, every one of them, to that descent**. CP2c reverted it.
// So this block carries two kinds of case and the difference is the point:
//
//   • REGRESSION CLASS — `correct: not_proven`, NO `actual`. These are the answers the
//     descent got wrong. They pass today and they must keep passing: this is what
//     stops the widening coming back unnoticed.
//   • RECALL GAPS — `correct: pass_evidenced`, `actual: not_proven`. Real merchants
//     the reverted engine is wrong about. Reverting did not make them right; it made
//     them WRONG IN A DIRECTION WE CAN STATE (we did not look), instead of wrong in a
//     direction we could not (we answered a question the standard declares blocked).
//     A recall gap is a debt with a receipt; a false pass on a variant's identifier is
//     a false claim about a merchant.
// ---------------------------------------------------------------------------
interface LdCase {
  label: string;
  node: Record<string, unknown>;
  correct: AssertionStatus;
  /** The value the row must have selected — asserting status alone cannot see a pass
   *  on the wrong number. `null` means nothing may be selected. */
  gtin: string | null;
  why: string;
  actual?: AssertionStatus;
  /** The value actually selected today, when it differs from `gtin`. Same contract as
   *  `actual`: present ONLY where the engine disagrees with the honest answer. */
  actualGtin?: string | null;
  /** The WHOLE rendered `detail`. A pass with a different quote is a different answer,
   *  and a status-only assertion is structurally blind to it. */
  detailExact?: string;
}
const P = (extra: Record<string, unknown>): Record<string, unknown> => ({ "@type": "Product", name: "Thing", ...extra });

const LD_SELECTION: LdCase[] = [
  // --- canonical TRUE: what the product node publishes ------------------------
  { label: "gtin on the product node", node: P({ gtin13: "4006381333931" }),
    correct: "pass_evidenced", gtin: "4006381333931",
    why: "The product node's own identifier is the one that describes the product, and the only one the extractor reads. The control that keeps this block two-sided — a rule that selected nothing would satisfy every not_proven case below." },
  { label: "top-level wins over a different offer gtin", node: P({ gtin13: "4006381333931", offers: [{ "@type": "Offer", gtin12: "036000291452" }] }),
    correct: "pass_evidenced", gtin: "4006381333931",
    why: "Unchanged across CP2a and its revert: whatever else is on the page, the product node's value is the answer when it has one." },

  // --- THE REGRESSION CLASS the revert exists for -----------------------------
  // Each of these PASSED under CP2a. `conflict_rules[1]` of ALS-COFFEE-1.3-IDENT-001
  // says, verbatim: when "different variants carry different barcodes", "the engine
  // reads the product-level node only; per-variant identity is a known limitation
  // published as a blocked entry". An `executable` row answering a question the same
  // published document declares `blocked` is not a recall win.
  { label: "REGRESSION CLASS: three variants, three different barcodes", node: P({ hasVariant: [{ "@type": "Product", gtin13: "0810000100026" }, { "@type": "Product", gtin13: "0810000100019" }, { "@type": "Product", gtin13: "0810000100040" }] }),
    correct: "not_proven", gtin: null,
    why: "Adjudicated cases R01/G-04/R04. There is no product-level answer to pick, so 'the first that validates' answers for ONE variant while the row's sentence is about the product. 22 of 338 captured products carry more than one distinct nested GTIN, so this is not a constructed rarity." },
  { label: "REGRESSION CLASS: offers per variant disagree", node: P({ offers: [{ "@type": "Offer", gtin13: "0810000100040" }, { "@type": "Offer", gtin13: "0810000100019" }] }),
    correct: "not_proven", gtin: null,
    why: "Adjudicated case R02. An offer-per-size list IS variants carrying different barcodes; the shape differs from hasVariant[] and the rule does not." },
  { label: "REGRESSION CLASS: AggregateOffer members disagree", node: P({ offers: { "@type": "AggregateOffer", offers: [{ "@type": "Offer", price: "18.00", gtin13: "0810000100019" }, { "@type": "Offer", price: "96.00", gtin13: "0810000100026" }] } }),
    correct: "not_proven", gtin: null,
    why: "Adjudicated case R03. Members at 18.00 and 96.00 are different purchasable things with different barcodes, reached one level deeper than R02." },
  { label: "REGRESSION CLASS: isVariantOf parent group whose siblings disagree", node: P({ isVariantOf: [{ "@type": "ProductGroup", hasVariant: [{ "@type": "Product", gtin13: "5060004111114" }, { "@type": "Product", gtin13: "4006381333931" }] }] }),
    correct: "not_proven", gtin: null,
    why: "Adjudicated cases R05/R06. This page's own node publishes nothing; the identifiers belong to the group's other members. Reached through the parent link, which is the third door CP2a opened." },
  { label: "REGRESSION CLASS: the storefront's own key as a nested gtin13", node: P({ hasVariant: [{ "@type": "Product", gtin13: "8079462006891" }] }),
    correct: "not_proven", gtin: null,
    why: "Adjudicated case R13, and the worst of the eleven. The descent carries the storefront's own product key in from a variant list and names it as the merchant's GTIN — the exact value rule D (v3.5 CP2b) exists to reject, one field over. A widening and a tightening in the same release, cancelling each other on the same page." },
  { label: "REGRESSION CLASS: gtin8 before gtin13 across disagreeing offers", node: P({ offers: [{ "@type": "Offer", gtin8: "96385074" }, { "@type": "Offer", gtin13: "4006381333931" }] }),
    correct: "not_proven", gtin: null,
    why: "Adjudicated case R17. Two offers, two different barcodes, and the key-precedence order inside a node decides which variant the merchant is told about — an arbitrary answer dressed as a selection rule." },
  { label: "REGRESSION CLASS: a real MPN must not acquire a variant's GTIN in its evidence", node: P({ mpn: "FR-YRG-12-WB", hasVariant: [{ "@type": "Product", gtin13: "0810000100026" }, { "@type": "Product", gtin13: "0810000100019" }] }),
    correct: "pass_evidenced", gtin: null,
    detailExact: "Your structured data publishes an MPN (FR-YRG-12-WB).",
    why: "Adjudicated case R21, and it is why this block asserts the RENDERED SENTENCE. The status is pass_evidenced in every tree, so no status diff and no real-store replay can see it — but under CP2a the row also named a GTIN taken from a variant list, which conflict_rules[1] puts out of bounds. A pass with a different quote is a different answer (v3.1, v3.2, twice)." },

  // --- HOSTILE: a value that is not this product's ----------------------------
  // Trivially satisfied while nothing is followed. They are kept because they stop
  // being trivial the instant any descent returns, and a narrowed descent is a live
  // proposal (ENGINE_GAPS P-06) rather than a closed question.
  { label: "gtin only on isSimilarTo (a DIFFERENT product)", node: P({ isSimilarTo: [{ "@type": "Product", gtin13: "4006381333931" }] }),
    correct: "not_proven", gtin: null,
    why: "A related-products block is a competitor's or an upsell's identifier. Forward-looking bound: any future descent must be a named-key walk, never a deep search, or it attributes another product's GTIN to this one." },
  { label: "gtin only on a nested review/brand object", node: P({ brand: { "@type": "Brand", name: "Acme", gtin13: "4006381333931" } }),
    correct: "not_proven", gtin: null,
    why: "Same class through a different key." },
  { label: "a SKU published in offers[].gtin does not surface", node: P({ offers: [{ "@type": "Offer", gtin13: "20210151-GRN-S" }] }),
    correct: "not_proven", gtin: null,
    why: "A real captured value (imogeneandwillie.com publishes per-variant SKUs in gtin fields). A seller-private stock code cannot match a product to an external catalogue, which is the row's whole promise." },

  // --- RECALL GAPS the revert reintroduced, each with what it costs ------------
  { label: "gtin only on a SINGLE offer", node: P({ offers: [{ "@type": "Offer", price: "12", gtin12: "036000291452" }] }),
    correct: "pass_evidenced", gtin: "036000291452", actual: "not_proven", actualGtin: null,
    why: "KNOWN GAP, reintroduced deliberately by the CP2a revert. Adjudicated cases G-03/R07: one variant, one offer, one barcode — conflict_rules[1] is not engaged and accepted_evidence names no node, so the honest answer is a pass. Measured cost: of 338 captured real stores, 32 publish a check-digit-valid GTIN only in a nested node and are told they publish none. It is NOT fixed by re-widening: the same descent answers the multi-variant cases above, which is the class that regressed. See ENGINE_GAPS P-06." },
  { label: "gtin only on a SINGLE hasVariant entry", node: P({ hasVariant: [{ "@type": "Product", gtin13: "4006381333931" }] }),
    correct: "pass_evidenced", gtin: "4006381333931", actual: "not_proven", actualGtin: null,
    why: "KNOWN GAP, same class through the other named key — 19 of the 32 measured gains carried the value on hasVariant[] rather than offers[]. Pinned separately because a narrowed descent has to be measured on both shapes, not on whichever one its author tested." },
  { label: "gtin only inside an AggregateOffer's nested offers", node: P({ offers: { "@type": "AggregateOffer", offers: [{ "@type": "Offer", gtin13: "4006381333931" }] } }),
    correct: "pass_evidenced", gtin: "4006381333931", actual: "not_proven", actualGtin: null,
    why: "KNOWN GAP, and the shape that needs two levels rather than one: an AggregateOffer carries its members under a nested `offers`. Adjudicated case G-06 — one barcode, nothing conflicting." },
  { label: "an INVALID gtin13 hides a VALID gtin12 on the SAME node", node: P({ gtin13: "4006381333930", gtin12: "036000291452" }),
    correct: "pass_evidenced", gtin: "036000291452", actual: "not_proven", actualGtin: "4006381333930",
    why: "KNOWN GAP, and the one nobody attacked. `selectGtin` returns the first NON-EMPTY key, not the first PUBLISHABLE one, so a single malformed value hides a real identifier sitting beside it on the product node. This is not a descent — no nested node is involved — and CP2a happened to fix it in passing; the byte-identity revert took it back out. Restoring it alone is separable from the descent and carries none of the descent's risk. See ENGINE_GAPS P-07." },
  { label: "nothing valid anywhere reports the top-level value", node: P({ gtin13: "4006381333930", offers: [{ "@type": "Offer", gtin12: "036000291451" }] }),
    correct: "not_proven", gtin: "4006381333930",
    why: "Both invalid. The value handed downstream must be the one the product node actually published, so no consumer of `product.gtin` ever sees a string that was never on that node." },
  { label: "all-zeros on the product node does not pass", node: P({ gtin13: "0000000000000" }),
    correct: "not_proven", gtin: "0000000000000",
    why: "All-zeros satisfies the check-digit arithmetic and identifies nothing. Selection reports it; `isPublishableGtin` in the judging row refuses it — which is the division of labour the CP2a revert restored." },
];

// ---------------------------------------------------------------------------
// v3.5 CP2b — RULE D: an `mpn` that is the STOREFRONT'S OWN RECORD KEY.
//
// Licensed by Coffee Standard v1.3, which added the disqualification; the standard
// defines the requirement, the engine implements it, in that order. Measured over 338
// captured real stores: 23 products publish the integer their own storefront uses to
// key this product record in the MPN field — a value that resolves to nothing outside
// the store that minted it, in the field whose row promises an external catalogue match.
//
// These run WHOLE PAGES through `extractPage` + `shopifyStorefrontObjectId`, because
// the hard part is not the comparison, it is the READ: `"id"` occurs inside
// `variants[]` on every real page, so a regex returns a variant's key.
// ---------------------------------------------------------------------------
const PAGE = (ld: Record<string, unknown> | null, meta: string | null, beforeMeta = ""): string =>
  "<html><head>" +
  (ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : "") +
  beforeMeta +
  (meta == null ? "" : `<script>var meta = ${meta};\nfor (var attr in meta) { window.ShopifyAnalytics.meta[attr] = meta[attr]; }</script>`) +
  "</head><body><p>A thing.</p></body></html>";

/** A page whose head chunk is written out verbatim — for the bootstrap SHAPES the
 *  reader does not recognise, which `PAGE` cannot express because it hard-codes
 *  `var meta = `. */
const RAW_PAGE = (ld: Record<string, unknown> | null, rawHead: string): string =>
  "<html><head>" +
  (ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : "") +
  rawHead +
  "</head><body><p>A thing.</p></body></html>";

interface PageCase {
  label: string; html: string; correct: AssertionStatus; why: string;
  actual?: AssertionStatus;
  /** Substring the rendered detail must contain. */
  detail?: string;
  /** The WHOLE rendered `detail`, byte for byte. `detail` is an `includes`, and an
   *  `includes` cannot see a clause APPENDED to a correct sentence — nor one REMOVED
   *  from it, which is the defect v3.5 CP3 fixed: the sentence said "the only
   *  identifier in your product structured data" to six merchants who publish a valid
   *  GTIN one node down, and every substring assertion in this file was satisfied. */
  detailExact?: string;
  /** What `shopifyStorefrontObjectId` must have read — a guard that fires for the
   *  wrong reason is not a guard, and status alone cannot see which id it compared. */
  storefrontId: string | null;
}

const RULE_D: PageCase[] = [
  // --- the class it exists to close -------------------------------------------
  { label: "mpn IS the storefront's product key", storefrontId: "8079462006899",
    html: PAGE(P({ mpn: "8079462006899" }), '{"product":{"id":8079462006899,"vendor":"Acme","type":"Skincare","variants":[{"id":44139877171393,"public_title":"30ml"}]},"page":{"pageType":"product"}}'),
    correct: "not_proven", detail: "8079462006899",
    detailExact: "The only identifier we can use on your product's own structured-data node is an MPN (8079462006899), and that is the id your own storefront uses for this product — it resolves to nothing outside your store. We read that node only, so a GTIN published beneath it on an offer or a variant is not counted here.",
    why: "glowrecipe.com, verbatim: the same value the page also emits as `rid`, `source_product_id`, `product.id` and `data-product-id`. It is not a placeholder, so the row passed and reported a published product identifier, while the value identifies nothing to anyone outside that one store. ⚠️ THE WHOLE SENTENCE IS ASSERTED, and the SAME sentence is asserted on the six-store case below, where a valid GTIN sits one node down. That identity is the property, not a duplication: the engine reads the product node and nothing else, so it cannot tell these two pages apart, and copy that distinguished them would be claiming a measurement we never took. This page is the side where nothing else is published — it is what stops the reach limit reading as an admission that something WAS found." },
  { label: "the disqualification NAMES the reason, not just the value", storefrontId: "7649496858737",
    html: PAGE(P({ mpn: "7649496858737" }), '{"product":{"id":7649496858737,"type":"Coffee","variants":[{"id":42,"public_title":"12oz"}]}}'),
    correct: "not_proven", detail: "id your own storefront uses for this product",
    why: "Falling through to the generic \"publishes no GTIN or MPN\" would be FALSE about a store that publishes an MPN, and it would hide the decision from the only audit that can catch it. This class hid for two versions precisely because the row rendered nothing to be suspicious of." },

  // --- PARSED, NOT REGEXED — both directions ----------------------------------
  { label: "the product key is read past variants[] that come FIRST", storefrontId: "123456789",
    html: PAGE(P({ mpn: "123456789" }), '{"product":{"variants":[{"id":8079462006899,"public_title":"12oz"},{"id":8079462006900}],"id":123456789,"type":"Coffee"}}'),
    correct: "not_proven", detail: "123456789",
    why: "THE POSITIVE CONTROL for the parser. Shopify emits `product.id` before `variants` today; a theme that reorders keys makes a bare /\"id\"\\s*:\\s*(\\d+)/ return a VARIANT's key. This page puts variants first, so a regex reads 8079462006899, fails to match the mpn, and this case fails." },
  { label: "a VARIANT key in mpn is NOT disqualified (measured limit)", storefrontId: "123456789",
    html: PAGE(P({ mpn: "8079462006899" }), '{"product":{"variants":[{"id":8079462006899,"public_title":"12oz"}],"id":123456789,"type":"Coffee"}}'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, deliberate, and CONFIRMED by the independent pass as adjudicated cases D-05 and EVA-13. v1.3's clause says \"the value the storefront also uses as its own product OR VARIANT key\"; rule D was scored on the PRODUCT key alone (23 TP / 0 FP / 0 FN over 36 mpn-publishing products) and variant-key matching occurs 0 times in 338 captured stores — so widening it would ship an unmeasured rule to close a class nothing in the corpus exhibits. It doubles as the NEGATIVE control for the parser: a regex taking the first \"id\" would disqualify here and this case would fail." },

  // --- FAILS OPEN, which is the direction that matters ------------------------
  { label: "no analytics bootstrap: nothing is disqualified", storefrontId: null,
    html: PAGE(P({ mpn: "8079462006899" }), null),
    correct: "pass_evidenced", detail: "8079462006899",
    why: "A guard that fires on \"unknown\" suppresses real merchants, which this project treats as unrecoverable. 11 of 338 captured pages have no parseable bootstrap. v1.3 states this outcome in the document itself: a pass is the absence of a disqualification we could DECIDE, never evidence of one we could not." },
  { label: "truncated bootstrap: nothing is disqualified", storefrontId: null,
    html: PAGE(P({ mpn: "8079462006899" }), '{"product":{"id":8079462006899,"type":"Coffee"'),
    correct: "pass_evidenced",
    why: "An unbalanced object must not be guessed at. Same fail-open rule as the absent case — this is the shape a byte-capped fetch produces on a large page." },
  { label: "non-JSON bootstrap: nothing is disqualified", storefrontId: null,
    html: PAGE(P({ mpn: "8079462006899" }), "{not json at all}"),
    correct: "pass_evidenced",
    why: "Third failure mode of the read. All three must land on the same side." },
  { label: "bootstrap present but no product.id", storefrontId: null,
    html: PAGE(P({ mpn: "8079462006899" }), '{"product":{"type":"Coffee","variants":[]},"page":{"pageType":"product"}}'),
    correct: "pass_evidenced",
    why: "A bootstrap that parses is not a bootstrap that answered. Missing `id` is undecidable, not licence to compare against something else." },

  // --- the two-sided canary: it must NOT fire on a real MPN -------------------
  { label: "a real MPN on a store WITH a bootstrap still passes", storefrontId: "8079462006899",
    html: PAGE(P({ mpn: "PW-CP-09" }), '{"product":{"id":8079462006899,"type":"Instruments","variants":[{"id":42}]}}'),
    correct: "pass_evidenced", detail: "PW-CP-09",
    why: "daddario.com's real published part number. A guard that disqualified every mpn on every page with a bootstrap would satisfy the cases above and destroy the row; a one-sided corpus cannot tell the difference." },
  { label: "a valid GTIN still passes even when the mpn is the storefront key", storefrontId: "8079462006899",
    html: PAGE(P({ mpn: "8079462006899", gtin13: "4006381333931" }), '{"product":{"id":8079462006899,"type":"Coffee","variants":[{"id":42}]}}'),
    correct: "pass_evidenced", detail: "4006381333931",
    why: "Rule D disqualifies one FIELD, not the row. ⚠️ THIS CASE'S OWN MEASUREMENT WAS WRONG IN EXACTLY THE WAY THE ROW'S COPY WAS, and v3.5 CP3 corrected both. It read \"Measured: 0 of the 23 rule-D stores publish a valid GTIN anywhere in their JSON-LD\". Re-executed over the captured bytes (`experiments/v3-5/copyfix/adjudicate_cp1.mjs`, 23/23 pages read, two-sided canary): 0 on the SELECTED product node — true, and true BY CONSTRUCTION, since this branch only runs when there is none; 0 reachable by descending `offers[]`/`hasVariant[]`/`isVariantOf[]` from that node; and SIX anywhere in the JSON-LD graph (flybyjing, monos, negativeunderwear, nomatic, wandpdesign, yellowbirdsauce). \"Anywhere in their JSON-LD\" was a statement about the node the ENGINE reads dressed as a statement about the merchant's whole markup — the identical conflation as the sentence this row used to render, in the file that pins it. What survives is the case's PURPOSE: no captured store puts a valid GTIN on the product node beside a storefront-key mpn, so the interaction is unexercised by the real-store replay and only a constructed case can hold it. The GTIN is on the PRODUCT NODE — this case was written at CP2a with the GTIN inside `offers[]`, which stopped being reachable when CP2c reverted the descent, and a case whose fixture no longer reaches the branch it names pins nothing." },

  // --- the class rule D deliberately does NOT close ---------------------------
  { label: "mpn === sku, and NOT the storefront key", storefrontId: "8631346921664",
    html: PAGE(P({ mpn: "100754", sku: "100754" }), '{"product":{"id":8631346921664,"type":"Coffee","variants":[{"id":42,"sku":"100754"}]}}'),
    correct: "pass_evidenced",
    why: "⚠️ THE `correct` FIELD WAS WRONG HERE, NOT THE ENGINE — corrected at v3.5 CP2c, and it removes an open gap that was never a gap. This case shipped as `correct: not_proven, actual: pass_evidenced` with a `why` that ended \"v1.3 deliberately does not disqualify a SKU echo per se\": the record contradicted its own expectation on the next line. Per v1.3, `residual_risk`(2) scopes the new clause to the seller's own OBJECT ID and says a stock code that is neither a placeholder nor the storefront's key \"is outside this clause\", and `pass_means` defines a pass as \"the absence of a disqualification we could decide\". This value (www.stumptowncoffee.com's `\"sku\":\"100754\",\"mpn\":\"100754\"`) is not the storefront key, so nothing in v1.3 disqualifies it and the honest answer IS a pass. The rule that would catch it — mpn === sku — was scored on the captured corpus at 0% precision: 0 true positives, 7 false, and the seven are exactly the COMPLIANT case (a brand that manufactures what it sells uses one string for both; one of the seven is a real published part number and another is a VALID GTIN). Whether a store-local code SHOULD disqualify is a question for the standard, filed as ENGINE_GAPS P-11 — it is not an engine defect while the document says it passes." },

  // --- shape robustness --------------------------------------------------------
  { label: "a STRING product id still matches", storefrontId: "8079462006899",
    html: PAGE(P({ mpn: "8079462006899" }), '{"product":{"id":"8079462006899","type":"Coffee","variants":[]}}'),
    correct: "not_proven", detail: "8079462006899",
    why: "Shopify emits a number; a theme can emit the same value quoted. The comparison is on the string form, so both shapes reach the same answer — a JSON type must not decide whether a merchant is told the truth." },
  { label: "a near-miss id does NOT match", storefrontId: "8079462006899",
    html: PAGE(P({ mpn: "8079462006898" }), '{"product":{"id":8079462006899,"type":"Coffee","variants":[]}}'),
    correct: "pass_evidenced", detail: "8079462006898",
    why: "Byte-identical, not \"looks like\". One digit apart is a different value, and a fuzzy comparison here would fail merchants for resembling a number on their own page." },

  // =========================================================================
  // v3.5 CP2c — THE 15 RESIDUALS THE INDEPENDENT PASS MEASURED. ONE INCOMPLETE
  // FIX, NOT A DEFECT, AND NOT AN ACCEPTED BEHAVIOUR EITHER.
  //
  // The adversarial pass ran 78 cases through three worktrees and attributed
  // ZERO regressions to rule D. What it did attribute is this: 15 pages where a
  // storefront's own key sits in the MPN field, is legible somewhere on the page,
  // and rule D does not reach it. Every one of them FAILS OPEN — the merchant
  // keeps their pass — which is the direction this project treats as recoverable.
  //
  // Each case names its adjudicated id. The compact fixtures below were verified
  // to reproduce the same `storefrontObjectId` read and the same status as the
  // full-page originals in experiments/v3-5/adjudicate/cases.json, by execution.
  //
  // ⚠️ WHY THEY ARE PINNED INDIVIDUALLY rather than as one line in a document.
  // "A rule stated only in a comment is not a rule" — v2.9's quantity guard broke
  // the sentence its own comment named as a must-pass, and grepping for it returned
  // exactly one hit: the comment. Four of the shapes below (EVA-08/09/11/12) are one
  // CLASS with four fixtures, and a future widening of the bootstrap reader that
  // closes two of the four must not be able to claim the class.
  // =========================================================================

  // --- the key is published in a DECORATED form (both directions) -------------
  { label: "RESIDUAL EVA-03: mpn is the gid form of the id in the same parsed object", storefrontId: "8079462006899",
    html: PAGE(P({ mpn: "gid://shopify/Product/8079462006899" }), '{"product":{"id":8079462006899,"gid":"gid:\\/\\/shopify\\/Product\\/8079462006899","type":"Coffee","variants":[{"id":44139877171393}]}}'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. The mpn is byte-identical to `meta.product.gid`, which the SAME object rule D already parsed publishes as this product's key — the comparison reads `product.id` and nothing else. Not a decoration the engine has to guess at: both forms are in bytes we hold. Closing it needs a stated NORMALISATION rule (which decorated forms of a key count as the key), which the document does not have — ENGINE_GAPS P-08." },
  { label: "RESIDUAL D-06: the id is published in gid form and the mpn is the bare integer", storefrontId: "gid://shopify/Product/7215488761946",
    html: PAGE(P({ mpn: "7215488761946" }), '{"product":{"id":"gid:\\/\\/shopify\\/Product\\/7215488761946","type":"Coffee","variants":[{"id":"gid:\\/\\/shopify\\/ProductVariant\\/41963258413194"}]}}', '<div data-product-id="7215488761946"></div>'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, and the INVERSE of EVA-03 — the same normalisation gap seen from the other side, which is what makes it one rule rather than two patches. A theme that emits the gid as `product.id` puts the bare key beyond a byte-identical comparison, and `data-product-id` on the same page carries it plainly. ENGINE_GAPS P-08." },

  // --- the key is a VARIANT key (v1.3's clause names it; rule D does not) ------
  { label: "RESIDUAL EVA-14: mpn is a variant key and the bootstrap carries no product.id", storefrontId: null,
    html: PAGE(P({ mpn: "44139877171393" }), '{"product":{"type":"Coffee","handle":"x","variants":[{"id":44139877171393,"sku":"FK-ETH-12"}]},"page":{"pageType":"product"}}'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, third of the variant-key set with D-05 and EVA-13. Distinct from them because there is no `product.id` to compare against at all, so the value is undecidable by rule D as written even though the variant list makes it legible. Distinct from the fail-open case above it because there the value was NOT a key; here it is. ENGINE_GAPS P-09." },

  // --- the key is legible on the page, outside the bootstrap ------------------
  { label: "RESIDUAL EVA-07: no bootstrap at all, key in data-product-id", storefrontId: null,
    html: RAW_PAGE(P({ mpn: "8079462006899" }), '<div class="product" data-product-id="8079462006899"><input type="hidden" name="product-id" value="8079462006899"></div>'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. `pass_means` says the disqualification is decidable where the storefront publishes its key \"somewhere legible\" — decidability is a property of the PAGE, and this page publishes it twice. Rule D reads one emitter. ENGINE_GAPS P-10." },
  { label: "RESIDUAL D-10: bootstrap is single-quoted JS, key in data-product-id and rid", storefrontId: null,
    html: RAW_PAGE(P({ mpn: "7215488761946" }), "<script>var meta = {'product':{'id':7215488761946,'type':'Coffee'}};</script><div data-product-id=\"7215488761946\"></div><input name=\"rid\" value=\"7215488761946\">"),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, and NOT the same as the fail-open 'non-JSON bootstrap' case above it — there nothing on the page decided the question, here two other emitters do. Fail-open is right when the page is silent and merely conservative when it is not. ENGINE_GAPS P-10." },

  // --- the bootstrap is there in a shape the reader does not recognise --------
  { label: "RESIDUAL EVA-08: window.ShopifyAnalytics.meta = { … }", storefrontId: null,
    html: RAW_PAGE(P({ mpn: "8079462006899" }), '<script>window.ShopifyAnalytics = window.ShopifyAnalytics || {};\nwindow.ShopifyAnalytics.meta = {"product":{"id":8079462006899,"type":"Coffee","variants":[{"id":44139877171393}]}};</script>'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. The anchor is `/\\bvar\\s+meta\\s*=\\s*\\{/`, so a theme assigning the same payload straight onto the analytics object is unreadable. ENGINE_GAPS P-10." },
  { label: "RESIDUAL EVA-09: const meta = { … }", storefrontId: null,
    html: RAW_PAGE(P({ mpn: "8079462006899" }), '<script>const meta = {"product":{"id":8079462006899,"type":"Coffee","variants":[{"id":44139877171393}]}};</script>'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. One keyword away from the shape the reader knows. ENGINE_GAPS P-10." },
  { label: "RESIDUAL EVA-11: a JS comment inside the object literal", storefrontId: null,
    html: RAW_PAGE(P({ mpn: "8079462006899" }), '<script>var meta = { /* set by theme.liquid */ "product":{"id":8079462006899,"type":"Coffee","variants":[{"id":44139877171393}]}};</script>'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. The brace walk finds the object; `JSON.parse` then rejects it, because a comment is JS and is not JSON. Fails open, correctly, on a page whose key is fully legible to a human. ENGINE_GAPS P-10." },
  { label: "RESIDUAL EVA-12: var meta = JSON.parse(\"…\")", storefrontId: null,
    html: RAW_PAGE(P({ mpn: "8079462006899" }), '<script>var meta = JSON.parse("{\\"product\\":{\\"id\\":8079462006899,\\"type\\":\\"Coffee\\"}}");</script>'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. `var meta = ` is followed by a call, not a brace, so the anchor never fires. ENGINE_GAPS P-10." },

  // --- something that is NOT the bootstrap shadows the bootstrap --------------
  { label: "RESIDUAL D-11: an HTML comment carries a DECOY bootstrap before the real one", storefrontId: "DEMO-0001",
    html: PAGE(P({ mpn: "7215488761946" }), '{"product":{"id":7215488761946,"type":"Coffee","variants":[{"id":41963258413194}]}}', '<!-- theme demo: var meta = {"product":{"id":"DEMO-0001"}}; -->'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, and the one that reads WORST: `storefrontObjectId` is not null here, it is \"DEMO-0001\". The reader takes the FIRST match in the byte stream and HTML comments are not stripped, so a commented-out theme demo answers for the live bootstrap two lines below it. The engine is not undecided — it is confidently wrong, and it then fails open on that. ENGINE_GAPS P-10." },
  { label: "RESIDUAL EVA-10: an HTML comment carries an EMPTY bootstrap before the real one", storefrontId: null,
    html: PAGE(P({ mpn: "8079462006899" }), '{"product":{"id":8079462006899,"type":"Coffee","variants":[{"id":44139877171393}]}}', "<!-- theme fallback: var meta = {}; -->"),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, same mechanism as D-11 with the milder outcome: `{}` parses, carries no product, and yields null. Both are pinned because a fix that strips comments must close both, and a fix that only checks for an empty object closes one. ENGINE_GAPS P-10." },
  { label: "RESIDUAL EVA-22: MERCHANT-TYPED description text shadows the bootstrap", storefrontId: null,
    html: PAGE(P({ mpn: "8079462006899", description: "A washed Ethiopian single origin. Wholesale partners: paste var meta = {} into your theme header before our tracking snippet." }), '{"product":{"id":8079462006899,"type":"Coffee","variants":[{"id":44139877171393}]}}'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP, and the hostile class this corpus exists for: merchant-controlled text reaching a reader. The JSON-LD `description` is written by the store and appears BEFORE the analytics script, so `var meta = {}` inside a sentence about theme installation decides what the engine reads about that store. Whether it is deliberate does not matter — a parser steered by the input it is judging is the defect. ENGINE_GAPS P-10." },

  // --- the recall gap and rule D, INTERSECTING ---------------------------------
  //
  // ⚠️ SIX NAMED REAL MERCHANTS, and the sentence they were shown was false about them.
  // `experiments/v3-5/ship_pivot.ts` (DEFECTS_FOUND, 23/23 rule-D losses examined, 0
  // snapshots missing, two-sided canary passing) measured that 6 of the 23 stores rule D
  // newly fails DO publish a check-digit-valid GTIN in their JSON-LD: flybyjing.com,
  // monos.com, negativeunderwear.com, nomatic.com, wandpdesign.com, yellowbirdsauce.com.
  // All six were `pass_evidenced` at af6d387 AND at d151876 and are `not_proven` only at
  // head, so rule D owns the flip, not the CP2a revert.
  //
  // Classified from the captured bytes rather than from prose (`classify_six.mjs`,
  // `enclosing.mjs`, `adjudicate_cp1.mjs` under experiments/v3-5/copyfix): on ALL SIX the
  // value hangs off a Product node the extractor does not SELECT, and NOTHING publishable
  // is reachable by descending `offers[]`/`hasVariant[]`/`isVariantOf[]` from the node it
  // does select — 0 of 23 by descent, 6 of 23 across the graph. So P-06 answers none of
  // them, wide OR narrowed. Corroborated by the engine rather than by a re-implementation:
  // at `d151876`, with the wide descent LIVE, all six still rendered "Your structured data
  // publishes an MPN (…)". Four carry the value in the own `gtin*` key of that other
  // Product node; two carry theirs on its `Offer`s. This is ENGINE_GAPS P-12, and it is
  // the measurement behind the register's "P-12 before P-06".
  { label: "SIX REAL STORES: the GTIN is on a Product node the extractor does not select", storefrontId: "15019014521202",
    html: RAW_PAGE(P({ mpn: "15019014521202" }),
      `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "Thing" }, { "@type": "Product", name: "Thing", gtin: "810089218773" }] })}</script>` +
      '<script>var meta = {"product":{"id":15019014521202,"type":"Bags","variants":[{"id":42}]}};</script>'),
    correct: "pass_evidenced", actual: "not_proven",
    detailExact: "The only identifier we can use on your product's own structured-data node is an MPN (15019014521202), and that is the id your own storefront uses for this product — it resolves to nothing outside your store. We read that node only, so a GTIN published beneath it on an offer or a variant is not counted here.",
    why: "KNOWN GAP, and nomatic.com's real shape reproduced from its captured bytes — mpn 15019014521202 (its own storefront key) on the first Product node, gtin 810089218773 on a Product node inside a later block's @graph. DISTINCT FROM X-01/X-04/R15 below, which is the offers[] door: here the value is on the own key of a node the extractor already flattened and merely did not pick, so it needs no descent and carries none of P-06's variant-attribution risk. Nothing in LD_SELECTION can express it either — `verdictOfLd` builds a page with ONE node, so a second, non-selected Product node was structurally unrepresentable in this file. ⚠️ ITS STATUS IS NOT WHAT THIS CASE PINS. `conflict_rules[1]` of ALS-COFFEE-1.3-IDENT-001 says the engine reads the product-level node only, so `not_proven` is what the published standard licenses; what was WRONG is the sentence, which told six merchants the MPN was \"the only identifier in your product structured data\" and that a machine buyer therefore can't match the product — two assertions of absence we never established. The row went from right-for-the-wrong-reason (base passed it, naming the storefront key) to wrong-for-a-stated-reason. `detailExact` is asserted BYTE-IDENTICAL to the no-other-identifier case above: one sentence, both shapes, because the engine cannot tell them apart. ENGINE_GAPS P-12." },
  { label: "RESIDUAL X-01/X-04/R15: rule D disqualifies the mpn and the only real GTIN is nested", storefrontId: "7215488761946",
    html: PAGE(P({ mpn: "7215488761946", offers: [{ "@type": "Offer", price: "18.00", gtin13: "5060391620510" }] }), '{"product":{"id":7215488761946,"type":"Coffee","variants":[{"id":42}]}}'),
    correct: "pass_evidenced", actual: "not_proven",
    why: "KNOWN GAP, and the ONLY THREE STATUS REGRESSIONS THAT SURVIVE THE CP2a REVERT against af6d387 — adjudicated X-01, X-04 and R15, re-run in four worktrees. It is worth reading exactly what happened. In `af6d387` this row PASSED, and it passed on the mpn — which is the storefront's own product key, the precise value CP2b was built to reject. So base was right in STATUS and wrong in EVIDENCE: it told the merchant they publish an identifier and named a string that resolves to nothing outside their own store. Rule D correctly refuses that value; the pass then depends on the GTIN in `offers[]`, which the reverted `selectGtin` does not read. The result is a FALSE FAIL where there used to be a right answer reached from a wrong one. It is the P-06 recall gap intersecting rule D, not a new mechanism, and it is the strongest argument in the register for solving node selection (P-12) rather than re-widening the descent (P-06)." },

  // --- rule D is scoped to ONE FIELD, and the value can move ------------------
  { label: "RESIDUAL EVA-15: the storefront key published in the GTIN field", storefrontId: "8079462006891",
    html: PAGE(P({ gtin13: "8079462006891" }), '{"product":{"id":8079462006891,"type":"Coffee","variants":[{"id":44139877171393}]}}'),
    correct: "not_proven", actual: "pass_evidenced",
    why: "KNOWN GAP. v1.3's clause is written for the MPN field, but its own `why_not` says the reason \"is field-agnostic: it is a statement about the VALUE, not about which key carries it\" — and the neighbouring clause already refuses an internal SKU in the GTIN field. This id happens to satisfy the GS1 check digit, so the arithmetic passes it. ENGINE_GAPS P-11." },
  { label: "RESIDUAL EVA-21: a valid GTIN-13 key, zero-padded, becomes a valid GTIN-14", storefrontId: "8079462006891",
    html: PAGE(P({ mpn: "8079462006891", gtin14: "08079462006891" }), '{"product":{"id":8079462006891,"type":"Coffee","variants":[{"id":44139877171393}]}}'),
    correct: "not_proven", actual: "pass_evidenced",
    detail: "08079462006891",
    why: "KNOWN GAP, ESCALATED, and the only one of the fifteen that is a MECHANICAL BYPASS rather than a reach limit. Rule D fires correctly on the mpn — the rendered detail names the GTIN alone, so the MPN was disqualified — and the SAME value walks back in one field over with a leading zero, because padding a valid GTIN-13 always yields a valid GTIN-14 (the check digit is computed right-aligned, so a leading zero changes nothing). Any store whose object id satisfies GS1 therefore has a one-field, one-character bypass of the guard, decidable by a rule nobody has written. The adjudicator ruled this case REJECTED on normalisation grounds — the padded value is literally not the key — and that ruling is about the ATTACKER'S claim, not about the mechanism. Pinned here because the mechanism is real, decidable, and nothing else in the repo records it. ENGINE_GAPS P-11." },
];

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------
const ALL: Array<[string, Case[]]> = [
  ["materials", MATERIALS], ["dimensions", DIMENSIONS],
  ["care", CARE], ["claims", CLAIMS], ["delivery", DELIVERY], ["v2.5-found", V25_FOUND],
  ["v2.8-found", V28_FOUND], ["v3.7-found", V37_FOUND],
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
  const gap = i.actual !== undefined;
  test(`[identifiers]${gap ? " KNOWN GAP —" : ""} ${i.label}`, () => {
    const v = verdictOfIds(i.opts);
    assert.equal(
      v.status, i.actual ?? i.correct,
      gap
        ? `KNOWN GAP CHANGED. Corpus records actual=${i.actual} (honest answer: ${i.correct}). Got ${v.status}. ` +
          `If this gap is now FIXED, delete its \`actual\` and decrement openGaps. Why: ${i.why}`
        : `${i.label} — ${i.why}`,
    );
    if (i.detail !== undefined) {
      assert.ok(
        v.detail.includes(i.detail),
        `the rendered detail must contain ${JSON.stringify(i.detail)} but was ${JSON.stringify(v.detail)}. ` +
        `A row that renders no value is invisible to a human audit. Why: ${i.why}`,
      );
    }
    // `includes` cannot see a clause APPENDED to a correct sentence — which is exactly
    // what CP2a's provenance caveat was, and why it needed its own assertion.
    if (i.detailExact !== undefined) assert.equal(v.detail, i.detailExact, `the WHOLE rendered detail. Why: ${i.why}`);
  });
}

for (const c of LD_SELECTION) {
  const gap = c.actual !== undefined;
  test(`[ld-selection]${gap ? " KNOWN GAP —" : ""} ${c.label}`, () => {
    const v = verdictOfLd(c.node);
    assert.equal(
      v.status, c.actual ?? c.correct,
      gap
        ? `KNOWN GAP CHANGED. Corpus records actual=${c.actual} (honest answer: ${c.correct}). Got ${v.status}. ` +
          `If this gap is now FIXED, delete its \`actual\` and decrement openGaps. Why: ${c.why}`
        : `REGRESSION. Expected ${c.correct}, got ${v.status}. Why: ${c.why}`,
    );
    // A pass on the WRONG value is a different answer; status cannot see it. Where the
    // engine currently selects something other than the honest answer, that value is
    // recorded too — a gap whose selected value drifts is a different gap.
    const expectGtin = c.actualGtin !== undefined ? c.actualGtin : c.gtin;
    assert.equal(v.gtin, expectGtin, `selected GTIN — ${c.why}`);
    // `signals.gtin` is read by the diagnosis and merchant-facts layers. It must track
    // the selected value: two parts of the engine answering differently about the same
    // page is the defect this project names one level up.
    assert.equal(v.signalGtin, expectGtin != null, `signals.gtin must track the selected value — ${c.why}`);
    // The RENDERED sentence, whole. R21 is a pass in every tree and the only thing that
    // changed under CP2a was the quote — invisible to status, invisible to a replay.
    if (c.detailExact !== undefined) assert.equal(v.detail, c.detailExact, `the WHOLE rendered detail. Why: ${c.why}`);
  });
}

for (const c of RULE_D) {
  const gap = c.actual !== undefined;
  test(`[rule-d]${gap ? " KNOWN GAP —" : ""} ${c.label}`, () => {
    const v = verdictOfPage(c.html);
    // WHICH id was read, asserted before the verdict: a guard that reaches the right
    // answer from the wrong value is not the guard the corpus thinks it is pinning.
    assert.equal(v.storefrontObjectId, c.storefrontId, `storefront id read — ${c.why}`);
    assert.equal(
      v.status, c.actual ?? c.correct,
      gap
        ? `KNOWN GAP CHANGED. Corpus records actual=${c.actual} (honest answer: ${c.correct}). Got ${v.status}. ` +
          `If this gap is now FIXED, delete its \`actual\` and decrement openGaps. Why: ${c.why}`
        : `REGRESSION. Expected ${c.correct}, got ${v.status}. Why: ${c.why}`,
    );
    if (c.detail !== undefined) {
      assert.ok(
        v.detail.includes(c.detail),
        `the rendered detail must contain ${JSON.stringify(c.detail)} but was ${JSON.stringify(v.detail)}. Why: ${c.why}`,
      );
    }
    // The WHOLE rendered sentence. An `includes` is blind in both directions — it
    // cannot see a clause appended to a correct sentence (CP2a's provenance caveat)
    // and it cannot see a false clause already in one (CP3's "the only identifier in
    // your product structured data", satisfied by every substring assertion here while
    // being false about six named merchants).
    if (c.detailExact !== undefined) assert.equal(v.detail, c.detailExact, `the WHOLE rendered detail. Why: ${c.why}`);
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
  const gaps = [
    ...ALL.flatMap(([g, cs]) => cs.filter((c) => c.actual !== undefined).map((c) => `${g}: ${c.sentence}`)),
    // v3.5 CP2a — identifier gaps are COUNTED now. They could not be before: the
    // IDENTIFIERS array had no `actual` field, so an identifier defect was structurally
    // invisible to this assertion. Adding the mechanism found no pre-existing gaps
    // (every existing case still agrees with `correct`), so the count it contributes is
    // exactly the debts recorded deliberately.
    ...IDENTIFIERS.filter((i) => i.actual !== undefined).map((i) => `identifiers: ${i.label}`),
    ...LD_SELECTION.filter((c) => c.actual !== undefined).map((c) => `ld-selection: ${c.label}`),
    ...RULE_D.filter((c) => c.actual !== undefined).map((c) => `rule-d: ${c.label}`),
  ];
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
  //
  // 38 -> 42: v3.5 CP2c REVERTED THE CP2a GTIN WIDENING, AND FOUR RECALL GAPS CAME BACK
  // WITH IT. Read the direction correctly — this is FOUR DEFECTS DELIBERATELY
  // REINSTATED, which is a thing this corpus has never had to record before:
  //   • a check-digit-valid GTIN published only in a SINGLE nested node — three shapes,
  //     `offers[]`, `hasVariant[]` and an AggregateOffer's nested `offers`. Measured: 32
  //     of 338 captured real stores are in this class and are told they publish no
  //     identifier while they publish a real one.
  //   • an invalid `gtin13` hiding a VALID `gtin12` on the SAME product node — first
  //     non-empty key wins, not first publishable. Nobody attacked this one; CP2a fixed
  //     it in passing and the byte-identity revert took it back out.
  // They are gaps in RECALL. What CP2a traded for them was 11 regressions — 9 status
  // and 2 quote-only, every one attributed by an independent three-worktree A/B to the
  // same descent — including a page where the descent named the storefront's own product
  // key as the merchant's GTIN, which is the exact value rule D exists to reject. The
  // multi-variant class it answered is one `conflict_rules[1]` of ALS-COFFEE-1.3-IDENT-001
  // declares BLOCKED. A gap we can state ("we did not look") beats an answer we cannot
  // defend ("we read one variant's barcode and called it the product's").
  //
  // 42 -> 55: v3.5 CP2d PINS WHAT RULE D DOES NOT CLOSE, FROM THE SAME INDEPENDENT PASS.
  // Two moves, opposite signs:
  //
  //   −1  the SKU-echo case's `correct` field was WRONG, NOT THE ENGINE. It shipped as
  //       `correct: not_proven, actual: pass_evidenced` with a `why` whose own last
  //       sentence read "v1.3 deliberately does not disqualify a SKU echo per se". Per
  //       v1.3 `residual_risk`(2) + `pass_means`, `pass_evidenced` IS the honest answer.
  //       A corpus entry that contradicted itself on the next line counted as an engine
  //       debt for one commit. Corrected, not reclassified.                       -> 41
  //  +14  the 15 RESIDUALS the pass measured against rule D, minus D-05/EVA-13 which the
  //       existing variant-key case already pins. Every one FAILS OPEN — the merchant
  //       keeps their pass — and every one is a place the storefront's key is legible on
  //       the page and rule D does not reach it. Four classes: a DECORATED form of the
  //       key (EVA-03, D-06), a VARIANT key (EVA-14), the key legible OUTSIDE the one
  //       bootstrap we read (EVA-07, D-10, EVA-08/09/11/12, D-11, EVA-10, EVA-22), and
  //       the key in a DIFFERENT FIELD (EVA-15, EVA-21).                          -> 55
  //   +1  and one more the RE-RUN found, which no single-commit reading could have: the
  //       recall gap INTERSECTING rule D. X-01, X-04 and R15 are the only three status
  //       regressions that survive the revert against af6d387, and all three are one
  //       page shape — the mpn is the storefront key (rule D refuses it, correctly) and
  //       the only real GTIN is nested (the reverted selector cannot see it). Base
  //       passed them ON THE STOREFRONT KEY: right in status, wrong in evidence.  -> 56
  //
  // ⚠️ 14 CASES, FOUR CLASSES. The count is of cases and always has been; do not read
  // it as fourteen independent defects. They are pinned one fixture each because a
  // future widening of the bootstrap reader that closes two of EVA-08/09/11/12 must not
  // be able to claim the class — and because a rule stated only in a comment is not a
  // rule (v2.9's quantity guard broke the sentence its own comment named as a must-pass).
  //
  // ⚠️ AND THE RISE IS NOT THE STORY. Rule D itself took ZERO regressions across 78
  // cases in three worktrees. Every gap above is a limit of REACH, not a wrong answer
  // about a merchant. The one entry that is a mechanical bypass rather than a reach
  // limit — EVA-21, where zero-padding the key turns a rejected MPN into an accepted
  // GTIN-14 — is called out at its case and escalated in ENGINE_GAPS P-11.
  //
  // 36 -> 38: v3.5 CP2b RECORDS TWO IDENTIFIER GAPS THAT WERE ALWAYS THERE AND COULD
  // NOT BE COUNTED. Read the direction correctly — this is not two new defects, and it
  // is not two repairs either:
  //   • CP2a gave the identifier arrays an `actual` field. Before it, an identifier
  //     defect was structurally invisible to this assertion, which is how a whole class
  //     (v3.2 CP3's 18 false passes) could sit inside a corpus that reported 36 gaps.
  //     Adding the mechanism surfaced NO pre-existing gap: every case already written
  //     still agrees with `correct`.
  //   • CP2b closed the measured class (`mpn` === the storefront's product key, 23 of
  //     338 captured stores, 100% precision and recall on the 36 mpn-publishing
  //     products) and pinned the two neighbouring classes it deliberately did NOT
  //     close, each with the measurement that decided it: a VARIANT key (v1.3's wording
  //     covers it; 0 occurrences in 338, so widening would be unmeasured) and an `mpn`
  //     that echoes the `sku` (the rule that catches it scores 0% precision and fails
  //     seven compliant merchants).
  // A class that is closed in the engine and a class that is pinned in the corpus are
  // both progress; a class nobody can count is not.
  //
  // 56 -> 57: v3.5 CP3 pins ONE more case and it is +1 CASE, 0 NEW DEFECTS — say that
  // plainly, because the count is of cases and a rise that is really a second fixture
  // must not be read as the engine getting worse. `ship_pivot.ts` measured that 6 of the
  // 23 real stores rule D newly fails publish a check-digit-valid GTIN one node down;
  // three further scripts then classified WHERE, from the bytes, and the answer is the
  // same for all six: under a Product node the extractor does not SELECT, with NOTHING
  // reachable by descending from the node it does select (0 of 23 by descent, 6 of 23
  // across the graph — so P-06 answers none of them). The offers-under-the-selected-node
  // door was already pinned (X-01/X-04/R15). The node-selection door was pinned NOWHERE,
  // and could not be: `verdictOfLd` builds a page with one node, so a second,
  // non-selected Product node had no representation in this file at all.
  //   +1  rule-d: the GTIN on a Product node the extractor does not select (nomatic.com,
  //       reproduced from its captured bytes).                                    -> 57
  // The COPY defect the same measurement exposed added no gap and changed no status:
  // 338 stores replayed before and after, 2,847 rows, 0 status changes, 0 quote changes,
  // 23 detail changes and every one an identifier row. It is pinned as `detailExact` on
  // two rule-D cases instead — the shape with nothing else published and the shape with
  // a GTIN one node down must render the BYTE-IDENTICAL sentence, because the engine
  // does not look and therefore cannot tell them apart.
  //
  // 57 -> 60: v3.7 CP-1, from the FIRST complete row-by-row audit of the general sample —
  // 488 pass rows over 172 real stores, 18 confirmed false passes where the published
  // figure recorded ZERO. The arithmetic, one line per case, because a count that moves by
  // three needs three reasons:
  //   +1  the SIBLING product's size, reached by a cross-reference link, read as this
  //       product's measurement (askinosie.com, from its captured bytes).          -> 58
  //   +1  $0.00 accepted as a readable price, on five real stores that publish no price
  //       (knifewear, kosas, partakefoods, studioneat, tenthousand + branchbasics). -> 59
  //   +1  JSON-LD `InStock` reported over the page's own `"available":false`, with no
  //       surface anywhere saying true (lesserevil.com).                           -> 60
  //
  // ⚠️ +3 CASES, 18 CONFIRMED DEFECTS, AND THE DIFFERENCE IS NOT SLOPPINESS. Seven defect
  // classes were confirmed; four of them are UPSTREAM of the matcher this corpus probes,
  // in `fetchPublicProduct` / `priceToUsd`, and are structurally unrepresentable here — a
  // non-USD price (no currency field exists on `PublicProduct`), integer cents read as
  // dollars, a MISSING `available` field defaulted to purchasable, and a "lowest readable
  // price" that is the page's maximum. Read the gap as "the fetch and normalisation layer
  // has no adversarial corpus at all", not as four defects quietly dropped. ENGINE_GAPS
  // P-17 carries them with the numbers.
  // v4.5: 60 − 1 = 59. ENGINE_GAPS P-19's first half closed — `$0.00` is no longer read as
  // a price. One case, `price_under` / "placeholder", dropped its `actual`. Nothing else
  // moved: the second half of P-19 (the minimum over an offers array) was built, measured,
  // and REVERTED after an independent pass showed it let a junk sibling offer coerce to 0
  // and beat a real published price, so no case changes for it.
  const EXPECTED_OPEN_GAPS = 59;
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
