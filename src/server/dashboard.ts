import type { Request, Response } from "express";
import { shopOf } from "./shopify.js";
import { aggregateRun, getBenchmark, getLatestCompletedRun } from "../db/benchmarks.js";
import { scoreFromMetrics, type BenchmarkMetrics } from "../benchmarks/metrics.js";
import type { Proportion } from "../benchmarks/stats.js";
import { countFindings } from "../db/crawler.js";
import { countProposals } from "../db/fixes.js";
import { countAlerts } from "../db/monitoring.js";
import { engineLabel } from "../engines/labels.js";

// Shop-scoped Dashboard API (Phase 12 holdout). Computes the connected merchant's OWN
// home screen — score, recommendation/mention rates with CIs, share of voice, weakest
// engine, top in-niche threat, the 5-step loop counts, and open alerts — from THEIR
// benchmark runs/findings/proposals/alerts. Until a merchant has a completed run the
// envelope reports hasData=false (the UI shows "run your first benchmark", never demo
// numbers). When there's no shop session at all, requireShop returns 401 and the client
// falls back to the labeled Olipop sample — we never imply the sample is the merchant's.


export interface DashboardData {
  score: number | null; // null when the latest run has zero observations (no score) — see scoreCore
  scoreComponents: Array<{ key: string; label: string; weight: number; value: number; contribution: number }>;
  recommendationRate: Proportion;
  mentionRate: Proportion;
  shareOfVoice: Array<{ key: string; share: number }>;
  weakestEngine: string | null;
  topThreat: string | null;
  lastRunAt: string | null;
  openFindings: number;
  pendingFixes: number;
  openAlerts: number;
}

export interface DashboardEnvelope {
  connected: boolean;
  hasData: boolean;
  brand: string;
  category: string;
  runId: number | null;
  data: DashboardData | null;
}

/** Pure assembly of the dashboard from a run's metrics + counts (no I/O → unit-testable). */
export function buildDashboardData(args: {
  brand: string;
  metrics: BenchmarkMetrics;
  lastRunAt: string | null;
  openFindings: number;
  pendingFixes: number;
  openAlerts: number;
}): DashboardData {
  const m = args.metrics;
  const brandNorm = args.brand.trim().toLowerCase();

  // Weakest engine = lowest recommendation rate among engines that actually answered
  // (n>0). Skip engines with no data so a dropped/unconfigured engine isn't "weakest".
  let weakest: string | null = null;
  let weakestRate = Infinity;
  for (const [eng, e] of Object.entries(m.byEngine)) {
    if (e.n <= 0 || e.recommendationRate.rate == null) continue;
    if (e.recommendationRate.rate < weakestRate) { weakestRate = e.recommendationRate.rate; weakest = eng; }
  }

  // Top threat = the highest share-of-voice brand that isn't the merchant. shareOfVoice
  // is already sorted desc, so the first non-self entry is the leading rival.
  const topThreat = m.shareOfVoice.find((s) => s.key.trim().toLowerCase() !== brandNorm)?.key ?? null;

  const { score, components } = scoreFromMetrics(m);
  return {
    score,
    scoreComponents: components,
    recommendationRate: m.recommendationRate,
    mentionRate: m.mentionRate,
    shareOfVoice: m.shareOfVoice.map((s) => ({ key: s.key, share: s.share })),
    weakestEngine: weakest ? engineLabel(weakest) : null,
    topThreat,
    lastRunAt: args.lastRunAt,
    openFindings: args.openFindings,
    pendingFixes: args.pendingFixes,
    openAlerts: args.openAlerts,
  };
}

/** GET /app/api/dashboard — the connected merchant's own dashboard. */
export async function dashboardHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const run = await getLatestCompletedRun(shop);
  if (!run) {
    // Connected, but no completed benchmark yet → the UI prompts to run the first one.
    res.json({ connected: true, hasData: false, brand: "", category: "", runId: null, data: null } satisfies DashboardEnvelope);
    return;
  }

  const bench = run.benchmark_id != null ? await getBenchmark(run.benchmark_id) : null;
  const brand = bench?.config.brand.name ?? "";
  const category = bench?.config.category ?? "";

  const { metrics } = await aggregateRun(run.id, brand);
  const [openFindings, pendingFixes, openAlerts] = await Promise.all([
    countFindings(shop, { runId: run.id }),
    countProposals(shop, { status: "proposed" }),
    countAlerts(shop, { status: "open" }),
  ]);

  const data = buildDashboardData({
    brand, metrics,
    lastRunAt: run.finished_at ?? run.started_at,
    openFindings, pendingFixes, openAlerts,
  });
  res.json({ connected: true, hasData: true, brand, category, runId: run.id, data } satisfies DashboardEnvelope);
}
