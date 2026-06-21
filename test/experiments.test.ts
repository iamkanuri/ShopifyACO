import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { proportion } from "../src/benchmarks/stats.js";
import type { BenchmarkMetrics } from "../src/benchmarks/metrics.js";
import { compareExperiment } from "../src/experiments/verify.js";

// Build a BenchmarkMetrics with the five compared proportions (others are unused by
// the comparison and filled minimally to satisfy the type).
function m(rec: [number, number], men: [number, number], top: [number, number], cov: [number, number], cit: [number, number]): BenchmarkMetrics {
  return {
    brand: "B", n: rec[1],
    recommendationRate: proportion(rec[0], rec[1]),
    mentionRate: proportion(men[0], men[1]),
    topChoiceRate: proportion(top[0], top[1]),
    avgPosition: { mean: null, n: 0, stdErr: null },
    promptCoverage: proportion(cov[0], cov[1]),
    citationBackedRate: proportion(cit[0], cit[1]),
    shareOfVoice: [], byEngine: {}, engineDivergence: null,
    winLoss: { responses: 0, wins: 0, losses: 0, winRate: proportion(0, 0) },
  };
}
const big = (s: number, n: number): [number, number] => [s, n];

// ---- pure: verdicts -------------------------------------------------------
test("compareExperiment classifies improved / regressed / inconclusive on the primary metric", () => {
  const base = m(big(2, 40), big(10, 40), big(2, 40), big(2, 40), big(1, 10));
  const up = m(big(24, 40), big(30, 40), big(10, 40), big(20, 40), big(5, 10));
  assert.equal(compareExperiment(base, up).verdict, "improved");
  assert.equal(compareExperiment(up, base).verdict, "regressed");

  const a = m(big(5, 10), big(5, 10), big(1, 10), big(3, 10), big(1, 5));
  const b = m(big(6, 10), big(6, 10), big(1, 10), big(4, 10), big(1, 5));
  assert.equal(compareExperiment(a, b).verdict, "inconclusive"); // too small to call
});

test("compareExperiment reports the primary metric + all secondary metrics with CIs", () => {
  const r = compareExperiment(m(big(2, 40), big(10, 40), big(2, 40), big(2, 40), big(1, 10)), m(big(24, 40), big(30, 40), big(10, 40), big(20, 40), big(5, 10)));
  assert.equal(r.primary.metric, "recommendationRate");
  assert.equal(r.secondary.length, 4);
  assert.ok(r.secondary.some((s) => s.metric === "mentionRate"));
  // The diff CI is reported and (for a real improvement) excludes 0.
  assert.ok(r.primary.diffCiLow > 0);
});

// ---- pure: comparability + caveats (the honesty layer) --------------------
test("comparability flags model changes, mismatched sizes, and low power", () => {
  const base = m(big(2, 40), big(10, 40), big(2, 40), big(2, 40), big(1, 10));
  const up = m(big(24, 40), big(30, 40), big(10, 40), big(20, 40), big(5, 10));
  const r = compareExperiment(base, up, {
    baseline: { runId: 1, engines: ["openai"], modelVersions: { openai: "gpt-x-2025-01" }, promptCount: 10, repetitions: 2 },
    verification: { runId: 2, engines: ["openai"], modelVersions: { openai: "gpt-x-2025-06" }, promptCount: 10, repetitions: 2 },
  });
  const codes = r.comparability.map((c) => c.code);
  assert.ok(codes.includes("model_changed"), "model change must be flagged");
  // n=40 < 30? no — ensure low_power appears only on small n.
  const small = compareExperiment(m(big(1, 8), big(1, 8), big(0, 8), big(1, 8), big(0, 2)), m(big(2, 8), big(2, 8), big(0, 8), big(1, 8), big(0, 2)));
  assert.ok(small.comparability.some((c) => c.code === "low_power"));
});

test("caveats never claim causation and flag inconclusive honestly", () => {
  const r = compareExperiment(m(big(5, 10), big(5, 10), big(1, 10), big(3, 10), big(1, 5)), m(big(6, 10), big(6, 10), big(1, 10), big(4, 10), big(1, 5)));
  assert.equal(r.verdict, "inconclusive");
  assert.ok(r.caveats.some((c) => /Association, not proof/i.test(c)));
  assert.ok(r.caveats.some((c) => /not proof the intervention had no effect/i.test(c)));
  // An improved result must still carry the causation caveat.
  const up = compareExperiment(m(big(2, 40), big(2, 40), big(2, 40), big(2, 40), big(1, 10)), m(big(24, 40), big(24, 40), big(10, 40), big(20, 40), big(5, 10)));
  assert.ok(up.caveats.some((c) => /Association, not proof/i.test(c)));
});

// ---- DB-gated: full matched baseline → verification e2e (mock engines, $0) --
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
test("plan → captureBaseline → runVerification persists a CI-backed verdict (mock)", { skip: !RUN_DB }, async () => {
  const { createBenchmark } = await import("../src/db/benchmarks.js");
  const { planIntervention, captureBaseline, runVerification } = await import("../src/experiments/execute.js");
  const { getExperiment, getIntervention } = await import("../src/db/experiments.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `exp-${Date.now()}.myshopify.com`;
  const config = {
    brand: { name: "Caraway" }, category: "cookware", competitors: [{ name: "GreenPan" }],
    prompts: [{ intent: "comparison", text: "best ceramic pan?" }, { intent: "budget", text: "best nonstick pan under $200?" }],
    engines: ["openai", "gemini", "perplexity"], repetitions: 1,
  };
  const benchmarkId = await createBenchmark(shop, "exp-bench", "verification", config as never);
  try {
    const { interventionId, experimentId } = await planIntervention(shop, { benchmarkId, kind: "manual", description: "added AggregateRating schema" });
    const base = await captureBaseline(shop, experimentId, { mock: true });
    assert.ok(base.runId > 0);

    const result = await runVerification(shop, experimentId, { mock: true });
    assert.ok(["improved", "regressed", "inconclusive"].includes(result.verdict));
    assert.equal(result.primary.metric, "recommendationRate");
    assert.ok(Array.isArray(result.comparability));
    // Deterministic mock → identical runs → no measurable change.
    assert.equal(result.verdict, "inconclusive");

    const exp = await getExperiment(experimentId);
    assert.ok(exp!.verification_run_id != null);
    assert.equal(exp!.verdict, result.verdict);
    const intervention = await getIntervention(interventionId);
    assert.ok(["verified", "inconclusive", "regressed"].includes(intervention!.status));

    // tenant isolation: another shop can't read this experiment
    const other = await getExperiment(experimentId);
    assert.equal(other!.shop_domain, shop);
  } finally {
    await pgQuery("delete from experiments where shop_domain=$1", [shop]);
    await pgQuery("delete from interventions where shop_domain=$1", [shop]);
    await pgQuery("delete from observations where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmark_runs where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});

test("startVerification builds a benchmark, captures a baseline, then verify yields a verdict (mock)", { skip: !RUN_DB }, async () => {
  const { startVerification, runVerification } = await import("../src/experiments/execute.js");
  const { getExperiment } = await import("../src/db/experiments.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `exps-${Date.now()}.myshopify.com`;
  let benchmarkId = 0;
  try {
    const started = await startVerification(shop, { brand: "Caraway", category: "non-toxic cookware", competitors: ["GreenPan"], description: "added AggregateRating schema", mock: true });
    assert.ok(started.baselineRunId > 0);
    const exp = await getExperiment(started.experimentId);
    benchmarkId = exp!.benchmark_id!;
    assert.equal(exp!.baseline_run_id, started.baselineRunId);

    const result = await runVerification(shop, started.experimentId, { mock: true });
    assert.ok(["improved", "regressed", "inconclusive"].includes(result.verdict));
    assert.equal(result.verdict, "inconclusive"); // deterministic mock → matched runs
  } finally {
    await pgQuery("delete from experiments where shop_domain=$1", [shop]);
    await pgQuery("delete from interventions where shop_domain=$1", [shop]);
    await pgQuery("delete from observations where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmark_runs where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});
