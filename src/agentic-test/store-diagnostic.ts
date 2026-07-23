import type {
  EvidenceReference,
  EvidenceSurface,
  JourneyResult,
  ShoppingConstraint,
  ShoppingTaskContract,
  SnapshotEvidenceItem,
  StoreSnapshot,
} from "./types.js";
import { detectPriceDisagreement, referenceSupportsConstraint } from "./evidence-validator.js";
import { isNegatedMatch, matchingTermsIn, occursOutsideSpans } from "./util.js";

// ===========================================================================
// STORE DIAGNOSTIC SCAN (Stage 3, spec 4.1) — the instrument's OWN opinion of
// the store, computed evaluator-side from the FULL snapshot, independent of
// any agent's retrieval choices. Deterministic, zero model calls, label-blind
// (inputs: snapshot + contract only). Agent journeys then measure per-model
// IMPACT — which models notice what the scan already knows is there (4.4).
//
// This converts Stage 2's Gemini/F2 finding into what it really was: a
// retrieval-coverage measurement, not an instrument failure.
// ===========================================================================

export interface SurfaceEvidenceHit {
  evidenceId: string;
  surface: EvidenceSurface;
  sourceObjectId: string;
  quote: string;
  inScope: boolean;
}

export interface ConflictHit {
  affirmativeQuote: string;
  affirmativeSurface: EvidenceSurface;
  negativeQuote: string;
  negativeSurface: EvidenceSurface;
}

export interface ConstraintDiagnostic {
  constraintId: string;
  attribute: string;
  /** EXPLICIT-tier verdict over the WHOLE snapshot. */
  verdict: "evidenced" | "absent" | "conflicted";
  /** Supporting explicit evidence on acceptable surfaces. */
  explicitHits: SurfaceEvidenceHit[];
  /** Supporting evidence found on surfaces OUTSIDE acceptableSurfaces. */
  outOfScopeHits: SurfaceEvidenceHit[];
  /** Explicit evidence that CONTRADICTS the constraint (e.g. required variant
   *  unavailable). Recorded verbatim; verdict stays within the spec's enum. */
  contraryHits: SurfaceEvidenceHit[];
  conflictHits: ConflictHit[];
  /** Surfaces a competent agent would need to read for this constraint:
   *  everything bearing in-scope support, contrary evidence, or a conflict side. */
  relevantSurfaces: EvidenceSurface[];
}

export interface StoreDiagnostic {
  snapshotId: string;
  contractId: string;
  perConstraint: ConstraintDiagnostic[];
}

const asRef = (snapshot: StoreSnapshot, e: SnapshotEvidenceItem): EvidenceReference => ({
  evidenceId: e.evidenceId,
  surface: e.surface,
  sourceObjectId: e.sourceObjectId,
  exactText: e.exactText,
  structuredValue: e.structuredValue,
  snapshotId: snapshot.id,
});

function scanConstraint(
  snapshot: StoreSnapshot,
  constraint: ShoppingConstraint,
  scope: { productId: string; variantId?: string; productVariantIds?: ReadonlySet<string> },
): ConstraintDiagnostic {
  const explicitHits: SurfaceEvidenceHit[] = [];
  const outOfScopeHits: SurfaceEvidenceHit[] = [];
  const contraryHits: SurfaceEvidenceHit[] = [];
  const conflictHits: ConflictHit[] = [];

  for (const item of snapshot.evidence) {
    const ref = asRef(snapshot, item);
    const verdict = referenceSupportsConstraint(ref, constraint, scope);
    const hit: SurfaceEvidenceHit = {
      evidenceId: item.evidenceId,
      surface: item.surface,
      sourceObjectId: item.sourceObjectId,
      quote: item.exactText ?? JSON.stringify(item.structuredValue ?? null),
      inScope: constraint.acceptableSurfaces.includes(item.surface),
    };
    if (verdict.supports) {
      (hit.inScope ? explicitHits : outOfScopeHits).push(hit);
    } else if (verdict.contradicts && hit.inScope) {
      contraryHits.push(hit);
    }
  }

  // Conflict pairs, swept across the WHOLE snapshot's acceptable surfaces.
  for (const pair of constraint.conflictTermPairs ?? []) {
    const inScope = snapshot.evidence.filter(
      (e) => constraint.acceptableSurfaces.includes(e.surface) && e.exactText,
    );
    const aff = inScope.find((e) =>
      matchingTermsIn(e.exactText!, pair.affirmative).some((t) => !isNegatedMatch(e.exactText!, t)),
    );
    const neg = inScope.find((e) =>
      pair.negative.some((t) => occursOutsideSpans(e.exactText!, t, pair.affirmative) && !isNegatedMatch(e.exactText!, t)),
    );
    if (aff && neg) {
      conflictHits.push({
        affirmativeQuote: aff.exactText!,
        affirmativeSurface: aff.surface,
        negativeQuote: neg.exactText!,
        negativeSurface: neg.surface,
      });
    }
  }

  // Price-source disagreement (F4-class): snapshot-wide, for price constraints.
  if (constraint.attribute === "variant_price") {
    const all = snapshot.evidence.map((e) => asRef(snapshot, e));
    const price = detectPriceDisagreement(all, scope);
    if (price.disagree) {
      const mf = snapshot.evidence.find(
        (e) => e.surface === "product_metafields" && /price/i.test(String((e.structuredValue as { key?: string })?.key ?? "")),
      );
      const variant = snapshot.evidence.find((e) => {
        const sv = e.structuredValue as { variantId?: string } | undefined;
        return e.surface === "product_variants" && (!scope.variantId || sv?.variantId === scope.variantId);
      });
      conflictHits.push({
        affirmativeQuote: variant ? JSON.stringify(variant.structuredValue) : "variant price",
        affirmativeSurface: "product_variants",
        negativeQuote: mf?.exactText ?? price.detail ?? "disagreeing price source",
        negativeSurface: mf?.surface ?? "product_metafields",
      });
    }
  }

  const relevantSurfaces = [
    ...new Set([
      ...explicitHits.map((h) => h.surface),
      ...contraryHits.map((h) => h.surface),
      ...conflictHits.flatMap((c) => [c.affirmativeSurface, c.negativeSurface]),
    ]),
  ];

  const verdict: ConstraintDiagnostic["verdict"] =
    conflictHits.length > 0 ? "conflicted" : explicitHits.length > 0 ? "evidenced" : "absent";

  return {
    constraintId: constraint.id,
    attribute: constraint.attribute,
    verdict,
    explicitHits,
    outOfScopeHits,
    contraryHits,
    conflictHits,
    relevantSurfaces,
  };
}

/** The full evaluator-side scan: every hard AND soft constraint, all surfaces. */
export function scanStore(snapshot: StoreSnapshot, contract: ShoppingTaskContract): StoreDiagnostic {
  const target = snapshot.products.find((p) => p.productId === contract.productScope.productId);
  const scope = {
    ...contract.productScope,
    productVariantIds: new Set((target?.variants ?? []).map((v) => v.variantId)),
  };
  return {
    snapshotId: snapshot.id,
    contractId: contract.id,
    perConstraint: [...contract.hardConstraints, ...(contract.softConstraints ?? [])].map((c) =>
      scanConstraint(snapshot, c, scope),
    ),
  };
}

// ---- retrieval-coverage metric (spec 4.4) ----------------------------------

export interface CoverageMetric {
  coverageRatio: number;
  relevantSurfaces: EvidenceSurface[];
  retrievedSurfaces: EvidenceSurface[];
  missedRelevantSurfaces: EvidenceSurface[];
}

/** Compare what the scan says MATTERS against what the agent actually read. */
export function computeCoverage(diagnostic: StoreDiagnostic, result: JourneyResult): CoverageMetric {
  const relevant = [...new Set(diagnostic.perConstraint.flatMap((c) => c.relevantSurfaces))];
  const retrieved = [
    ...new Set(
      result.traceEvents
        .filter((e) => e.type === "TOOL_RESULT")
        .flatMap((e) => e.evidenceReferences ?? [])
        .map((r) => r.surface),
    ),
  ];
  const missed = relevant.filter((s) => !retrieved.includes(s));
  return {
    coverageRatio: relevant.length ? (relevant.length - missed.length) / relevant.length : 1,
    relevantSurfaces: relevant,
    retrievedSurfaces: retrieved,
    missedRelevantSurfaces: missed,
  };
}
