import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { proportion } from "../src/benchmarks/stats.js";
import type { BenchmarkMetrics } from "../src/benchmarks/metrics.js";
import { evaluateAlerts, nextRunAt } from "../src/monitoring/alerts.js";
import { EmailProvider, LoggerProvider, emailConfigured, getProvider } from "../src/notify/provider.js";

function M(rec: [number, number], extra: { men?: [number, number]; sov?: Array<{ key: string; share: number }>; brand?: string } = {}): BenchmarkMetrics {
  const men = extra.men ?? rec;
  return {
    brand: extra.brand ?? "MyBrand", n: rec[1],
    recommendationRate: proportion(rec[0], rec[1]),
    mentionRate: proportion(men[0], men[1]),
    topChoiceRate: proportion(0, rec[1]),
    avgPosition: { mean: null, n: 0, stdErr: null },
    promptCoverage: proportion(0, rec[1]),
    citationBackedRate: proportion(0, 1),
    shareOfVoice: (extra.sov ?? []).map((s) => ({ key: s.key, count: 0, share: s.share })),
    byEngine: {}, engineDivergence: null,
    winLoss: { responses: 0, wins: 0, losses: 0, winRate: proportion(0, 0) },
  };
}

// ---- cadence ---------------------------------------------------------------
test("nextRunAt advances by cadence (UTC)", () => {
  const from = new Date("2026-06-21T00:00:00Z");
  assert.equal(nextRunAt("daily", from).toISOString(), "2026-06-22T00:00:00.000Z");
  assert.equal(nextRunAt("weekly", from).toISOString(), "2026-06-28T00:00:00.000Z");
  assert.equal(nextRunAt("biweekly", from).toISOString(), "2026-07-05T00:00:00.000Z");
  assert.equal(nextRunAt("monthly", from).toISOString(), "2026-07-21T00:00:00.000Z");
});

// ---- alert evaluation (the honesty layer) ----------------------------------
test("evaluateAlerts fires a regression only when the CI excludes 0", () => {
  const drop = evaluateAlerts(M([2, 40]), M([24, 40]));
  assert.ok(drop.some((a) => a.type === "regression" && a.severity === "critical"));

  const rise = evaluateAlerts(M([24, 40]), M([2, 40]));
  assert.ok(rise.some((a) => a.type === "improvement"));

  // Small, noisy change → no regression/improvement alert (no cry-wolf).
  const noise = evaluateAlerts(M([6, 10]), M([5, 10]));
  assert.equal(noise.some((a) => a.type === "regression" || a.type === "improvement"), false);
});

test("evaluateAlerts raises threshold + competitor-overtake alerts", () => {
  const floor = evaluateAlerts(M([3, 40]), null, { floorRate: 0.5 });
  assert.ok(floor.some((a) => a.type === "threshold" && a.severity === "warning"));
  // First run (no previous) → no comparison alert.
  assert.equal(floor.some((a) => a.type === "regression" || a.type === "improvement"), false);

  const cur = M([10, 40], { sov: [{ key: "GreenPan", share: 0.6 }, { key: "MyBrand", share: 0.4 }] });
  const prev = M([10, 40], { sov: [{ key: "MyBrand", share: 0.6 }, { key: "GreenPan", share: 0.4 }] });
  assert.ok(evaluateAlerts(cur, prev).some((a) => a.type === "competitor_overtake"));
});

// ---- notification provider -------------------------------------------------
test("LoggerProvider sends; EmailProvider skips until configured; getProvider defaults to logger", async () => {
  assert.equal((await new LoggerProvider().send({ shop: "s", subject: "x", body: "y" })).status, "sent");
  const email = await new EmailProvider().send({ shop: "s", recipient: "a@b.com", subject: "x", body: "y" });
  assert.equal(email.status, "skipped"); // no EMAIL_* set
  assert.equal(emailConfigured(), false);
  assert.equal(getProvider().channel, "log");
});

// ---- DB-gated: schedule run + no-false-alert + alert lifecycle --------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
test("monitorRun runs a benchmark, advances cadence, and does NOT alert on identical mock runs", { skip: !RUN_DB }, async () => {
  const { createBenchmark } = await import("../src/db/benchmarks.js");
  const { createSchedule, getSchedule, listAlerts } = await import("../src/db/monitoring.js");
  const { monitorRun, runDueSchedules } = await import("../src/monitoring/execute.js");
  const { pgQuery } = await import("../src/db/pg.js");

  const shop = `mon-${Date.now()}.myshopify.com`;
  const config = { brand: { name: "Caraway" }, category: "cookware", competitors: [{ name: "GreenPan" }], prompts: [{ text: "best ceramic pan?" }], engines: ["openai", "gemini", "perplexity"], repetitions: 1 };
  const benchmarkId = await createBenchmark(shop, "mon-bench", "monitoring", config as never);
  try {
    const scheduleId = await createSchedule(shop, { kind: "benchmark", benchmarkId, cadence: "weekly" });

    // First run: no previous → no comparison alert; schedule advances.
    const r1 = await monitorRun(scheduleId, { mock: true });
    assert.ok(r1.runId! > 0);
    assert.equal(r1.alerts, 0);
    const s1 = await getSchedule(scheduleId);
    assert.equal(s1!.last_run_id, r1.runId);
    assert.ok(new Date(s1!.next_run_at).getTime() > Date.now());

    // Second run: deterministic mock → identical metrics → inconclusive → NO alert.
    const r2 = await monitorRun(scheduleId, { mock: true });
    assert.equal(r2.alerts, 0, "identical runs must not raise a false alert");

    assert.equal((await listAlerts(shop)).length, 0);

    // runDueSchedules inline path also processes (schedule already advanced future,
    // so force it due first).
    await pgQuery("update schedules set next_run_at = now() - interval '1 minute' where id=$1", [scheduleId]);
    const due = await runDueSchedules({ inline: true, mock: true });
    assert.ok(due.processed >= 1);
  } finally {
    await pgQuery("delete from notifications where shop_domain=$1", [shop]);
    await pgQuery("delete from alerts where shop_domain=$1", [shop]);
    await pgQuery("delete from schedules where shop_domain=$1", [shop]);
    await pgQuery("delete from observations where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmark_runs where benchmark_id=$1", [benchmarkId]);
    await pgQuery("delete from benchmarks where id=$1", [benchmarkId]);
  }
});

test("alert create → list → acknowledge (DB)", { skip: !RUN_DB }, async () => {
  const { createAlert, listAlerts, acknowledgeAlert } = await import("../src/db/monitoring.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `mona-${Date.now()}.myshopify.com`;
  try {
    const id = await createAlert(shop, { type: "regression", severity: "critical", metric: "recommendationRate", title: "drop", detail: "d", comparison: {} });
    const open = await listAlerts(shop, { status: "open" });
    assert.equal(open.length, 1);
    assert.equal(await acknowledgeAlert(shop, id), 1);
    assert.equal((await listAlerts(shop, { status: "open" })).length, 0);
    assert.equal((await listAlerts(shop, { status: "acknowledged" })).length, 1);
    // acknowledging again is a no-op
    assert.equal(await acknowledgeAlert(shop, id), 0);
  } finally {
    await pgQuery("delete from alerts where shop_domain=$1", [shop]);
  }
});
