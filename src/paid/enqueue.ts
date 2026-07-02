import type { Config } from "../types.js";
import { hasPg } from "../db/pg.js";
import { enqueue } from "../queue/jobs.js";
import { getResults } from "../server/runStore.js";
import { createPendingPaidReport } from "../db/paidReports.js";
import { PAID_REPORT_JOB } from "./handler.js";
import { paidJobKey } from "./jobKey.js";

// Called from the Stripe webhook (WEB process — it has the DATA_DIR volume the worker lacks).
// Reads the original mini-scan config off the volume, records a pending paid_report (idempotent
// on session_id), and enqueues the durable generation job. Everything here is a couple of fast
// DB/file ops and NO generation — so the webhook can return 200 immediately (Stripe won't retry
// → no double-fire). Generation runs on the worker.

export async function enqueuePaidReport(input: {
  sessionId: string;
  runId: string | null;
  email: string | null;
  plan: string | null;
  paymentIntent: string | null;
}): Promise<{ enqueued: boolean; reason?: string }> {
  if (!hasPg()) return { enqueued: false, reason: "no_pg" };
  if (!input.runId) return { enqueued: false, reason: "no_run_id" };

  const results = (await getResults(input.runId)) as { config?: Config } | null;
  const config = results?.config;
  if (!config) return { enqueued: false, reason: "no_source_config" };

  // Idempotency #1: one paid_report per checkout session. A re-sent event → created=false → no re-enqueue.
  const { created } = await createPendingPaidReport({
    sessionId: input.sessionId,
    runId: input.runId,
    email: input.email,
    plan: input.plan,
    paymentIntent: input.paymentIntent,
  });
  if (!created) return { enqueued: false, reason: "duplicate" };

  // Idempotency #2 (belt & suspenders): the job's idempotency key. Built via paidJobKey so the
  // reconciliation sweep (which joins jobs→paid_reports on this exact key) can never drift from it.
  await enqueue({
    type: PAID_REPORT_JOB,
    idempotencyKey: paidJobKey(input.sessionId),
    payload: { sessionId: input.sessionId, runId: input.runId, email: input.email, config },
  });
  return { enqueued: true };
}
