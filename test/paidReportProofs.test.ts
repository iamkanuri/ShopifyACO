import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { constructEvent } from "../src/server/stripe.js";
import { processAutoRefund } from "../src/paid/refund.js";
import { paidJobKey } from "../src/paid/jobKey.js";

// ===========================================================================
// Paid-report Phase 2 — the CAN'T-UNDO-IN-PROD proofs (webhook + refund). These
// must hold before anything goes live: they look fine in a happy-path demo and
// break in prod.
// ===========================================================================

const SECRET = "whsec_test_secret";
function sign(body: string, secret = SECRET, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

// ---- PROOF 1: signature verification REJECTS unsigned/forged events ---------
test("PROOF 1: webhook signature rejects missing/forged/tampered events, accepts a valid one", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } });
  const buf = Buffer.from(body);

  assert.equal(constructEvent(buf, undefined, SECRET).ok, false, "missing signature must be rejected");
  assert.equal(constructEvent(buf, "garbage", SECRET).ok, false, "malformed signature must be rejected");
  assert.equal(constructEvent(buf, sign(body, "wrong_secret"), SECRET).ok, false, "forged (wrong secret) must be rejected");
  // Tampered body: signature was computed over a different payload.
  assert.equal(constructEvent(Buffer.from(body + "x"), sign(body), SECRET).ok, false, "tampered body must be rejected");

  const good = constructEvent(buf, sign(body), SECRET);
  assert.equal(good.ok, true, "a correctly-signed event is accepted");
});

// ---- PROOF 3: the webhook CANNOT block on generation (returns 200 immediately)
// Structural: the webhook path only ENQUEUES; generation is a worker-only queue handler. If the
// webhook can't reach the generator, it can't await it → no slow response → no Stripe retry/double-fire.
test("PROOF 3: the webhook path never imports the generator (generation is worker-only)", () => {
  const stripeSrc = readFileSync("src/server/stripe.ts", "utf8");
  const enqueueSrc = readFileSync("src/paid/enqueue.ts", "utf8");
  const workerSrc = readFileSync("src/worker.ts", "utf8");

  for (const [name, src] of [["stripe.ts", stripeSrc], ["enqueue.ts", enqueueSrc]] as const) {
    assert.ok(!/paid\/generate|generatePaidReport/.test(src), `${name} must not reach the generator (would let the webhook block)`);
  }
  // The generator only runs via the worker's registered handler.
  assert.match(workerSrc, /registerPaidReportJobs\(\)/, "worker must register the paid_report_generate handler");
});

// ---- PROOF 2 (mechanism, in-code): dedup is enforced two ways ---------------
// The live-DB round-trip is in test/paidReport.db.test.ts (RUN_DB_TESTS=1). Here we prove the
// MECHANISM exists so it can't be silently removed: a unique session_id + on-conflict-do-nothing,
// plus the job's idempotency key.
test("PROOF 2 (mechanism): session_id is unique + creation/enqueue are on-conflict idempotent", () => {
  const migration = readFileSync("migrations/0023_paid_reports.sql", "utf8");
  assert.match(migration, /session_id\s+text\s+unique\s+not\s+null/i, "session_id must be UNIQUE (blocks a duplicate report)");

  const dao = readFileSync("src/db/paidReports.ts", "utf8");
  assert.match(dao, /on conflict \(session_id\) do nothing/i, "createPendingPaidReport must be on-conflict idempotent");

  const enqueue = readFileSync("src/paid/enqueue.ts", "utf8");
  assert.match(enqueue, /if \(!created\) return \{ enqueued: false, reason: "duplicate" \}/, "a duplicate must NOT re-enqueue");
  // The job's idempotency key goes through the shared paidJobKey helper so it can't drift from the
  // reconciliation join (a drift would silently break dead-letter→held detection → stranded payments).
  assert.match(enqueue, /idempotencyKey: paidJobKey\(input\.sessionId\)/, "the job key uses the shared paidJobKey helper");
  assert.equal(paidJobKey("cs_x"), "paid_report:cs_x", "paidJobKey pins the exact key format the reconcile sweep joins on");
});

// ---- PROOF 4: a FAILED refund alerts loudly + independently ------------------
test("PROOF 4: refund failure alerts loudly for manual action (alert never depends on refund success)", async () => {
  const row = { session_id: "cs_1", run_id: "r1", stripe_payment_intent: "pi_1", email: "b@x.com" };

  // (a) refund returns ok:false → LOUD manual-action alert, NO refunded mark.
  {
    const alerts: string[] = [];
    let markedRefunded = false;
    const out = await processAutoRefund(row, {
      refund: async () => ({ ok: false, error: "Stripe HTTP 401 bad key" }),
      alert: async (subject) => { alerts.push(subject); },
      markRefunded: async () => { markedRefunded = true; },
    });
    assert.equal(out.refunded, false);
    assert.equal(markedRefunded, false, "must NOT mark refunded when the refund didn't fire");
    assert.ok(alerts.some((s) => /REFUND FAILED/.test(s)), "must alert loudly for manual action");
  }

  // (b) the refund MECHANISM itself throws (API down) → still alerts, doesn't crash.
  {
    const alerts: string[] = [];
    const out = await processAutoRefund(row, {
      refund: async () => { throw new Error("network down"); },
      alert: async (subject, body) => { alerts.push(subject + " :: " + body); },
      markRefunded: async () => {},
    });
    assert.equal(out.refunded, false);
    assert.ok(alerts.some((s) => /REFUND FAILED/.test(s) && /network down/.test(s)), "alert fires even when the refund mechanism breaks");
  }

  // (c) refund succeeds → marked refunded + informational alert.
  {
    const alerts: string[] = [];
    let markedRefunded = false;
    const out = await processAutoRefund(row, {
      refund: async () => ({ ok: true, refundId: "re_1" }),
      alert: async (subject) => { alerts.push(subject); },
      markRefunded: async () => { markedRefunded = true; },
    });
    assert.equal(out.refunded, true);
    assert.ok(markedRefunded, "successful refund is recorded");
    assert.ok(alerts.some((s) => /auto-refunded/.test(s)));
  }
});
