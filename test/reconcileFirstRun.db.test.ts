import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";

// ===========================================================================
// FIRST-RUN RECONCILIATION (v2.2 CP6).
//
// The V2 promise is that a merchant who runs a public Buyer Test lands, after
// installing, on THAT test continued — not a cold app. Two paths deliver it:
//
//   1. an exact token, carried through our own OAuth redirect; and
//   2. a HOST MATCH fallback, for the App Store install path, where no token can
//      survive (App Store rule 2.3.1 forbids a shop-domain prompt, so the install
//      begins on a Shopify surface with no state of ours attached).
//
// Path 2 is the one that matters, because path 2 is the only one a real merchant
// takes. It had NO test at all — despite DEPLOY.md describing it as "built and
// unit-safe" — so these are the first. The last test pins the defect the audit
// found: on a genuinely fresh install the fallback cannot fire.
// ===========================================================================

const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

async function seedPublicTest(storeHost: string): Promise<string> {
  const { newTestToken, storePublicTest } = await import("../src/db/buyerTests.js");
  const token = newTestToken();
  await storePublicTest(token, `https://${storeHost}/products/thing`, storeHost, { ok: true, assertions: [] });
  return token;
}

async function cleanup(tokens: string[]): Promise<void> {
  const { pgQuery } = await import("../src/db/pg.js");
  await pgQuery("delete from public_tests where token = any($1::text[])", [tokens]);
}

test("host match claims a public test run against the shop's storefront host", { skip: !RUN_DB }, async () => {
  const { claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const shop = `recon-${Date.now()}.myshopify.com`;
  const storefront = `brand-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(storefront);
  try {
    const claimed = await claimPublicTestByHost(shop, [shop, storefront]);
    assert.ok(claimed, "the merchant's own prior test must be found by its storefront host");
    assert.equal(claimed!.token, token);
    assert.equal(claimed!.shop_domain, shop);
  } finally {
    await cleanup([token]);
  }
});

test("host match ignores `www.` and case — merchants paste either form", { skip: !RUN_DB }, async () => {
  const { claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const shop = `recon-${Date.now()}.myshopify.com`;
  const bare = `brand2-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(`www.${bare.toUpperCase()}`);
  try {
    const claimed = await claimPublicTestByHost(shop, [bare]);
    assert.ok(claimed, "www./case differences must not lose a merchant's test");
  } finally {
    await cleanup([token]);
  }
});

test("host match never re-binds a test another shop already claimed", { skip: !RUN_DB }, async () => {
  const { claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const storefront = `brand3-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(storefront);
  const shopA = `recon-a-${Date.now()}.myshopify.com`;
  const shopB = `recon-b-${Date.now()}.myshopify.com`;
  try {
    assert.ok(await claimPublicTestByHost(shopA, [storefront]), "first shop claims it");
    const second = await claimPublicTestByHost(shopB, [storefront]);
    assert.equal(second, null, "a claimed test must never transfer to another store");
  } finally {
    await cleanup([token]);
  }
});

test("FIXED (v2.3 CP1): a fresh install DOES host-match, from the storefront host persisted at install", { skip: !RUN_DB }, async () => {
  // This was the audit's central first-run finding (FIRST_RUN_AUDIT.md §F1), pinned
  // as a failing-by-design test in v2.2 and fixed here. It now asserts the fix.
  //
  // The defect: `claimTestHandler` built its candidate hosts from
  // `[shop, getStorefrontUrl(shop)]`; `getStorefrontUrl` reads `products.online_url`,
  // and nothing synced a catalog on install — so on a fresh install the only
  // candidate was the `.myshopify.com` domain, while a real merchant had tested
  // their custom domain. The two sets could not intersect on the ONLY install path
  // App Store rule 2.3.1 permits.
  //
  // The fix: resolve `{ shop { myshopifyDomain primaryDomain { host } } }` at install
  // time and persist it on `shops.storefront_host` (migration 0029). This test asserts
  // the CLAIM — a fresh install with an EMPTY catalog reconciles — not the mechanism.
  const { claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const { upsertShop, setStorefrontHost, shopCandidateHosts } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `recon-fresh-${Date.now()}.myshopify.com`;
  const customDomain = `brand4-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(customDomain);
  try {
    // A genuinely fresh install: shop row exists, storefront host resolved from
    // Shopify, and — critically — NO products row, so the catalog cannot help.
    await upsertShop(shop, { status: "active" });
    await setStorefrontHost(shop, customDomain);
    const { rows: catalog } = await pgQuery<{ n: string }>(
      "select count(*)::text as n from products where shop_domain = $1", [shop],
    );
    assert.equal(catalog[0]?.n, "0", "precondition: the catalog is empty, as on a fresh install");

    // The claim: reconciliation succeeds using ONLY what an install can know.
    const hosts = await shopCandidateHosts(shop);
    assert.ok(hosts.includes(customDomain), "the persisted storefront host is a candidate");
    const claimed = await claimPublicTestByHost(shop, hosts);
    assert.ok(claimed, "a fresh install reconciles its public test with an empty catalog");
    assert.equal(claimed!.store_host, customDomain, "and it is the merchant's own test, matched by host");
  } finally {
    await cleanup([token]);
    await pgQuery("delete from shops where shop_domain = $1", [shop]);
  }
});

test("the storefront host is what does the work — without it, a fresh install still cannot match", { skip: !RUN_DB }, async () => {
  // The companion to the test above, and the reason both exist: if reconciliation
  // succeeded for some OTHER reason, the test above would pass while the fix did
  // nothing. This fails if `storefront_host` is not the load-bearing input.
  const { claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const { upsertShop, shopCandidateHosts } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `recon-nohost-${Date.now()}.myshopify.com`;
  const customDomain = `brand6-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(customDomain);
  try {
    await upsertShop(shop, { status: "active" }); // installed, but host never resolved
    const hosts = await shopCandidateHosts(shop);
    assert.deepEqual(hosts, [shop], "with no persisted host the shop knows only its myshopify domain");
    assert.equal(
      await claimPublicTestByHost(shop, hosts), null,
      "and then it cannot match — which is precisely the defect the persisted host removes",
    );
  } finally {
    await cleanup([token]);
    await pgQuery("delete from shops where shop_domain = $1", [shop]);
  }
});

test("hasMatchablePublicTest probes without claiming", { skip: !RUN_DB }, async () => {
  // Install telemetry must not consume the very test the first authenticated screen
  // is about to import — claiming here would make `claimTestHandler` report
  // "nothing to import" and break the landing it exists to guarantee.
  const { hasMatchablePublicTest, claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const shop = `recon-probe-${Date.now()}.myshopify.com`;
  const storefront = `brand5-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(storefront);
  try {
    assert.equal(await hasMatchablePublicTest([storefront]), true);
    assert.equal(await hasMatchablePublicTest([storefront]), true, "probing twice must not consume it");
    assert.ok(await claimPublicTestByHost(shop, [storefront]), "still claimable after probing");
    assert.equal(await hasMatchablePublicTest([storefront]), false, "claimed tests are no longer matchable");
  } finally {
    await cleanup([token]);
  }
});
