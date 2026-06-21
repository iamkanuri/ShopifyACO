import { pgQuery } from "./pg.js";
import type { ExperimentResult, RunMeta } from "../experiments/verify.js";

// Persistence for Phase 7 (interventions + matched experiments). Shop-scoped.

export interface InterventionRow {
  id: number;
  shop_domain: string;
  benchmark_id: number | null;
  kind: string;
  description: string;
  proposal_id: number | null;
  product_gid: string | null;
  status: string;
}

export interface ExperimentRow {
  id: number;
  shop_domain: string;
  intervention_id: number | null;
  benchmark_id: number | null;
  baseline_run_id: number | null;
  verification_run_id: number | null;
  primary_metric: string;
  verdict: string;
  result: ExperimentResult | Record<string, unknown>;
  comparability: unknown[];
}

export async function createIntervention(shop: string, i: { benchmarkId: number | null; kind: string; description: string; proposalId?: number | null; productGid?: string | null }): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    "insert into interventions (shop_domain, benchmark_id, kind, description, proposal_id, product_gid) values ($1,$2,$3,$4,$5,$6) returning id",
    [shop, i.benchmarkId, i.kind, i.description, i.proposalId ?? null, i.productGid ?? null],
  );
  return Number(rows[0]!.id);
}

export async function updateInterventionStatus(id: number, status: string): Promise<void> {
  await pgQuery("update interventions set status=$2, updated_at=now() where id=$1", [id, status]);
}

export async function getIntervention(id: number): Promise<InterventionRow | null> {
  const { rows } = await pgQuery<InterventionRow & { id: string; benchmark_id: string | null; proposal_id: string | null }>(
    "select * from interventions where id=$1",
    [id],
  );
  const r = rows[0];
  return r ? { ...r, id: Number(r.id), benchmark_id: r.benchmark_id != null ? Number(r.benchmark_id) : null, proposal_id: r.proposal_id != null ? Number(r.proposal_id) : null } : null;
}

export async function listInterventions(shop: string, limit = 50): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery(
    `select i.*, (select count(*)::int from experiments e where e.intervention_id=i.id) as experiment_count
       from interventions i where i.shop_domain=$1 order by i.created_at desc limit $2`,
    [shop, Math.min(200, Math.max(1, limit))],
  );
  return rows;
}

export async function createExperiment(shop: string, e: { interventionId: number; benchmarkId: number | null; primaryMetric?: string }): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    "insert into experiments (shop_domain, intervention_id, benchmark_id, primary_metric) values ($1,$2,$3,$4) returning id",
    [shop, e.interventionId, e.benchmarkId, e.primaryMetric ?? "recommendationRate"],
  );
  return Number(rows[0]!.id);
}

export async function getExperiment(id: number): Promise<ExperimentRow | null> {
  const { rows } = await pgQuery<ExperimentRow & { id: string; intervention_id: string | null; benchmark_id: string | null; baseline_run_id: string | null; verification_run_id: string | null }>(
    "select * from experiments where id=$1",
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...r, id: Number(r.id),
    intervention_id: r.intervention_id != null ? Number(r.intervention_id) : null,
    benchmark_id: r.benchmark_id != null ? Number(r.benchmark_id) : null,
    baseline_run_id: r.baseline_run_id != null ? Number(r.baseline_run_id) : null,
    verification_run_id: r.verification_run_id != null ? Number(r.verification_run_id) : null,
  };
}

export async function listExperiments(shop: string, interventionId?: number): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery(
    `select id, intervention_id, benchmark_id, baseline_run_id, verification_run_id, primary_metric, verdict, result, comparability, created_at, verified_at
       from experiments where shop_domain=$1 and ($2::bigint is null or intervention_id=$2) order by created_at desc limit 100`,
    [shop, interventionId ?? null],
  );
  return rows;
}

export async function setBaselineRun(experimentId: number, runId: number): Promise<void> {
  await pgQuery("update experiments set baseline_run_id=$2 where id=$1", [experimentId, runId]);
}

export async function saveExperimentResult(experimentId: number, fields: { verificationRunId: number; verdict: string; result: ExperimentResult; comparability: unknown[] }): Promise<void> {
  await pgQuery(
    "update experiments set verification_run_id=$2, verdict=$3, result=$4::jsonb, comparability=$5::jsonb, verified_at=now() where id=$1",
    [experimentId, fields.verificationRunId, fields.verdict, JSON.stringify(fields.result), JSON.stringify(fields.comparability)],
  );
}

/** Pull a benchmark run's comparability metadata (engines, model versions, sizes). */
export async function getRunComparability(runId: number): Promise<RunMeta> {
  const { rows } = await pgQuery<{ engines: string[] | null; model_versions: Record<string, string> | null; prompt_count: number | null; repetitions: number | null; finished_at: string | null }>(
    "select engines, model_versions, prompt_count, repetitions, finished_at from benchmark_runs where id=$1",
    [runId],
  );
  const r = rows[0];
  return {
    runId,
    engines: r?.engines ?? [],
    modelVersions: r?.model_versions ?? {},
    promptCount: r?.prompt_count ?? undefined,
    repetitions: r?.repetitions ?? undefined,
    finishedAt: r?.finished_at ?? null,
  };
}
