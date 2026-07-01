import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pgQuery } from "../src/db/pg.js";
import { runDir } from "../src/server/runStore.js";
import { createPendingPaidReport, getPaidReportBySession } from "../src/db/paidReports.js";
import { enqueuePaidReport } from "../src/paid/enqueue.js";

// PROOF 2 (DB-gated): a re-sent Stripe event MUST NOT double-generate or double-charge —
// idempotency on session_id actually holds — AND the webhook's enqueue step does NOT run
// generation inline (the row stays 'pending' until the worker picks it up).
//   RUN_DB_TESTS=1 npm run test:db

const DB = process.env.RUN_DB_TESTS === "1";
const RUN_ID = "20260701-150000-0123456789abcdef0123";
const SESSION = "cs_test_paidreport_dedup";

function seedRun(): void {
  const dir = runDir(RUN_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results.json"), JSON.stringify({
    config: { brand: { name: "TestCo" }, category: "widgets", competitors: [{ name: "Rival" }], promptTemplates: ["best widgets?"] },
  }));
}
async function cleanup(): Promise<void> {
  await pgQuery("delete from paid_reports where session_id = $1", [SESSION]).catch(() => {});
  await pgQuery("delete from jobs where idempotency_key = $1", [`paid_report:${SESSION}`]).catch(() => {});
  try { rmSync(runDir(RUN_ID), { recursive: true, force: true }); } catch { /* ignore */ }
}

test("PROOF 2: duplicate checkout session does not create a second paid report", { skip: !DB }, async () => {
  await cleanup();
  try {
    const first = await createPendingPaidReport({ sessionId: SESSION, runId: RUN_ID });
    const second = await createPendingPaidReport({ sessionId: SESSION, runId: RUN_ID });
    assert.equal(first.created, true, "first create makes the row");
    assert.equal(second.created, false, "the re-sent event must NOT create a duplicate");
    const rows = await pgQuery("select count(*)::int as n from paid_reports where session_id = $1", [SESSION]);
    assert.equal((rows.rows[0] as { n: number }).n, 1, "exactly one paid report per session");
  } finally {
    await cleanup();
  }
});

test("PROOF 2b: webhook enqueue is idempotent + does NOT generate inline (stays 'pending')", { skip: !DB }, async () => {
  await cleanup();
  seedRun();
  try {
    const first = await enqueuePaidReport({ sessionId: SESSION, runId: RUN_ID, email: "b@x.com", plan: "full_report", paymentIntent: "pi_1" });
    assert.deepEqual(first, { enqueued: true }, "first enqueue succeeds");

    // Generation did NOT run inline — the row is still pending, report/artifacts unpopulated.
    const row = await getPaidReportBySession(SESSION);
    assert.equal(row?.status, "pending", "status must be 'pending' — generation happens on the worker, not in the webhook");
    assert.equal(row?.report, null, "no report generated inline");

    const jobs1 = await pgQuery("select count(*)::int as n from jobs where idempotency_key = $1", [`paid_report:${SESSION}`]);
    assert.equal((jobs1.rows[0] as { n: number }).n, 1, "exactly one generation job enqueued");

    // A re-sent event → deduped, no second job.
    const second = await enqueuePaidReport({ sessionId: SESSION, runId: RUN_ID, email: "b@x.com", plan: "full_report", paymentIntent: "pi_1" });
    assert.equal(second.enqueued, false, "duplicate event does not re-enqueue");
    assert.equal(second.reason, "duplicate");
    const jobs2 = await pgQuery("select count(*)::int as n from jobs where idempotency_key = $1", [`paid_report:${SESSION}`]);
    assert.equal((jobs2.rows[0] as { n: number }).n, 1, "still exactly one job — no double generation");
  } finally {
    await cleanup();
  }
});
