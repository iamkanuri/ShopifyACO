import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { storefrontHostIsStale, STOREFRONT_HOST_TTL_MS } from "../src/db/shops.js";

// ===========================================================================
// STOREFRONT HOST FRESHNESS + THE RECONCILIATION ASSERTION (v2.6 CP1).
//
// Migration 0029 resolved `shops.storefront_host` in exactly one place — install —
// and shipped no refresh and no backfill. Both consequences were then observed on
// REAL rows in production, which is why these tests exist and what they encode:
//
//   • a shop installed before 0029 held NULL, and a `shop/update` webhook arrived
//     for it and did not populate the column;
//   • the dev store held a STALE value — its myshopify domain, captured before its
//     custom domain was connected and made primary.
//
// The last test is the one the entire install-loop fix was written for: that a
// public test recorded against a merchant's CUSTOM domain is matched, while one
// recorded against the myshopify domain of a DIFFERENT shop is not. It had never
// been exercised, because until the dev store's custom domain existed the two
// strings were identical and the assertion was vacuous.
// ===========================================================================

const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

// ---- the freshness policy (pure) -------------------------------------------

test("a host that was never confirmed is stale — this is what makes pre-0030 rows self-heal", () => {
  assert.equal(storefrontHostIsStale({ storefront_host_checked_at: null }), true);
  // Every row written before migration 0030 has a NULL stamp, so the backfill is
  // the policy itself rather than a script somebody has to remember to run.
});

test("a recently confirmed host is not stale; an old one is", () => {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  assert.equal(storefrontHostIsStale({ storefront_host_checked_at: iso(now - 1000) }, now), false);
  assert.equal(storefrontHostIsStale({ storefront_host_checked_at: iso(now - STOREFRONT_HOST_TTL_MS - 1) }, now), true);
});

test("an unparseable stamp is treated as stale, not as fresh", () => {
  // Fail toward re-checking. Treating garbage as a confirmation would pin a wrong
  // host for a week, and a wrong host is what breaks reconciliation silently.
  assert.equal(storefrontHostIsStale({ storefront_host_checked_at: "not-a-date" }), true);
});

// ---- the DB-backed behaviour ------------------------------------------------

test("setStorefrontHost stamps the confirmation time", { skip: !RUN_DB }, async () => {
  const { upsertShop, setStorefrontHost, getShop } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `sfh-${Date.now()}.myshopify.com`;
  try {
    await upsertShop(shop, {});
    const before = await getShop(shop);
    assert.equal(before?.storefront_host_checked_at, null, "a fresh row has never been confirmed");
    assert.equal(storefrontHostIsStale(before!), true);

    await setStorefrontHost(shop, "https://Brand.Example.COM/collections/all");
    const after = await getShop(shop);
    assert.equal(after?.storefront_host, "brand.example.com", "stored lowercase and host-only");
    assert.ok(after?.storefront_host_checked_at, "the confirmation time is stamped");
    assert.equal(storefrontHostIsStale(after!), false);
  } finally {
    await pgQuery("delete from shops where shop_domain = $1", [shop]);
  }
});

test("a blank resolve neither erases the host nor counts as a confirmation", { skip: !RUN_DB }, async () => {
  const { upsertShop, setStorefrontHost, getShop } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `sfh-blank-${Date.now()}.myshopify.com`;
  try {
    await upsertShop(shop, {});
    await setStorefrontHost(shop, "brand.example.com");
    const confirmed = await getShop(shop);
    await pgQuery("update shops set storefront_host_checked_at = now() - interval '30 days' where shop_domain = $1", [shop]);

    await setStorefrontHost(shop, null); // a failed lookup
    const after = await getShop(shop);
    assert.equal(after?.storefront_host, "brand.example.com", "a failed lookup must not erase a known host");
    assert.equal(storefrontHostIsStale(after!), true,
      "and must not look like a confirmation, or a failing shop goes quiet for a week holding an unchecked value");
    assert.ok(confirmed);
  } finally {
    await pgQuery("delete from shops where shop_domain = $1", [shop]);
  }
});

test("the refresh sweep selects never-confirmed and expired rows, and skips fresh ones", { skip: !RUN_DB }, async () => {
  const { upsertShop, setStorefrontHost, shopsNeedingHostRefresh } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const stamp = Date.now();
  const never = `sfh-never-${stamp}.myshopify.com`;
  const expired = `sfh-expired-${stamp}.myshopify.com`;
  const fresh = `sfh-fresh-${stamp}.myshopify.com`;
  const gone = `sfh-gone-${stamp}.myshopify.com`;
  try {
    for (const s of [never, expired, fresh, gone]) await upsertShop(s, {});
    await setStorefrontHost(expired, "expired.example.com");
    await pgQuery("update shops set storefront_host_checked_at = now() - interval '30 days' where shop_domain = $1", [expired]);
    await setStorefrontHost(fresh, "fresh.example.com");
    await setStorefrontHost(gone, "gone.example.com");
    await pgQuery("update shops set status = 'uninstalled', storefront_host_checked_at = null where shop_domain = $1", [gone]);

    const due = await shopsNeedingHostRefresh(500);
    assert.ok(due.includes(never), "a never-confirmed shop is due");
    assert.ok(due.includes(expired), "an expired shop is due");
    assert.ok(!due.includes(fresh), "a freshly confirmed shop is not re-asked");
    assert.ok(!due.includes(gone), "an uninstalled shop is never asked — we have no token for it");
  } finally {
    await pgQuery("delete from shops where shop_domain = any($1::text[])", [[never, expired, fresh, gone]]);
  }
});

// ---- THE ASSERTION THE INSTALL-LOOP FIX WAS WRITTEN FOR ---------------------

test("reconciliation matches a test run against the CUSTOM domain, not the myshopify one", { skip: !RUN_DB }, async () => {
  const { upsertShop, setStorefrontHost, shopCandidateHosts } = await import("../src/db/shops.js");
  const { newTestToken, storePublicTest, claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const { pgQuery } = await import("../src/db/pg.js");

  // The real shape, with the two strings GENUINELY different — which is the whole
  // point, and was not true of any prior fixture. Mirrors the dev store: a
  // myshopify domain plus a separately-connected primary custom domain.
  const stamp = Date.now().toString(36);
  const shop = `ai-visibility-${stamp}.myshopify.com`;
  const custom = `devstore-${stamp}.example.com`;
  const otherShop = `other-${stamp}.myshopify.com`;

  const mine = newTestToken();
  const theirs = newTestToken();
  try {
    await upsertShop(shop, {});
    await setStorefrontHost(shop, custom);

    // The merchant ran their public test against their CUSTOM domain — which is what
    // a merchant actually pastes, and is the case that could never match before.
    await storePublicTest(mine, `https://${custom}/products/thing`, custom, { ok: true, assertions: [] });
    // A different shop's test, recorded against ITS myshopify domain.
    await storePublicTest(theirs, `https://${otherShop}/products/thing`, otherShop, { ok: true, assertions: [] });

    const hosts = await shopCandidateHosts(shop);
    assert.deepEqual(hosts.sort(), [custom, shop].sort(),
      "candidates must carry BOTH the myshopify domain and the resolved custom domain");
    assert.notEqual(custom, shop, "the fixture is only meaningful when the two hosts differ");

    const claimed = await claimPublicTestByHost(shop, hosts);
    assert.ok(claimed, "the merchant's own test, run against their custom domain, must be found");
    assert.equal(claimed!.token, mine);
    assert.equal(claimed!.shop_domain, shop);

    // And it must not have swept up somebody else's.
    const { rows } = await pgQuery<{ shop_domain: string | null }>(
      "select shop_domain from public_tests where token = $1", [theirs],
    );
    assert.equal(rows[0]?.shop_domain, null, "another shop's test must never be claimed by this one");
  } finally {
    await pgQuery("delete from public_tests where token = any($1::text[])", [[mine, theirs]]);
    await pgQuery("delete from shops where shop_domain = $1", [shop]);
  }
});

test("a STALE host is why reconciliation would silently match nothing", { skip: !RUN_DB }, async () => {
  // The dev store's exact production state before this session: storefront_host held
  // the myshopify domain, captured before the custom domain existed. The merchant's
  // test was run against the custom domain, so the candidate sets could not intersect.
  const { upsertShop, setStorefrontHost, shopCandidateHosts } = await import("../src/db/shops.js");
  const { newTestToken, storePublicTest, claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const stamp = Date.now().toString(36);
  const shop = `stale-${stamp}.myshopify.com`;
  const custom = `stalecustom-${stamp}.example.com`;
  const token = newTestToken();
  try {
    await upsertShop(shop, {});
    await setStorefrontHost(shop, shop); // STALE: the myshopify domain
    await storePublicTest(token, `https://${custom}/products/thing`, custom, { ok: true, assertions: [] });

    const stale = await claimPublicTestByHost(shop, await shopCandidateHosts(shop));
    assert.equal(stale, null, "with a stale host the merchant's own test is invisible — the defect, pinned");

    // After a refresh resolves the real primary domain, the same call finds it.
    await setStorefrontHost(shop, custom);
    const fixed = await claimPublicTestByHost(shop, await shopCandidateHosts(shop));
    assert.ok(fixed, "once the host is re-confirmed the merchant's test is found");
    assert.equal(fixed!.token, token);
  } finally {
    await pgQuery("delete from public_tests where token = $1", [token]);
    await pgQuery("delete from shops where shop_domain = $1", [shop]);
  }
});
