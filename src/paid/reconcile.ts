import { ENV } from "../server/env.js";
import { listReportsToHold, markHeld } from "../db/paidReports.js";
import { PAID_JOB_PREFIX } from "./jobKey.js";
import { alertOwner } from "./notify.js";

// Design A reconciliation (Phase 2). Runs on the scheduler tick, BEFORE the refund sweep. It is the
// SOLE place a paid report transitions to `held` — driven by job/report state, never by the per-attempt
// handler. A report is held ONLY when its generation is GENUINELY dead:
//   • retries exhausted (its job dead-lettered), or
//   • stuck in `generating` past the tight gen cap (worker claimed it then died mid-run), or
//   • stuck in `pending` past the long refund-window cap (never claimed — dead/absent worker).
// This makes the retry-display fix safe two ways: (1) a transient hiccup that succeeds on retry never
// reaches 'held', so the buyer never sees a phantom failure; and (2) a job that never dead-letters
// (crash / lease lost / no worker) is STILL caught by a time cap, so a payment is never stranded.
// The owner alert fires HERE, exactly once per report (the query excludes rows already `held`).

const REASON_TEXT: Record<string, string> = {
  retries_exhausted: "generation failed after all retries (dead-lettered)",
  stuck_generating: "generation stalled mid-run (worker likely died)",
  stuck_pending: "generation was never claimed (worker down/absent)",
};

/** Mark genuinely-dead paid reports `held` (+ alert the owner once). Returns how many were held. */
export async function reconcileFailedReports(): Promise<{ held: number }> {
  const rows = await listReportsToHold({
    genStuckCapMin: ENV.paidGenStuckCapMin,
    pendingStuckCapMin: ENV.paidRefundAfterMin, // pending pinned to the refund window (ordinary backlog untouched)
    jobPrefix: PAID_JOB_PREFIX,
  });
  let held = 0;
  for (const row of rows) {
    const reason = REASON_TEXT[row.hold_reason] ?? row.hold_reason;
    // markHeld (which enables the refund) is the primary action; the alert is best-effort so a
    // transport blip can't leave a report un-held. Once held, the row drops out of the next sweep.
    await markHeld(row.session_id, reason);
    await alertOwner(
      `Paid report HELD — ${row.hold_reason} (${row.session_id})`,
      `run=${row.run_id} buyer=${row.email ?? "?"}: ${reason}. It's HELD; re-run it (admin queue) ` +
        `or it auto-refunds after the window.`,
    ).catch(() => {});
    held++;
  }
  return { held };
}
