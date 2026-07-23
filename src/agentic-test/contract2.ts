import type { ConflictTermPair, ShoppingTaskContract } from "./types.js";
import { ALUMINUM_FREE_MATCHING_TERMS, DEV_SHOP_ID } from "./contract.js";

// ===========================================================================
// STAGE 2 contracts + deterministic term fixtures (spec 4.1). IDs are the REAL
// dev-store GIDs captured after the seeded catalog synced through the actual
// ingestion pipeline (see experiments/agentic-stage2/AUDIT.md).
// ===========================================================================

export const PRIMARY_PRODUCT_ID = "gid://shopify/Product/8114219450470"; // Cedar Hollow Natural Deodorant
export const REQUIRED_VARIANT_ID = "gid://shopify/ProductVariant/45972061814886"; // Unscented / 2.5 oz
export const SECONDARY_PRODUCT_ID = "gid://shopify/Product/8114219483238"; // Harbor Lane Shave Soap

// ---- deterministic term fixtures (normalized exactly as in Stage 1) --------

/** c4 subscription_required=false: supporting (absence-of-subscription) terms. */
export const NO_SUBSCRIPTION_TERMS = [
  "no subscription",
  "one time purchase",
  "one-time purchase",
  "without a subscription",
  "not a subscription",
] as const;

/** c4 violating terms: presence of these = subscription IS required. */
export const SUBSCRIPTION_VIOLATION_TERMS = [
  "subscription required",
  "subscribe to purchase",
  "auto-renew",
  "auto renew",
] as const;

/** c5 delivery_timing resolvable: any of these + ≥1 digit in the same sentence.
 *  "same day" added to the spec list (disclosed in AUDIT.md): the spec's own
 *  seeded policy says "ship the same day", which "ships same day" fails to
 *  match — without the fix F5 would leave a genuine timing sentence behind and
 *  the validator would false-reject honest same-day citations. */
export const DELIVERY_TIMING_TERMS = [
  "ships same day",
  "same day",
  "ships within",
  "business days",
  "delivery in",
  "arrives in",
  "delivered within",
  "shipping time",
] as const;

/** c1 conflict pair: aluminum-free claims vs contains-aluminum claims. */
export const ALUMINUM_CONFLICT_PAIR: ConflictTermPair = {
  affirmative: [...ALUMINUM_FREE_MATCHING_TERMS],
  negative: ["contains aluminum", "aluminum-based", "aluminium-based", "with aluminum"],
};

/** F2 returns conflict pair (soft observational constraint). */
export const RETURNS_CONFLICT_PAIR: ConflictTermPair = {
  affirmative: ["free returns", "30-day returns", "30 day returns", "return within"],
  negative: ["final sale", "all sales final", "no returns", "non-returnable"],
};

/** Secondary contract (product B) vegan terms. */
export const VEGAN_TERMS = ["vegan", "100% vegan", "no animal products", "tallow-free", "tallow free"] as const;

// ---- contract v2 (primary, multi-constraint) --------------------------------

export const stage2PrimaryContract: ShoppingTaskContract = {
  id: "stage2-deodorant-full",
  version: "2",
  objective: "select_purchase_ready_product",
  productScope: { shopId: DEV_SHOP_ID, productId: PRIMARY_PRODUCT_ID, variantId: REQUIRED_VARIANT_ID },
  hardConstraints: [
    {
      id: "c1-aluminum-free",
      attribute: "aluminum_free",
      operator: "must_be_true",
      expectedValue: true,
      evidenceRequired: true,
      acceptableSurfaces: ["product_description", "product_metafields", "structured_data", "faq"],
      conflictTermPairs: [ALUMINUM_CONFLICT_PAIR],
    },
    {
      id: "c2-price",
      attribute: "variant_price",
      operator: "less_than",
      expectedValue: 20.0,
      evidenceRequired: true,
      acceptableSurfaces: ["product_variants", "structured_data"],
    },
    {
      id: "c3-variant-purchasable",
      attribute: "required_variant_in_stock",
      operator: "must_be_true",
      expectedValue: true,
      evidenceRequired: true,
      acceptableSurfaces: ["product_variants"],
    },
    {
      id: "c4-no-subscription",
      attribute: "subscription_required",
      operator: "must_be_false",
      expectedValue: false,
      evidenceRequired: true,
      acceptableSurfaces: ["product_description", "faq"],
    },
    {
      id: "c5-delivery-resolvable",
      attribute: "delivery_timing",
      operator: "must_be_resolvable",
      evidenceRequired: true,
      acceptableSurfaces: ["shipping_policy", "faq"],
    },
  ],
  softConstraints: [
    {
      // Observational only (F2): never shown to the agent; the validator checks
      // its conflict pair across retrieved evidence and forces CONTRADICTION.
      id: "soft-returns-consistent",
      attribute: "returns_policy_consistent",
      operator: "must_be_resolvable",
      evidenceRequired: false,
      acceptableSurfaces: ["product_description", "faq", "returns_policy"],
      conflictTermPairs: [RETURNS_CONFLICT_PAIR],
    },
  ],
  successConditions: {
    correctProductRequired: true,
    allHardConstraintsSatisfied: true,
    evidenceRequiredForEveryFact: true,
  },
  limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
};

// ---- secondary sanity contract (product B, BASE only) -----------------------

export const stage2SecondaryContract: ShoppingTaskContract = {
  id: "stage2-shave-soap-sanity",
  version: "2",
  objective: "select_purchase_ready_product",
  productScope: { shopId: DEV_SHOP_ID, productId: SECONDARY_PRODUCT_ID },
  hardConstraints: [
    {
      id: "b1-vegan",
      attribute: "vegan",
      operator: "must_be_true",
      expectedValue: true,
      evidenceRequired: true,
      acceptableSurfaces: ["product_description", "product_metafields", "structured_data", "faq"],
    },
    {
      id: "b2-price",
      attribute: "variant_price",
      operator: "less_than",
      expectedValue: 30.0,
      evidenceRequired: true,
      acceptableSurfaces: ["product_variants", "structured_data"],
    },
  ],
  successConditions: {
    correctProductRequired: true,
    allHardConstraintsSatisfied: true,
    evidenceRequiredForEveryFact: true,
  },
  limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
};

/** Per-ATTRIBUTE deterministic fixtures for the Stage 2 validator tier. */
export const STAGE2_TERM_FIXTURES: Record<
  string,
  { supportTerms?: readonly string[]; violatingTerms?: readonly string[]; requiresDigitInSentence?: boolean }
> = {
  aluminum_free: { supportTerms: ALUMINUM_FREE_MATCHING_TERMS },
  subscription_required: { supportTerms: NO_SUBSCRIPTION_TERMS, violatingTerms: SUBSCRIPTION_VIOLATION_TERMS },
  delivery_timing: { supportTerms: DELIVERY_TIMING_TERMS, requiresDigitInSentence: true },
  vegan: { supportTerms: VEGAN_TERMS },
};
