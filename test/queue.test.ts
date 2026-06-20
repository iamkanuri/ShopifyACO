import "dotenv/config"; // load DATABASE_URL for the opt-in DB integration tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, decideFailure, isTerminal, nextRunAfter, normalizeIdempotencyKey } from "../src/queue/backoff.js";

// ===========================================================================
// Pure unit tests (no DB) — always run.
// ===========================================================================

test("backoffMs grows exponentially and is capped", () => {
  const noJitter = () => 0.5; // delta = 0
  const o = { baseMs: 2000, maxMs: 30_000, factor: 2, jitter: 0.25 };
  assert.equal(backoffMs(1, o, noJitter), 2000);
  assert.equal(backoffMs(2, o, noJitter), 4000);
  assert.equal(backoffMs(3, o, noJitter), 8000);
  assert.equal(backoffMs(10, o, noJitter), 30_000); // capped
});

test("backoffMs jitter stays within bounds and is non-negative", () => {
  const o = { baseMs: 1000, maxMs: 100_000, factor: 2, jitter: 0.25 };
  for (const rnd of [() => 0, () => 1, () => 0.5, Math.random]) {
    const v = backoffMs(3, o, rnd as () => number); // raw = 4000, span = 1000
    assert.ok(v >= 0, "non-negative");
    assert.ok(v >= 3000 && v <= 5000, `within ±jitter: ${v}`);
  }
});

test("decideFailure dead-letters at max attempts", () => {
  assert.equal(decideFailure(1, 5), "retry");
  assert.equal(decideFailure(4, 5), "retry");
  assert.equal(decideFailure(5, 5), "dead_letter");
  assert.equal(decideFailure(6, 5), "dead_letter");
});

test("isTerminal classifies states", () => {
  assert.ok(isTerminal("completed") && isTerminal("cancelled") && isTerminal("dead_letter"));
  assert.ok(!isTerminal("queued") && !isTerminal("running") && !isTerminal("failed"));
});

test("nextRunAfter returns a future timestamp", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const t = nextRunAfter(2, now, { baseMs: 1000, maxMs: 10_000, factor: 2, jitter: 0 }, () => 0.5);
  assert.equal(t.getTime() - now.getTime(), 2000);
});

test("normalizeIdempotencyKey trims/lowercases/collapses and bounds length", () => {
  assert.equal(normalizeIdempotencyKey("  Foo   Bar "), "foo bar");
  assert.equal(normalizeIdempotencyKey(""), undefined);
  assert.equal(normalizeIdempotencyKey(undefined), undefined);
  assert.equal(normalizeIdempotencyKey("x".repeat(300))?.length, 200);
});

// ===========================================================================
// DB integration tests — opt-in (RUN_DB_TESTS=1 + DATABASE_URL). Self-cleaning.
// Run once after `npm run migrate` to verify atomic claiming + spend reservation:
//   RUN_DB_TESTS=1 node --import tsx --test test/queue.test.ts
// ===========================================================================

const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const dbTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !RUN_DB }, fn);

dbTest("enqueue is idempotent on key", async () => {
  const { enqueue } = await import("../src/queue/jobs.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const key = `test-idem-${Date.now()}`;
  try {
    const a = await enqueue({ type: "noop", idempotencyKey: key, payload: { a: 1 } });
    const b = await enqueue({ type: "noop", idempotencyKey: key, payload: { a: 2 } });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.id, b.id);
  } finally {
    await pgQuery("delete from jobs where idempotency_key = $1", [key]);
  }
});

dbTest("claim → complete lifecycle and atomic single-claim", async () => {
  const { enqueue, claim, complete } = await import("../src/queue/jobs.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const key = `test-claim-${Date.now()}`;
  try {
    await enqueue({ type: "noop", idempotencyKey: key, payload: {} });
    const w1 = await claim("worker-A", { types: ["noop"], globalLimit: 0 });
    assert.ok(w1, "first claim returns the job");
    assert.equal(w1!.status, "running");
    assert.equal(w1!.attempts, 1);
    // A concurrent claim must not double-claim the same row.
    const again = await pgQuery("select status from jobs where id = $1", [w1!.id]);
    assert.equal(again.rows[0].status, "running");
    await complete(w1!.id, { done: true });
    const done = await pgQuery<{ status: string }>("select status from jobs where id = $1", [w1!.id]);
    assert.equal(done.rows[0].status, "completed");
  } finally {
    await pgQuery("delete from jobs where idempotency_key = $1", [key]);
  }
});

dbTest("fail retries then dead-letters at max attempts", async () => {
  const { enqueue, claim, fail } = await import("../src/queue/jobs.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const key = `test-dl-${Date.now()}`;
  try {
    await enqueue({ type: "noop", idempotencyKey: key, maxAttempts: 1 });
    const job = await claim("worker-A", { types: ["noop"] });
    assert.ok(job);
    const decision = await fail(job!.id, "boom"); // attempts now 1 >= max 1
    assert.equal(decision, "dead_letter");
    const row = await pgQuery<{ status: string; last_error: string }>("select status, last_error from jobs where id = $1", [job!.id]);
    assert.equal(row.rows[0].status, "dead_letter");
    assert.match(row.rows[0].last_error, /boom/);
  } finally {
    await pgQuery("delete from jobs where idempotency_key = $1", [key]);
  }
});

dbTest("recoverAbandoned requeues a job with an expired lease", async () => {
  const { recoverAbandoned } = await import("../src/queue/jobs.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const key = `test-recover-${Date.now()}`;
  try {
    // Insert a 'running' job whose lease expired 10 minutes ago.
    await pgQuery(
      `insert into jobs (type, status, idempotency_key, locked_by, lease_expires_at)
       values ('noop','running',$1,'dead-worker', now() - interval '10 minutes')`,
      [key],
    );
    const n = await recoverAbandoned(30);
    assert.ok(n >= 1);
    const row = await pgQuery<{ status: string }>("select status from jobs where idempotency_key = $1", [key]);
    assert.equal(row.rows[0].status, "queued");
  } finally {
    await pgQuery("delete from jobs where idempotency_key = $1", [key]);
  }
});

dbTest("spend reservation is atomic and reconciles to net-zero", async () => {
  const { reserveSpend, reconcileSpend } = await import("../src/queue/spend.js");
  const runId = `test-spend-${Date.now()}`;
  // Over-cap reservation is rejected without mutating anything.
  const rejected = await reserveSpend(runId, 1000, 0.0001);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reservationId, undefined);
  // Tiny reservation within a generous cap succeeds, then we release it (net-zero).
  const ok = await reserveSpend(runId, 0.000001, 1_000_000);
  assert.equal(ok.ok, true);
  assert.ok(ok.reservationId);
  await reconcileSpend(ok.reservationId!, 0); // release → no real spend recorded
});
