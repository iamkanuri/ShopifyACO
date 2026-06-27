import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPurgeDue,
  runRetentionPurge,
  PIXEL_RETENTION_DAYS,
  __resetRetentionThrottle,
} from "../src/retention/purge.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---- pure throttle logic ---------------------------------------------------
test("isPurgeDue is true on first run and after the interval, false within it", () => {
  assert.equal(isPurgeDue(0, 1_700_000_000_000), true); // first run: lastAt=0, real clock
  assert.equal(isPurgeDue(1000, 1000 + 1000), false); // 1s later
  assert.equal(isPurgeDue(1000, 1000 + DAY_MS - 1), false); // just under a day
  assert.equal(isPurgeDue(1000, 1000 + DAY_MS), true); // exactly a day
  assert.equal(isPurgeDue(1000, 1000 + 2 * DAY_MS), true); // well past
});

test("PIXEL_RETENTION_DAYS is the documented 90-day window", () => {
  assert.equal(PIXEL_RETENTION_DAYS, 90);
});

// ---- orchestrator throttle (injected purge → no DB needed) -----------------
test("runRetentionPurge runs once, then throttles for 24h, then runs again", async () => {
  __resetRetentionThrottle();
  let calls = 0;
  let lastDays = 0;
  const purge = async (days: number) => {
    calls++;
    lastDays = days;
    return 3;
  };
  const t0 = 1_700_000_000_000;

  const a = await runRetentionPurge({ now: t0, purge });
  assert.equal(a.ran, true);
  assert.equal(a.pixelEventsDeleted, 3);
  assert.equal(lastDays, PIXEL_RETENTION_DAYS); // purges with the retention window

  const b = await runRetentionPurge({ now: t0 + 60_000, purge }); // 1 min later
  assert.equal(b.ran, false);

  const c = await runRetentionPurge({ now: t0 + DAY_MS + 1, purge }); // next day
  assert.equal(c.ran, true);
  assert.equal(calls, 2); // only two actual purges across the three ticks
});

// ---- DB-gated: real delete honors the retention boundary -------------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
test("purgeExpiredPixelEvents deletes rows past the window, keeps recent ones", { skip: !RUN_DB }, async () => {
  const { pgQuery } = await import("../src/db/pg.js");
  const { purgeExpiredPixelEvents } = await import("../src/db/pixel.js");
  const shop = `retention-test-${Date.now()}.myshopify.com`;
  try {
    // One row well past the window (100 days), one fresh.
    await pgQuery(
      `insert into pixel_events (shop_domain, session_id, event_type, consent, created_at, occurred_at)
       values ($1, 'old-sess', 'session_start', true, now() - interval '100 days', now() - interval '100 days')`,
      [shop],
    );
    await pgQuery(
      `insert into pixel_events (shop_domain, session_id, event_type, consent)
       values ($1, 'new-sess', 'session_start', true)`,
      [shop],
    );

    const deleted = await purgeExpiredPixelEvents(90);
    assert.ok(deleted >= 1, "should delete at least the 100-day-old row");

    const { rows } = await pgQuery<{ session_id: string }>(
      `select session_id from pixel_events where shop_domain = $1`,
      [shop],
    );
    const sessions = rows.map((r) => r.session_id);
    assert.ok(!sessions.includes("old-sess"), "old row purged");
    assert.ok(sessions.includes("new-sess"), "fresh row kept");
  } finally {
    await pgQuery(`delete from pixel_events where shop_domain = $1`, [shop]);
  }
});
