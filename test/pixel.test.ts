import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAiReferrer, referrerHost } from "../src/pixel/referrer.js";
import { parsePixelEvent, toLandingPath, PIXEL_EVENT_TYPES } from "../src/pixel/event.js";

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
  const r = parsePixelEvent({ shop: "My-Shop.myshopify.com", type: "session_start", sessionId: "abc12345" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.event.shop, "my-shop.myshopify.com");
    assert.equal(r.event.consent, true); // omitted → true
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

    const a = await attribution(shop, { windowDays: 30 });
    const cg = a.bySource.find((s) => s.aiSource === "ChatGPT")!;
    const px = a.bySource.find((s) => s.aiSource === "Perplexity")!;
    assert.equal(cg.sessions, 2, "x1 excluded by consent");
    assert.equal(cg.productViews, 2);
    assert.equal(cg.checkouts, 1);
    assert.equal(px.sessions, 1);
    assert.equal(px.productViews, 0);
    assert.deepEqual(a.totals, { sessions: 3, productViews: 2, checkouts: 1 });
  } finally {
    await pgQuery("delete from pixel_events where shop_domain=$1", [shop]);
  }
});
