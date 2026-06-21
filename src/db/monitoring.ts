import { pgQuery } from "./pg.js";
import type { AlertDraft, Cadence } from "../monitoring/alerts.js";
import type { DeliveryResult, NotificationMessage } from "../notify/provider.js";

// Persistence for Phase 8 (schedules, alerts, notifications). Shop-scoped.

export interface ScheduleRow {
  id: number;
  shop_domain: string;
  kind: string;
  benchmark_id: number | null;
  experiment_id: number | null;
  cadence: string;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_run_id: number | null;
}

export async function createSchedule(shop: string, s: { kind?: string; benchmarkId?: number | null; experimentId?: number | null; cadence: Cadence }): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    "insert into schedules (shop_domain, kind, benchmark_id, experiment_id, cadence) values ($1,$2,$3,$4,$5) returning id",
    [shop, s.kind ?? "benchmark", s.benchmarkId ?? null, s.experimentId ?? null, s.cadence],
  );
  return Number(rows[0]!.id);
}

function toRow(r: ScheduleRow & { id: string; benchmark_id: string | null; experiment_id: string | null; last_run_id: string | null }): ScheduleRow {
  return {
    ...r, id: Number(r.id),
    benchmark_id: r.benchmark_id != null ? Number(r.benchmark_id) : null,
    experiment_id: r.experiment_id != null ? Number(r.experiment_id) : null,
    last_run_id: r.last_run_id != null ? Number(r.last_run_id) : null,
  };
}

export async function getSchedule(id: number): Promise<ScheduleRow | null> {
  const { rows } = await pgQuery<ScheduleRow & { id: string; benchmark_id: string | null; experiment_id: string | null; last_run_id: string | null }>(
    "select * from schedules where id=$1", [id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listSchedules(shop: string): Promise<ScheduleRow[]> {
  const { rows } = await pgQuery<ScheduleRow & { id: string; benchmark_id: string | null; experiment_id: string | null; last_run_id: string | null }>(
    "select * from schedules where shop_domain=$1 order by created_at desc", [shop],
  );
  return rows.map(toRow);
}

export async function updateSchedule(id: number, fields: { cadence?: Cadence; enabled?: boolean }): Promise<void> {
  await pgQuery(
    "update schedules set cadence=coalesce($2, cadence), enabled=coalesce($3, enabled), updated_at=now() where id=$1",
    [id, fields.cadence ?? null, fields.enabled ?? null],
  );
}

export async function deleteSchedule(shop: string, id: number): Promise<number> {
  const { rowCount } = await pgQuery("delete from schedules where id=$1 and shop_domain=$2", [id, shop]);
  return rowCount ?? 0;
}

/** Due, enabled schedules (next_run_at in the past). The scheduler enqueues these. */
export async function claimDueSchedules(limit = 50): Promise<ScheduleRow[]> {
  const { rows } = await pgQuery<ScheduleRow & { id: string; benchmark_id: string | null; experiment_id: string | null; last_run_id: string | null }>(
    "select * from schedules where enabled = true and next_run_at <= now() order by next_run_at asc limit $1",
    [Math.min(200, Math.max(1, limit))],
  );
  return rows.map(toRow);
}

/** Record a completed run + advance the cadence. */
export async function advanceSchedule(id: number, runId: number, nextRunAt: Date): Promise<void> {
  await pgQuery(
    "update schedules set last_run_id=$2, last_run_at=now(), next_run_at=$3, updated_at=now() where id=$1",
    [id, runId, nextRunAt.toISOString()],
  );
}

// ---- alerts ----------------------------------------------------------------
export async function createAlert(shop: string, a: AlertDraft & { scheduleId?: number | null; runId?: number | null; prevRunId?: number | null }): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into alerts (shop_domain, schedule_id, run_id, prev_run_id, type, severity, metric, title, detail, comparison)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning id`,
    [shop, a.scheduleId ?? null, a.runId ?? null, a.prevRunId ?? null, a.type, a.severity, a.metric ?? null, a.title, a.detail, JSON.stringify(a.comparison)],
  );
  return Number(rows[0]!.id);
}

export async function listAlerts(shop: string, opts: { status?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery(
    `select id, schedule_id, run_id, prev_run_id, type, severity, metric, title, detail, comparison, status, created_at, acknowledged_at
       from alerts where shop_domain=$1 and ($2::text is null or status=$2)
       order by created_at desc limit $3`,
    [shop, opts.status ?? null, Math.min(200, Math.max(1, opts.limit ?? 100))],
  );
  return rows;
}

export async function acknowledgeAlert(shop: string, id: number): Promise<number> {
  const { rowCount } = await pgQuery(
    "update alerts set status='acknowledged', acknowledged_at=now() where id=$1 and shop_domain=$2 and status='open'",
    [id, shop],
  );
  return rowCount ?? 0;
}

// ---- notifications ---------------------------------------------------------
export async function recordNotification(shop: string, alertId: number, msg: NotificationMessage, result: DeliveryResult): Promise<void> {
  await pgQuery(
    "insert into notifications (shop_domain, alert_id, channel, recipient, subject, body, status, error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [shop, alertId, result.channel, msg.recipient ?? null, msg.subject, msg.body, result.status, result.error ?? null],
  );
}
