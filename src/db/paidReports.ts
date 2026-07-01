import { pgQuery, hasPg } from "./pg.js";

// Data access for the automated paid report (Phase 2). Raw pg (db/pg.ts) so the WORKER can
// read/write it (the supabase-js graceful layer is web-side). All writes key on session_id
// so a re-sent Stripe webhook can't create a duplicate.

export interface PaidReportRow {
  id: number;
  session_id: string;
  run_id: string;
  email: string | null;
  plan: string | null;
  status: "pending" | "generating" | "complete" | "held" | "refunded";
  report: unknown | null;
  artifacts: unknown | null;
  cost_usd: number;
  attempts: number;
  error: string | null;
  refunded_at: string | null;
  stripe_payment_intent: string | null;
  created_at: string;
}

/** Idempotent create. Returns created=false if a row for this session already exists (Stripe
 *  re-sent the event) — the caller then knows NOT to enqueue a second generation. */
export async function createPendingPaidReport(input: {
  sessionId: string; runId: string; email?: string | null; plan?: string | null; paymentIntent?: string | null;
}): Promise<{ created: boolean }> {
  const res = await pgQuery<{ id: string }>(
    `insert into paid_reports (session_id, run_id, email, plan, stripe_payment_intent, status)
     values ($1, $2, $3, $4, $5, 'pending')
     on conflict (session_id) do nothing
     returning id`,
    [input.sessionId, input.runId, input.email ?? null, input.plan ?? null, input.paymentIntent ?? null],
  );
  return { created: res.rows.length > 0 };
}

export async function getPaidReportBySession(sessionId: string): Promise<PaidReportRow | null> {
  const res = await pgQuery<PaidReportRow>("select * from paid_reports where session_id = $1", [sessionId]);
  return res.rows[0] ?? null;
}

/** The latest paid report for a run (a report page loads by runId). */
export async function getPaidReportByRun(runId: string): Promise<PaidReportRow | null> {
  if (!hasPg()) return null;
  const res = await pgQuery<PaidReportRow>(
    "select * from paid_reports where run_id = $1 order by created_at desc limit 1",
    [runId],
  );
  return res.rows[0] ?? null;
}

export async function markGenerating(sessionId: string): Promise<void> {
  await pgQuery(
    "update paid_reports set status = 'generating', attempts = attempts + 1, updated_at = now() where session_id = $1",
    [sessionId],
  );
}

export async function markComplete(sessionId: string, report: unknown, artifacts: unknown, costUsd: number): Promise<void> {
  await pgQuery(
    `update paid_reports set status = 'complete', report = $2::jsonb, artifacts = $3::jsonb,
       cost_usd = cost_usd + $4, error = null, updated_at = now() where session_id = $1`,
    [sessionId, JSON.stringify(report), JSON.stringify(artifacts), costUsd],
  );
}

/** Generation failed — hold it (not refunded yet) and record the error + when we alerted. */
export async function markHeld(sessionId: string, error: string): Promise<void> {
  await pgQuery(
    "update paid_reports set status = 'held', error = $2, alerted_at = now(), updated_at = now() where session_id = $1",
    [sessionId, error.slice(0, 500)],
  );
}

export async function markRefunded(sessionId: string): Promise<void> {
  await pgQuery(
    "update paid_reports set status = 'refunded', refunded_at = now(), updated_at = now() where session_id = $1",
    [sessionId],
  );
}

/** Held reports older than the window that haven't been refunded — the auto-refund fallback set. */
export async function listHeldForRefund(olderThanMinutes: number): Promise<PaidReportRow[]> {
  if (!hasPg()) return [];
  const res = await pgQuery<PaidReportRow>(
    `select * from paid_reports where status = 'held' and refunded_at is null
       and created_at < now() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)],
  );
  return res.rows;
}
