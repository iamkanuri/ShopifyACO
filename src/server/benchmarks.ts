import type { Request, Response } from "express";
import { shopOf } from "./shopify.js";
import { listRunsForShop } from "../db/benchmarks.js";
import { runShopBenchmark } from "../benchmarks/shopRun.js";
import { assertBenchmarkQuota, assertFeature, gateDenial } from "../billing/enforce.js";

// Shop-scoped Benchmarks API (Phase 12). Lets a connected merchant START the loop
// themselves. Runs are MOCK ($0) by default; a live run (real engine spend) requires
// explicit { live: true } and is reserved + capped by the Phase-1 spend controls.

/** POST /app/api/benchmarks/run { brand, category, competitors[], priceRange?, live? } */
export async function runBenchmarkHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const brand = typeof req.body?.brand === "string" ? req.body.brand.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const competitors = Array.isArray(req.body?.competitors) ? req.body.competitors.map(String) : [];
  if (!brand || !category) {
    res.status(400).json({ error: "brand and category are required." });
    return;
  }
  const live = req.body?.live === true;

  // Entitlement gate (Phase 11, dormant until BILLING_ENFORCED=1). Real engine spend
  // needs the live_benchmarks feature; every run counts against the monthly quota.
  if (live) {
    const feat = await assertFeature(shop, "live_benchmarks");
    if (!feat.allowed) { res.status(402).json(gateDenial(feat)); return; }
  }
  const quota = await assertBenchmarkQuota(shop);
  if (!quota.allowed) { res.status(402).json(gateDenial(quota)); return; }

  try {
    const r = await runShopBenchmark(shop, {
      brand, category, competitors,
      priceRange: typeof req.body?.priceRange === "string" ? req.body.priceRange : undefined,
      mock: !live,
    });
    res.json({
      ok: true, mode: live ? "live" : "mock", runId: r.runId, benchmarkId: r.benchmarkId,
      promptCount: r.promptCount, observationCount: r.observationCount, costUsd: r.costUsd,
      recommendationRate: r.metrics.recommendationRate, mentionRate: r.metrics.mentionRate,
      shareOfVoice: r.metrics.shareOfVoice,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

/** GET /app/api/benchmarks — recent runs for this shop. */
export async function listBenchmarksHandler(req: Request, res: Response): Promise<void> {
  const runs = await listRunsForShop(shopOf(req));
  res.json({ count: runs.length, runs });
}
