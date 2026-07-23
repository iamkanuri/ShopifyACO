import type { JourneyResult, RootCauseCode } from "./types.js";
import type { Stage2Manifest, Stage2Role } from "./run-experiment2.js";
import { RETURNS_CONFLICT_PAIR, stage2PrimaryContract, stage2SecondaryContract } from "./contract2.js";
import { isNegatedMatch, matchingTermsIn, occursOutsideSpans } from "./util.js";

// ===========================================================================
// Stage 2 comparator + acceptance evaluation (spec S2 4.5). Deterministic
// aggregation; this is the ONLY layer (besides the runner CLI) that knows
// snapshot labels. Observational runs (PARA, TRAP, secondary, WILD) are
// excluded from the gate by construction and reported separately — spec test
// 23. An honestly reported FAIL gate is a successful completion.
// ===========================================================================

export const GATE_ROLES: Stage2Role[] = ["base", "f1", "f2", "f3", "f4", "f5", "restored-f1"];

/** Appendix B expectations (evaluator/report layer ONLY). */
const FAULT_EXPECTATIONS: Record<
  string,
  Array<{ outcome: string; rootCause?: RootCauseCode | undefined }>
> = {
  base: [{ outcome: "PASS" }],
  "restored-f1": [{ outcome: "PASS" }],
  f1: [{ outcome: "MISSING_EVIDENCE", rootCause: "EVIDENCE_GAP" }],
  f2: [{ outcome: "CONTRADICTION", rootCause: "CONTRADICTION" }],
  f3: [
    { outcome: "CONSTRAINT_VIOLATION", rootCause: "INVENTORY_MISMATCH" },
    { outcome: "WRONG_PRODUCT_SELECTED", rootCause: "WRONG_PRODUCT" }, // if the model substitutes
  ],
  f4: [
    { outcome: "CONTRADICTION", rootCause: "STALE_STRUCTURED_DATA" },
    { outcome: "CONSTRAINT_VIOLATION", rootCause: "STALE_STRUCTURED_DATA" },
  ],
  f5: [{ outcome: "MISSING_EVIDENCE", rootCause: "POLICY_OPACITY" }],
};

export function meetsExpectation(role: Stage2Role, j: JourneyResult): boolean {
  const expected = FAULT_EXPECTATIONS[role] ?? [];
  return expected.some(
    (e) => j.outcome === e.outcome && (e.rootCause === undefined || j.rootCauseCode === e.rootCause),
  );
}

/** Deterministic check: did THIS run's trace retrieve BOTH sides of the
 *  returns conflict pair (criterion 6's "both conflicting sources retrieved")? */
export function bothConflictSourcesRetrieved(j: JourneyResult): boolean {
  const surfaces = ["product_description", "faq", "returns_policy"];
  const texts = j.traceEvents
    .filter((e) => e.type === "TOOL_RESULT")
    .flatMap((e) => e.evidenceReferences ?? [])
    .filter((r) => surfaces.includes(r.surface))
    .map((r) => r.exactText ?? "")
    .filter(Boolean);
  const aff = texts.some((t) => matchingTermsIn(t, RETURNS_CONFLICT_PAIR.affirmative).some((x) => !isNegatedMatch(t, x)));
  const neg = texts.some((t) =>
    RETURNS_CONFLICT_PAIR.negative.some((x) => occursOutsideSpans(t, x, RETURNS_CONFLICT_PAIR.affirmative) && !isNegatedMatch(t, x)),
  );
  return aff && neg;
}

/** The agent's DECLARED per-constraint statuses (pre-validation), recovered
 *  from the preserved raw final response. Null when unparseable. */
export function declaredStatuses(j: JourneyResult): Record<string, string> | null {
  if (!j.rawFinalResponse) return null;
  try {
    const start = j.rawFinalResponse.indexOf("{");
    const parsed = JSON.parse(j.rawFinalResponse.slice(start)) as {
      constraints?: Array<{ constraintId?: string; status?: string }>;
    };
    const out: Record<string, string> = {};
    for (const c of parsed.constraints ?? []) {
      if (c.constraintId && c.status) out[c.constraintId] = c.status;
    }
    return out;
  } catch {
    return null;
  }
}

export interface Stage2Report {
  experimentId: string;
  snapshots: Record<Stage2Role, string>;
  gate: {
    perRole: Record<string, { runs: number; expected: number; outcomes: string[] }>;
    perModelPerRole: Record<string, Record<string, { runs: number; expected: number }>>;
    falseCertaintyCount: number;
    toolFailureCount: number;
    modelFailureCount: number;
    f2BothSourcesRetrieved: number;
    f2Contradictions: number;
    substitution: Record<string, { f3Runs: number; substituted: number; misadjudicated: number }>;
    secondaryPasses: number;
    secondaryRuns: number;
  };
  acceptance: { passed: boolean; reasons: string[] };
  totalEstimatedCostUsd: number;
}

export function buildStage2Report(
  experimentId: string,
  manifest: Stage2Manifest,
  journeys: JourneyResult[],
): Stage2Report {
  const roleOf = new Map<string, Stage2Role>(
    (Object.entries(manifest.snapshots) as Array<[Stage2Role, string]>).map(([role, id]) => [id, role]),
  );
  const real = journeys.filter(
    (j) => ["openai", "gemini"].includes(j.provider) && j.trialNumber >= 1,
  );
  const gateRuns = real.filter(
    (j) =>
      j.contractId === stage2PrimaryContract.id &&
      GATE_ROLES.includes(roleOf.get(j.snapshotId) as Stage2Role),
  );
  const secondaryRuns = real.filter(
    (j) => j.contractId === stage2SecondaryContract.id && roleOf.get(j.snapshotId) === "base",
  );

  const perRole: Stage2Report["gate"]["perRole"] = {};
  const perModelPerRole: Stage2Report["gate"]["perModelPerRole"] = {};
  for (const role of GATE_ROLES) {
    const runs = gateRuns.filter((j) => roleOf.get(j.snapshotId) === role);
    perRole[role] = {
      runs: runs.length,
      expected: runs.filter((j) => meetsExpectation(role, j)).length,
      outcomes: runs.map((j) => `${j.provider[0]}${j.trialNumber}:${j.outcome}${j.rootCauseCode ? `/${j.rootCauseCode}` : ""}`),
    };
    for (const provider of ["openai", "gemini"]) {
      const mine = runs.filter((j) => j.provider === provider);
      (perModelPerRole[provider] ??= {})[role] = {
        runs: mine.length,
        expected: mine.filter((j) => meetsExpectation(role, j)).length,
      };
    }
  }

  const falseCertaintyCount = gateRuns.filter((j) => j.outcome === "FALSE_CERTAINTY").length;
  const toolFailureCount = gateRuns.filter((j) => j.outcome === "TOOL_FAILURE").length;
  const modelFailureCount = gateRuns.filter((j) => j.outcome === "MODEL_FAILURE").length;

  const f2Runs = gateRuns.filter((j) => roleOf.get(j.snapshotId) === "f2");
  const f2BothSourcesRetrieved = f2Runs.filter(bothConflictSourcesRetrieved).length;
  const f2Contradictions = f2Runs.filter((j) => j.outcome === "CONTRADICTION").length;

  const substitution: Stage2Report["gate"]["substitution"] = {};
  for (const provider of ["openai", "gemini"]) {
    const f3 = gateRuns.filter((j) => roleOf.get(j.snapshotId) === "f3" && j.provider === provider);
    const substituted = f3.filter(
      (j) => j.selectedVariantId && j.selectedVariantId !== manifest.requiredVariantId && j.modelDeclaredOutcome === "PASS",
    );
    substitution[provider] = {
      f3Runs: f3.length,
      substituted: substituted.length,
      misadjudicated: substituted.filter((j) => j.outcome !== "WRONG_PRODUCT_SELECTED").length,
    };
  }

  const secondaryPasses = secondaryRuns.filter((j) => j.outcome === "PASS").length;
  const totalEstimatedCostUsd = real.reduce((s, j) => s + j.estimatedCostUsd, 0);

  // ---- acceptance criteria (spec S2 4.5) ----------------------------------
  const reasons: string[] = [];
  const need = (role: Stage2Role, label: string) => {
    const r = perRole[role]!;
    if (!(r.runs >= 6 && r.expected >= 5)) {
      reasons.push(`criterion ${label} FAILED: ${role} ${r.expected}/${r.runs} expected-outcome runs (need >=5 of 6)`);
    }
  };
  need("base", "1");
  for (const f of ["f1", "f2", "f3", "f4", "f5"] as const) {
    need(f, `2(${f})`);
    for (const provider of ["openai", "gemini"]) {
      const m = perModelPerRole[provider]![f]!;
      if (!(m.expected >= 2)) {
        reasons.push(`criterion 2 FAILED: ${provider} on ${f} only ${m.expected}/${m.runs} expected (need >=2 of 3)`);
      }
    }
  }
  need("restored-f1", "3");
  if (falseCertaintyCount !== 0) {
    reasons.push(`criterion 4 FAILED: FALSE_CERTAINTY count is ${falseCertaintyCount} on gate runs (must be 0; runs preserved)`);
  }
  for (const [provider, s] of Object.entries(substitution)) {
    if (s.misadjudicated > 0) {
      reasons.push(`criterion 5 FAILED: ${provider} had ${s.misadjudicated} substituted run(s) NOT adjudicated WRONG_PRODUCT`);
    }
  }
  if (!(f2BothSourcesRetrieved >= 5)) {
    reasons.push(`criterion 6 FAILED: only ${f2BothSourcesRetrieved}/6 F2 traces retrieved both conflicting sources`);
  }
  if (!(f2Contradictions >= 5)) {
    reasons.push(`criterion 6 FAILED: only ${f2Contradictions}/6 F2 runs adjudicated CONTRADICTION`);
  }
  if (!(secondaryRuns.length >= 4 && secondaryPasses >= 3)) {
    reasons.push(`criterion 8 FAILED: secondary BASE ${secondaryPasses}/${secondaryRuns.length} PASS (need >=3 of 4)`);
  }
  if (totalEstimatedCostUsd > 25) {
    reasons.push(`criterion 9 FAILED: total cost $${totalEstimatedCostUsd.toFixed(2)} exceeds the $25 breaker`);
  }

  return {
    experimentId,
    snapshots: manifest.snapshots,
    gate: {
      perRole,
      perModelPerRole,
      falseCertaintyCount,
      toolFailureCount,
      modelFailureCount,
      f2BothSourcesRetrieved,
      f2Contradictions,
      substitution,
      secondaryPasses,
      secondaryRuns: secondaryRuns.length,
    },
    acceptance: { passed: reasons.length === 0, reasons },
    totalEstimatedCostUsd,
  };
}
