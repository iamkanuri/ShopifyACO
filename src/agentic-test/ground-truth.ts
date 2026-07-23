import type { MerchantGroundTruth } from "./types.js";
import { TEST_PRODUCT_ID } from "./contract.js";
import { deepFreeze } from "./util.js";

// ===========================================================================
// EVALUATOR-ONLY ground truth (spec 4.2). This module must NEVER be imported by
// agent-runner.ts or store-tools.ts — enforced by test/agenticStage1.test.ts
// (test 16, import-graph grep). The agent must never see these facts, the
// mutation manifest, expected outcomes, or snapshot labels.
//
// The test product is fictional (mock-catalog fixture), so its ground truth is
// defined by us acting as the merchant: the product is aluminum-free, and the
// seed step writes exactly that (truthful) statement onto the test-store copy.
// ===========================================================================

export const groundTruth: MerchantGroundTruth = deepFreeze({
  productId: TEST_PRODUCT_ID,
  facts: { aluminum_free: true },
  sources: [
    {
      attribute: "aluminum_free",
      sourceType: "merchant_confirmed",
      note: "Experimental ground truth only; never shown to the agent.",
    },
  ],
});

// ---- Stage 2: dev-store seeded products (we are the merchant; the seeded
// store content mirrors these facts exactly — Amendment 1 §A.4) --------------

export const stage2GroundTruth: MerchantGroundTruth = deepFreeze({
  productId: "gid://shopify/Product/8114219450470", // Cedar Hollow Natural Deodorant
  facts: {
    aluminum_free: true,
    subscription_required: false,
    variant_price: 14.0,
    required_variant_in_stock: true,
    delivery_timing: "orders before 2 PM ET ship same day; standard arrives in 2 to 4 business days",
    returns_policy: "free returns within 30 days of delivery",
  },
  sources: [
    { attribute: "aluminum_free", sourceType: "merchant_confirmed", note: "Seeded truthfully; never shown to the agent." },
    { attribute: "subscription_required", sourceType: "merchant_confirmed" },
    { attribute: "delivery_timing", sourceType: "merchant_confirmed" },
  ],
});

export const stage2SecondaryGroundTruth: MerchantGroundTruth = deepFreeze({
  productId: "gid://shopify/Product/8114219483238", // Harbor Lane Shave Soap
  facts: { vegan: true, variant_price: 24.0 },
  sources: [{ attribute: "vegan", sourceType: "merchant_confirmed" }],
});
