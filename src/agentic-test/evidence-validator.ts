import type {
  ConstraintEvaluation,
  EvidenceReference,
  JourneyResult,
  ShoppingConstraint,
  ShoppingTaskContract,
  TraceEvent,
} from "./types.js";
import { MATCHING_TERMS_BY_ATTRIBUTE } from "./contract.js";
import { isNegatedMatch, matchingTermsIn, normalizeForMatch } from "./util.js";

// ===========================================================================
// Evidence validator (spec 4.8) — the heart of the instrument. 100%
// deterministic code: NO LLM CALLS anywhere in this module. It never silently
// corrects the agent — an unsupported positive claim becomes FALSE_CERTAINTY
// with the raw model response preserved by the runner.
// ===========================================================================

/** Does this tool-returned reference genuinely support `constraint` being true? */
export function referenceSupportsConstraint(
  ref: EvidenceReference,
  constraint: ShoppingConstraint,
): { supports: boolean; reason: string } {
  const terms = MATCHING_TERMS_BY_ATTRIBUTE[constraint.attribute] ?? [];

  // Structured support: a metafield keyed to the attribute whose value is true.
  const mf = ref.structuredValue as { key?: unknown; value?: unknown } | undefined;
  if (
    ref.surface === "product_metafields" &&
    typeof mf?.key === "string" &&
    normalizeForMatch(mf.key.replace(/[._]/g, " ")) === normalizeForMatch(constraint.attribute.replace(/[._]/g, " "))
  ) {
    const v = mf.value;
    if (v === true || String(v).trim().toLowerCase() === "true") {
      return { supports: true, reason: `metafield ${mf.key}=true` };
    }
    return { supports: false, reason: `metafield ${mf.key} value is not true` };
  }

  // Text support: normalized exactText contains an approved term, not negated.
  const text = ref.exactText ?? "";
  if (!text) return { supports: false, reason: "no text content" };
  const hits = matchingTermsIn(text, [...terms]);
  if (!hits.length) return { supports: false, reason: "text contains no approved matching term" };
  const nonNegated = hits.some((t) => !isNegatedMatch(text, t));
  if (!nonNegated) return { supports: false, reason: "every matching term occurrence is negated" };
  return { supports: true, reason: `text matches "${hits[0]}"` };
}

/** Spec 4.8. Verifies every claimed evidence id against what tools ACTUALLY
 *  returned in THIS run, on THIS snapshot, on an ACCEPTABLE surface, genuinely
 *  supporting the claimed value. Downgrades unsupported satisfied-claims to
 *  unresolvable and flags the run as FALSE_CERTAINTY material. */
export function validateEvidenceClaims(
  result: JourneyResult,
  traceEvents: TraceEvent[],
  contract: ShoppingTaskContract,
): JourneyResult {
  const returned = new Map<string, EvidenceReference>();
  for (const ev of traceEvents) {
    if (ev.type !== "TOOL_RESULT") continue;
    for (const r of ev.evidenceReferences ?? []) returned.set(r.evidenceId, r);
  }

  const notes: string[] = [...(result.validationNotes ?? [])];
  let unsupportedPositiveClaim = false;

  const evaluations: ConstraintEvaluation[] = result.constraintEvaluations.map((evaluation) => {
    const constraint = contract.hardConstraints.find((c) => c.id === evaluation.constraintId);
    if (!constraint) {
      notes.push(`evaluation references unknown constraint '${evaluation.constraintId}'`);
      return evaluation;
    }
    if (evaluation.status !== "satisfied") return evaluation; // only positive claims need support

    const claimedIds = evaluation.claimedEvidenceIds ?? evaluation.evidenceReferences.map((r) => r.evidenceId);
    const validRefs: EvidenceReference[] = [];
    for (const id of claimedIds) {
      const ref = returned.get(id);
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
      const support = referenceSupportsConstraint(ref, constraint);
      if (!support.supports) {
        notes.push(`constraint '${constraint.id}': evidence '${id}' does not support the claim (${support.reason})`);
        continue;
      }
      validRefs.push(ref);
    }

    if (validRefs.length === 0) {
      // Unsupported positive claim: FALSE_CERTAINTY, never silently corrected.
      unsupportedPositiveClaim = true;
      notes.push(
        `constraint '${constraint.id}': agent claimed satisfied with NO valid supporting evidence — marked unresolvable (FALSE_CERTAINTY)`,
      );
      return { ...evaluation, status: "unresolvable" as const, evidenceReferences: [] };
    }
    return { ...evaluation, evidenceReferences: validRefs };
  });

  return {
    ...result,
    constraintEvaluations: evaluations,
    claimedEvidenceReferences: evaluations.flatMap((e) => e.evidenceReferences),
    validationNotes: notes,
    unsupportedPositiveClaim,
  };
}
