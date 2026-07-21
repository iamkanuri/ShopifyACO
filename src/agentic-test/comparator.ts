import type { JourneyResult, ShoppingTaskContract, Stage1Report } from "./types.js";
import { referenceSupportsConstraint } from "./evidence-validator.js";

// ===========================================================================
// Comparator + acceptance evaluation (spec 4.13). Deterministic aggregation of
// the 18 journeys into the Stage1Report, applying the acceptance criteria
// verbatim. An honestly reported FAIL gate is a successful completion of the
// experiment — nothing here retries or massages results.
// ===========================================================================

export interface SnapshotIds {
  baseId: string;
  faultyId: string;
  restoredId: string;
}

export function buildStage1Report(
  experimentId: string,
  contract: ShoppingTaskContract,
  snapshots: SnapshotIds,
  journeys: JourneyResult[],
): Stage1Report {
  const of = (snapshotId: string) => journeys.filter((j) => j.snapshotId === snapshotId);
  const base = of(snapshots.baseId);
  const faulty = of(snapshots.faultyId);
  const restored = of(snapshots.restoredId);

  const basePasses = base.filter((j) => j.outcome === "PASS").length;
  const faultyCorrectFailures = faulty.filter((j) => j.outcome === "MISSING_EVIDENCE").length;
  const restoredPasses = restored.filter((j) => j.outcome === "PASS").length;
  const falseCertaintyCount = journeys.filter((j) => j.outcome === "FALSE_CERTAINTY").length;
  const toolFailureCount = journeys.filter((j) => j.outcome === "TOOL_FAILURE").length;
  const modelFailureCount = journeys.filter((j) => j.outcome === "MODEL_FAILURE").length;

  const models = [...new Map(journeys.map((j) => [`${j.provider}/${j.model}`, { provider: j.provider, model: j.model }])).values()];
  const byModel = models.map(({ provider, model }) => {
    const mine = journeys.filter((j) => j.provider === provider && j.model === model);
    const rate = (list: JourneyResult[], outcome: string) =>
      list.length ? list.filter((j) => j.outcome === outcome).length / list.length : 0;
    return {
      provider,
      model,
      basePassRate: rate(mine.filter((j) => j.snapshotId === snapshots.baseId), "PASS"),
      faultyMissingEvidenceRate: rate(mine.filter((j) => j.snapshotId === snapshots.faultyId), "MISSING_EVIDENCE"),
      restoredPassRate: rate(mine.filter((j) => j.snapshotId === snapshots.restoredId), "PASS"),
    };
  });

  const totalEstimatedCostUsd = journeys.reduce((s, j) => s + j.estimatedCostUsd, 0);

  // ---- acceptance criteria (spec 4.13, all required) -----------------------
  const reasons: string[] = [];

  if (!(base.length >= 6 && basePasses >= 5)) {
    reasons.push(`criterion 1 FAILED: BASE ${basePasses}/${base.length} PASS (need >=5 of 6)`);
  }
  if (!(faulty.length >= 6 && faultyCorrectFailures >= 5)) {
    reasons.push(`criterion 2 FAILED: FAULTY ${faultyCorrectFailures}/${faulty.length} MISSING_EVIDENCE (need >=5 of 6)`);
  }
  if (!(restored.length >= 6 && restoredPasses >= 5)) {
    reasons.push(`criterion 3 FAILED: RESTORED ${restoredPasses}/${restored.length} PASS (need >=5 of 6)`);
  }
  // 4. Each model family distinguishes FAULTY from BASE/RESTORED in >=2 of 3 trials:
  //    it correctly fails FAULTY >=2/3 while correctly passing BASE and RESTORED >=2/3.
  for (const m of byModel) {
    const mine = journeys.filter((j) => j.provider === m.provider && j.model === m.model);
    const n = (id: string, outcome: string) => mine.filter((j) => j.snapshotId === id && j.outcome === outcome).length;
    const ok = n(snapshots.faultyId, "MISSING_EVIDENCE") >= 2 && n(snapshots.baseId, "PASS") >= 2 && n(snapshots.restoredId, "PASS") >= 2;
    if (!ok) {
      reasons.push(
        `criterion 4 FAILED: ${m.provider}/${m.model} does not distinguish FAULTY from BASE/RESTORED in >=2 of 3 trials ` +
          `(base PASS ${n(snapshots.baseId, "PASS")}/3, faulty MISSING_EVIDENCE ${n(snapshots.faultyId, "MISSING_EVIDENCE")}/3, restored PASS ${n(snapshots.restoredId, "PASS")}/3)`,
      );
    }
  }
  // 5. Every positive attribute claim references tool-returned evidence.
  for (const j of journeys) {
    for (const ev of j.constraintEvaluations) {
      if (ev.status === "satisfied" && ev.evidenceReferences.length === 0) {
        reasons.push(`criterion 5 FAILED: run ${j.runId} has a satisfied-claim with no tool-returned evidence`);
      }
    }
  }
  if (falseCertaintyCount !== 0) {
    reasons.push(`criterion 6 FAILED: FALSE_CERTAINTY count is ${falseCertaintyCount} (must be 0); runs preserved for debugging`);
  }
  // 7. No store failure reported where the trace shows the evidence existed and
  //    was reachable through allowed tools: a MISSING_EVIDENCE run whose OWN
  //    trace contains a tool-returned reference that validly supports the
  //    constraint is such a contradiction.
  for (const j of journeys) {
    if (j.outcome !== "MISSING_EVIDENCE") continue;
    for (const constraint of contract.hardConstraints) {
      const returned = j.traceEvents
        .filter((e) => e.type === "TOOL_RESULT")
        .flatMap((e) => e.evidenceReferences ?? [])
        .filter((r) => constraint.acceptableSurfaces.includes(r.surface));
      const reachable = returned.some((r) => referenceSupportsConstraint(r, constraint).supports);
      if (reachable) {
        reasons.push(
          `criterion 7 FAILED: run ${j.runId} reported MISSING_EVIDENCE but its trace contains tool-returned evidence supporting '${constraint.id}'`,
        );
      }
    }
  }
  if (totalEstimatedCostUsd > 25) {
    reasons.push(`criterion 8 FAILED: total estimated cost $${totalEstimatedCostUsd.toFixed(2)} exceeds $25`);
  }

  return {
    experimentId,
    snapshots,
    aggregate: {
      basePasses,
      baseRuns: base.length,
      faultyCorrectFailures,
      faultyRuns: faulty.length,
      restoredPasses,
      restoredRuns: restored.length,
      falseCertaintyCount,
      toolFailureCount,
      modelFailureCount,
    },
    byModel,
    acceptance: { passed: reasons.length === 0, reasons },
    totalEstimatedCostUsd,
  };
}

/** Human-readable output block (spec 4.13 format). */
export function formatHumanReport(
  report: Stage1Report,
  detail: {
    taskLine: string;
    baseEvidenceLine: string;
    faultySurfacesLine: string;
    restoredEvidenceLine: string;
    unsupportedReferenceCount: number;
  },
): string {
  const a = report.aggregate;
  return [
    "AGENTIC INSTRUMENT TEST — STAGE 1",
    `Task: ${detail.taskLine}`,
    "",
    `BASE SNAPSHOT       ${a.basePasses}/${a.baseRuns} PASS`,
    `  Evidence found: ${detail.baseEvidenceLine}`,
    `FAULTY SNAPSHOT     ${a.faultyCorrectFailures}/${a.faultyRuns} MISSING_EVIDENCE`,
    `  Surfaces checked: ${detail.faultySurfacesLine}   No explicit aluminum-free evidence found.`,
    `RESTORED SNAPSHOT   ${a.restoredPasses}/${a.restoredRuns} PASS`,
    `  Evidence restored: ${detail.restoredEvidenceLine}`,
    "",
    `False-certainty events: ${a.falseCertaintyCount}     Unsupported evidence references: ${detail.unsupportedReferenceCount}`,
    `Tool failures: ${a.toolFailureCount}              Model failures: ${a.modelFailureCount}`,
    `Estimated API cost: $${report.totalEstimatedCostUsd.toFixed(2)}`,
    `GATE RESULT: ${report.acceptance.passed ? "PASS" : "FAIL"}`,
    `Reasons: ${report.acceptance.passed ? "all acceptance criteria met" : report.acceptance.reasons.join(" | ")}`,
  ].join("\n");
}
