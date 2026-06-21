import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { shopOf } from "./shopify.js";
import { diagnoseRun } from "../diagnosis/execute.js";
import { getBenchmark, getRun } from "../db/benchmarks.js";
import { listCrawlPages, listFindings } from "../db/crawler.js";
import { enqueue } from "../queue/jobs.js";

// Shop-scoped Evidence & Diagnosis API (Phase 5). requireShop sets req.shopDomain;
// every handler verifies the target run belongs to THIS shop (tenant isolation).
// Diagnosis defaults to mock (no network); a live crawl is explicit opt-in.

/** Load a run and confirm it belongs to the caller's shop. */
async function ownedRun(req: Request, res: Response): Promise<{ runId: number; benchmarkId: number | null } | null> {
  const runId = Number(req.body?.runId ?? req.query?.runId);
  if (!Number.isInteger(runId)) {
    res.status(400).json({ error: "A numeric runId is required." });
    return null;
  }
  const run = await getRun(runId);
  if (!run || run.shop_domain !== shopOf(req)) {
    res.status(404).json({ error: "Run not found for this shop.", code: "run_not_found" });
    return null;
  }
  return { runId, benchmarkId: run.benchmark_id };
}

/** POST /app/api/evidence/diagnose — crawl + diagnose a completed run. Body:
 *  { runId, merchantUrl?, competitorUrls?, live? }. Live crawling hits the network
 *  (opt-in; spends no API money). Queued when the worker is on, else inline. */
export async function diagnoseHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const owned = await ownedRun(req, res);
  if (!owned) return;

  const bench = owned.benchmarkId != null ? await getBenchmark(owned.benchmarkId) : null;
  const merchantBrand = bench?.config.brand.name ?? String(req.body?.merchantBrand ?? "");
  if (!merchantBrand) {
    res.status(400).json({ error: "merchantBrand could not be resolved from the run; pass it explicitly." });
    return;
  }
  const live = req.body?.live === true;
  const merchantUrl = typeof req.body?.merchantUrl === "string" ? req.body.merchantUrl : null;
  const competitorUrls = Array.isArray(req.body?.competitorUrls) ? req.body.competitorUrls.map(String).slice(0, 25) : undefined;

  if (ENV.jobQueueEnabled) {
    const { id, created } = await enqueue({
      type: "evidence_diagnose",
      payload: { runId: owned.runId, shop, merchantBrand, benchmarkId: owned.benchmarkId, merchantUrl, competitorUrls, live },
      shop,
      idempotencyKey: `evidence_diagnose:${owned.runId}:${live ? "live" : "mock"}`,
    });
    res.json({ queued: true, jobId: id, deduped: !created, mode: live ? "live" : "mock" });
    return;
  }
  try {
    const result = await diagnoseRun({
      runId: owned.runId, shopDomain: shop, merchantBrand, benchmarkId: owned.benchmarkId,
      merchantUrl, competitorUrls, mock: !live,
    });
    res.json({ queued: false, ...result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

/** GET /app/api/evidence/findings?runId= — findings for a run (evidence-backed first). */
export async function findingsHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const owned = await ownedRun(req, res);
  if (!owned) return;
  const findings = await listFindings(shop, { runId: owned.runId });
  res.json({ runId: owned.runId, count: findings.length, findings });
}

/** GET /app/api/evidence/pages?runId= — crawled pages for a run (merchant + competitors). */
export async function pagesHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const owned = await ownedRun(req, res);
  if (!owned) return;
  const pages = await listCrawlPages(shop, owned.runId);
  res.json({ runId: owned.runId, count: pages.length, pages });
}
