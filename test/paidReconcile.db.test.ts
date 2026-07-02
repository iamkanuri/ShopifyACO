import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgQuery } from "../src/db/pg.js";
import { listReportsToHold, getPaidReportByRun } from "../src/db/paidReports.js";
import { reconcileFailedReports } from "../src/paid/reconcile.js";
import { paidJobKey, PAID_JOB_PREFIX } from "../src/paid/jobKey.js";

// Design A reconciliation (DB-gated): a paid report transitions to `held` ONLY on GENUINE death —
// retries exhausted (dead-letter) OR stuck past a cap — never on a transient retry or ordinary
// backlog. Two caps: a TIGHT one for `generating` (a claimed-then-dead worker) and a LONG one for
// `pending` (never-claimed) so ordinary backlog isn't force-failed but a stranded payment still refunds.
//   RUN_DB_TESTS=1 npm run test:db

const DB = process.env.RUN_DB_TESTS === "1";
const P = "cs_reconcile_test_"; // scoped prefix for cleanup

interface Seed {
  session: string;
  status: "pending" | "generating";
  ageMin: number;
  job?: string | null; // jobs.status, or null = no job row at all
}

async function seed(s: Seed): Promise<void> {
  await pgQuery(
    `insert into paid_reports (session_id, run_id, email, plan, status, stripe_payment_intent, created_at)
     values ($1, $2, 'b@x.com', 'full_report', $3, $4, now() - ($5 || ' minutes')::interval)`,
    [P + s.session, "run_" + P + s.session, s.status, "pi_" + s.session, String(s.ageMin)],
  );
  if (s.job) {
    await pgQuery(`insert into jobs (type, status, idempotency_key) values ('paid_report_generate', $1, $2)`, [
      s.job,
      paidJobKey(P + s.session),
    ]);
  }
}

async function cleanup(): Promise<void> {
  await pgQuery(`delete from paid_reports where session_id like $1`, [P + "%"]).catch(() => {});
  await pgQuery(`delete from jobs where idempotency_key like $1`, [PAID_JOB_PREFIX + P + "%"]).catch(() => {});
}

test("listReportsToHold: holds genuine death (dead-letter / stuck), spares retries + backlog", { skip: !DB }, async () => {
  await cleanup();
  try {
    // Should be HELD:
    await seed({ session: "deadletter", status: "generating", ageMin: 5, job: "dead_letter" }); // retries exhausted
    await seed({ session: "stuckgen", status: "generating", ageMin: 45, job: "running" }); // claimed then died (>30m)
    await seed({ session: "stuckpend", status: "pending", ageMin: 200, job: "queued" }); // never claimed (>180m)
    // Should be SPARED:
    await seed({ session: "healthygen", status: "generating", ageMin: 5, job: "running" }); // mid-generation, fine
    await seed({ session: "younggen_nojob", status: "generating", ageMin: 5, job: null }); // young, not dead-lettered
    await seed({ session: "backlog", status: "pending", ageMin: 45, job: "queued" }); // ordinary backlog (<180m) — must NOT hold

    const rows = await listReportsToHold({ genStuckCapMin: 30, pendingStuckCapMin: 180, jobPrefix: PAID_JOB_PREFIX });
    const byRun = new Map(rows.map((r) => [r.run_id, r.hold_reason]));

    // The three genuinely-dead reports are held, each for the right reason.
    assert.equal(byRun.get("run_" + P + "deadletter"), "retries_exhausted");
    assert.equal(byRun.get("run_" + P + "stuckgen"), "stuck_generating");
    assert.equal(byRun.get("run_" + P + "stuckpend"), "stuck_pending");

    // The healthy / backlog reports are NOT held — this is the whole point of the two-cap tuning.
    assert.ok(!byRun.has("run_" + P + "healthygen"), "a mid-generation report must not be held");
    assert.ok(!byRun.has("run_" + P + "younggen_nojob"), "a young generating report (no dead-letter) must not be held");
    assert.ok(!byRun.has("run_" + P + "backlog"), "ordinary pending backlog (<180m) must NOT be force-failed");
  } finally {
    await cleanup();
  }
});

test("reconcileFailedReports marks held once + is idempotent (no re-hold/re-alert)", { skip: !DB }, async () => {
  await cleanup();
  try {
    // A dead-lettered generation — held regardless of age (the dead-letter branch has no time gate).
    await seed({ session: "recon", status: "generating", ageMin: 1, job: "dead_letter" });

    const first = await reconcileFailedReports();
    assert.ok(first.held >= 1, "reconcile marks the dead-lettered report held");
    const after = await getPaidReportByRun("run_" + P + "recon");
    assert.equal(after?.status, "held", "the report is now held (enables the refund sweep)");

    // Second pass: already held → excluded from the sweep → not re-held (so the owner alert fires once).
    const before2 = (await getPaidReportByRun("run_" + P + "recon"))?.status;
    const second = await reconcileFailedReports();
    const reconStill = await pgQuery<{ n: number }>(
      `select count(*)::int n from paid_reports where run_id = $1 and status = 'held'`,
      ["run_" + P + "recon"],
    );
    assert.equal(before2, "held");
    assert.equal((reconStill.rows[0] as { n: number }).n, 1, "still exactly one held row — no churn");
    // second.held counts only rows newly returned by the sweep; our recon row is excluded now.
    assert.ok(!(second.held > first.held), "an already-held report is not re-held (alert-once)");
  } finally {
    await cleanup();
  }
});
