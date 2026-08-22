// ===========================================================================
// THE LEGITIMACY CORPUS — cases as DATA, executed against the real `evaluate`.
//
// The existing `adversarialCorpus.test.ts` probes whether the matcher reads a SENTENCE
// correctly. This corpus probes a different failure, one that corpus structurally cannot
// see: the matcher read the page perfectly, the sentence it produced is TRUE, and it is
// still not a finding.
//
//   "No organic claim appears."      true, and not a defect on a conventional coffee
//   "No single-origin claim appears." true, and not a defect on a deliberate blend
//   "No Ground variant found."        true, and not a defect when the page sells two grinds
//
// So every case asserts TWO INDEPENDENT THINGS, and they are recorded separately because
// they fail separately:
//
//   1. FACTUAL CORRECTNESS  — is the `status` what the evidence supports?
//   2. FINDING LEGITIMACY   — is raising this as a deficiency reasonable and useful?
//
// A case can be correct on (1) and wrong on (2). That combination is the entire subject
// of this file, and it is invisible to any suite that only checks statuses.
//
// ⚠️ `direction` IS LOAD-BEARING AND THE RUNNER ENFORCES ITS BALANCE. `hostile` cases say
// "do not raise this"; `must_not_regress` cases say "raise this, or the gate has eaten a
// real finding". A suppression gate scores 100% on hostile cases alone while quietly
// deleting the findings the business runs on — this system has measured that exact
// outcome once already (v2.6: 16/16 on its own set, independently measured as 7 false
// passes closed against 46 false fails opened). The runner FAILS a category whose
// must_not_regress share falls below the floor, so the balance cannot rot by accretion.
//
// ⚠️ `knownGap: true` RECORDS A CASE THE ENGINE GETS WRONG TODAY. The expectation stays
// TRUE-CORRECT; the runner counts these and pins the count. Softening an expectation to
// make a case pass is the one edit that must never happen here, because it converts a
// defect into a specification.
//
// Pure: no network, no DB, no model calls, no clock.
// ===========================================================================

import { mkExtracted, type MkOptions } from "./adversarial.js";
import type { AssertionStatus, NotActionableReason, Expectation } from "../../src/server/productTest.js";

export type Category = "coffee" | "apparel" | "footwear" | "electronics" | "furniture" | "beauty";

export interface CaseRequirement {
  kind: "claim" | "attribute" | "variant_option" | "delivery" | "in_stock" | "identifiers" | "no_subscription";
  claim?: string;
  attribute?: string;
  optionValue?: string;
  satisfiedByOptionValues?: string[];
  expectation?: Expectation;
  label?: string;
}

export interface LegitimacyCase {
  /** Unique within a category. Used as the failure name, so make it read like one. */
  name: string;
  category: Category;
  /** Which class of mistake this probes, in one sentence. */
  why: string;
  direction: "hostile" | "must_not_regress";
  product: MkOptions;
  requirement: CaseRequirement;
  expect: {
    status: AssertionStatus;
    /** true = this negative IS a legitimate deficiency. Always true for a passing status. */
    actionable: boolean;
    /** Expected `notActionable.reason` when `actionable` is false. */
    reason?: NotActionableReason;
  };
  /** The engine is wrong about this case today, and the expectation above is the truth. */
  knownGap?: boolean;
}

// ---------------------------------------------------------------------------
// COFFEE — the category the defect was found in, so it carries the deepest set.
// ---------------------------------------------------------------------------

const COFFEE_GRINDS = ["Espresso", "Filter", "Drip", "Pour Over", "French Press", "Espresso Grind", "Filter Grind"];

export const COFFEE: LegitimacyCase[] = [
  {
    name: "conventional coffee is not missing an organic claim",
    category: "coffee",
    why: "Absence of a voluntary certification is not a defect; the merchant cannot state it truthfully without holding it.",
    direction: "hostile",
    product: { title: "Nano Challa", productType: "Coffee", description: "Roasted in small batches. Notes of peach and jasmine." },
    requirement: { kind: "claim", claim: "organic" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a deliberate blend is not missing a single-origin claim",
    category: "coffee",
    why: "The page answered the buyer question in the negative; the entry can only evidence one of its two legitimate answers.",
    direction: "hostile",
    product: { title: "Sidecar Espresso Blend", productType: "Coffee", description: "A blend of Colombian and Ethiopian beans, built for milk drinks." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a house blend named only in the title still counters single-origin",
    category: "coffee",
    why: "The title is the merchant's own name for the product and is an evidence surface, so the counter must reach it.",
    direction: "hostile",
    product: { title: "House Blend", productType: "Coffee", description: "Our everyday cup. Chocolate and toffee.", extraEvidence: [{ surface: "product_title", text: "House Blend" }] },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "fair trade absent on a direct-trade roaster is not a defect",
    category: "coffee",
    why: "A scheme claim is a scheme membership; a roaster buying outside every scheme has nothing to state.",
    direction: "hostile",
    product: { title: "Finca La Esperanza", productType: "Coffee", description: "Bought direct from the producer, at a price we publish annually." },
    requirement: { kind: "claim", claim: "fair_trade" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a single-format ground SKU is not missing whole bean",
    category: "coffee",
    why: "With no variant axis at all, whether whole bean is sold elsewhere is a catalogue question a product page cannot settle.",
    direction: "hostile",
    product: {
      title: "Classic Black Ground Coffee - 10oz", productType: "Coffee",
      variants: [{ title: "Default Title", priceUsd: 15, available: true, options: ["Default Title"] }],
    },
    requirement: { kind: "variant_option", optionValue: "Whole Bean" },
    expect: { status: "requires_store_access", actionable: false, reason: "catalog_level_unknown" },
  },
  {
    name: "a product titled Ground Coffee proves Ground from its own title",
    category: "coffee",
    why: "The v2.7.0 case. A page that names the format has answered the buyer, dropdown or no dropdown.",
    direction: "must_not_regress",
    product: {
      title: "Classic Black Ground Coffee - 10oz", productType: "Coffee",
      variants: [{ title: "Default Title", priceUsd: 15, available: true, options: ["Default Title"] }],
    },
    requirement: { kind: "variant_option", optionValue: "Ground" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "two named grinds answer can-I-buy-this-ground",
    category: "coffee",
    why: "The Bird Rock bullet. Espresso and Filter ARE ground; demanding an option literally named Ground is a word game.",
    direction: "hostile",
    product: {
      title: "Miraflores Pink Bourbon", productType: "Coffee",
      optionValues: ["Whole Bean", "Espresso", "Filter"],
      variants: [
        { title: "Whole Bean", priceUsd: 22, available: true, options: ["Whole Bean"] },
        { title: "Espresso", priceUsd: 22, available: true, options: ["Espresso"] },
        { title: "Filter", priceUsd: 22, available: true, options: ["Filter"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Ground", satisfiedByOptionValues: COFFEE_GRINDS },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a SIZE axis must not be read as a grind axis",
    category: "coffee",
    why: "The false-equivalence risk of the declared-equivalents mechanism, which would silence a true finding.",
    direction: "must_not_regress",
    product: {
      title: "House Roast", productType: "Coffee",
      optionValues: ["8oz", "12oz", "2lb"],
      variants: [
        { title: "8oz", priceUsd: 14, available: true, options: ["8oz"] },
        { title: "12oz", priceUsd: 18, available: true, options: ["12oz"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Ground", satisfiedByOptionValues: COFFEE_GRINDS },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "blend as a VERB in a tasting note must not suppress single-origin",
    category: "coffee",
    why: "The counter list is phrases, not bare words, precisely so this sentence cannot silence a real finding.",
    direction: "must_not_regress",
    product: { title: "Ethiopia Guji", productType: "Coffee", description: "The flavours blend beautifully with a splash of milk." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a stated single-origin claim still passes",
    category: "coffee",
    why: "The gate must not cost a pass. Suppressing the negative is worthless if it also stops evidencing the positive.",
    direction: "must_not_regress",
    product: { title: "Nano Challa", productType: "Coffee", description: "A single origin lot from the Nano Challa co-operative in Ethiopia." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "a stated organic claim still passes",
    category: "coffee",
    why: "Same, for the claim the whole gate was built around. A conditional claim is still evidenced when the page states it.",
    direction: "must_not_regress",
    product: { title: "Peru Organico", productType: "Coffee", description: "Certified organic by CCOF, grown at 1,800m in Cajamarca." },
    requirement: { kind: "claim", claim: "organic" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "a genuinely missing net weight stays a finding",
    category: "coffee",
    why: "Example D. Every bag of coffee has a weight, so its absence is remediable truthfully today. The highest-value finding the standard produces.",
    direction: "must_not_regress",
    product: { title: "House Roast", productType: "Coffee", description: "Our flagship roast. Chocolate and toffee." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a genuinely missing delivery window stays a finding",
    category: "coffee",
    why: "Example E. Every store that ships has a dispatch time, and a shopper cannot buy without it.",
    direction: "must_not_regress",
    // ⚠️ `policyStatus: "readable"` IS THE POINT OF THIS FIXTURE, not scaffolding. Left
    // unset, the engine returns `requires_store_access` because it never got to look, and
    // the case would measure "we could not read the policy" instead of "the policy is
    // readable and states nothing". Those are the two sides of the finding-versus-accusation
    // rule, and a corpus that confused them would be testing the wrong thing in the right
    // shape. Every delivery case below sets it for the same reason.
    product: { title: "House Roast", productType: "Coffee", description: "Our flagship roast.", policyStatus: "readable" },
    requirement: { kind: "delivery" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a genuinely missing identifier stays a finding",
    category: "coffee",
    why: "Rare in the category and still required information: a machine buyer cannot match the product without one.",
    direction: "must_not_regress",
    // Same distinction as the delivery cases: with `extracted` null the engine reports
    // that it could not read the markup at all. `mkExtracted({})` gives readable Product
    // markup that publishes no GTIN and no MPN, which is the finding under test.
    product: { title: "House Roast", productType: "Coffee", description: "Our flagship roast.", extracted: mkExtracted({}) },
    requirement: { kind: "identifiers" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a standard may force a conditional claim to required",
    category: "coffee",
    why: "The standard is the published document and overrules the engine's register. Without this the gate cannot be steered by a standard that means it.",
    direction: "must_not_regress",
    product: { title: "House Roast", productType: "Coffee", description: "Our flagship roast." },
    requirement: { kind: "claim", claim: "organic", expectation: "required" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "an unavailable variant is a finding, not a catalogue unknown",
    category: "coffee",
    why: "Listed-but-sold-out is a fact about THIS page, unlike the axis-less case, and the two must not collapse.",
    direction: "must_not_regress",
    product: {
      title: "Ethiopia Guji", productType: "Coffee", optionValues: ["Whole Bean", "Ground"],
      variants: [
        { title: "Whole Bean", priceUsd: 20, available: true, options: ["Whole Bean"] },
        { title: "Ground", priceUsd: 20, available: false, options: ["Ground"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Ground", satisfiedByOptionValues: COFFEE_GRINDS },
    expect: { status: "not_proven", actionable: true },
  },
];

// ---------------------------------------------------------------------------
// APPAREL
// ---------------------------------------------------------------------------

export const APPAREL: LegitimacyCase[] = [
  {
    name: "a conventional cotton tee is not missing an organic claim",
    category: "apparel",
    why: "Same class as coffee, different category: organic cotton is a sourcing fact, not a page requirement.",
    direction: "hostile",
    product: { title: "Everyday Tee", productType: "Apparel", description: "A midweight cotton tee cut for a relaxed fit." },
    requirement: { kind: "claim", claim: "organic" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a leather jacket is not missing a vegan claim",
    category: "apparel",
    why: "The product's own material contradicts the claim. Demanding it asks the merchant to lie about the product.",
    direction: "hostile",
    product: { title: "Rider Jacket", productType: "Apparel", description: "Full-grain leather, waxed cotton lining, contains animal hide." },
    requirement: { kind: "claim", claim: "vegan" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a genuinely missing material composition stays a finding",
    category: "apparel",
    why: "Every garment is made of something, and a shopper cannot judge fit, care or allergy without it.",
    direction: "must_not_regress",
    product: { title: "Everyday Tee", productType: "Apparel", description: "Cut for a relaxed fit. Pre-shrunk and ready to wear." },
    requirement: { kind: "attribute", attribute: "materials" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a stated material composition passes",
    category: "apparel",
    why: "The control for the case above. A gate that suppressed this would be deleting the category's best finding.",
    direction: "must_not_regress",
    product: { title: "Everyday Tee", productType: "Apparel", description: "Made from 100% organic cotton, milled in Portugal." },
    requirement: { kind: "attribute", attribute: "materials" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "colour carried only as a variant is not a missing description",
    category: "apparel",
    why: "The answer is on the page in the option list; demanding it in prose tests wording, not readability.",
    direction: "hostile",
    product: {
      title: "Everyday Tee", productType: "Apparel", description: "Midweight cotton, relaxed fit.",
      optionValues: ["Black", "Ecru", "Navy"],
      variants: [
        { title: "Black", priceUsd: 32, available: true, options: ["Black"] },
        { title: "Ecru", priceUsd: 32, available: true, options: ["Ecru"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Colour", satisfiedByOptionValues: ["Black", "Ecru", "Navy"] },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a genuinely missing care instruction stays a finding on a textile",
    category: "apparel",
    why: "Care is a real buyer constraint for a garment, and every garment has one.",
    direction: "must_not_regress",
    product: { title: "Merino Crew", productType: "Sweaters", description: "Fine-gauge merino wool in a classic crew neck." },
    requirement: { kind: "attribute", attribute: "care" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a cruelty-free claim is not expected of a cotton tee",
    category: "apparel",
    why: "The 13-of-13 defect this engine already fixed once by narrowing generation; the gate must hold it in the standards path too.",
    direction: "hostile",
    product: { title: "Everyday Tee", productType: "Apparel", description: "Midweight cotton, relaxed fit." },
    requirement: { kind: "claim", claim: "cruelty_free" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a stated vegan claim on a synthetic still passes",
    category: "apparel",
    why: "Conditional does not mean unevidenceable. A page that states it gets the pass.",
    direction: "must_not_regress",
    product: { title: "Puffer Vest", productType: "Apparel", description: "100% vegan insulation, recycled polyester shell." },
    requirement: { kind: "claim", claim: "vegan" },
    expect: { status: "pass_evidenced", actionable: true },
  },
];

// ---------------------------------------------------------------------------
// FOOTWEAR
// ---------------------------------------------------------------------------

export const FOOTWEAR: LegitimacyCase[] = [
  {
    name: "an open sandal is not missing a waterproofing claim",
    category: "footwear",
    why: "The category contradicts the claim. A knowledgeable merchant would ask why they would ever put that on this product.",
    direction: "hostile",
    product: { title: "Coastal Sandal", productType: "Sandals", description: "An open-toe leather sandal with an adjustable ankle strap." },
    requirement: { kind: "claim", claim: "third_party_tested" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a genuinely missing size axis stays a finding",
    category: "footwear",
    why: "Every shoe has a size, and a shopper literally cannot buy without one.",
    direction: "must_not_regress",
    product: {
      title: "Trail Runner", productType: "Footwear", description: "A cushioned trail shoe with a rock plate.",
      variants: [{ title: "Default Title", priceUsd: 140, available: true, options: ["Default Title"] }],
    },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a width axis is not answered by a size axis",
    category: "footwear",
    why: "Two genuinely different axes; collapsing them would silence a real fit gap.",
    direction: "must_not_regress",
    product: {
      title: "Trail Runner", productType: "Footwear", optionValues: ["8", "9", "10", "11"],
      variants: [
        { title: "9", priceUsd: 140, available: true, options: ["9"] },
        { title: "10", priceUsd: 140, available: true, options: ["10"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Wide", satisfiedByOptionValues: ["EE", "2E", "Wide Fit"] },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a wide fitting under another name satisfies the width question",
    category: "footwear",
    why: "The declared-equivalence mechanism, in a second category, so it is not a coffee special case.",
    direction: "hostile",
    product: {
      title: "Trail Runner", productType: "Footwear", optionValues: ["D", "2E"],
      variants: [
        { title: "D", priceUsd: 140, available: true, options: ["D"] },
        { title: "2E", priceUsd: 140, available: true, options: ["2E"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Wide", satisfiedByOptionValues: ["EE", "2E", "Wide Fit"] },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a genuinely missing material stays a finding on a shoe",
    category: "footwear",
    why: "Upper material decides breathability, care and durability; every shoe has one.",
    direction: "must_not_regress",
    product: { title: "Coastal Sandal", productType: "Footwear", description: "An open-toe sandal with an adjustable ankle strap." },
    requirement: { kind: "attribute", attribute: "materials" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a missing delivery window stays a finding on footwear",
    category: "footwear",
    why: "Category-independent required information. If the gate is category-shaped, this is where it shows.",
    direction: "must_not_regress",
    product: { title: "Trail Runner", productType: "Footwear", description: "A cushioned trail shoe.", policyStatus: "readable" },
    requirement: { kind: "delivery" },
    expect: { status: "not_proven", actionable: true },
  },
];

// ---------------------------------------------------------------------------
// ELECTRONICS
// ---------------------------------------------------------------------------

export const ELECTRONICS: LegitimacyCase[] = [
  {
    name: "a mains-powered device is not missing a battery-life claim",
    category: "electronics",
    why: "Example of a requirement that is irrelevant for the product class; the page says it plugs in.",
    direction: "hostile",
    product: { title: "Studio Desk Lamp", productType: "Lighting", description: "Plugs into any wall outlet. No batteries required." },
    requirement: { kind: "claim", claim: "third_party_tested" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a genuinely missing dimension stays a finding on hardware",
    category: "electronics",
    why: "Every physical device has dimensions, and desk fit is a real purchase blocker.",
    direction: "must_not_regress",
    product: { title: "Studio Monitor", productType: "Speakers", description: "A two-way nearfield monitor with a silk dome tweeter." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a genuinely missing identifier stays a finding on electronics",
    category: "electronics",
    why: "The category where GTIN matching matters most: a machine buyer cannot price-compare without it.",
    direction: "must_not_regress",
    product: { title: "Studio Monitor", productType: "Speakers", description: "A two-way nearfield monitor.", extracted: mkExtracted({}) },
    requirement: { kind: "identifiers" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a stated dimension passes on electronics",
    category: "electronics",
    why: "The control. A spec block is the normal shape here and must still evidence.",
    direction: "must_not_regress",
    product: { title: "Studio Monitor", productType: "Speakers", description: "Cabinet dimensions are 7.9 inches wide by 11.1 inches tall." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "a BPA-free claim is not expected of a speaker",
    category: "electronics",
    why: "A food-contact claim demanded of a non-food-contact product. The clearest why-would-I-ever case in the set.",
    direction: "hostile",
    product: { title: "Studio Monitor", productType: "Speakers", description: "A two-way nearfield monitor." },
    requirement: { kind: "claim", claim: "bpa_free" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a bundled accessory list is not a missing standalone claim",
    category: "electronics",
    why: "Bundle composition is merchandising, and the page already answers it in the option list.",
    direction: "hostile",
    product: {
      title: "Studio Monitor", productType: "Speakers", optionValues: ["Single", "Pair"],
      variants: [
        { title: "Single", priceUsd: 349, available: true, options: ["Single"] },
        { title: "Pair", priceUsd: 649, available: true, options: ["Pair"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Stereo Pair", satisfiedByOptionValues: ["Pair", "Two-pack"] },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
];

// ---------------------------------------------------------------------------
// FURNITURE
// ---------------------------------------------------------------------------

export const FURNITURE: LegitimacyCase[] = [
  {
    name: "a genuinely missing dimension stays a finding on furniture",
    category: "furniture",
    why: "The category where dimensions are the purchase decision. If the gate eats this it is worthless.",
    direction: "must_not_regress",
    product: { title: "Oak Side Table", productType: "Tables", description: "A solid oak side table with a hand-rubbed finish." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a stated dimension passes on furniture",
    category: "furniture",
    why: "The control for the case above.",
    direction: "must_not_regress",
    product: { title: "Oak Side Table", productType: "Tables", description: "Dimensions are 18 inches wide by 22 inches tall." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "an explicitly indoor piece is not missing an outdoor rating",
    category: "furniture",
    why: "Applicability contradicted by the product's stated use. Demanding it invites a false weatherproofing claim.",
    direction: "hostile",
    product: { title: "Oak Side Table", productType: "Tables", description: "For indoor use only. The oiled finish is not weather resistant." },
    requirement: { kind: "claim", claim: "third_party_tested" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a genuinely missing material stays a finding on furniture",
    category: "furniture",
    why: "Solid wood against veneer is the single biggest price driver in the category.",
    direction: "must_not_regress",
    product: { title: "Side Table", productType: "Tables", description: "A clean-lined side table for a reading corner." },
    requirement: { kind: "attribute", attribute: "materials" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a set sold as pieces answers the piece-count question in its options",
    category: "furniture",
    why: "The declared-equivalence mechanism against a set-versus-component axis.",
    direction: "hostile",
    product: {
      title: "Dining Chair", productType: "Chairs", optionValues: ["Set of 2", "Set of 4"],
      variants: [
        { title: "Set of 2", priceUsd: 420, available: true, options: ["Set of 2"] },
        { title: "Set of 4", priceUsd: 780, available: true, options: ["Set of 4"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Pair", satisfiedByOptionValues: ["Set of 2", "2-pack"] },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a missing delivery window stays a finding on furniture",
    category: "furniture",
    why: "The category with the longest lead times, so the absence costs the shopper most.",
    direction: "must_not_regress",
    product: { title: "Oak Side Table", productType: "Tables", description: "A solid oak side table.", policyStatus: "readable" },
    requirement: { kind: "delivery" },
    expect: { status: "not_proven", actionable: true },
  },
];

// ---------------------------------------------------------------------------
// SKINCARE / BEAUTY — the category where an absence must never become a
// medical or safety conclusion.
// ---------------------------------------------------------------------------

export const BEAUTY: LegitimacyCase[] = [
  {
    name: "a deliberately fragranced product is not missing a fragrance-free claim",
    category: "beauty",
    why: "The page states the opposite as a FEATURE. Reporting the absence would invert the product proposition.",
    direction: "hostile",
    product: { title: "Neroli Hand Cream", productType: "Skincare", description: "Scented with added fragrance from neroli and bitter orange." },
    requirement: { kind: "claim", claim: "fragrance_free" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "an unstated paraben-free claim is not a defect",
    category: "beauty",
    why: "A free-from claim is voluntary. Its absence says nothing about the formula, and reporting it as a gap implies it does.",
    direction: "hostile",
    product: { title: "Daily Moisturiser", productType: "Skincare", description: "A light daily moisturiser with squalane and glycerin." },
    requirement: { kind: "claim", claim: "paraben_free" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "an unstated cruelty-free claim is not a defect",
    category: "beauty",
    why: "The original 13-of-13 template finding, in the category it came from.",
    direction: "hostile",
    product: { title: "Daily Moisturiser", productType: "Skincare", description: "A light daily moisturiser." },
    requirement: { kind: "claim", claim: "cruelty_free" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a stated fragrance-free claim passes",
    category: "beauty",
    why: "The control. Shoppers with sensitivities rely on this, and the gate must not cost the pass.",
    direction: "must_not_regress",
    product: { title: "Barrier Balm", productType: "Skincare", description: "Fragrance-free and formulated for reactive skin." },
    requirement: { kind: "claim", claim: "fragrance_free" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "a genuinely missing net quantity stays a finding on skincare",
    category: "beauty",
    why: "Price per millilitre is uncomputable without it, and every jar has a fill volume.",
    direction: "must_not_regress",
    product: { title: "Daily Moisturiser", productType: "Skincare", description: "A light daily moisturiser with squalane." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a stated net quantity passes on skincare",
    category: "beauty",
    why: "The control for the case above.",
    direction: "must_not_regress",
    product: { title: "Daily Moisturiser", productType: "Skincare", description: "Net contents 50 ml in a recyclable glass jar." },
    requirement: { kind: "attribute", attribute: "dimensions" },
    expect: { status: "pass_evidenced", actionable: true },
  },
  {
    name: "a stated gluten-containing ingredient is not a gluten-free defect",
    category: "beauty",
    why: "The absence is a property of the formula, not a fault in the page. Fixing it would mean changing the product.",
    direction: "hostile",
    product: { title: "Oat Cleansing Balm", productType: "Skincare", description: "Contains wheat protein for slip and cushion." },
    requirement: { kind: "claim", claim: "gluten_free" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a missing delivery window stays a finding on skincare",
    category: "beauty",
    why: "Category-independent required information, asserted in the sixth category so a category-shaped gate is visible.",
    direction: "must_not_regress",
    product: { title: "Daily Moisturiser", productType: "Skincare", description: "A light daily moisturiser.", policyStatus: "readable" },
    requirement: { kind: "delivery" },
    expect: { status: "not_proven", actionable: true },
  },
];

// ---------------------------------------------------------------------------
// THE ADVERSARIAL PASS. Every case below was found by an independent review that
// EXECUTED this gate against 292 constructed products across the six categories, and
// each one pins a defect the review found in the GATE rather than in the engine it
// sits on. They are kept together because that review is the reason they exist, and
// because the false-suppression cases are the ones that must never rot: a missed
// counter leaves a row unpromoted, a FALSE counter deletes a true finding in silence.
// ---------------------------------------------------------------------------

export const ADVERSARIAL: LegitimacyCase[] = [
  {
    name: "a bare Blend in the TITLE counters single-origin",
    category: "coffee",
    why: "The identity counter. The phrase list cannot carry a bare `blend` (it is a verb in body copy), but a product NAMED X Blend is a blend, and that is the commonest naming convention in the category. Same authority v2.7.0 uses to prove a format from the title.",
    direction: "hostile",
    product: { title: "Hometown Blend", productType: "Coffee", description: "Our everyday cup. Chocolate and toffee." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a bare blend in BODY COPY does not counter single-origin",
    category: "coffee",
    why: "The other half of the identity rule, and the reason it is limited to title and product type. In prose `blend` is a verb, so the same word that is decisive in a name is worthless in a sentence.",
    direction: "must_not_regress",
    product: { title: "Ethiopia Guji", productType: "Coffee", description: "The flavours blend beautifully with a splash of milk." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a URL slug is never an identity signal",
    category: "coffee",
    why: "Measured live: sweetbloomcoffee.com/products/hometown-blend has the product TITLE `Hometown`, with `blend` only in the handle. The standard names collection handles and URL slugs under category_signals.never, as merchant-controlled naming rather than evidence, and the counter must obey that too.",
    direction: "must_not_regress",
    product: { title: "Hometown", productType: "Coffee", description: "Our everyday cup." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a tasting note using blend-of must not counter single-origin",
    category: "coffee",
    why: "FALSE SUPPRESSION. 'Expect a blend of red apple, brown sugar and jasmine in the cup' is the commonest tasting-note wording in specialty coffee and contains a counter phrase verbatim, so it was deleting the single-origin finding on a named Colombian lot. Closed by counterGuard.",
    direction: "must_not_regress",
    product: { title: "Miraflores Pink Bourbon", productType: "Coffee", description: "Expect a blend of red apple, brown sugar and jasmine in the cup." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a store meta description must not counter this product",
    category: "coffee",
    why: "FALSE SUPPRESSION. The page furniture advertises the rest of the catalogue and is not evidence about THIS lot. Closed by COUNTER_SURFACES, the same asymmetry the claim branch already applies to the shipping policy.",
    direction: "must_not_regress",
    product: {
      title: "Miraflores Pink Bourbon", productType: "Coffee",
      description: "A washed Colombian lot from the Huila department.",
      extraEvidence: [{ surface: "meta_description", text: "Shop our house blend subscriptions and seasonal lots." }],
    },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "a real blend statement still counters, guard and all",
    category: "coffee",
    why: "The control for the two above. Guarding and narrowing the counter is only correct if the counter still fires where it should.",
    direction: "hostile",
    product: { title: "Sidecar Espresso Blend", productType: "Coffee", description: "Our house blend brings together beans from three farms." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a tasting note and a real blend line on one page still counters",
    category: "coffee",
    why: "Why counterGuard is passed as the findSupport valueGuard rather than checked on the returned quote: a rejected sentence must skip to the next one, not decide the row.",
    direction: "hostile",
    product: { title: "Daybreak", productType: "Coffee", description: "Expect notes of cocoa and orange in the cup. This is our house blend of Brazilian and Guatemalan beans." },
    requirement: { kind: "claim", claim: "single_origin" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a declared equivalent must not match inside a longer value",
    category: "beauty",
    why: "FALSE SUPPRESSION. 30 ml occurs inside 130 ml, so a serum sold only in 130 ml had its genuinely missing travel size removed from the finding list. Word bounding does not close it, because the engine bounds on a letter class and 1 is a digit, so equivalences match exact option values.",
    direction: "must_not_regress",
    product: {
      title: "Vitamin C Serum", productType: "Serum", optionValues: ["130 ml"],
      variants: [{ title: "130 ml", priceUsd: 78, available: true, options: ["130 ml"] }],
    },
    requirement: { kind: "variant_option", optionValue: "Travel Size", satisfiedByOptionValues: ["30 ml"] },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a declared equivalent must not match inside a longer word",
    category: "beauty",
    why: "The word form of the same false suppression, kept separately because it needed the same fix for a different reason: Mini sits inside Minimal Ingredient Edition, which is not a size at all.",
    direction: "must_not_regress",
    product: {
      title: "Cleansing Balm", productType: "Skincare", optionValues: ["Minimal Ingredient Edition"],
      variants: [{ title: "Minimal Ingredient Edition", priceUsd: 40, available: true, options: ["Minimal Ingredient Edition"] }],
    },
    requirement: { kind: "variant_option", optionValue: "Travel Size", satisfiedByOptionValues: ["Mini"] },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a declared equivalent that is SOLD OUT does not answer the buyer",
    category: "beauty",
    why: "Pins the availability condition in the equivalence loop. An option the shopper cannot buy has not answered them.",
    direction: "must_not_regress",
    product: {
      title: "Vitamin C Serum", productType: "Serum", optionValues: ["30 ml", "100 ml"],
      variants: [
        { title: "30 ml", priceUsd: 32, available: false, options: ["30 ml"] },
        { title: "100 ml", priceUsd: 78, available: true, options: ["100 ml"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Travel Size", satisfiedByOptionValues: ["30 ml", "Mini"] },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a multi-axis variant title still resolves a declared equivalent",
    category: "coffee",
    why: "The control for the exact-match fix. Titles read Filter Grind / 12 oz, so tightening to exact values would break every multi-axis store if the title were not split on its separator first.",
    direction: "hostile",
    product: {
      title: "Ethiopia Yirgacheffe", productType: "Coffee", optionValues: ["Whole Bean", "Filter Grind", "12 oz"],
      variants: [
        { title: "Whole Bean / 12 oz", priceUsd: 20, available: true, options: ["Whole Bean", "12 oz"] },
        { title: "Filter Grind / 12 oz", priceUsd: 20, available: true, options: ["Filter Grind", "12 oz"] },
      ],
    },
    requirement: { kind: "variant_option", optionValue: "Ground", satisfiedByOptionValues: ["Filter Grind", "Espresso Grind"] },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a standard declaring a NON-claim row conditional is obeyed",
    category: "electronics",
    why: "The declaration was a silent no-op: requirementExpectation only STAMPED it, and the one branch that gated on it lived inside case claim. A sidecar field that looks authoritative and changes nothing is the attr:warranty failure the applicability module exists to end.",
    direction: "hostile",
    product: { title: "Drift Wireless Earbuds", productType: "Earbuds", description: "Pair the earbuds to your phone and start listening." },
    requirement: { kind: "attribute", attribute: "care", expectation: "conditional" },
    expect: { status: "not_proven", actionable: false, reason: "optional_unstated" },
  },
  {
    name: "an undeclared row of the same kind stays actionable",
    category: "electronics",
    why: "The control for the case above, and the reason it is safe: the override reaches only rows a standard has explicitly declared. Nothing in the coffee sidecar declares a non-claim row conditional, so nothing in production moved.",
    direction: "must_not_regress",
    product: { title: "Drift Wireless Earbuds", productType: "Earbuds", description: "Pair the earbuds to your phone and start listening." },
    requirement: { kind: "attribute", attribute: "care" },
    expect: { status: "not_proven", actionable: true },
  },
  {
    name: "a leather armchair is contradicted, not merely unstated",
    category: "furniture",
    why: "Right actionability reached by the wrong reading. The reason is what a merchant-facing report prints, and does not apply here reads very differently from optional.",
    direction: "hostile",
    product: { title: "Halden Leather Armchair", productType: "Armchairs", description: "Upholstered in full-grain aniline leather that develops a patina with use." },
    requirement: { kind: "claim", claim: "vegan" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "a shampoo built on SLS is contradicted, not merely unstated",
    category: "beauty",
    why: "The same class in the category where free-from claims are densest.",
    direction: "hostile",
    product: { title: "Clarifying Shampoo", productType: "Shampoo", description: "A deep-clean shampoo built on sodium laureth sulfate for a rich, fast-rinsing lather." },
    requirement: { kind: "claim", claim: "sulfate_free" },
    expect: { status: "not_proven", actionable: false, reason: "contradicted_by_evidence" },
  },
  {
    name: "an animal-free upper is not read as stating the opposite",
    category: "footwear",
    why: "KNOWN GAP, with the fix known and deliberately deferred. `contains animal` is a substring of `contains animal-free`, and findViolation discards an overlap only when a SUPPORTING term extends past the violating span, so the phrase has to be in `support` — one line, filed at ENGINE_GAPS P-30 with its measured cost, which is re-deriving the G-14 table and suite 2.0. Recorded rather than banked because G-11 already stops this row being PROMOTED; only the reason it records is wrong. TRUE-CORRECT: pass_evidenced, actionable.",
    direction: "must_not_regress",
    product: { title: "Plant Runner", productType: "Sneakers", description: "The upper contains animal-free microsuede backed with recycled foam." },
    requirement: { kind: "claim", claim: "vegan" },
    expect: { status: "pass_evidenced", actionable: true },
    knownGap: true,
  },
];

export const ALL_CASES: LegitimacyCase[] = [
  ...COFFEE, ...APPAREL, ...FOOTWEAR, ...ELECTRONICS, ...FURNITURE, ...BEAUTY, ...ADVERSARIAL,
];
