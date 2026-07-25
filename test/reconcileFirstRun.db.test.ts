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

test("DEFECT (v2.2 CP6): a fresh install cannot host-match, because it knows no storefront host", { skip: !RUN_DB }, async () => {
  // This is the audit's central first-run finding, pinned so it cannot regress
  // quietly and so the fix has an executable definition of done.
  //
  // `claimTestHandler` builds its candidate hosts from `[shop, getStorefrontUrl(shop)]`.
  // `getStorefrontUrl` reads `products.online_url` — and NOTHING enqueues a catalog
  // sync on install, so on a fresh install the products table is empty and it returns
  // null. The only candidate left is the `.myshopify.com` domain.
  //
  // But a merchant tests their REAL storefront ("theirbrand.com"), so `store_host` is
  // the custom domain and never the `.myshopify.com` one. The fallback therefore has
  // nothing to match on at exactly the moment it is needed — the App Store install,
  // which is the only install path a real merchant takes.
  const { claimPublicTestByHost } = await import("../src/db/buyerTests.js");
  const shop = `recon-fresh-${Date.now()}.myshopify.com`;
  const customDomain = `brand4-${Date.now().toString(36)}.example`;
  const token = await seedPublicTest(customDomain);
  try {
    // What a fresh install can actually offer: its own .myshopify.com domain.
    const freshInstall = await claimPublicTestByHost(shop, [shop]);
    assert.equal(
      freshInstall, null,
      "records the CURRENT behaviour: with an empty catalog there is nothing to match on",
    );
    // …and the same call succeeds the moment the storefront host is known, which is
    // exactly what the fix has to supply (resolve it from Shopify at install time
    // rather than from a catalog that has not been synced yet).
    const withStorefront = await claimPublicTestByHost(shop, [shop, customDomain]);
    assert.ok(withStorefront, "knowing the storefront host is the whole fix");
  } finally {
    await cleanup([token]);
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
