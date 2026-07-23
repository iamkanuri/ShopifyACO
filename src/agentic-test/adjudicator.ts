import type {
  ConstraintStatus,
  JourneyOutcome,
  JourneyResult,
  RootCauseCode,
  ShoppingTaskContract,
  TraceEvent,
} from "./types.js";

// ===========================================================================
// Deterministic Stage 1 adjudication (spec 4.9). Pure code, no model calls.
// The model's own declared outcome is stored separately and NEVER trusted —
// the adjudicated outcome derives from validated evidence only. Model errors,
// tool errors, and store failures stay separate result classes.
// ===========================================================================

const FAILURE_CLASSES: JourneyOutcome[] = ["TOOL_FAILURE", "MODEL_FAILURE", "BUDGET_EXHAUSTED"];

export function adjudicateStage1(
  contract: ShoppingTaskContract,
  result: JourneyResult,
  traceEvents: TraceEvent[],
): JourneyOutcome {
  // 1. Infrastructure failure classes are terminal and never blended (Rule 7).
  if (FAILURE_CLASSES.includes(result.outcome)) return result.outcome;

  // 2. Any satisfied-claim without trace-backed valid evidence.
  if (result.unsupportedPositiveClaim) return "FALSE_CERTAINTY";

  const targetProduct = contract.productScope.productId;
  const correctSelected = result.selectedProductId === targetProduct;
  const considered =
    correctSelected ||
    traceEvents.some((e) => e.type === "PRODUCT_CONSIDERED" && e.payload.productId === targetProduct);

  const byId = new Map(result.constraintEvaluations.map((e) => [e.constraintId, e]));
  const allSatisfiedWithEvidence = contract.hardConstraints.every((c) => {
    const ev = byId.get(c.id);
    return ev?.status === "satisfied" && ev.evidenceReferences.length >= 1;
  });
  const anyUnresolvable = contract.hardConstraints.some((c) => byId.get(c.id)?.status === "unresolvable");
  const anyViolated = contract.hardConstraints.some((c) => byId.get(c.id)?.status === "violated");
  const modelDeclaredPass = result.modelDeclaredOutcome === "PASS";

  // 3. PASS: correct product AND every hard constraint satisfied with valid evidence.
  if (correctSelected && allSatisfiedWithEvidence) return "PASS";

  // 4. The agent declared purchase-ready but the evidence doesn't hold that up.
  if (modelDeclaredPass) {
    if (!correctSelected && result.selectedProductId) return "WRONG_PRODUCT_SELECTED";
    return "CONSTRAINT_VIOLATION";
  }

  // 5. Direct contradicting store evidence reported by the agent.
  if (anyViolated) return "CONTRADICTION";

  // 6. Honest failure: the product was examined, a required fact is unresolvable,
  //    and no unsupported positive claim was made (rule 2 handled those).
  if (considered && anyUnresolvable) return "MISSING_EVIDENCE";

  // 7. Never looked at the right product.
  if (!considered) return "WRONG_PRODUCT_SELECTED";

  return "MISSING_EVIDENCE";
}

// ===========================================================================
// Stage 2 (spec 4.1): adjudication + deterministic root-cause mapping.
// ===========================================================================

/** Root-cause table, keyed by constraint ATTRIBUTE × non-satisfied status.
 *  Exhaustive for every constraint in the v2 contracts (spec test 19); `null`
 *  means "no code beyond the outcome". `priceDisagree` is the validator's
 *  observed disagreement between price-bearing surfaces (the F4 signal). */
export function rootCauseFor(
  attribute: string,
  status: Exclude<ConstraintStatus, "satisfied">,
  flags: { priceDisagree?: boolean } = {},
): RootCauseCode | null {
  const table: Record<string, Record<Exclude<ConstraintStatus, "satisfied">, RootCauseCode | null>> = {
    aluminum_free: { unresolvable: "EVIDENCE_GAP", violated: "CONTRADICTION", conflicting: "CONTRADICTION" },
    vegan: { unresolvable: "EVIDENCE_GAP", violated: "CONTRADICTION", conflicting: "CONTRADICTION" },
    variant_price: {
      unresolvable: "EVIDENCE_GAP",
      violated: flags.priceDisagree ? "STALE_STRUCTURED_DATA" : "PRICE_VIOLATION",
      conflicting: flags.priceDisagree ? "STALE_STRUCTURED_DATA" : "CONTRADICTION",
    },
    required_variant_in_stock: { unresolvable: "EVIDENCE_GAP", violated: "INVENTORY_MISMATCH", conflicting: "CONTRADICTION" },
    subscription_required: { unresolvable: "EVIDENCE_GAP", violated: "CONTRADICTION", conflicting: "CONTRADICTION" },
    delivery_timing: { unresolvable: "POLICY_OPACITY", violated: "POLICY_OPACITY", conflicting: "CONTRADICTION" },
    returns_policy_consistent: { unresolvable: null, violated: "CONTRADICTION", conflicting: "CONTRADICTION" },
  };
  const row = table[attribute];
  if (!row) throw new Error(`rootCauseFor: no mapping for attribute '${attribute}' (table must be exhaustive)`);
  return row[status];
}

export interface Stage2Adjudication {
  outcome: JourneyOutcome;
  rootCause?: RootCauseCode;
}

export function adjudicateStage2(
  contract: ShoppingTaskContract,
  result: JourneyResult,
  traceEvents: TraceEvent[],
): Stage2Adjudication {
  // 1. Infrastructure failure classes are terminal and never blended (Rule 7).
  if (FAILURE_CLASSES.includes(result.outcome)) return { outcome: result.outcome };

  // 2. Any satisfied-claim without trace-backed valid evidence.
  if (result.unsupportedPositiveClaim) return { outcome: "FALSE_CERTAINTY" };

  const targetProduct = contract.productScope.productId;
  const requiredVariant = contract.productScope.variantId;
  const correctProduct = result.selectedProductId === targetProduct;
  const variantOk = !requiredVariant || result.selectedVariantId === requiredVariant;
  const considered =
    correctProduct ||
    traceEvents.some((e) => e.type === "PRODUCT_CONSIDERED" && e.payload.productId === targetProduct);
  const modelDeclaredPass = result.modelDeclaredOutcome === "PASS";
  const flags = { priceDisagree: result.priceSourcesDisagree };

  const byId = new Map(result.constraintEvaluations.map((e) => [e.constraintId, e]));
  const ordered = [...contract.hardConstraints, ...(contract.softConstraints ?? [])];

  // 3. Silent substitution / wrong target while claiming purchase-ready.
  if (modelDeclaredPass && (!correctProduct || !variantOk)) {
    return { outcome: "WRONG_PRODUCT_SELECTED", rootCause: "WRONG_PRODUCT" };
  }

  // 4. Any conflicting constraint (hard or soft, deterministic rule) → CONTRADICTION.
  for (const c of ordered) {
    if (byId.get(c.id)?.status === "conflicting") {
      return { outcome: "CONTRADICTION", rootCause: rootCauseFor(c.attribute, "conflicting", flags) ?? "CONTRADICTION" };
    }
  }

  // 5. Any violated hard constraint → CONSTRAINT_VIOLATION.
  for (const c of contract.hardConstraints) {
    if (byId.get(c.id)?.status === "violated") {
      return { outcome: "CONSTRAINT_VIOLATION", rootCause: rootCauseFor(c.attribute, "violated", flags) ?? undefined };
    }
  }

  // 6. PASS: correct product AND (when required) the exact variant AND every
  //    hard constraint satisfied with validated evidence.
  const allSatisfied = contract.hardConstraints.every((c) => {
    const ev = byId.get(c.id);
    return ev?.status === "satisfied" && ev.evidenceReferences.length >= 1;
  });
  if (correctProduct && variantOk && allSatisfied) return { outcome: "PASS" };

  // 7. Honest failure: examined the product, a required fact is unresolvable.
  if (considered) {
    for (const c of contract.hardConstraints) {
      if (byId.get(c.id)?.status === "unresolvable") {
        return { outcome: "MISSING_EVIDENCE", rootCause: rootCauseFor(c.attribute, "unresolvable", flags) ?? undefined };
      }
    }
  }

  // 8. Never looked at the right product / declared pass without full evidence.
  if (!considered) return { outcome: "WRONG_PRODUCT_SELECTED", rootCause: "WRONG_PRODUCT" };
  if (modelDeclaredPass) return { outcome: "CONSTRAINT_VIOLATION" };
  return { outcome: "MISSING_EVIDENCE" };
}

/** Dispatcher: v2 contracts get root-caused adjudication; v1 stays byte-stable. */
export function adjudicate(
  contract: ShoppingTaskContract,
  result: JourneyResult,
  traceEvents: TraceEvent[],
): Stage2Adjudication {
  if (contract.version === "2") return adjudicateStage2(contract, result, traceEvents);
  return { outcome: adjudicateStage1(contract, result, traceEvents) };
}
