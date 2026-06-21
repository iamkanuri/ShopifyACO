import { pgQuery } from "./pg.js";
import { aggregate, type BenchmarkMetrics, type ObservationLike } from "../benchmarks/metrics.js";

// Benchmark persistence (Phase 4). Benchmarks are reusable+versioned; runs execute
// them; observations are the atomic per-answer rows the statistics aggregate over.

export interface BenchmarkConfig {
  brand: { name: string; storeUrl?: string; products?: string[] };
  category: string;
  competitors: Array<{ name: string }>;
  prompts: Array<{ intent?: string; text: string }>;
  engines: string[];
  repetitions?: number;
  productGids?: string[];
  locale?: string;
  language?: string;
  geo?: string;
  priceConstraint?: string;
}

export async function createBenchmark(shop: string | null, name: string, tier: string, config: BenchmarkConfig, schedule?: string): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    "insert into benchmarks (shop_domain, name, tier, config, schedule) values ($1,$2,$3,$4::jsonb,$5) returning id",
    [shop, name, tier, JSON.stringify(config), schedule ?? null],
  );
  return Number(rows[0]!.id);
}

export async function getBenchmark(id: number): Promise<{ id: number; shop_domain: string | null; name: string; tier: string; config: BenchmarkConfig } | null> {
  const { rows } = await pgQuery<{ id: string; shop_domain: string | null; name: string; tier: string; config: BenchmarkConfig }>(
    "select id, shop_domain, name, tier, config from benchmarks where id = $1",
    [id],
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

export async function listBenchmarks(shop: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery("select id, name, tier, version, schedule, created_at from benchmarks where shop_domain=$1 order by created_at desc", [shop]);
  return rows;
}

export interface RunRow {
  id: number;
  benchmark_id: number | null;
  shop_domain: string | null;
  tier: string;
  status: string;
  observation_count: number;
}

/** A single run's metadata — used to verify shop ownership before diagnosing it. */
export async function getRun(runId: number): Promise<RunRow | null> {
  const { rows } = await pgQuery<{ id: string; benchmark_id: string | null; shop_domain: string | null; tier: string; status: string; observation_count: number }>(
    "select id, benchmark_id, shop_domain, tier, status, observation_count from benchmark_runs where id=$1",
    [runId],
  );
  const r = rows[0];
  return r ? { id: Number(r.id), benchmark_id: r.benchmark_id != null ? Number(r.benchmark_id) : null, shop_domain: r.shop_domain, tier: r.tier, status: r.status, observation_count: r.observation_count } : null;
}

/** Recent benchmark runs for a shop (for the in-app Measure/runs view). */
export async function listRunsForShop(shop: string, limit = 20): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery(
    `select id, benchmark_id, tier, status, observation_count, cost_usd, prompt_count, started_at, finished_at
       from benchmark_runs where shop_domain=$1 order by started_at desc limit $2`,
    [shop, Math.min(100, Math.max(1, limit))],
  );
  return rows;
}

export async function createRun(benchmarkId: number, shop: string | null, tier: string, engines: string[], promptCount: number, repetitions: number): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    "insert into benchmark_runs (benchmark_id, shop_domain, tier, status, engines, prompt_count, repetitions) values ($1,$2,$3,'running',$4,$5,$6) returning id",
    [benchmarkId, shop, tier, engines, promptCount, repetitions],
  );
  return Number(rows[0]!.id);
}

export interface ObservationInsert {
  runId: number;
  benchmarkId: number;
  shopDomain: string | null;
  responseId: string;
  promptText: string;
  intent?: string;
  engine: string;
  model?: string;
  groundingMode?: string;
  targetBrand: string;
  productGid?: string | null;
  recommendationStatus: string;
  rank?: number | null;
  sentiment?: string | null;
  citations?: unknown[];
  evidenceSnippet?: string | null;
  latencyMs?: number | null;
  costUsd?: number;
  classificationMethod?: string;
}

export async function insertObservation(o: ObservationInsert): Promise<void> {
  await pgQuery(
    `insert into observations (run_id, benchmark_id, shop_domain, response_id, prompt_text, intent, engine, model,
       grounding_mode, target_brand, product_gid, recommendation_status, rank, sentiment, citations, evidence_snippet,
       latency_ms, cost_usd, classification_method)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19)`,
    [o.runId, o.benchmarkId, o.shopDomain, o.responseId, o.promptText, o.intent ?? null, o.engine, o.model ?? null,
     o.groundingMode ?? null, o.targetBrand, o.productGid ?? null, o.recommendationStatus, o.rank ?? null,
     o.sentiment ?? null, JSON.stringify(o.citations ?? []), o.evidenceSnippet ?? null, o.latencyMs ?? null,
     o.costUsd ?? 0, o.classificationMethod ?? "deterministic"],
  );
}

export async function finishRun(runId: number, fields: { status: "completed" | "failed"; observationCount?: number; costUsd?: number; modelVersions?: Record<string, string>; groundingModes?: Record<string, string>; error?: string }): Promise<void> {
  await pgQuery(
    `update benchmark_runs set status=$2, observation_count=coalesce($3, observation_count), cost_usd=coalesce($4, cost_usd),
       model_versions=coalesce($5::jsonb, model_versions), grounding_modes=coalesce($6::jsonb, grounding_modes),
       error=$7, finished_at=now() where id=$1`,
    [runId, fields.status, fields.observationCount ?? null, fields.costUsd ?? null,
     fields.modelVersions ? JSON.stringify(fields.modelVersions) : null,
     fields.groundingModes ? JSON.stringify(fields.groundingModes) : null, fields.error ?? null],
  );
}

export async function getObservations(runId: number): Promise<ObservationLike[]> {
  const { rows } = await pgQuery<{ response_id: string | null; engine: string; target_brand: string; recommendation_status: string; rank: number | null; prompt_text: string; citations: unknown[] }>(
    "select response_id, engine, target_brand, recommendation_status, rank, prompt_text, citations from observations where run_id=$1",
    [runId],
  );
  return rows.map((r) => ({
    responseId: r.response_id, engine: r.engine, targetBrand: r.target_brand,
    recommendationStatus: r.recommendation_status, rank: r.rank, promptText: r.prompt_text,
    citations: Array.isArray(r.citations) ? r.citations : [],
  }));
}

export async function aggregateRun(runId: number, merchantBrand: string): Promise<{ observationCount: number; metrics: BenchmarkMetrics }> {
  const obs = await getObservations(runId);
  return { observationCount: obs.length, metrics: aggregate(obs, merchantBrand) };
}
