import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAiReferrer, referrerHost } from "../src/pixel/referrer.js";
import { parsePixelEvent, toLandingPath, PIXEL_EVENT_TYPES } from "../src/pixel/event.js";
import { hasPixelScope, pixelSettings, REQUIRED_PIXEL_SCOPES } from "../src/pixel/activate.js";

// ---- AI-referrer classification (the core IP) ------------------------------
test("classifyAiReferrer identifies each assistant by host", () => {
  assert.equal(classifyAiReferrer({ referrer: "https://chatgpt.com/" }).source, "ChatGPT");
  assert.equal(classifyAiReferrer({ referrer: "https://chat.openai.com/c/abc" }).source, "ChatGPT");
  assert.equal(classifyAiReferrer({ referrer: "https://www.perplexity.ai/search" }).source, "Perplexity");
  assert.equal(classifyAiReferrer({ referrer: "https://gemini.google.com/app" }).source, "Gemini");
  assert.equal(classifyAiReferrer({ referrer: "https://copilot.microsoft.com/" }).source, "Copilot");
  assert.equal(classifyAiReferrer({ referrer: "https://claude.ai/" }).source, "Claude");
});

test("classifyAiReferrer does NOT flag organic search (avoid false positives)", () => {
  assert.equal(classifyAiReferrer({ referrer: "https://www.google.com/search?q=pans" }).isAi, false);
  assert.equal(classifyAiReferrer({ referrer: "https://www.bing.com/" }).isAi, false);
  assert.equal(classifyAiReferrer({ referrer: "https://duckduckgo.com/" }).isAi, false);
  assert.equal(classifyAiReferrer({ referrer: "" }).isAi, false);
});

test("classifyAiReferrer falls back to utm_source when the referrer is stripped", () => {
  assert.equal(classifyAiReferrer({ referrer: "", utmSource: "chatgpt" }).source, "ChatGPT");
  assert.equal(classifyAiReferrer({ referrer: "https://example.com", utmSource: "perplexity" }).source, "Perplexity");
  assert.equal(classifyAiReferrer({ utmSource: "ChatGPT" }).source, "ChatGPT"); // case-insensitive
  assert.equal(classifyAiReferrer({ utmSource: "facebook" }).isAi, false);
});

test("referrerHost parses URLs and bare hosts, rejects non-http", () => {
  assert.equal(referrerHost("https://Chatgpt.com/x"), "chatgpt.com");
  assert.equal(referrerHost("chatgpt.com/path"), "chatgpt.com");
  assert.equal(referrerHost("ftp://x.com"), null);
  assert.equal(referrerHost(""), null);
  assert.equal(referrerHost(null), null);
});

// ---- inbound beacon validation (untrusted public input) --------------------
test("parsePixelEvent accepts a well-formed beacon and normalizes the shop", () => {
  const r = parsePixelEvent({ shop: "My-Shop.myshopify.com", type: "session_start", sessionId: "abc12345", consent: true });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.event.shop, "my-shop.myshopify.com");
    assert.equal(r.event.consent, true); // explicit true → granted
  }
});

test("parsePixelEvent requires EXPLICIT consent — omitted/non-true never grants it", () => {
  for (const consent of [undefined, "true", 1, null]) {
    const r = parsePixelEvent({ shop: "s.myshopify.com", type: "session_start", sessionId: "abc12345", consent });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.event.consent, false, `consent=${String(consent)} must not grant`);
  }
});

test("parsePixelEvent rejects bad shop / type / session", () => {
  assert.equal((parsePixelEvent({ shop: "evil.com", type: "session_start", sessionId: "abc12345" }) as { error: string }).error, "invalid_shop");
  assert.equal((parsePixelEvent({ shop: "s.myshopify.com", type: "nope", sessionId: "abc12345" }) as { error: string }).error, "invalid_type");
  assert.equal((parsePixelEvent({ shop: "s.myshopify.com", type: "session_start", sessionId: "short" }) as { error: string }).error, "invalid_session");
});

test("parsePixelEvent honors explicit consent=false and strips PII from paths", () => {
  const r = parsePixelEvent({ shop: "s.myshopify.com", type: "product_viewed", sessionId: "sess_0001", consent: false, landingPath: "https://s.com/products/p?email=a@b.com#x" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.event.consent, false);
    assert.equal(r.event.landingPath, "/products/p"); // query + fragment dropped
  }
});

test("parsePixelEvent clamps a wildly-off client clock to ~now", () => {
  const r = parsePixelEvent({ shop: "s.myshopify.com", type: "session_start", sessionId: "abc12345", occurredAt: "1999-01-01T00:00:00Z" });
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(Math.abs(Date.parse(r.event.occurredAt) - Date.now()) < 5000);
});

test("toLandingPath reduces any URL/path to a leading-slash pathname", () => {
  assert.equal(toLandingPath("https://x.com/a/b?c=1"), "/a/b");
  assert.equal(toLandingPath("/already/a/path?q=2"), "/already/a/path");
  assert.equal(toLandingPath("nopath"), "/nopath");
  assert.equal(toLandingPath(""), null);
});

test("PIXEL_EVENT_TYPES is the funnel set", () => {
  assert.deepEqual([...PIXEL_EVENT_TYPES], ["session_start", "product_viewed", "checkout_started", "checkout_completed"]);
});

// ---- Web Pixel activation gate ---------------------------------------------
test("hasPixelScope requires BOTH write_pixels and read_customer_events", () => {
  assert.equal(hasPixelScope("read_products,read_customer_events,write_pixels"), true);
  assert.equal(hasPixelScope("read_products,write_pixels"), false); // missing read_customer_events
  assert.equal(hasPixelScope("read_products"), false);
  assert.equal(hasPixelScope(null), false);
  assert.deepEqual([...REQUIRED_PIXEL_SCOPES], ["read_customer_events", "write_pixels"]);
});

test("pixelSettings includes EVERY schema key (webPixelCreate rejects missing keys)", () => {
  const s = JSON.parse(pixelSettings("tok_abc123"));
  assert.ok(typeof s.ingest_url === "string" && s.ingest_url.endsWith("/api/pixel/ingest"));
  // shared_secret must always be present (empty when unset) or webPixelCreate fails.
  assert.equal(Object.prototype.hasOwnProperty.call(s, "shared_secret"), true);
  assert.equal(typeof s.shared_secret, "string");
  // ingest_token must be present + non-blank (the per-shop token) — same schema-key rule.
  assert.equal(s.ingest_token, "tok_abc123");
});

test("parsePixelEvent accepts a valid eventId and drops a malformed one", () => {
  const good = parsePixelEvent({ shop: "s.myshopify.com", type: "product_viewed", sessionId: "sess_0001", consent: true, eventId: "evt_abcdef12" });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.event.eventId, "evt_abcdef12");
  const bad = parsePixelEvent({ shop: "s.myshopify.com", type: "product_viewed", sessionId: "sess_0001", consent: true, eventId: "no!" });
  assert.equal(bad.ok, true);
  if (bad.ok) assert.equal(bad.event.eventId, null); // malformed → dropped to null (still stores)
});

// ---- DB-gated: ingest → directional attribution funnel ---------------------
const RUN_DB = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test("attribution computes a distinct-session funnel per AI source (consent-filtered)", { skip: !RUN_DB }, async () => {
  const { insertPixelEvent, attribution } = await import("../src/db/pixel.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `pix-${Date.now()}.myshopify.com`;
  const now = new Date().toISOString();
  const ev = (sessionId: string, eventType: string, aiSource: string, consent = true) =>
    insertPixelEvent({ shop, sessionId, eventType, aiSource, referrerHost: null, utmSource: null, landingPath: "/", consent, ipHash: "h", occurredAt: now });
  try {
    // ChatGPT: c1 full funnel, c2 viewed only.
    await ev("c1", "session_start", "ChatGPT");
    await ev("c1", "product_viewed", "ChatGPT");
    await ev("c1", "checkout_completed", "ChatGPT");
    await ev("c2", "session_start", "ChatGPT");
    await ev("c2", "product_viewed", "ChatGPT");
    // Perplexity: p1 session only.
    await ev("p1", "session_start", "Perplexity");
    // A non-consented ChatGPT session must be EXCLUDED.
    await ev("x1", "session_start", "ChatGPT", false);
    // An ORPHAN product_viewed with NO session_start must NOT inflate the funnel (forge-resistant).
    await ev("orphan", "product_viewed", "ChatGPT");

    const a = await attribution(shop, { windowDays: 30 });
    const cg = a.bySource.find((s) => s.aiSource === "ChatGPT")!;
    const px = a.bySource.find((s) => s.aiSource === "Perplexity")!;
    assert.equal(cg.sessions, 2, "x1 excluded by consent; orphan excluded (no session_start)");
    assert.equal(cg.productViews, 2, "orphan product_viewed excluded — funnel stays monotonic");
    assert.equal(cg.checkouts, 1);
    assert.equal(px.sessions, 1);
    assert.equal(px.productViews, 0);
    assert.deepEqual(a.totals, { sessions: 3, productViews: 2, checkouts: 1 });
  } finally {
    await pgQuery("delete from pixel_events where shop_domain=$1", [shop]);
  }
});

test("insertPixelEvent dedups on (shop, event_id); getOrCreatePixelIngestToken is stable", { skip: !RUN_DB }, async () => {
  const { insertPixelEvent, attribution } = await import("../src/db/pixel.js");
  const { upsertShop, getOrCreatePixelIngestToken } = await import("../src/db/shops.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const shop = `pixdedup-${Date.now()}.myshopify.com`;
  const now = new Date().toISOString();
  const ev = (eventId: string | null) => insertPixelEvent({ shop, sessionId: "c1", eventId, eventType: "session_start", aiSource: "ChatGPT", referrerHost: null, utmSource: null, landingPath: "/", consent: true, ipHash: "h", occurredAt: now });
  try {
    await upsertShop(shop, { status: "active" });

    // Same event_id twice → second is a no-op (deduped).
    assert.equal(await ev("evt_111"), true, "first insert stored");
    assert.equal(await ev("evt_111"), false, "duplicate event_id deduped");
    // A different id stores; a null id always stores (no dedup key).
    assert.equal(await ev("evt_222"), true);
    assert.equal(await ev(null), true);
    assert.equal(await ev(null), true, "null event_id never collides");

    // Only the two DISTINCT session_start events for c1 count as 1 session.
    const a = await attribution(shop, { windowDays: 30 });
    assert.equal(a.totals.sessions, 1);

    // The per-shop token is generated once and stable across calls.
    const t1 = await getOrCreatePixelIngestToken(shop);
    const t2 = await getOrCreatePixelIngestToken(shop);
    assert.ok(t1 && t1.length >= 16);
    assert.equal(t1, t2, "token is stable (coalesce keeps the first)");
  } finally {
    await pgQuery("delete from pixel_events where shop_domain=$1", [shop]);
    await pgQuery("delete from shops where shop_domain=$1", [shop]);
  }
});

// Web Pixel activation against the MOCK Shopify client (no real store needed).
const RUN_ACT = RUN_DB && process.env.SHOPIFY_MODE === "mock" && Boolean(process.env.APP_ENCRYPTION_KEY);
test("activatePixelForShop activates with scopes (idempotent) and refuses without", { skip: !RUN_ACT }, async () => {
  const { upsertShop, storeCredentials, getShop } = await import("../src/db/shops.js");
  const { activatePixelForShop } = await import("../src/pixel/activate.js");
  const { pgQuery } = await import("../src/db/pg.js");
  const ok = `pixact-ok-${Date.now()}.myshopify.com`;
  const no = `pixact-no-${Date.now()}.myshopify.com`;
  try {
    // Granted both pixel scopes → activates; mock client returns an id; stored on the shop.
    await upsertShop(ok, { status: "active", scopes: "read_products,read_customer_events,write_pixels" });
    await storeCredentials(ok, "mock_token", "read_products,read_customer_events,write_pixels");
    const r1 = await activatePixelForShop(ok);
    assert.equal(r1.activated, true);
    assert.ok(r1.webPixelId);
    assert.equal((await getShop(ok))!.web_pixel_id, r1.webPixelId);
    const r2 = await activatePixelForShop(ok); // idempotent: same id (update path)
    assert.equal(r2.webPixelId, r1.webPixelId);

    // Missing scopes → refused, nothing stored.
    await upsertShop(no, { status: "active", scopes: "read_products" });
    await storeCredentials(no, "mock_token", "read_products");
    const r3 = await activatePixelForShop(no);
    assert.equal(r3.activated, false);
    assert.equal(r3.reason, "missing_scope");
    assert.equal((await getShop(no))!.web_pixel_id, null);
  } finally {
    for (const s of [ok, no]) {
      await pgQuery("delete from shop_credentials where shop_domain=$1", [s]);
      await pgQuery("delete from shops where shop_domain=$1", [s]);
    }
  }
});
