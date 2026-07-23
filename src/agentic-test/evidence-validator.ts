import type {
  ConstraintEvaluation,
  EvidenceReference,
  JourneyResult,
  ShoppingConstraint,
  ShoppingTaskContract,
  TraceEvent,
} from "./types.js";
import { MATCHING_TERMS_BY_ATTRIBUTE } from "./contract.js";
import { STAGE2_TERM_FIXTURES } from "./contract2.js";
import { isNegatedMatch, matchingTermsIn, normalizeForMatch, occursOutsideSpans } from "./util.js";

// ===========================================================================
// Evidence validator (spec 4.8 + Stage 2 4.1) — the heart of the instrument.
// 100% deterministic code: NO LLM CALLS anywhere in this module. It never
// silently corrects the agent — every downgrade/override is recorded in
// validationNotes, unsupported positive claims become FALSE_CERTAINTY, and
// deterministic overrides (conflict pairs, observed variant availability,
// disagreeing price sources) apply REGARDLESS of the model's declared status.
// Label-blind: inputs are the contract, the run's trace, and the result only.
// ===========================================================================

interface TermFixture {
  supportTerms?: readonly string[];
  violatingTerms?: readonly string[];
  requiresDigitInSentence?: boolean;
}

function fixturesFor(attribute: string): TermFixture {
  const stage2 = STAGE2_TERM_FIXTURES[attribute];
  if (stage2) return stage2;
  const stage1 = MATCHING_TERMS_BY_ATTRIBUTE[attribute];
  return stage1 ? { supportTerms: stage1 } : {};
}

const keyMatchesAttribute = (key: string, attribute: string): boolean =>
  normalizeForMatch(key.replace(/[._]/g, " ")) === normalizeForMatch(attribute.replace(/[._]/g, " "));

/** Parse the first money-like number out of a text value ("$24.00" → 24). */
export function parsePrice(text: string): number | null {
  const m = /(\d+(?:\.\d{1,2})?)/.exec(text.replace(/,/g, ""));
  return m ? Number(m[1]) : null;
}

export interface SupportVerdict {
  supports: boolean;
  reason: string;
  /** The reference actively contradicts the constraint (e.g. variant unavailable,
   *  violating term present, price at/over the limit). */
  contradicts?: boolean;
}

/** Does this tool-returned reference genuinely support `constraint`?
 *  `scope` carries the contract's product/variant target for c2/c3-style checks. */
export function referenceSupportsConstraint(
  ref: EvidenceReference,
  constraint: ShoppingConstraint,
  scope?: { productId?: string; variantId?: string },
): SupportVerdict {
  const fx = fixturesFor(constraint.attribute);

  // ---- numeric price comparison (c2): no term list ------------------------
  if (constraint.operator === "less_than" || constraint.operator === "greater_than") {
    let value: number | null = null;
    const sv = ref.structuredValue as { price?: unknown; variantId?: string; value?: unknown } | undefined;
    if (ref.surface === "product_variants" && sv && typeof sv.price === "number") {
      if (scope?.variantId && sv.variantId !== scope.variantId) {
        return { supports: false, reason: "price is for a different variant than the required one" };
      }
      value = sv.price;
    } else if (ref.surface === "structured_data") {
      value = typeof sv?.price === "number" ? sv.price : ref.exactText ? parsePrice(ref.exactText) : null;
    }
    if (value === null) return { supports: false, reason: "no numeric price in this reference" };
    const limit = Number(constraint.expectedValue);
    const ok = constraint.operator === "less_than" ? value < limit : value > limit;
    return ok
      ? { supports: true, reason: `price ${value} ${constraint.operator === "less_than" ? "<" : ">"} ${limit}` }
      : { supports: false, reason: `price ${value} fails ${constraint.operator} ${limit}`, contradicts: true };
  }

  // ---- required-variant availability (c3): tool output flag, no terms -----
  if (constraint.attribute === "required_variant_in_stock") {
    const sv = ref.structuredValue as { variantId?: string; available?: unknown } | undefined;
    if (ref.surface !== "product_variants" || !sv?.variantId) {
      return { supports: false, reason: "not a variant reference" };
    }
    if (scope?.variantId && sv.variantId !== scope.variantId) {
      return { supports: false, reason: "reference is a sibling variant, not the required one" };
    }
    if (sv.available === true) return { supports: true, reason: "required variant availableForSale=true" };
    return { supports: false, reason: "required variant is not available", contradicts: sv.available === false };
  }

  // ---- structured support: metafield keyed to the attribute ---------------
  const mf = ref.structuredValue as { key?: unknown; value?: unknown } | undefined;
  if (ref.surface === "product_metafields" && typeof mf?.key === "string" && keyMatchesAttribute(mf.key, constraint.attribute)) {
    const v = String(mf.value).trim().toLowerCase();
    const want = constraint.operator === "must_be_false" ? "false" : "true";
    if (mf.value === (want === "true") || v === want) return { supports: true, reason: `metafield ${mf.key}=${want}` };
    return { supports: false, reason: `metafield ${mf.key} value is not ${want}`, contradicts: v === (want === "true" ? "false" : "true") };
  }

  // ---- term-based text support (c1, c4, c5, vegan) ------------------------
  const text = ref.exactText ?? "";
  if (!text) return { supports: false, reason: "no text content" };

  if (fx.violatingTerms?.length) {
    // Span-aware: "subscription required" inside "no subscription required" is
    // covered by the support phrase and must not count as a violation.
    const bad = fx.violatingTerms.filter(
      (t) => occursOutsideSpans(text, t, fx.supportTerms ?? []) && !isNegatedMatch(text, t),
    );
    if (bad.length) {
      return { supports: false, reason: `text matches violating term "${bad[0]}"`, contradicts: true };
    }
  }
  const terms = fx.supportTerms ?? [];
  const hits = matchingTermsIn(text, [...terms]);
  if (!hits.length) return { supports: false, reason: "text contains no approved matching term" };
  const nonNegated = hits.some((t) => !isNegatedMatch(text, t));
  if (!nonNegated) return { supports: false, reason: "every matching term occurrence is negated" };
  if (fx.requiresDigitInSentence && !/\d/.test(text)) {
    return { supports: false, reason: "timing term present but no digit in the same sentence" };
  }
  return { supports: true, reason: `text matches "${hits[0]}"` };
}

// ---- deterministic overrides (Stage 2, label-blind) ------------------------

/** Conflict-pair rule (spec 4.1): both sides retrieved on the constraint's
 *  acceptable surfaces → status `conflicting`, regardless of the model. */
function conflictDetected(
  constraint: ShoppingConstraint,
  returned: EvidenceReference[],
): { hit: boolean; detail?: string } {
  for (const pair of constraint.conflictTermPairs ?? []) {
    const texts = returned
      .filter((r) => constraint.acceptableSurfaces.includes(r.surface))
      .map((r) => r.exactText ?? "")
      .filter(Boolean);
    const aff = texts.find((t) => matchingTermsIn(t, pair.affirmative).some((x) => !isNegatedMatch(t, x)));
    const neg = texts.find((t) =>
      pair.negative.some((x) => occursOutsideSpans(t, x, pair.affirmative) && !isNegatedMatch(t, x)),
    );
    if (aff && neg) return { hit: true, detail: `"${aff.slice(0, 80)}" vs "${neg.slice(0, 80)}"` };
  }
  return { hit: false };
}

/** Price-source disagreement (F4 root-cause signal): the target product's
 *  variant price vs any other price-bearing surface (structured data or a
 *  price metafield) retrieved in THIS run, disagreeing by more than 1 cent. */
export function detectPriceDisagreement(
  returned: EvidenceReference[],
  scope: { productId: string; variantId?: string },
): { disagree: boolean; detail?: string } {
  let variantPrice: number | null = null;
  let otherPrice: number | null = null;
  let otherSource = "";
  for (const r of returned) {
    const sv = r.structuredValue as { variantId?: string; price?: unknown; key?: unknown; value?: unknown } | undefined;
    if (r.surface === "product_variants" && sv && typeof sv.price === "number") {
      if (!scope.variantId || sv.variantId === scope.variantId) variantPrice = sv.price;
    } else if (r.surface === "structured_data" && r.exactText) {
      otherPrice = parsePrice(r.exactText);
      otherSource = "structured_data";
    } else if (
      r.surface === "product_metafields" &&
      typeof sv?.key === "string" &&
      /price/i.test(sv.key) &&
      r.sourceObjectId.startsWith(scope.productId)
    ) {
      otherPrice = parsePrice(String(sv.value ?? r.exactText ?? ""));
      otherSource = `metafield ${sv.key}`;
    }
  }
  if (variantPrice !== null && otherPrice !== null && Math.abs(variantPrice - otherPrice) > 0.01) {
    return { disagree: true, detail: `variant price ${variantPrice} vs ${otherSource} ${otherPrice}` };
  }
  return { disagree: false };
}

// ---- the validator ---------------------------------------------------------

/** Spec 4.8 + Stage 2. Verifies every claimed evidence id against what tools
 *  ACTUALLY returned in THIS run, applies the deterministic conflict-pair /
 *  availability / price-disagreement overrides, downgrades unsupported
 *  satisfied-claims, and never silently corrects anything. */
export function validateEvidenceClaims(
  result: JourneyResult,
  traceEvents: TraceEvent[],
  contract: ShoppingTaskContract,
): JourneyResult {
  const returnedMap = new Map<string, EvidenceReference>();
  for (const ev of traceEvents) {
    if (ev.type !== "TOOL_RESULT") continue;
    for (const r of ev.evidenceReferences ?? []) returnedMap.set(r.evidenceId, r);
  }
  const returned = [...returnedMap.values()];
  const scope = contract.productScope;

  const notes: string[] = [...(result.validationNotes ?? [])];
  const unsupportedConstraintIds = new Set<string>();

  // 1. Per-claim validation of the agent's satisfied-claims (Stage 1 rules).
  let evaluations: ConstraintEvaluation[] = result.constraintEvaluations.map((evaluation) => {
    const constraint = contract.hardConstraints.find((c) => c.id === evaluation.constraintId);
    if (!constraint) {
      notes.push(`evaluation references unknown constraint '${evaluation.constraintId}'`);
      return evaluation;
    }
    if (evaluation.status !== "satisfied") return evaluation;

    const claimedIds = evaluation.claimedEvidenceIds ?? evaluation.evidenceReferences.map((r) => r.evidenceId);
    const validRefs: EvidenceReference[] = [];
    for (const id of claimedIds) {
      const ref = returnedMap.get(id);
      if (!ref) {
        notes.push(`constraint '${constraint.id}': claimed evidence '${id}' was never returned by any tool in this run`);
        continue;
      }
      if (ref.snapshotId !== result.snapshotId) {
        notes.push(`constraint '${constraint.id}': evidence '${id}' belongs to snapshot ${ref.snapshotId}, not the pinned ${result.snapshotId}`);
        continue;
      }
      if (!constraint.acceptableSurfaces.includes(ref.surface)) {
        notes.push(`constraint '${constraint.id}': evidence '${id}' surface '${ref.surface}' is not acceptable for this constraint`);
        continue;
      }
      const support = referenceSupportsConstraint(ref, constraint, scope);
      if (!support.supports) {
        notes.push(`constraint '${constraint.id}': evidence '${id}' does not support the claim (${support.reason})`);
        continue;
      }
      validRefs.push(ref);
    }

    if (validRefs.length === 0) {
      unsupportedConstraintIds.add(constraint.id);
      notes.push(
        `constraint '${constraint.id}': agent claimed satisfied with NO valid supporting evidence — marked unresolvable (FALSE_CERTAINTY)`,
      );
      return { ...evaluation, status: "unresolvable" as const, evidenceReferences: [] };
    }
    return { ...evaluation, evidenceReferences: validRefs };
  });

  // 2. Deterministic overrides — applied to hard AND soft constraints,
  //    regardless of what the model declared. Never silent: every override is
  //    a validationNotes entry.
  const allConstraints = [...contract.hardConstraints, ...(contract.softConstraints ?? [])];

  for (const constraint of allConstraints) {
    const conflict = conflictDetected(constraint, returned);
    if (conflict.hit) {
      const existing = evaluations.find((e) => e.constraintId === constraint.id);
      const explanation = `deterministic conflict-pair rule: retrieved evidence contains both sides (${conflict.detail})`;
      notes.push(`constraint '${constraint.id}': ${explanation}`);
      if (existing) {
        if (existing.status === "satisfied" || existing.status !== "conflicting") {
          evaluations = evaluations.map((e) =>
            e.constraintId === constraint.id ? { ...e, status: "conflicting" as const, explanation: `${e.explanation} [OVERRIDE: ${explanation}]` } : e,
          );
        }
      } else {
        evaluations.push({
          constraintId: constraint.id,
          status: "conflicting",
          evidenceReferences: [],
          explanation,
        });
      }
      // A conflict override supersedes an unsupported-claim downgrade for this
      // constraint — the deterministic tier has POSITIVE knowledge of the state.
      unsupportedConstraintIds.delete(constraint.id);
    }
  }

  // Required-variant availability observed in the trace overrides c3 claims.
  const c3 = contract.hardConstraints.find((c) => c.attribute === "required_variant_in_stock");
  if (c3 && scope.variantId) {
    const observation = returned.find((r) => {
      const sv = r.structuredValue as { variantId?: string; available?: unknown } | undefined;
      return r.surface === "product_variants" && sv?.variantId === scope.variantId && typeof sv?.available === "boolean";
    });
    const available = observation
      ? (observation.structuredValue as { available?: boolean }).available
      : undefined;
    if (observation && available === false) {
      const existing = evaluations.find((e) => e.constraintId === c3.id);
      const explanation = "deterministic override: tool output shows the required variant is NOT available";
      notes.push(`constraint '${c3.id}': ${explanation}`);
      if (existing && existing.status !== "violated") {
        evaluations = evaluations.map((e) =>
          e.constraintId === c3.id
            ? { ...e, status: "violated" as const, evidenceReferences: [observation], explanation: `${e.explanation} [OVERRIDE: ${explanation}]` }
            : e,
        );
        // If the agent had claimed satisfied, the per-claim check failed it and
        // flagged c3 as unsupported — but here the deterministic tier KNOWS the
        // true state from tool output, so the run is a CONSTRAINT_VIOLATION
        // (INVENTORY_MISMATCH), not FALSE_CERTAINTY. Only c3's flag is cleared;
        // unsupported claims on other constraints still count.
        unsupportedConstraintIds.delete(c3.id);
      } else if (!existing) {
        evaluations.push({ constraintId: c3.id, status: "violated", evidenceReferences: [observation], explanation });
      }
    }
  }

  // Price-source disagreement (F4): force c2 conflicting + record the signal.
  const priceCheck = detectPriceDisagreement(returned, scope);
  const c2 = contract.hardConstraints.find((c) => c.attribute === "variant_price");
  if (priceCheck.disagree && c2) {
    const explanation = `deterministic override: price sources disagree in this run's trace (${priceCheck.detail})`;
    notes.push(`constraint '${c2.id}': ${explanation}`);
    const existing = evaluations.find((e) => e.constraintId === c2.id);
    if (existing) {
      evaluations = evaluations.map((e) =>
        e.constraintId === c2.id ? { ...e, status: "conflicting" as const, explanation: `${e.explanation} [OVERRIDE: ${explanation}]` } : e,
      );
    } else {
      evaluations.push({ constraintId: c2.id, status: "conflicting", evidenceReferences: [], explanation });
    }
  }

  return {
    ...result,
    constraintEvaluations: evaluations,
    claimedEvidenceReferences: evaluations.flatMap((e) => e.evidenceReferences),
    validationNotes: notes,
    unsupportedPositiveClaim: unsupportedConstraintIds.size > 0,
    priceSourcesDisagree: priceCheck.disagree || undefined,
  };
}
