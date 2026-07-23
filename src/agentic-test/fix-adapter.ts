import type { FixProposal } from "../fixes/propose.js";
import { stripHtml } from "../catalog/normalize.js";
import type { StoreDiagnostic } from "./store-diagnostic.js";
import type { PendingRevertMarker } from "./store-fault.js";

// ===========================================================================
// Diagnosis → Fix Studio proposal adapter (spec 4.3.1). Maps the instrument's
// EVIDENCE_GAP diagnosis (constraint, root cause, scan surface inventory) plus
// the pending-revert restoration content into the exact FixProposal shape the
// production engine consumes. Framed the way Fix Studio frames merchant
// changes; nothing is fabricated — the proposed value IS the merchant's own
// pre-fault copy.
// ===========================================================================

export interface CaseDiagnosis {
  constraintId: string;
  attribute: string;
  rootCause: "EVIDENCE_GAP";
  scan: StoreDiagnostic;
  /** Surfaces journeys actually searched (from traces), for the rationale. */
  searchedSurfaces: string[];
}

/** Rollback verification (spec test 39): the API re-read must match the
 *  pre-change state exactly (null and "" are the same "unset" state). */
export function verifyRollback(before: string | null, after: string | null): boolean {
  return (before ?? "") === (after ?? "");
}

/** Identical-rerun guard (spec test 40): refuse a before/after comparison when
 *  harness/prompt/contract identities differ between the two run sets. */
export interface RunConfigPin {
  contractId: string;
  promptVersion: string;
  providers: string[];
}
export function assertIdenticalRunConfig(before: RunConfigPin, after: RunConfigPin): void {
  const problems: string[] = [];
  if (before.contractId !== after.contractId) problems.push(`contract differs: ${before.contractId} vs ${after.contractId}`);
  if (before.promptVersion !== after.promptVersion) problems.push(`promptVersion differs: ${before.promptVersion} vs ${after.promptVersion}`);
  const a = [...before.providers].sort().join(",");
  const b = [...after.providers].sort().join(",");
  if (a !== b) problems.push(`providers differ: ${a} vs ${b}`);
  if (problems.length) throw new Error(`IDENTICAL-RERUN GUARD: ${problems.join("; ")} — before/after comparison is invalid`);
}

export function buildRestorationProposal(diagnosis: CaseDiagnosis, marker: PendingRevertMarker): FixProposal {
  if (diagnosis.rootCause !== "EVIDENCE_GAP") {
    throw new Error(`adapter only maps EVIDENCE_GAP diagnoses (got ${diagnosis.rootCause})`);
  }
  const c1 = diagnosis.scan.perConstraint.find((c) => c.constraintId === diagnosis.constraintId);
  if (!c1 || c1.verdict !== "absent") {
    throw new Error("diagnosis/scan mismatch: the constraint is not 'absent' in the provided scan");
  }
  const faultedPlainText = stripHtml(marker.faultedDescriptionHtml) ?? "";
  return {
    productGid: marker.productGid,
    kind: "write_products",
    target: "descriptionHtml",
    label: `Restore the product's ${diagnosis.attribute.replace(/_/g, "-")} statement to the description`,
    currentValue: faultedPlainText,
    proposedValue: marker.restore.descriptionHtml,
    // Conflict baseline = what Fix Studio's re-read will actually see for this
    // target: the NORMALIZED (HTML-stripped) live description.
    basedOn: faultedPlainText,
    rationale:
      `AI shopping agents cannot verify "${diagnosis.attribute}" for this product: the store exposes no ` +
      `explicit statement on any checkable surface (checked: ${diagnosis.searchedSurfaces.join(", ")}). ` +
      `This restores the merchant's own product copy that states it directly.`,
    evidence: {
      findingKind: "EVIDENCE_GAP",
      signal: diagnosis.attribute,
      intervention: "restore explicit attribute statement to the product description",
      mechanism:
        "agents and the deterministic validator credit only retrievable, explicit statements — restoring the sentence makes the fact verifiable again; hedged: external AI visibility additionally depends on indexing",
    },
  };
}
