import { compareProportions, type ChangeVerdict, type Comparison } from "../benchmarks/stats.js";
import type { BenchmarkMetrics } from "../benchmarks/metrics.js";

// ===========================================================================
// Experiment verification (Phase 7) — PURE. THE differentiator: did the change
// actually move AI visibility? We compare a matched pair of benchmark runs (the
// SAME definition, before vs after the intervention) metric-by-metric with Wilson
// confidence intervals, and classify each as improved | regressed | inconclusive
// (the 95% CI of the difference must exclude 0 — "no evidence of change" is NOT
// "no change"). We NEVER assert causation: an intervention plus a measured change
// is association, with confounders (assistant model updates, index refreshes,
// competitor moves, run-to-run variance) that the CI does not capture. Those are
// surfaced as comparability warnings + explicit caveats, never hidden.
// ===========================================================================

/** Proportion metrics we compare (each carries successes + n on BenchmarkMetrics). */
const COMPARED_METRICS = [
  "recommendationRate",
  "mentionRate",
  "topChoiceRate",
  "promptCoverage",
  "citationBackedRate",
] as const;
export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export interface MetricComparison extends Comparison {
  metric: ComparedMetric;
}

export interface ComparabilityWarning {
  code: "model_changed" | "engines_changed" | "prompt_count_changed" | "repetitions_changed" | "low_power" | "denominator_changed";
  message: string;
}

export interface RunMeta {
  runId?: number | null;
  engines?: string[];
  modelVersions?: Record<string, string>;
  promptCount?: number;
  repetitions?: number;
  finishedAt?: string | null;
}

export interface ExperimentResult {
  primaryMetric: ComparedMetric;
  primary: MetricComparison;
  secondary: MetricComparison[];
  verdict: ChangeVerdict;
  comparability: ComparabilityWarning[];
  caveats: string[];
  baselineRunId: number | null;
  verificationRunId: number | null;
}

function compareMetric(metric: ComparedMetric, baseline: BenchmarkMetrics, verification: BenchmarkMetrics): MetricComparison {
  const b = baseline[metric];
  const v = verification[metric];
  return { metric, ...compareProportions(b.successes, b.n, v.successes, v.n) };
}

/** Detect things that make the two runs not strictly comparable. We never silently
 *  drop a result for these — we attach them so the verdict is read in context. */
export function comparabilityWarnings(base: RunMeta, verif: RunMeta, primary: MetricComparison): ComparabilityWarning[] {
  const warnings: ComparabilityWarning[] = [];

  // Engine model version changed between runs → the engine itself may explain a shift.
  const bModels = base.modelVersions ?? {};
  const vModels = verif.modelVersions ?? {};
  const changedModels = Object.keys({ ...bModels, ...vModels }).filter((e) => bModels[e] && vModels[e] && bModels[e] !== vModels[e]);
  if (changedModels.length > 0) {
    warnings.push({
      code: "model_changed",
      message: `Engine model changed between runs (${changedModels.map((e) => `${e}: ${bModels[e]}→${vModels[e]}`).join(", ")}). A model update can move these numbers independent of your change.`,
    });
  }

  // Different engine set → different denominators / behavior.
  const bEng = [...(base.engines ?? [])].sort().join(",");
  const vEng = [...(verif.engines ?? [])].sort().join(",");
  if (bEng && vEng && bEng !== vEng) {
    warnings.push({ code: "engines_changed", message: `Different engines were run (baseline: ${bEng || "?"}; verification: ${vEng || "?"}). Compare the same engine set.` });
  }

  if (base.promptCount != null && verif.promptCount != null && base.promptCount !== verif.promptCount) {
    warnings.push({ code: "prompt_count_changed", message: `Prompt count differs (${base.promptCount} vs ${verif.promptCount}); the two runs measured different question sets.` });
  }
  if (base.repetitions != null && verif.repetitions != null && base.repetitions !== verif.repetitions) {
    warnings.push({ code: "repetitions_changed", message: `Repetitions differ (${base.repetitions} vs ${verif.repetitions}); sampling depth isn't matched.` });
  }

  // Low statistical power → an "inconclusive" verdict is expected, not informative.
  const minN = Math.min(primary.baseline.n, primary.current.n);
  if (minN < 30) {
    warnings.push({
      code: "low_power",
      message: `Small sample (n=${minN} on the primary metric). At this size only a large effect is detectable; an "inconclusive" result likely reflects low power, not a confirmed null.`,
    });
  }
  if (primary.baseline.n !== primary.current.n) {
    warnings.push({ code: "denominator_changed", message: `Primary-metric denominator differs (baseline n=${primary.baseline.n}, verification n=${primary.current.n}).` });
  }
  return warnings;
}

function caveatsFor(verdict: ChangeVerdict, primary: MetricComparison): string[] {
  const caveats = [
    "Association, not proof: a change measured alongside your intervention is not causal evidence. Confounders (assistant model updates, retrieval/index refreshes, competitor changes, run-to-run variance) can move these numbers on their own.",
    "The confidence interval reflects sampling within this matched run pair only — it does not capture all sources of real-world variation.",
  ];
  if (verdict === "inconclusive") {
    caveats.push('"Inconclusive" means no change was detectable at this sample size — NOT proof the intervention had no effect. Add prompts/repetitions for more statistical power, then re-verify.');
  } else {
    const dir = verdict === "improved" ? "increase" : "decrease";
    caveats.push(`The measured ${dir} on ${primary.metric} is the best estimate from this pair; the true effect lies within the reported CI and should be re-confirmed on a later run before being treated as durable.`);
  }
  return caveats;
}

/** Compare a matched baseline/verification pair into an honest, CI-backed result. */
export function compareExperiment(
  baseline: BenchmarkMetrics,
  verification: BenchmarkMetrics,
  meta: { baseline: RunMeta; verification: RunMeta; primaryMetric?: ComparedMetric } = { baseline: {}, verification: {} },
): ExperimentResult {
  const primaryMetric = meta.primaryMetric ?? "recommendationRate";
  const primary = compareMetric(primaryMetric, baseline, verification);
  const secondary = COMPARED_METRICS.filter((m) => m !== primaryMetric).map((m) => compareMetric(m, baseline, verification));

  return {
    primaryMetric,
    primary,
    secondary,
    verdict: primary.verdict,
    comparability: comparabilityWarnings(meta.baseline, meta.verification, primary),
    caveats: caveatsFor(primary.verdict, primary),
    baselineRunId: meta.baseline.runId ?? null,
    verificationRunId: meta.verification.runId ?? null,
  };
}
