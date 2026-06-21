import type { Request, Response } from "express";
import { shopOf } from "./shopify.js";
import { getBenchmark } from "../db/benchmarks.js";
import { getExperiment, listExperiments, listInterventions } from "../db/experiments.js";
import { captureBaseline, planIntervention, runVerification, startVerification } from "../experiments/execute.js";

// Shop-scoped Experiments API (Phase 7). requireShop sets req.shopDomain; every
// handler is tenant-isolated. Baseline/verification are benchmark runs: mock by
// default ($0); a LIVE run (real engine spend) requires explicit { live: true }.

const METRICS = new Set(["recommendationRate", "mentionRate", "topChoiceRate", "promptCoverage", "citationBackedRate"]);

/** POST /app/api/experiments/plan — record an intervention + open an experiment. */
export async function planHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const benchmarkId = Number(req.body?.benchmarkId);
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const kind = typeof req.body?.kind === "string" ? req.body.kind : "manual";
  if (!Number.isInteger(benchmarkId) || !description) {
    res.status(400).json({ error: "benchmarkId (number) and description (string) are required." });
    return;
  }
  // Tenant isolation: the benchmark must belong to this shop.
  const bench = await getBenchmark(benchmarkId);
  if (!bench || bench.shop_domain !== shop) {
    res.status(404).json({ error: "Benchmark not found for this shop." });
    return;
  }
  const primaryMetric = typeof req.body?.primaryMetric === "string" && METRICS.has(req.body.primaryMetric) ? req.body.primaryMetric : undefined;
  const out = await planIntervention(shop, {
    benchmarkId, kind, description,
    proposalId: req.body?.proposalId != null ? Number(req.body.proposalId) : null,
    productGid: typeof req.body?.productGid === "string" ? req.body.productGid : null,
    primaryMetric: primaryMetric as never,
  });
  res.json({ ...out, primaryMetric: primaryMetric ?? "recommendationRate" });
}

/** POST /app/api/experiments/start { brand, category, competitors[], description, live? }
 *  — build a benchmark, plan an intervention, and capture its baseline in one step. */
export async function startVerificationHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const brand = typeof req.body?.brand === "string" ? req.body.brand.trim() : "";
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const competitors = Array.isArray(req.body?.competitors) ? req.body.competitors.map(String) : [];
  if (!brand || !category || !description) {
    res.status(400).json({ error: "brand, category and description are required." });
    return;
  }
  const live = req.body?.live === true;
  try {
    const r = await startVerification(shop, { brand, category, competitors, description, mock: !live });
    res.json({ ok: true, mode: live ? "live" : "mock", ...r });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

/** POST /app/api/experiments/:id/baseline { live? } — capture the BEFORE run. */
export async function baselineHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  const live = req.body?.live === true;
  try {
    const r = await captureBaseline(shop, id, { mock: !live });
    res.json({ ok: true, baselineRunId: r.runId, mode: live ? "live" : "mock" });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
}

/** POST /app/api/experiments/:id/verify { live? } — run the AFTER benchmark + compare. */
export async function verifyHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  const live = req.body?.live === true;
  try {
    const result = await runVerification(shop, id, { mock: !live });
    res.json({ ok: true, mode: live ? "live" : "mock", ...result });
  } catch (err) {
    res.status(422).json({ error: (err as Error).message });
  }
}

/** GET /app/api/experiments/:id — the experiment + its result. */
export async function getExperimentHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const exp = await getExperiment(Number(req.params.id));
  if (!exp || exp.shop_domain !== shop) {
    res.status(404).json({ error: "Experiment not found for this shop." });
    return;
  }
  res.json(exp);
}

/** GET /app/api/experiments?interventionId= — list experiments. */
export async function listExperimentsHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const interventionId = req.query.interventionId != null ? Number(req.query.interventionId) : undefined;
  const experiments = await listExperiments(shop, Number.isInteger(interventionId) ? interventionId : undefined);
  res.json({ count: experiments.length, experiments });
}

/** GET /app/api/interventions — list interventions. */
export async function listInterventionsHandler(req: Request, res: Response): Promise<void> {
  const interventions = await listInterventions(shopOf(req));
  res.json({ count: interventions.length, interventions });
}
