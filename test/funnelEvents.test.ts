import { test } from "node:test";
import assert from "node:assert/strict";
import { toDomain, classifyReferrer } from "../src/db/funnel.js";
import { renderFunnel } from "../src/server/funnelAdmin.js";
import type { FunnelWindow } from "../src/db/funnel.js";

// ===========================================================================
// FUNNEL INSTRUMENTATION (v2.2 CP2).
//
// The pure half: the privacy boundary and the rendering. The DB half — which is
// where "does it actually record" is answered, and where the mutation test
// lives — is in test/funnelRecord.db.test.ts.
// ===========================================================================

// ---- the privacy boundary --------------------------------------------------
// This is the whole no-PII guarantee. If a full URL can survive `toDomain`, the
// table stops being anonymous, so these cases are the contract.

test("toDomain reduces a product URL to its registrable domain — the path never survives", () => {
  assert.equal(toDomain("https://shop.example.com/products/blue-widget?utm_source=x"), "example.com");
  assert.equal(toDomain("https://www.example.com/products/thing"), "example.com");
  assert.equal(toDomain("example.com"), "example.com");
  assert.equal(toDomain("https://example.co.uk/products/x"), "example.co.uk");
});

test("toDomain never returns anything containing a path, query, port or scheme", () => {
  const inputs = [
    "https://store.example.com:8443/products/secret-thing?email=a@b.com",
    "http://example.org/collections/private/products/x#frag",
    "https://sub.deep.example.net/products/y?token=abc123",
  ];
  for (const i of inputs) {
    const d = toDomain(i);
    assert.ok(d, `expected a domain for ${i}`);
    for (const forbidden of ["/", "?", "#", ":", "@"]) {
      assert.ok(!d!.includes(forbidden), `"${d}" leaked "${forbidden}" from ${i}`);
    }
  }
});

test("toDomain rejects IP literals — the table's no-IP guarantee must be literally true", () => {
  // `registrableDomain` passes bare IPs through on purpose (for citation analysis,
  // merging distinct IPs would be wrong). Here that would put an IP in the `domain`
  // column while migration 0028 states no column can hold one. Found by an
  // adversarial review of this exact claim.
  for (const ip of [
    "http://198.51.100.23/products/tee",
    "203.0.113.45:9292",
    "192.0.2.14",
    "http://192.0.2.14:9292/products/tee",
    "http://[2001:db8:85a3::8a2e:370:7334]/x",
    "[::ffff:198.51.100.23]",
  ]) {
    assert.equal(toDomain(ip), null, `an IP literal must not be stored: ${ip}`);
  }
});

test("toDomain bounds what can be stored — an unbounded host is not a domain", () => {
  // `test_requested` is emitted BEFORE the route's 400-char URL check (deliberately —
  // the denominator should count real arrivals). That meant an unbounded value reached
  // an unbounded `text` column: a 200 kB host, well under the 256 kB body cap, was
  // stored verbatim, twice per request, at 120 req/min/IP, in a table with no
  // retention job. Node's URL parser does not enforce DNS length limits, so this is
  // the only place that can.
  assert.equal(toDomain("https://" + "x".repeat(200_000) + ".com/products/y"), null);
  assert.equal(toDomain("https://" + "x".repeat(64) + ".com"), null, "a label over 63 chars cannot resolve");
  assert.equal(toDomain("https://" + "a".repeat(60) + ".com"), (("a".repeat(60)) + ".com"), "a legal long label still works");
});

test("toDomain drops the myshopify.com bucket rather than fake a unique host", () => {
  // Every *.myshopify.com store reduces to the same bare suffix, so counting it
  // inflates uniqueDomains with one meaningless bucket. Keeping the un-reduced form
  // is not an option — that IS a shop domain, which this table must never hold.
  assert.equal(toDomain("https://coolbrand.myshopify.com/products/x"), null);
  assert.equal(toDomain("https://otherbrand.myshopify.com/products/y"), null);
});

test("toDomain returns null rather than inventing a domain for junk input", () => {
  assert.equal(toDomain(""), null);
  assert.equal(toDomain(null), null);
  assert.equal(toDomain(undefined), null);
  assert.equal(toDomain("not a url at all"), null);
  // A scheme we would never fetch must not be normalised into a stored value.
  assert.equal(toDomain("mailto:someone@example.com"), null);
  assert.equal(toDomain("javascript:alert(1)"), null);
});

// ---- referrer classification (the header itself is never stored) ------------

test("classifyReferrer: absent referrer is direct, our own /c/:token is hosted_case", () => {
  assert.equal(classifyReferrer(null, "lens.example.com"), "direct");
  assert.equal(classifyReferrer("", "lens.example.com"), "direct");
  assert.equal(classifyReferrer("https://lens.example.com/c/abc123XYZ", "lens.example.com"), "hosted_case");
  assert.equal(classifyReferrer("https://lens.example.com/c/abc123XYZ/", "lens.example.com"), "hosted_case");
});

test("classifyReferrer: a /c/ path on SOMEONE ELSE'S host is not our hosted case", () => {
  // Otherwise anyone could mint fake outreach attribution by linking from
  // https://evil.example/c/xyz — the class would stop meaning anything.
  assert.equal(classifyReferrer("https://evil.example/c/abc123", "lens.example.com"), "other");
  assert.equal(classifyReferrer("https://lens.example.com/index", "lens.example.com"), "other");
  assert.equal(classifyReferrer("https://google.com/search?q=x", "lens.example.com"), "other");
  assert.equal(classifyReferrer("not-a-url", "lens.example.com"), "other");
});

test("classifyReferrer collapses everything else to 'other' — no referrer is ever echoed back", () => {
  const sensitive = "https://mail.example.com/inbox/message/12345?user=someone%40example.com";
  const cls = classifyReferrer(sensitive, "lens.example.com");
  assert.equal(cls, "other");
  // The classification is the only thing that leaves this function.
  assert.ok(!String(cls).includes("example"));
});

// ---- the read surface ------------------------------------------------------

const emptyWindow = (days: number): FunnelWindow => ({
  days,
  testsRequested: 0, testsCompleted: 0, testsFailed: 0, uniqueDomains: 0,
  throttleRate: null, throttleAttempted: 0, throttleUpstream: 0, throttleOurs: 0,
  medianDurationMs: null, p95DurationMs: null,
  states: { evidenced: 0, noBlocking: 0, notProven: 0, requiresAccess: 0 },
  actionableRate: null,
  installClicks: 0, installCompleted: 0, installsReconciled: 0,
  installClickRate: null, installCompletionRate: null,
  caseViews: 0, caseViewsByToken: [],
  semanticSpendUsd: 0, errorsByKind: [],
});

test("renderFunnel shows an em-dash for an undefined rate, never 0% — no data is not zero", () => {
  const out = renderFunnel([emptyWindow(7)]);
  assert.match(out, /throttle rate\s+—/);
  assert.doesNotMatch(out, /throttle rate\s+0\.0%/);
});

test("renderFunnel reports OUR throttles separately and shows the rate's denominator", () => {
  const w = emptyWindow(7);
  w.testsCompleted = 8;
  w.testsFailed = 2;
  w.throttleUpstream = 1;
  w.throttleOurs = 5;
  w.throttleAttempted = 5; // only 5 of the 10 rows actually reached a store
  w.throttleRate = 1 / 5;
  const out = renderFunnel([w]);
  assert.match(out, /throttle rate\s+ 20\.0%/);
  // The two numbers that would be WRONG: 1/10 (denominator diluted by rows that
  // never attempted a fetch) and 6/10 (our own back-pressure counted as upstream).
  assert.doesNotMatch(out, /10\.0%/);
  assert.doesNotMatch(out, /60\.0%/);
  // A rate is never shown without its n.
  assert.match(out, /upstream 1 of 5 that reached a store/);
  assert.match(out, /our own throttles\s+5/);
  assert.match(out, /excluded from BOTH sides/);
});

test("renderFunnel renders both windows and every case token", () => {
  const w7 = emptyWindow(7);
  w7.caseViews = 3;
  w7.caseViewsByToken = [{ token: "abc123", views: 2 }, { token: "def456", views: 1 }];
  const out = renderFunnel([w7, emptyWindow(30)]);
  assert.match(out, /LAST 7 DAYS/);
  assert.match(out, /LAST 30 DAYS/);
  assert.match(out, /abc123\s+2/);
  assert.match(out, /def456\s+1/);
});

test("renderFunnel labels the sample honestly rather than implying precision", () => {
  const out = renderFunnel([emptyWindow(7)]);
  assert.match(out, /direction, not precision/);
});
