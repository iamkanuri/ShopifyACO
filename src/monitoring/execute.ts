import { registerHandler } from "../queue/handlers.js";
import { enqueue } from "../queue/jobs.js";
import { executeBenchmark } from "../benchmarks/execute.js";
import { aggregateRun, getBenchmark } from "../db/benchmarks.js";
import { runVerification } from "../experiments/execute.js";
import { evaluateAlerts, nextRunAt, type AlertDraft, type Cadence } from "./alerts.js";
import { advanceSchedule, claimDueSchedules, createAlert, getSchedule, recordNotification } from "../db/monitoring.js";
import { getProvider } from "../notify/provider.js";
import { ENV } from "../server/env.js";
import { assertFeature } from "../billing/enforce.js";

// ===========================================================================
// Monitoring orchestrator (Phase 8). The scheduler (PROCESS_MODE=scheduler) calls
// runDueSchedules each tick to enqueue due `schedules`; the worker runs `monitor_run`.
// A benchmark schedule re-runs the benchmark and compares it to the PREVIOUS run
// (statistically-credible alerts only); a verification schedule re-checks whether
// an applied fix still holds. Alerts fan out through the notification provider and
// are recorded. mock by default ($0); a live run spends money (Phase-1 reservation).
// ===========================================================================

export interface MonitorResult {
  scheduleId: number;
  runId: number | null;
  alerts: number;
  skipped?: string;
}

async function dispatch(shop: string, drafts: Array<AlertDraft & { scheduleId: number; runId: number | null; prevRunId: number | null }>): Promise<number> {
  const provider = getProvider();
  for (const draft of drafts) {
    const alertId = await createAlert(shop, draft);
    const msg = { shop, recipient: null, subject: draft.title, body: draft.detail };
    let result;
    try {
      result = await provider.send(msg);
    } catch (err) {
      result = { channel: provider.channel, status: "failed" as const, error: (err as Error).message };
    }
    await recordNotification(shop, alertId, msg, result);
  }
  return drafts.length;
}

/** Execute one schedule: run + (benchmark) compare to the previous run, raise alerts,
 *  advance the cadence. Never throws past advancing — a tick shouldn't crash a loop. */
export async function monitorRun(scheduleId: number, opts: { mock?: boolean } = {}): Promise<MonitorResult> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) return { scheduleId, runId: null, alerts: 0, skipped: "schedule not found" };
  if (!schedule.enabled) return { scheduleId, runId: null, alerts: 0, skipped: "disabled" };
  const cadence = schedule.cadence as Cadence;
  const shop = schedule.shop_domain;

  // Execution-time entitlement re-check (Phase 11; dormant unless BILLING_ENFORCED=1). This is
  // the SHARED chokepoint for BOTH scheduled execution (worker monitor_run) and "Run now"
  // (runScheduleHandler), so a downgraded merchant can't keep monitoring by either path. Skip
  // (don't throw) so the worker doesn't retry-storm; idempotency keeps it from re-processing.
  // Kind-aware: a benchmark schedule needs `monitoring`; a verification schedule needs `experiments`.
  if (ENV.billing.enforced) {
    const gate = await assertFeature(shop, schedule.kind === "verification" ? "experiments" : "monitoring");
    if (!gate.allowed) return { scheduleId, runId: null, alerts: 0, skipped: "not_entitled" };
  }

  if (schedule.kind === "verification") {
    if (schedule.experiment_id == null) return { scheduleId, runId: null, alerts: 0, skipped: "no experiment" };
    const result = await runVerification(shop, schedule.experiment_id, { mock: opts.mock });
    const drafts: Array<AlertDraft & { scheduleId: number; runId: number | null; prevRunId: number | null }> = [];
    if (result.verdict === "regressed") {
      drafts.push({
        type: "regression", severity: "critical", metric: result.primary.metric,
        title: `A verified fix appears to have regressed (${result.primary.metric})`,
        detail: `Re-verifying your intervention now classifies ${result.primary.metric} as regressed vs the original baseline (CI of the change excludes 0). Re-investigate; this is a measured change, not a proven cause.`,
        comparison: result.primary,
        scheduleId, runId: result.verificationRunId, prevRunId: result.baselineRunId,
      });
    }
    const alerts = await dispatch(shop, drafts);
    await advanceSchedule(scheduleId, result.verificationRunId ?? 0, nextRunAt(cadence));
    return { scheduleId, runId: result.verificationRunId, alerts };
  }

  // kind === "benchmark": re-run + compare consecutive runs.
  if (schedule.benchmark_id == null) return { scheduleId, runId: null, alerts: 0, skipped: "no benchmark" };
  const bench = await getBenchmark(schedule.benchmark_id);
  if (!bench) return { scheduleId, runId: null, alerts: 0, skipped: "benchmark not found" };
  const brand = bench.config.brand.name;

  const run = await executeBenchmark(schedule.benchmark_id, { mock: opts.mock });
  const prevMetrics = schedule.last_run_id != null ? (await aggregateRun(schedule.last_run_id, brand)).metrics : null;
  const drafts = evaluateAlerts(run.metrics, prevMetrics).map((d) => ({ ...d, scheduleId, runId: run.runId, prevRunId: schedule.last_run_id }));
  const alerts = await dispatch(shop, drafts);

  await advanceSchedule(scheduleId, run.runId, nextRunAt(cadence));
  return { scheduleId, runId: run.runId, alerts };
}

/** Find due schedules and either run them inline (dev/tests) or enqueue monitor_run
 *  jobs (production scheduler). Idempotency keyed on the due time so overlapping
 *  ticks don't double-process a schedule. */
export async function runDueSchedules(opts: { inline?: boolean; mock?: boolean } = {}): Promise<{ processed: number }> {
  const due = await claimDueSchedules();
  let processed = 0;
  for (const s of due) {
    if (opts.inline) {
      try {
        await monitorRun(s.id, { mock: opts.mock });
      } catch (err) {
        console.error(`[monitor] schedule ${s.id} failed:`, (err as Error).message);
      }
    } else {
      await enqueue({
        type: "monitor_run",
        payload: { scheduleId: s.id, mock: opts.mock ?? true },
        shop: s.shop_domain,
        idempotencyKey: `monitor:${s.id}:${s.next_run_at}`,
      });
    }
    processed++;
  }
  return { processed };
}

/** Register the worker handler. The enqueue payload carries `mock` (runDueSchedules sets it
 *  from MONITORING_LIVE); honor it directly so MONITORING_LIVE=1 actually produces live runs.
 *  Defaults to mock when the flag is absent — recurring runs never silently spend. */
export function registerMonitoringJobs(): void {
  registerHandler("monitor_run", async (payload) => {
    const scheduleId = Number(payload.scheduleId);
    if (!Number.isInteger(scheduleId)) throw new Error("monitor_run: missing scheduleId");
    const r = await monitorRun(scheduleId, { mock: payload.mock !== false });
    return { ...r };
  });
}
