import type { EvidenceSurface, ShoppingConstraint, ShoppingTaskContract } from "../../types.js";
import { safeConstraintId } from "../../compiler.js";
import { registerTermFixtures, type TermFixture } from "../../evidence-validator.js";
import { NO_SUBSCRIPTION_TERMS, SUBSCRIPTION_VIOLATION_TERMS } from "../../contract2.js";

// ===========================================================================
// STAGE 6.2 — Category contract library v2, category: coffee. The second
// reusable entry (after deodorant), chosen because coffee is variant- and
// logistics-rich (grind/size variants, one-time vs subscription, roast-date
// freshness, decaf process) — the report's open question about whether the
// one-dominant-gap depth generalizes or whether a richer category yields
// multi-gap diagnoses. Same discipline as deodorant: every constraint is an
// EVIDENCE-AVAILABILITY check, never a product-truth claim. On PUBLIC data,
// `bindContractToPublicSnapshot` demotes any constraint whose surfaces are all
// not_inspectable (metafields/faq) to observational (Rule 4).
// ===========================================================================

// ---- coffee-specific deterministic term fixtures (registered additively) ---
// These are DISCLOSURE checks: does the public product data STATE the thing in
// a form an AI assistant can read? Never an assertion about the product itself.
export const COFFEE_TERM_FIXTURES: Record<string, TermFixture> = {
  single_origin: {
    supportTerms: ["single origin", "single-origin", "single estate", "single-estate", "single farm", "single-farm", "single producer"],
  },
  roast_date_disclosed: {
    supportTerms: [
      "roasted to order", "roast date", "roasted on", "roasted weekly", "roast-to-order", "roasted-to-order",
      "roasted per order", "roasted after you order", "roasted the same day", "roasted fresh weekly", "date roasted", "roasted within",
    ],
  },
  decaf_method_disclosed: {
    supportTerms: [
      "swiss water", "swiss-water", "water process", "co2 process", "carbon dioxide process", "sugarcane process",
      "sugar cane process", "ethyl acetate", "mountain water", "natural decaffeination", "chemical-free decaf",
    ],
  },
  fair_trade: { supportTerms: ["fair trade", "fair-trade", "fairtrade", "fair trade certified", "fairtrade certified"] },
  organic_certified: { supportTerms: ["usda organic", "certified organic", "usda-organic", "certified-organic", "organic certified"] },
};
registerTermFixtures(COFFEE_TERM_FIXTURES);

const S: Record<string, EvidenceSurface[]> = {
  claim: ["product_description", "product_metafields", "structured_data", "faq"],
  price: ["product_variants", "structured_data"],
  subscription: ["product_description", "faq"],
  roast: ["product_description", "structured_data", "faq"],
  process: ["product_description", "product_metafields", "structured_data", "faq"],
};

function c(attribute: string, i: number, operator: ShoppingConstraint["operator"], surfaces: EvidenceSurface[], expectedValue?: unknown): ShoppingConstraint {
  return { id: safeConstraintId(attribute, i), attribute, operator, expectedValue, evidenceRequired: true, acceptableSurfaces: surfaces };
}

/** C1 — fresh single-origin, one-time, affordable (the flagship coffee intent).
 *  FOUR independent evidence checks spanning different surfaces → the store can
 *  plausibly have MULTIPLE distinct gaps (the multi-gap generalization test). */
export const coffeeFreshSingleOriginContract: ShoppingTaskContract = {
  id: "cat-coffee-fresh-single-origin",
  version: "1",
  objective: "select_purchase_ready_product",
  productScope: { shopId: "", productId: "" }, // filled per prospect
  hardConstraints: [
    c("single_origin", 0, "must_be_true", S.claim!, true),
    c("variant_price", 1, "less_than", S.price!, 22.0),
    c("subscription_required", 2, "must_be_false", S.subscription!, false),
    c("roast_date_disclosed", 3, "must_be_true", S.roast!, true),
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 16, maxToolCalls: 14, maxOutputTokens: 3500 },
};

/** C2 — organic decaf with the process disclosed. */
export const coffeeOrganicDecafContract: ShoppingTaskContract = {
  id: "cat-coffee-organic-decaf",
  version: "1",
  objective: "select_purchase_ready_product",
  productScope: { shopId: "", productId: "" },
  hardConstraints: [
    c("decaf_method_disclosed", 0, "must_be_true", S.process!, true),
    c("organic_certified", 1, "must_be_true", S.claim!, true),
    c("variant_price", 2, "less_than", S.price!, 25.0),
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 16, maxToolCalls: 14, maxOutputTokens: 3500 },
};

/** C3 — fair-trade one-time bag under $18. */
export const coffeeFairTradeValueContract: ShoppingTaskContract = {
  id: "cat-coffee-fairtrade-value",
  version: "1",
  objective: "select_purchase_ready_product",
  productScope: { shopId: "", productId: "" },
  hardConstraints: [
    c("fair_trade", 0, "must_be_true", S.claim!, true),
    c("subscription_required", 1, "must_be_false", S.subscription!, false),
    c("variant_price", 2, "less_than", S.price!, 18.0),
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 16, maxToolCalls: 14, maxOutputTokens: 3500 },
};

export const COFFEE_CONTRACTS = [coffeeFreshSingleOriginContract, coffeeOrganicDecafContract, coffeeFairTradeValueContract];

/** Deterministic product-selection keywords for the coffee catalog scan. */
export const COFFEE_CATEGORY_KEYWORDS = [
  "coffee", "single origin", "single-origin", "whole bean", "ground coffee", "roast", "espresso", "cold brew", "arabica",
];

/** Category-generic words dropped from brand extraction so coffee noise
 *  ("Single Origin", "Medium Roast") doesn't masquerade as a brand. Downstream
 *  filters (count≥3 / ≥2 channels / citation-resolvable own domain / Shopify)
 *  remove residual noise; this just cleans the obvious category descriptors. */
export const COFFEE_BRAND_STOPWORDS = [
  "coffee", "coffees", "roast", "roasted", "roaster", "roasters", "roastery", "espresso", "decaf", "decaffeinated",
  "arabica", "robusta", "grind", "ground", "blend", "blends", "brew", "brewed", "organic", "fairtrade", "medium",
  "dark", "light", "beans", "whole", "single", "origin", "specialty", "batch",
];

/** 10 buyer-intent coffee prompts with hard, verifiable constraints (variant-
 *  and logistics-rich: grind, whole-bean, roast date, decaf process, one-time). */
export const COFFEE_PROMPTS: Array<{ id: string; text: string }> = [
  { id: "co1", text: "What's the best single-origin coffee under $20 for pour-over, as a one-time purchase with no subscription?" },
  { id: "co2", text: "Recommend a freshly roasted whole-bean coffee that shows its roast date and ships fast in the US." },
  { id: "co3", text: "Best organic decaf coffee that uses the Swiss Water process? I want to avoid chemical decaffeination." },
  { id: "co4", text: "Which coffee roasters sell single-origin beans I can buy once, without signing up for a subscription?" },
  { id: "co5", text: "I want a medium-roast Ethiopian or Colombian single-origin, ground for espresso, under $22. Recommendations with a link to buy?" },
  { id: "co6", text: "Best fair-trade, organic coffee for a French press, available as a one-time purchase under $18?" },
  { id: "co7", text: "Where can I buy small-batch, roasted-to-order coffee beans with fast shipping and free returns?" },
  { id: "co8", text: "Recommend a low-acid single-origin coffee that clearly states when it was roasted." },
  { id: "co9", text: "What decaf coffee brands disclose their decaffeination method (Swiss Water or CO2) and ship within a week?" },
  { id: "co10", text: "I need a one-time bag of single-origin whole beans under $20 with a visible roast date — not a subscription." },
];
