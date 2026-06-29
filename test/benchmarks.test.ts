import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareProportions, engineDivergence, mean, proportion, shareOfVoice, volatility } from "../src/benchmarks/stats.js";
import { ALL_INTENT_TYPES, generateIntentCohort } from "../src/benchmarks/intents.js";
import { aggregate, scoreFromMetrics, type ObservationLike } from "../src/benchmarks/metrics.js";
import { computeVisibilityScore } from "../src/analysis/score.js";
import { estimateMaxCost } from "../src/cli.js";
import { fixedCostPerCall } from "../src/engines/models.js";

// ---- A4: no-data score must agree across the benchmark + CLI paths ---------
test("no-data score is unified across benchmark + CLI paths (no neutral points for no evidence)", () => {
  const benchScore = scoreFromMetrics(aggregate([], "Olipop")).score;
  const cliScore = computeVisibilityScore([], { brand: { name: "Olipop" }, category: "x", competitors: [], promptTemplates: ["x"] }).score;
  assert.equal(benchScore, cliScore, "benchmark and CLI no-data scores must agree (was 15 vs 8)");
});

// ---- stats: Wilson CIs + comparisons --------------------------------------
test("proportion gives a point rate inside a Wilson CI", () => {
  const p = proportion(5, 10);
  assert.equal(p.rate, 0.5);
  assert.ok(p.ciLow > 0.2 && p.ciLow < 0.5);
  assert.ok(p.ciHigh > 0.5 && p.ciHigh < 0.8);
});

test("proportion with n=0 is 'no evidence', not zero", () => {
  const p = proportion(0, 0);
  assert.equal(p.rate, null);
  assert.equal(p.ciLow, 0);
  assert.equal(p.ciHigh, 1);
});

test("compareProportions classifies improved / regressed / inconclusive", () => {
  assert.equal(compareProportions(2, 20, 12, 20).verdict, "improved");
  assert.equal(compareProportions(12, 20, 2, 20).verdict, "regressed");
  assert.equal(compareProportions(5, 10, 6, 10).verdict, "inconclusive"); // small sample → no evidence
  assert.equal(compareProportions(0, 0, 5, 10).verdict, "inconclusive"); // missing baseline
});

test("mean, volatility, shareOfVoice, engineDivergence", () => {
  assert.equal(mean([2, 4]).mean, 3);
  assert.equal(mean([]).mean, null);
  assert.equal(volatility([1, 1, 1]), 0);
  assert.equal(volatility([5]), null);
  const sov = shareOfVoice({ A: 3, B: 1 });
  assert.equal(sov[0].key, "A");
  assert.equal(sov[0].share, 0.75);
  assert.equal(engineDivergence({ a: 0.1, b: 0.5 }), 0.4);
  assert.equal(engineDivergence({ a: 0.1 }), null);
});

// ---- intent cohort ---------------------------------------------------------
test("generateIntentCohort covers the taxonomy and fills templates", () => {
  const cohort = generateIntentCohort({ category: "cookware", competitors: ["GreenPan"], persona: "a home cook", priceRange: "under $300" });
  const types = new Set(cohort.map((p) => p.intent));
  for (const t of ALL_INTENT_TYPES) assert.ok(types.has(t), `missing intent ${t}`);
  assert.ok(cohort.some((p) => /GreenPan/.test(p.text)), "comparison/alternatives mention competitor");
  assert.ok(cohort.some((p) => /under \$300/.test(p.text)), "price intent uses price range");
  // deduped
  assert.equal(cohort.length, new Set(cohort.map((p) => p.text.toLowerCase())).size);
});

// ---- metrics aggregation ---------------------------------------------------
test("aggregate computes rates, SoV, and per-answer win/loss with CIs", () => {
  const obs: ObservationLike[] = [
    { responseId: "r1", engine: "openai", targetBrand: "Caraway", recommendationStatus: "recommended", rank: 1, promptText: "best cookware?", citations: ["x"] },
    { responseId: "r1", engine: "openai", targetBrand: "GreenPan", recommendationStatus: "mentioned_neutral", rank: 2, promptText: "best cookware?" },
    { responseId: "r2", engine: "openai", targetBrand: "Caraway", recommendationStatus: "not_mentioned", rank: null, promptText: "induction cookware?" },
    { responseId: "r2", engine: "openai", targetBrand: "GreenPan", recommendationStatus: "recommended", rank: 1, promptText: "induction cookware?" },
  ];
  const m = aggregate(obs, "Caraway");
  assert.equal(m.n, 2);
  assert.equal(m.recommendationRate.rate, 0.5);
  assert.equal(m.mentionRate.rate, 0.5);
  assert.equal(m.topChoiceRate.rate, 0.5);
  assert.equal(m.shareOfVoice.length, 2);
  assert.equal(m.winLoss.wins, 1);
  assert.equal(m.winLoss.losses, 1);
  assert.equal(m.winLoss.responses, 2);
});

test("estimateMaxCost includes each engine's fixed per-call search fee", () => {
  assert.equal(fixedCostPerCall("sonar"), 0.005);
  assert.equal(fixedCostPerCall("mock"), 0);          // mock never costs
  assert.equal(fixedCostPerCall("unknown-model"), 0); // unknown → no fee
  // 2 prompts × (sonar 0.005 + gpt-5.4-mini 0.016) fixed fees alone = 0.042, plus token cost.
  const adapters = [{ model: "sonar" }, { model: "gpt-5.4-mini" }] as never;
  assert.ok(estimateMaxCost(2, adapters) >= 2 * (0.005 + 0.016));
});

test("aggregate: citation-backed rate is n=0 (not a fabricated 0/1) when never mentioned", () => {
  const obs: ObservationLike[] = [
    { responseId: "r1", engine: "openai", targetBrand: "Rival", recommendationStatus: "recommended", rank: 1, promptText: "best pan?", citations: ["x"] },
  ];
  const m = aggregate(obs, "Caraway"); // Caraway never appears
  assert.equal(m.mentionRate.n, 0);
  assert.equal(m.citationBackedRate.n, 0);
  assert.equal(m.citationBackedRate.rate, null);
});

// ---- DB-gated: self-serve shop benchmark (mock engines, $0) -----------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
test("runShopBenchmark builds a cohort, runs it (mock), and lists the run for the shop", { skip: !RUN_DB }, async () => {
  const { runShopBenchmark } = await import("../src/benchmarks/shopRun.js");
  const { listRunsForShop } = await import("../src/db/benchmarks.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `bench-${Date.now()}.myshopify.com`;
  let benchmarkId = 0;
  try {
    const r = await runShopBenchmark(shop, { brand: "Caraway", category: "non-toxic cookware", competitors: ["GreenPan", "Our Place"], maxPrompts: 5, mock: true });
    benchmarkId = r.benchmarkId;
    assert.ok(r.runId > 0);
    assert.equal(r.promptCount, 5);
    assert.ok(r.observationCount > 0);
    assert.equal(r.costUsd, 0); // mock is free
    assert.ok(r.metrics.recommendationRate.n > 0); // honest denominator

    const runs = await listRunsForShop(shop);
    assert.ok(runs.some((row) => Number(row.id) === r.runId));
  } finally {
    await pgQuery("delete from observations where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmark_runs where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});

test("getLatestCompletedRun ignores mock runs — the dashboard shows only live (S7)", { skip: !RUN_DB }, async () => {
  const { createBenchmark, createRun, finishRun, getLatestCompletedRun } = await import("../src/db/benchmarks.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `s7-${Date.now()}.myshopify.com`;
  let benchmarkId = 0;
  try {
    benchmarkId = await createBenchmark(shop, "s7", "mini", { brand: { name: "X" }, category: "c", competitors: [], prompts: [{ text: "p" }], engines: ["mock"] });
    const liveRun = await createRun(benchmarkId, shop, "mini", ["mock"], 1, 1, "live");
    await finishRun(liveRun, { status: "completed", observationCount: 1 });
    // A MORE RECENT mock run (e.g. from a mock experiment / monitoring run) must NOT win.
    const mockRun = await createRun(benchmarkId, shop, "mini", ["mock"], 1, 1, "mock");
    await finishRun(mockRun, { status: "completed", observationCount: 1 });

    const latest = await getLatestCompletedRun(shop);
    assert.equal(latest?.id, liveRun, "dashboard latest must be the LIVE run, not the newer mock run");
  } finally {
    await pgQuery("delete from benchmark_runs where shop_domain=$1", [shop]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});
