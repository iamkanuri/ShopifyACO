import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverProduct } from "../src/server/discover.js";
import { __resetCaches } from "../src/server/productTestCache.js";

// ===========================================================================
// Internal storefront discovery (v2.8 CP3). Every test injects its transport —
// nothing here touches the network, and no third-party store is contacted.
//
// The properties that matter are the SAFETY ones: the flag gate, robots, honest
// error kinds, and the fact that a throttle is never reported as "no products".
// ===========================================================================

const ROBOTS_OK = { status: 200, contentType: "text/plain", body: "User-agent: *\nAllow: /\n" };
const listing = (handles: string[]) => ({
  status: 200, contentType: "application/json",
  body: JSON.stringify({ products: handles.map((h, i) => ({ handle: h, title: `Product ${i}`, product_type: "Thing" })) }),
});

/** A transport that answers robots.txt then /products.json. */
const transport = (productsRes: { status: number; contentType: string | null; body: string }, robotsRes = ROBOTS_OK) =>
  async (url: string) => (url.endsWith("/robots.txt") ? robotsRes : productsRes);

test("disabled by default — the flag is the gate, not the admin session alone", async () => {
  __resetCaches();
  const r = await discoverProduct("https://store.example", { enabled: false, fetchUrl: transport(listing(["a"])) });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "disabled");
});

test("returns the FIRST product handle in the store's own ordering", async () => {
  __resetCaches();
  const r = await discoverProduct("https://store.example", { enabled: true, fetchUrl: transport(listing(["alpha", "beta", "gamma"])) });
  assert.equal(r.ok, true);
  assert.equal(r.handle, "alpha");
  assert.equal(r.productUrl, "https://store.example/products/alpha");
  assert.equal(r.productCount, 3);
});

test("a bare host is accepted and normalised to https", async () => {
  __resetCaches();
  const r = await discoverProduct("store.example", { enabled: true, fetchUrl: transport(listing(["a"])) });
  assert.equal(r.ok, true);
  assert.equal(r.origin, "https://store.example");
});

test("robots Disallow on /products.json is RESPECTED", async () => {
  __resetCaches();
  const robots = { status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /products.json\n" };
  const r = await discoverProduct("https://store.example", { enabled: true, fetchUrl: transport(listing(["a"]), robots) });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "robots_disallowed");
});

test("a 429 is reported as rate_limited, never as no_products", async () => {
  // The distinction is the whole point: "this store publishes nothing" and "this
  // store would not talk to us" are different facts, and conflating them is how a
  // sample silently becomes a sample of stores that answered.
  __resetCaches();
  const r = await discoverProduct("https://store.example", {
    enabled: true, fetchUrl: transport({ status: 429, contentType: "text/plain", body: "" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "rate_limited");
});

test("a 404 on /products.json is not_shopify", async () => {
  __resetCaches();
  const r = await discoverProduct("https://store.example", {
    enabled: true, fetchUrl: transport({ status: 404, contentType: "text/html", body: "" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "not_shopify");
});

test("an HTML 200 is not_shopify, not a crash", async () => {
  __resetCaches();
  const r = await discoverProduct("https://store.example", {
    enabled: true, fetchUrl: transport({ status: 200, contentType: "text/html", body: "<!doctype html><p>hi" }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "not_shopify");
});

test("an empty product list is no_products", async () => {
  __resetCaches();
  const r = await discoverProduct("https://store.example", { enabled: true, fetchUrl: transport(listing([])) });
  assert.equal(r.ok, false);
  assert.equal(r.errorKind, "no_products");
});

test("SSRF: a private/loopback/metadata host is refused before any fetch", async () => {
  __resetCaches();
  let fetched = false;
  for (const target of ["http://127.0.0.1/", "http://169.254.169.254/", "http://localhost:8787", "file:///etc/passwd"]) {
    const r = await discoverProduct(target, {
      enabled: true,
      fetchUrl: async () => { fetched = true; return listing(["a"]); },
    });
    assert.equal(r.ok, false, `${target} must be refused`);
    assert.equal(r.errorKind, "bad_url", `${target} must be refused as bad_url`);
  }
  assert.equal(fetched, false, "no request may be issued for a refused target");
});

test("a throttled host is not re-probed while its cooldown runs", async () => {
  __resetCaches();
  let calls = 0;
  const dep = {
    enabled: true,
    fetchUrl: async (url: string) => {
      calls++;
      return url.endsWith("/robots.txt") ? ROBOTS_OK : { status: 429, contentType: null, body: "" };
    },
  };
  const first = await discoverProduct("https://store.example", dep);
  assert.equal(first.errorKind, "rate_limited");
  const callsAfterFirst = calls;
  const second = await discoverProduct("https://store.example", dep);
  assert.equal(second.errorKind, "rate_limited");
  assert.equal(calls, callsAfterFirst, "the cooldown must suppress a second probe entirely");
});
