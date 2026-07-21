import type { JourneyOutcome, JourneyResult, ShoppingTaskContract, TraceEvent } from "./types.js";

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
