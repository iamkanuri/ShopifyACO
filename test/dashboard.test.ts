import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { proportion } from "../src/benchmarks/stats.js";
import type { BenchmarkMetrics } from "../src/benchmarks/metrics.js";
import { scoreFromMetrics } from "../src/benchmarks/metrics.js";
import { buildDashboardData, type DashboardEnvelope } from "../src/server/dashboard.js";

// Build a BenchmarkMetrics with just the fields the dashboard reads.
function M(opts: {
  brand?: string;
  rec?: [number, number];
  men?: [number, number];
  avgPos?: number | null;
  win?: { responses: number; wins: number; losses: number };
  byEngine?: Record<string, [number, number]>; // engine -> [recommended, n]
  sov?: Array<{ key: string; share: number }>;
} = {}): BenchmarkMetrics {
  const rec = opts.rec ?? [0, 0];
  const men = opts.men ?? rec;
  const win = opts.win ?? { responses: 0, wins: 0, losses: 0 };
  const byEngine: BenchmarkMetrics["byEngine"] = {};
  for (const [e, [r, n]] of Object.entries(opts.byEngine ?? {})) byEngine[e] = { n, recommendationRate: proportion(r, n) };
  return {
    brand: opts.brand ?? "MyBrand", n: rec[1],
    recommendationRate: proportion(rec[0], rec[1]),
    mentionRate: proportion(men[0], men[1]),
    topChoiceRate: proportion(0, rec[1]),
    avgPosition: { mean: opts.avgPos ?? null, n: opts.avgPos == null ? 0 : 1, stdErr: null },
    promptCoverage: proportion(0, rec[1]),
    citationBackedRate: proportion(0, 1),
    shareOfVoice: (opts.sov ?? []).map((s) => ({ key: s.key, count: 0, share: s.share })),
    byEngine, engineDivergence: null,
    winLoss: { ...win, winRate: proportion(win.wins, win.responses) },
  };
}

// ---- scoreFromMetrics: the documented, deterministic formula -----------------
test("scoreFromMetrics: a perfect brand scores 100", () => {
  const { score } = scoreFromMetrics(M({ rec: [10, 10], men: [10, 10], avgPos: 1, win: { responses: 10, wins: 10, losses: 0 } }));
  assert.equal(score, 100);
});

test("scoreFromMetrics: an absent brand floors at the neutral rank 0.5 only (=8)", () => {
  // rec 0, mention 0, no rank data (neutral 0.5 → 7.5), no competitive data (0 — no
  // evidence earns no points, matching the CLI path; Codex A4 — was 0.5/15).
  const { score } = scoreFromMetrics(M({ rec: [0, 10] }));
  assert.equal(score, 8);
});

test("scoreFromMetrics: a partial brand matches the weighted formula", () => {
  // 0.50·0.5 + 0.20·0.8 + 0.15·rankQuality(avgPos 2 → 0.8) + 0.15·comp(1−4/10=0.6)
  const { score, components } = scoreFromMetrics(M({ rec: [5, 10], men: [8, 10], avgPos: 2, win: { responses: 10, wins: 6, losses: 4 } }));
  assert.equal(score, 62);
  assert.equal(components.length, 4);
  assert.ok(Math.abs(components.reduce((s, c) => s + c.contribution, 0) - 62) < 0.5);
});

// ---- buildDashboardData: weakest engine + top threat selection --------------
test("buildDashboardData: weakest engine skips engines with no data; top threat excludes self", () => {
  const data = buildDashboardData({
    brand: "Olipop",
    metrics: M({
      brand: "Olipop", rec: [2, 20],
      byEngine: { openai: [2, 10], gemini: [5, 10], perplexity: [0, 0] }, // perplexity has no data
      sov: [{ key: "Poppi", share: 0.6 }, { key: "Olipop", share: 0.4 }],
    }),
    lastRunAt: "2026-06-22T00:00:00Z", openFindings: 3, pendingFixes: 1, openAlerts: 2,
  });
  assert.equal(data.weakestEngine, "ChatGPT"); // openai 0.2 < gemini 0.5; perplexity (n=0) skipped
  assert.equal(data.topThreat, "Poppi");        // highest SoV that isn't the merchant
  assert.equal(data.openFindings, 3);
  assert.equal(data.pendingFixes, 1);
  assert.equal(data.openAlerts, 2);
  assert.equal(data.lastRunAt, "2026-06-22T00:00:00Z");
});

test("buildDashboardData: no engine/competitor data → null weakest engine + threat", () => {
  const data = buildDashboardData({
    brand: "X", metrics: M({ brand: "X", rec: [0, 0] }),
    lastRunAt: null, openFindings: 0, pendingFixes: 0, openAlerts: 0,
  });
  assert.equal(data.weakestEngine, null);
  assert.equal(data.topThreat, null);
  assert.equal(data.shareOfVoice.length, 0);
});

// ---- DB-gated: end-to-end over a real (mock $0) benchmark run ----------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
test("dashboardHandler: no run → hasData false; after a mock run → the merchant's real metrics", { skip: !RUN_DB }, async () => {
  const { createBenchmark } = await import("../src/db/benchmarks.js");
  const { executeBenchmark } = await import("../src/benchmarks/execute.js");
  const { dashboardHandler } = await import("../src/server/dashboard.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `dash-${Date.now()}.myshopify.com`;
  const make = () => {
    const res = { code: 0, payload: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.payload = b; return this; } };
    return { req: { shopDomain: shop, body: {}, params: {}, query: {} } as never, res };
  };

  // 1) Connected shop with no completed run → hasData:false, no demo numbers.
  const empty = make();
  await dashboardHandler(empty.req, empty.res as never);
  const e0 = empty.res.payload as DashboardEnvelope;
  assert.equal(e0.connected, true);
  assert.equal(e0.hasData, false);
  assert.equal(e0.data, null);

  const config = { brand: { name: "Caraway" }, category: "cookware", competitors: [{ name: "GreenPan" }], prompts: [{ text: "best ceramic pan?" }, { text: "non-toxic cookware?" }], engines: ["openai", "gemini", "perplexity"], repetitions: 1 };
  const benchmarkId = await createBenchmark(shop, "dash-bench", "monitoring", config as never);
  try {
    const run = await executeBenchmark(benchmarkId, { mock: true });
    assert.ok(run.runId > 0);

    // 2) After a completed run → the merchant's own metrics.
    const live = make();
    await dashboardHandler(live.req, live.res as never);
    const env = live.res.payload as DashboardEnvelope;
    assert.equal(env.connected, true);
    assert.equal(env.hasData, true);
    assert.equal(env.brand, "Caraway");
    assert.equal(env.category, "cookware");
    assert.equal(env.runId, run.runId);
    assert.ok(env.data);
    assert.ok(env.data!.score >= 0 && env.data!.score <= 100);
    assert.ok(env.data!.recommendationRate.n > 0, "own-brand observations should exist");
    assert.ok(Array.isArray(env.data!.shareOfVoice));
  } finally {
    await pgQuery("delete from observations where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmark_runs where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});
