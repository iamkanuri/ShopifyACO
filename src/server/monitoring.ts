import type { Request, Response } from "express";
import { shopOf } from "./shopify.js";
import { getBenchmark } from "../db/benchmarks.js";
import { getExperiment } from "../db/experiments.js";
import { acknowledgeAlert, createSchedule, deleteSchedule, getSchedule, listAlerts, listSchedules, updateSchedule } from "../db/monitoring.js";
import { CADENCES, type Cadence } from "../monitoring/alerts.js";
import { monitorRun } from "../monitoring/execute.js";
import { assertScheduleQuota, gateDenial } from "../billing/enforce.js";

// Shop-scoped Monitoring API (Phase 8). requireShop sets req.shopDomain; tenant-
// isolated. Recurring runs default to mock ($0); a live run needs { live: true }.

const isCadence = (c: unknown): c is Cadence => typeof c === "string" && (CADENCES as string[]).includes(c);

/** POST /app/api/schedules { kind?, benchmarkId, experimentId?, cadence } */
export async function createScheduleHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const kind = req.body?.kind === "verification" ? "verification" : "benchmark";
  const cadence = req.body?.cadence;
  if (!isCadence(cadence)) {
    res.status(400).json({ error: `cadence must be one of: ${CADENCES.join(", ")}` });
    return;
  }
  // Entitlement gate (Phase 11, dormant until BILLING_ENFORCED=1): recurring monitoring
  // is a paid feature with a per-plan cap on active schedules.
  const quota = await assertScheduleQuota(shop);
  if (!quota.allowed) { res.status(402).json(gateDenial(quota)); return; }
  if (kind === "benchmark") {
    const benchmarkId = Number(req.body?.benchmarkId);
    if (!Number.isInteger(benchmarkId)) {
      res.status(400).json({ error: "benchmarkId is required for a benchmark schedule." });
      return;
    }
    const bench = await getBenchmark(benchmarkId);
    if (!bench || bench.shop_domain !== shop) {
      res.status(404).json({ error: "Benchmark not found for this shop." });
      return;
    }
    const id = await createSchedule(shop, { kind, benchmarkId, cadence });
    res.json({ id, kind, cadence });
    return;
  }
  // verification
  const experimentId = Number(req.body?.experimentId);
  const exp = Number.isInteger(experimentId) ? await getExperiment(experimentId) : null;
  if (!exp || exp.shop_domain !== shop) {
    res.status(404).json({ error: "Experiment not found for this shop." });
    return;
  }
  // A verification schedule re-checks against the experiment's baseline; without one,
  // every run would fail. Require the baseline first.
  if (exp.baseline_run_id == null) {
    res.status(409).json({ error: "Capture the experiment's baseline before scheduling re-verification.", code: "no_baseline" });
    return;
  }
  const id = await createSchedule(shop, { kind, experimentId, benchmarkId: exp.benchmark_id, cadence });
  res.json({ id, kind, cadence });
}

/** GET /app/api/schedules */
export async function listSchedulesHandler(req: Request, res: Response): Promise<void> {
  const schedules = await listSchedules(shopOf(req));
  res.json({ count: schedules.length, schedules });
}

async function ownedSchedule(req: Request, res: Response): Promise<number | null> {
  const id = Number(req.params.id);
  const s = await getSchedule(id);
  if (!s || s.shop_domain !== shopOf(req)) {
    res.status(404).json({ error: "Schedule not found for this shop." });
    return null;
  }
  return id;
}

/** POST /app/api/schedules/:id { cadence?, enabled? } */
export async function updateScheduleHandler(req: Request, res: Response): Promise<void> {
  const id = await ownedSchedule(req, res);
  if (id == null) return;
  const cadence = req.body?.cadence;
  if (cadence != null && !isCadence(cadence)) {
    res.status(400).json({ error: `cadence must be one of: ${CADENCES.join(", ")}` });
    return;
  }
  const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;
  await updateSchedule(id, { cadence: isCadence(cadence) ? cadence : undefined, enabled });
  res.json({ ok: true });
}

/** POST /app/api/schedules/:id/delete */
export async function deleteScheduleHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const removed = await deleteSchedule(shop, Number(req.params.id));
  res.status(removed ? 200 : 404).json({ ok: removed > 0 });
}

/** POST /app/api/schedules/:id/run { live? } — run this schedule now. */
export async function runScheduleHandler(req: Request, res: Response): Promise<void> {
  const id = await ownedSchedule(req, res);
  if (id == null) return;
  const live = req.body?.live === true;
  try {
    const r = await monitorRun(id, { mock: !live });
    res.json({ ok: true, mode: live ? "live" : "mock", ...r });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
}

/** GET /app/api/alerts?status=open */
export async function listAlertsHandler(req: Request, res: Response): Promise<void> {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const alerts = await listAlerts(shopOf(req), { status });
  res.json({ count: alerts.length, alerts });
}

/** POST /app/api/alerts/:id/acknowledge */
export async function acknowledgeAlertHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const n = await acknowledgeAlert(shop, Number(req.params.id));
  res.status(n ? 200 : 404).json({ ok: n > 0 });
}
