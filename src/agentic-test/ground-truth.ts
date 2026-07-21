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
