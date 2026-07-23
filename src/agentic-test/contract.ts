import type { ShoppingTaskContract } from "./types.js";

// Stage 1 task fixture (spec 4.2, adapted per AUDIT.md §9): the test store is the
// locally-seeded mock shop; the test product is Mock Product 1 (ceramic cookware),
// carrying the exact `aluminum_free` attribute + matching-terms list from the spec.

export const TEST_SHOP_ID = "agentic-stage1-test.myshopify.com";
export const TEST_PRODUCT_ID = "gid://shopify/Product/1001";

/** Stage 2 (Rule 4 + Amendment 1): the app owner's own DEV store — the ONLY real
 *  Shopify store the experiment may read, and (under Amendment 1's conditions,
 *  via SHOPIFY_DEV_STORE_TOKEN only) seed. Never any production install.
 *  NOTE: the store's DISPLAY name is "ai-visibility-dev"; its canonical
 *  myshopify domain carries a suffix (confirmed from the owner's admin URL,
 *  2026-07-22). The seed script asserts `shop.myshopifyDomain` equals this
 *  constant before any write. */
export const DEV_SHOP_ID = "ai-visibility-dev-m2su2ozk.myshopify.com";

/** The ONLY shops the experiment runner will ever touch (Rule 10). Hard-coded. */
export const TEST_SHOP_ALLOWLIST: readonly string[] = [TEST_SHOP_ID, DEV_SHOP_ID];

/** Spec 4.4 matching terms, compared after identical normalization on both sides. */
export const ALUMINUM_FREE_MATCHING_TERMS: readonly string[] = [
  "aluminum free",
  "aluminium free",
  "no aluminum",
  "no aluminium",
  "without aluminum",
  "without aluminium",
  "free of aluminum",
  "free from aluminum",
];

/** Approved matching terms per attribute — the deterministic validator's ONLY
 *  vocabulary for deciding whether a piece of text supports an attribute claim. */
export const MATCHING_TERMS_BY_ATTRIBUTE: Record<string, readonly string[]> = {
  aluminum_free: ALUMINUM_FREE_MATCHING_TERMS,
};

export const aluminumFreeTask: ShoppingTaskContract = {
  id: "stage1-aluminum-free-cookware",
  version: "1",
  objective: "select_purchase_ready_product",
  productScope: { shopId: TEST_SHOP_ID, productId: TEST_PRODUCT_ID },
  hardConstraints: [
    {
      id: "aluminum-free",
      attribute: "aluminum_free",
      operator: "must_be_true",
      expectedValue: true,
      acceptableSurfaces: ["product_description", "product_metafields", "structured_data", "faq"],
      evidenceRequired: true,
    },
  ],
  successConditions: {
    correctProductRequired: true,
    allHardConstraintsSatisfied: true,
    evidenceRequiredForEveryFact: true,
  },
  limits: { maxSteps: 10, maxToolCalls: 8, maxOutputTokens: 2500 },
};
