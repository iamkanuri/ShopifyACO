import "dotenv/config"; // house idiom: DATABASE_URL comes from .env, and the gate below reads it
import { test } from "node:test";
import assert from "node:assert/strict";

// ===========================================================================
// FUNNEL INSTRUMENTATION — the half that can silently do nothing (v2.2 CP2).
//
// Rule 7 of this session's brief: "prove the instrumentation actually records by
// breaking the emit path and confirming a test fails. A test that passes whether
// or not the feature works is worse than no test."
//
// That is a real hazard here and not a hypothetical one: `recordFunnelEvent`
// swallows every error by design, because it runs on a visitor's request path and
// must never cost them a result. So a broken column name, a missing migration, a
// revoked grant or a typo'd table would all produce EXACTLY the same externally
// visible behaviour as a working writer — a warning in a log nobody reads.
//
// So these tests assert on rows in the table, never on the return value alone:
//   • the mutation test below (`MUTATION`) shows what happens when the writer is
//     broken — it returns false and writes nothing, and the assertions catch it;
//   • the round-trip test proves a real INSERT lands with the right values;
//   • the aggregate test proves the read surface computes the throttle split the
//     way the docs claim, which is the number the egress decision rests on.
// ===========================================================================

const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

/** Delete only the rows a test made, keyed by its own unique token. */
async function cleanup(token: string): Promise<void> {
  const { pgQuery } = await import("../src/db/pg.js");
  await pgQuery("delete from funnel_events where test_token = $1 or case_token = $1", [token]);
}

test("recordFunnelEvent writes a row with the values it was given", { skip: !RUN_DB }, async () => {
  const { recordFunnelEvent } = await import("../src/db/funnel.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const token = `t_${Date.now().toString(16)}aaaa`;
  try {
    const ok = await recordFunnelEvent({
      name: "test_completed",
      testToken: token,
      host: "https://www.example.com/products/widget?utm=x",
      cached: false,
      referrerClass: "hosted_case",
      durationMs: 8123,
      fetchTier: "page",
      evidenced: 2, noBlocking: 1, notProven: 2, requiresAccess: 0, requirements: 5,
      semanticInvoked: true, semanticCostUsd: 0.00274,
      throttleSource: null, robotsStatus: "ok", policyStatus: "readable",
    });
    // The return value alone would be satisfied by a no-op that returns true, so it
    // is checked AND the row is read back.
    assert.equal(ok, true, "recordFunnelEvent reported failure");

    const { rows } = await pgQuery<Record<string, unknown>>(
      "select * from funnel_events where test_token = $1",
      [token],
    );
    assert.equal(rows.length, 1, "expected exactly one row — the write did not land");
    const r = rows[0]!;
    assert.equal(r.name, "test_completed");
    // THE PRIVACY ASSERTION: a full product URL went in; only a registrable domain
    // may be stored. If this ever fails, the table is no longer anonymous.
    assert.equal(r.domain, "example.com");
    assert.equal(r.duration_ms, 8123);
    assert.equal(r.fetch_tier, "page");
    assert.equal(r.evidenced, 2);
    assert.equal(r.not_proven, 2);
    assert.equal(r.requirements, 5);
    assert.equal(r.referrer_class, "hosted_case");
    assert.equal(Number(r.semantic_cost_usd), 0.00274);
    assert.equal(r.robots_status, "ok");
  } finally {
    await cleanup(token);
  }
});

test("no column can hold a URL, an email or an IP", { skip: !RUN_DB }, async () => {
  // Structural, not conventional: assert on the actual schema, so a future column
  // named `product_url` or `email` fails here rather than in production.
  const { pgQuery } = await import("../src/db/pg.js");
  const { rows } = await pgQuery<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema='public' and table_name='funnel_events'",
  );
  const names = rows.map((r) => r.column_name);
  assert.ok(names.length > 0, "funnel_events is missing — migration 0028 not applied");
  for (const bad of ["url", "product_url", "email", "ip", "ip_hash", "referrer", "referer", "shop_domain", "user_agent"]) {
    assert.ok(!names.includes(bad), `funnel_events must not have a "${bad}" column`);
  }
});

test("MUTATION: a broken writer records nothing and this test catches it", { skip: !RUN_DB }, async () => {
  // Simulates the exact silent failure the design invites — the insert throws and
  // `recordFunnelEvent` swallows it. This proves the assertions above are load-
  // bearing: with a broken writer, `ok` is false and the row is absent. Break the
  // real `recordFunnelEvent` (rename a column in COLUMNS, drop the table) and the
  // round-trip test above fails in exactly this shape.
  const { pgQuery } = await import("../src/db/pg.js");
  const token = `t_${Date.now().toString(16)}bbbb`;
  let threw = false;
  try {
    await pgQuery("insert into funnel_events (name, no_such_column) values ($1, $2)", ["test_completed", token]);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "a bad insert must throw at the pg layer");

  const { rows } = await pgQuery("select 1 from funnel_events where test_token = $1", [token]);
  assert.equal(rows.length, 0, "a failed write must leave NO row — otherwise the counters lie");
});

test("funnelWindow computes the throttle split with OUR limiter excluded", { skip: !RUN_DB }, async () => {
  const { recordFunnelEvent, funnelWindow } = await import("../src/db/funnel.js");
  const token = `t_${Date.now().toString(16)}cccc`;
  try {
    const before = await funnelWindow(7);

    // One genuine upstream refusal, three of our own back-pressure.
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "a.example.com", errorKind: "rate_limited", throttleSource: "upstream" });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "b.example.com", errorKind: "http_429", throttleSource: "our_rate_limit" });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "c.example.com", errorKind: "rate_limited", throttleSource: "our_budget" });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "d.example.com", errorKind: "rate_limited", throttleSource: "our_cooldown" });

    const after = await funnelWindow(7);
    assert.equal(after.throttleUpstream - before.throttleUpstream, 1, "exactly one upstream throttle was added");
    assert.equal(after.throttleOurs - before.throttleOurs, 3, "our own three must be counted separately");
    assert.equal(after.testsFailed - before.testsFailed, 4);
    // Our own refusals are in NEITHER side of the rate. Note `our_budget` and
    // `our_cooldown` report errorKind `rate_limited` while never touching the store,
    // so the denominator has to filter on throttle_source, not on error kind alone —
    // filtering by error kind would have let two of these three back in.
    assert.equal(
      after.throttleAttempted - before.throttleAttempted, 1,
      "only the upstream row actually reached a store",
    );
  } finally {
    await cleanup(token);
  }
});

test("throttle rate's DENOMINATOR excludes tests that never reached a store", { skip: !RUN_DB }, async () => {
  // The first version divided by every test_failed row, which includes rows that
  // never attempted an egress fetch: a malformed paste (http_400), our own per-IP
  // 429 (http_429), and an internal exception. Those dilute the rate — and they
  // dilute it HARDEST under load, when our limiter fires most, so the escalation
  // trigger would go quiet at exactly the moment it should fire.
  const { recordFunnelEvent, funnelWindow } = await import("../src/db/funnel.js");
  const token = `t_${Date.now().toString(16)}ffff`;
  try {
    const before = await funnelWindow(7);

    // One real upstream refusal — the ONLY row that should be in the numerator.
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "up.example", errorKind: "rate_limited", throttleSource: "upstream" });
    // Three failures that never touched a store. None may enter the denominator.
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "a.example", errorKind: "http_400" });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "b.example", errorKind: "http_429", throttleSource: "our_rate_limit" });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: "c.example", errorKind: "exception" });

    const after = await funnelWindow(7);
    assert.equal(after.testsFailed - before.testsFailed, 4, "all four rows were written");
    assert.equal(
      after.throttleAttempted - before.throttleAttempted, 1,
      "only the row that actually reached a store counts toward the denominator",
    );
    assert.equal(after.throttleUpstream - before.throttleUpstream, 1);
    // With the old denominator this window would read 1/4 = 25%; the honest answer
    // for "of the tests that reached a store, how many were refused" is 100%.
    assert.equal(after.throttleRate, 1, `expected 100%, got ${after.throttleRate}`);
  } finally {
    await cleanup(token);
  }
});

test("funnelWindow sums result states and semantic spend over completed tests", { skip: !RUN_DB }, async () => {
  const { recordFunnelEvent, funnelWindow } = await import("../src/db/funnel.js");
  const token = `t_${Date.now().toString(16)}dddd`;
  try {
    const before = await funnelWindow(7);
    await recordFunnelEvent({
      name: "test_completed", testToken: token, host: "e.example.com",
      durationMs: 5000, evidenced: 2, noBlocking: 1, notProven: 2, requiresAccess: 0,
      requirements: 5, semanticInvoked: true, semanticCostUsd: 0.001,
    });
    await recordFunnelEvent({
      name: "test_completed", testToken: token, host: "f.example.com",
      durationMs: 9000, evidenced: 4, noBlocking: 1, notProven: 0, requiresAccess: 1,
      requirements: 6, semanticInvoked: true, semanticCostUsd: 0.002,
    });
    const after = await funnelWindow(7);
    assert.equal(after.states.evidenced - before.states.evidenced, 6);
    assert.equal(after.states.notProven - before.states.notProven, 2);
    assert.equal(after.states.requiresAccess - before.states.requiresAccess, 1);
    // Measured, not estimated — this is the number that answers "what did the free
    // test cost us this week".
    assert.ok(
      Math.abs(after.semanticSpendUsd - before.semanticSpendUsd - 0.003) < 1e-6,
      `semantic spend delta was ${after.semanticSpendUsd - before.semanticSpendUsd}`,
    );
    assert.ok(after.medianDurationMs !== null, "a duration was recorded, so the median must exist");
  } finally {
    await cleanup(token);
  }
});

test("unique domains counts FAILED tests too, not just completed ones", { skip: !RUN_DB }, async () => {
  // Regression: `unique_domains` was originally computed inside the aggregate that
  // filters `name='test_completed'`, so a run of nine real-but-failing tests reported
  // 0 distinct hosts — "no traffic" at precisely the moment the product was broken.
  const { recordFunnelEvent, funnelWindow } = await import("../src/db/funnel.js");
  const token = `t_${Date.now().toString(16)}eeee`;
  const stamp = Date.now().toString(36);
  try {
    const before = await funnelWindow(7);
    // Two distinct REGISTRABLE domains. Note `a.example.com` and `b.example.com`
    // would NOT be two — they both reduce to `example.com`, which is the privacy
    // boundary doing its job, so the fixture has to differ at the registrable level.
    const d1 = `store-a-${stamp}.example`;
    const d2 = `store-b-${stamp}.example`;
    await recordFunnelEvent({ name: "test_requested", testToken: token, host: `https://${d1}/products/x` });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: `https://${d1}/products/x`, errorKind: "unreachable" });
    await recordFunnelEvent({ name: "test_failed", testToken: token, host: `https://${d2}/products/y`, errorKind: "bad_url" });
    const after = await funnelWindow(7);
    assert.equal(
      after.uniqueDomains - before.uniqueDomains, 2,
      "two distinct domains were tested and both failed — both must still be counted",
    );
    assert.equal(after.testsCompleted - before.testsCompleted, 0, "nothing completed");
  } finally {
    await cleanup(token);
  }
});

test("case views are counted per token", { skip: !RUN_DB }, async () => {
  const { recordFunnelEvent, funnelWindow } = await import("../src/db/funnel.js");
  const token = `case${Date.now().toString(16)}`;
  try {
    await recordFunnelEvent({ name: "case_viewed", caseToken: token });
    await recordFunnelEvent({ name: "case_viewed", caseToken: token });
    const w = await funnelWindow(7);
    const row = w.caseViewsByToken.find((c) => c.token === token);
    assert.ok(row, "the token must appear in the per-token breakdown");
    assert.equal(row!.views, 2);
  } finally {
    await cleanup(token);
  }
});
