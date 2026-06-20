import { pgQuery } from "../db/pg.js";
import { backoffMs, decideFailure, normalizeIdempotencyKey, type JobStatus } from "./backoff.js";

// Durable Postgres job queue (Phase 1). Atomic claiming via FOR UPDATE SKIP LOCKED,
// idempotent enqueue, exponential-backoff retry with a dead-letter terminal state,
// lease-based abandoned-job recovery, and per-scope concurrency controls.

export interface Job {
  id: number;
  type: string;
  status: JobStatus;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  idempotency_key: string | null;
  shop: string | null;
  user_id: string | null;
  email_hash: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  lease_expires_at: string | null;
  last_error: string | null;
  reservation_id: number | null;
  spend_reserved_usd: string;
}

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  shop?: string;
  userId?: string;
  emailHash?: string;
  priority?: number;
  maxAttempts?: number;
  runAfter?: Date;
  reservationId?: number;
  spendReservedUsd?: number;
}

/** Idempotent enqueue. If a job with the same idempotency key already exists, returns
 *  that job's id instead of creating a duplicate. */
export async function enqueue(input: EnqueueInput): Promise<{ id: number; created: boolean }> {
  const key = normalizeIdempotencyKey(input.idempotencyKey);
  const ins = await pgQuery<{ id: string }>(
    `insert into jobs (type, payload, idempotency_key, shop, user_id, email_hash, priority,
                       max_attempts, run_after, reservation_id, spend_reserved_usd)
     values ($1, $2::jsonb, $3, $4, $5, $6, coalesce($7, 100), coalesce($8, 5),
             coalesce($9, now()), $10, coalesce($11, 0))
     on conflict (idempotency_key) where idempotency_key is not null do nothing
     returning id`,
    [
      input.type, JSON.stringify(input.payload ?? {}), key ?? null, input.shop ?? null,
      input.userId ?? null, input.emailHash ?? null, input.priority ?? null,
      input.maxAttempts ?? null, input.runAfter ?? null, input.reservationId ?? null,
      input.spendReservedUsd ?? null,
    ],
  );
  if (ins.rows[0]) return { id: Number(ins.rows[0].id), created: true };
  // Conflict on idempotency key — return the existing job.
  const existing = await pgQuery<{ id: string }>("select id from jobs where idempotency_key = $1", [key]);
  const row = existing.rows[0];
  if (!row) throw new Error("enqueue: idempotency conflict but no existing row found");
  return { id: Number(row.id), created: false };
}

export interface ClaimLimits {
  globalLimit?: number; // <=0 disables
  shopLimit?: number;
  emailLimit?: number;
  leaseSec?: number;
  types?: string[]; // restrict to these job types
}

/** Atomically claim the next runnable job, respecting concurrency caps. Returns null
 *  when nothing is claimable. Safe across replicas (FOR UPDATE SKIP LOCKED). */
export async function claim(workerId: string, limits: ClaimLimits = {}): Promise<Job | null> {
  const globalLimit = limits.globalLimit ?? 0;
  const shopLimit = limits.shopLimit ?? 0;
  const emailLimit = limits.emailLimit ?? 0;
  const leaseSec = limits.leaseSec ?? 120;
  const types = limits.types && limits.types.length ? limits.types : null;

  const { rows } = await pgQuery<Job>(
    `with cand as (
       select j.id
       from jobs j
       where j.status = 'queued'
         and j.run_after <= now()
         and ($1 <= 0 or (select count(*) from jobs r where r.status = 'running') < $1)
         and ($2 <= 0 or j.shop is null or
              (select count(*) from jobs r where r.status = 'running' and r.shop = j.shop) < $2)
         and ($3 <= 0 or j.email_hash is null or
              (select count(*) from jobs r where r.status = 'running' and r.email_hash = j.email_hash) < $3)
         and ($5::text[] is null or j.type = any($5))
       order by j.priority asc, j.run_after asc
       for update skip locked
       limit 1
     )
     update jobs j
       set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $4,
           lease_expires_at = now() + make_interval(secs => $6), updated_at = now()
     from cand
     where j.id = cand.id
     returning j.*`,
    [globalLimit, shopLimit, emailLimit, workerId, types, leaseSec],
  );
  return rows[0] ?? null;
}

/** Extend a running job's lease (call periodically during long work). */
export async function heartbeat(id: number, workerId: string, leaseSec = 120): Promise<boolean> {
  const { rowCount } = await pgQuery(
    `update jobs set lease_expires_at = now() + make_interval(secs => $2), updated_at = now()
     where id = $1 and status = 'running' and locked_by = $3`,
    [id, leaseSec, workerId],
  );
  return (rowCount ?? 0) > 0;
}

export async function complete(id: number, result: Record<string, unknown> = {}): Promise<void> {
  await pgQuery(
    `update jobs set status = 'completed', result = $2::jsonb, locked_at = null, locked_by = null,
       lease_expires_at = null, updated_at = now()
     where id = $1 and status = 'running'`,
    [id, JSON.stringify(result)],
  );
}

/** Fail a job: retry with backoff, or move to dead_letter once attempts hit max. */
export async function fail(
  id: number,
  error: string,
  opts: { baseMs?: number; maxMs?: number } = {},
): Promise<"retry" | "dead_letter"> {
  const { rows } = await pgQuery<{ attempts: number; max_attempts: number }>(
    "select attempts, max_attempts from jobs where id = $1",
    [id],
  );
  if (!rows[0]) return "dead_letter";
  const decision = decideFailure(rows[0].attempts, rows[0].max_attempts);
  const err = (error ?? "").slice(0, 2000);
  if (decision === "retry") {
    const delay = backoffMs(rows[0].attempts, opts);
    await pgQuery(
      `update jobs set status = 'queued', run_after = now() + make_interval(secs => $2),
         locked_at = null, locked_by = null, lease_expires_at = null, last_error = $3, updated_at = now()
       where id = $1`,
      [id, delay / 1000, err],
    );
  } else {
    await pgQuery(
      `update jobs set status = 'dead_letter', locked_at = null, locked_by = null,
         lease_expires_at = null, last_error = $2, updated_at = now()
       where id = $1`,
      [id, err],
    );
  }
  return decision;
}

export async function cancel(id: number): Promise<boolean> {
  const { rowCount } = await pgQuery(
    "update jobs set status = 'cancelled', locked_at = null, locked_by = null, lease_expires_at = null, updated_at = now() where id = $1 and status in ('queued','running')",
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/** Requeue jobs whose worker died (lease expired beyond a grace period). Returns count. */
export async function recoverAbandoned(graceSec = 30): Promise<number> {
  const { rowCount } = await pgQuery(
    `update jobs set status = 'queued', locked_at = null, locked_by = null, lease_expires_at = null,
       run_after = now(), last_error = left(coalesce(last_error,'') || ' [recovered: lease expired]', 2000),
       updated_at = now()
     where status = 'running' and lease_expires_at is not null
       and lease_expires_at < now() - make_interval(secs => $1)`,
    [graceSec],
  );
  return rowCount ?? 0;
}

/** Admin control: send a dead-lettered job back to the queue with fresh attempts. */
export async function retryDeadLetter(id: number): Promise<boolean> {
  const { rowCount } = await pgQuery(
    `update jobs set status = 'queued', attempts = 0, run_after = now(), last_error = null, updated_at = now()
     where id = $1 and status in ('dead_letter','failed','cancelled')`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export interface QueueStats {
  byStatus: Record<string, number>;
  oldestQueuedAgeSec: number | null;
  deadLetter: number;
  running: number;
  recent: Array<{ id: number; type: string; status: string; attempts: number; last_error: string | null; updated_at: string }>;
}

export async function stats(): Promise<QueueStats> {
  const counts = await pgQuery<{ status: string; n: string }>("select status, count(*)::int n from jobs group by status");
  const byStatus: Record<string, number> = {};
  for (const r of counts.rows) byStatus[r.status] = Number(r.n);
  const oldest = await pgQuery<{ age: string | null }>(
    "select extract(epoch from (now() - min(run_after)))::int as age from jobs where status = 'queued'",
  );
  const recent = await pgQuery<QueueStats["recent"][number]>(
    "select id, type, status, attempts, last_error, updated_at from jobs order by updated_at desc limit 20",
  );
  return {
    byStatus,
    oldestQueuedAgeSec: oldest.rows[0]?.age != null ? Number(oldest.rows[0].age) : null,
    deadLetter: byStatus.dead_letter ?? 0,
    running: byStatus.running ?? 0,
    recent: recent.rows,
  };
}

// ---- process heartbeats (health for worker/scheduler) ---------------------
export async function touchHeartbeat(name: string, meta: Record<string, unknown> = {}): Promise<void> {
  await pgQuery(
    `insert into system_heartbeats (name, at, meta) values ($1, now(), $2::jsonb)
     on conflict (name) do update set at = now(), meta = excluded.meta`,
    [name, JSON.stringify(meta)],
  );
}

export async function recentHeartbeats(withinSec = 120): Promise<Array<{ name: string; ageSec: number }>> {
  const { rows } = await pgQuery<{ name: string; age: string }>(
    "select name, extract(epoch from (now() - at))::int as age from system_heartbeats where at > now() - make_interval(secs => $1) order by name",
    [withinSec],
  );
  return rows.map((r) => ({ name: r.name, ageSec: Number(r.age) }));
}
