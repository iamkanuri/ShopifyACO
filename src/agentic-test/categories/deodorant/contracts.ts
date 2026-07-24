import type { EvidenceSurface, ShoppingConstraint, ShoppingTaskContract, StoreSnapshot } from "../../types.js";
import { safeConstraintId } from "../../compiler.js";

// ===========================================================================
// STAGE 5 — Category contract library v1 (spec 4.4), category: deodorant.
// The first reusable entry in the category test-suite library (Evolution 2
// seed). Three contracts whose hard constraints are drawn from what the
// battery prompts actually demanded. `demoteNotInspectable` rewrites a contract
// for a PUBLIC snapshot: any constraint whose acceptable surfaces are ALL
// not_inspectable becomes observational (moved to softConstraints) so it can
// never render as a failure (Rule 4 / spec 4.4).
// ===========================================================================

const S: Record<string, EvidenceSurface[]> = {
  claim: ["product_description", "product_metafields", "structured_data", "faq"],
  price: ["product_variants", "structured_data"],
  variant: ["product_variants"],
  subscription: ["product_description", "faq"],
  delivery: ["shipping_policy", "faq"],
};

function c(attribute: string, i: number, operator: ShoppingConstraint["operator"], surfaces: EvidenceSurface[], expectedValue?: unknown): ShoppingConstraint {
  return { id: safeConstraintId(attribute, i), attribute, operator, expectedValue, evidenceRequired: true, acceptableSurfaces: surfaces };
}

/** C1 — aluminum-free + affordable + no subscription (the flagship battery intent). */
export const deodorantAluminumFreeContract: ShoppingTaskContract = {
  id: "cat-deodorant-aluminum-free",
  version: "2",
  objective: "select_purchase_ready_product",
  productScope: { shopId: "", productId: "" }, // filled per prospect
  hardConstraints: [
    c("aluminum_free", 0, "must_be_true", S.claim!, true),
    c("variant_price", 1, "less_than", S.price!, 20.0),
    c("subscription_required", 2, "must_be_false", S.subscription!, false),
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
};

/** C2 — sensitive-skin: baking-soda-free + paraben-free + delivery resolvable. */
export const deodorantSensitiveSkinContract: ShoppingTaskContract = {
  id: "cat-deodorant-sensitive-skin",
  version: "2",
  objective: "select_purchase_ready_product",
  productScope: { shopId: "", productId: "" },
  hardConstraints: [
    c("baking_soda_free", 0, "must_be_true", S.claim!, true),
    c("aluminum_free", 1, "must_be_true", S.claim!, true),
    c("delivery_timing", 2, "must_be_resolvable", S.delivery!),
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
};

/** C3 — value/travel: under $15 + travel size purchasable + vegan. */
export const deodorantValueContract: ShoppingTaskContract = {
  id: "cat-deodorant-value-travel",
  version: "2",
  objective: "select_purchase_ready_product",
  productScope: { shopId: "", productId: "" },
  hardConstraints: [
    c("variant_price", 0, "less_than", S.price!, 15.0),
    c("vegan", 1, "must_be_true", S.claim!, true),
    c("required_variant_in_stock", 2, "must_be_true", S.variant!, true),
  ],
  successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
  limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
};

export const DEODORANT_CONTRACTS = [deodorantAluminumFreeContract, deodorantSensitiveSkinContract, deodorantValueContract];

/** Rewrite a contract for a PUBLIC snapshot: bind product scope, and demote any
 *  hard constraint whose acceptable surfaces are ALL not_inspectable to an
 *  observational softConstraint (spec 4.4 / Rule 4). Returns the bound contract
 *  plus the list of demoted attribute names for the case's "not inspectable"
 *  section. Constraints keep any surfaces that ARE inspectable. */
export function bindContractToPublicSnapshot(
  contract: ShoppingTaskContract,
  snapshot: StoreSnapshot,
): { contract: ShoppingTaskContract; demoted: Array<{ id: string; attribute: string; reason: string }> } {
  const notInspectable = new Set(snapshot.surfacesNotInspectable ?? []);
  const scope = { shopId: snapshot.shopId, productId: snapshot.products[0]?.productId ?? "" };
  const demoted: Array<{ id: string; attribute: string; reason: string }> = [];
  const hard: ShoppingConstraint[] = [];
  const soft: ShoppingConstraint[] = [...(contract.softConstraints ?? [])];

  for (const hc of contract.hardConstraints) {
    const inspectable = hc.acceptableSurfaces.filter((s) => !notInspectable.has(s));
    if (inspectable.length === 0) {
      demoted.push({ id: hc.id, attribute: hc.attribute, reason: `all acceptable surfaces not inspectable from public data (${hc.acceptableSurfaces.join(", ")})` });
      soft.push({ ...hc, evidenceRequired: false });
    } else {
      hard.push({ ...hc, acceptableSurfaces: inspectable });
    }
  }
  return {
    contract: { ...contract, productScope: scope, hardConstraints: hard, softConstraints: soft },
    demoted,
  };
}
