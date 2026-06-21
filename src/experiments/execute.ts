import { registerHandler } from "../queue/handlers.js";
import { executeBenchmark } from "../benchmarks/execute.js";
import { aggregateRun, getBenchmark } from "../db/benchmarks.js";
import {
  createExperiment, createIntervention, getExperiment, getRunComparability, saveExperimentResult,
  setBaselineRun, updateInterventionStatus, type ExperimentRow,
} from "../db/experiments.js";
import { compareExperiment, type ComparedMetric, type ExperimentResult } from "./verify.js";

// ===========================================================================
// Phase 7 orchestrator: capture a matched baseline/verification pair around a
// merchant intervention and classify the change with CIs. Benchmark execution
// reuses Phase 4 (executeBenchmark) — mock runs are $0; LIVE runs spend money and
// reserve worst-case cost up front (Phase-1 reservation), so the caller must
// confirm cost first (same gate as Phase 4). We measure; we never claim causation.
// ===========================================================================

const verdictToStatus: Record<string, string> = { improved: "verified", regressed: "regressed", inconclusive: "inconclusive" };

export interface PlanResult {
  interventionId: number;
  experimentId: number;
}

/** Record an intervention + open a (pending) experiment to measure it. */
export async function planIntervention(
  shop: string,
  opts: { benchmarkId: number; kind: string; description: string; proposalId?: number | null; productGid?: string | null; primaryMetric?: ComparedMetric },
): Promise<PlanResult> {
  const interventionId = await createIntervention(shop, {
    benchmarkId: opts.benchmarkId, kind: opts.kind, description: opts.description, proposalId: opts.proposalId, productGid: opts.productGid,
  });
  const experimentId = await createExperiment(shop, { interventionId, benchmarkId: opts.benchmarkId, primaryMetric: opts.primaryMetric });
  return { interventionId, experimentId };
}

async function ownedExperiment(shop: string, experimentId: number): Promise<ExperimentRow> {
  const exp = await getExperiment(experimentId);
  if (!exp || exp.shop_domain !== shop) throw new Error("experiment not found for this shop");
  if (exp.benchmark_id == null) throw new Error("experiment has no benchmark");
  return exp;
}

/** Capture the BASELINE: run the benchmark BEFORE the change. */
export async function captureBaseline(shop: string, experimentId: number, opts: { mock?: boolean } = {}): Promise<{ runId: number }> {
  const exp = await ownedExperiment(shop, experimentId);
  const r = await executeBenchmark(exp.benchmark_id!, { mock: opts.mock });
  await setBaselineRun(experimentId, r.runId);
  if (exp.intervention_id) await updateInterventionStatus(exp.intervention_id, "measuring");
  return { runId: r.runId };
}

/** Run the VERIFICATION (after the change) and compare it to the baseline. */
export async function runVerification(shop: string, experimentId: number, opts: { mock?: boolean } = {}): Promise<ExperimentResult> {
  const exp = await ownedExperiment(shop, experimentId);
  if (exp.baseline_run_id == null) throw new Error("capture a baseline before verifying");

  const bench = await getBenchmark(exp.benchmark_id!);
  if (!bench) throw new Error("benchmark not found");
  const brand = bench.config.brand.name;

  // Run verification, then aggregate BOTH runs for the merchant brand on identical metrics.
  const v = await executeBenchmark(exp.benchmark_id!, { mock: opts.mock });
  const baselineAgg = await aggregateRun(exp.baseline_run_id, brand);
  const verificationAgg = await aggregateRun(v.runId, brand);

  const [baseMeta, verifMeta] = await Promise.all([getRunComparability(exp.baseline_run_id), getRunComparability(v.runId)]);
  const result = compareExperiment(baselineAgg.metrics, verificationAgg.metrics, {
    baseline: baseMeta, verification: verifMeta, primaryMetric: exp.primary_metric as ComparedMetric,
  });

  await saveExperimentResult(experimentId, { verificationRunId: v.runId, verdict: result.verdict, result, comparability: result.comparability });
  if (exp.intervention_id) await updateInterventionStatus(exp.intervention_id, verdictToStatus[result.verdict] ?? "inconclusive");
  return result;
}

/** Register the queue handler so verification can run on the worker. Defaults to
 *  mock; a live verification (real engine spend) requires payload.live === true. */
export function registerExperimentJobs(): void {
  registerHandler("experiment_verify", async (payload) => {
    const shop = String(payload.shop ?? "");
    const experimentId = Number(payload.experimentId);
    if (!shop || !Number.isInteger(experimentId)) throw new Error("experiment_verify: missing shop/experimentId");
    const result = await runVerification(shop, experimentId, { mock: payload.live === true ? false : true });
    return { verdict: result.verdict, baselineRunId: result.baselineRunId, verificationRunId: result.verificationRunId };
  });
}
