import { register } from "@shopify/web-pixels-extension";

// AI Referral Pixel (Phase 10). Detects sessions that arrived from an AI assistant and
// beacons consent-gated, directional funnel events to the AI Visibility ingest endpoint.
//
// Design notes:
// - The AI referrer is only present on the LANDING page. We persist the original
//   referrer/UTM + a session id in sessionStorage and send THOSE with every event, so
//   later funnel events (whose page referrer is internal) are still attributed to the
//   original AI source. The server re-classifies authoritatively.
// - This client-side check just decides whether a session is worth beaconing; keep the
//   host/UTM lists in rough sync with src/pixel/referrer.ts (the server is the source
//   of truth and can be updated without redeploying this pixel).
// - Consent is gated by the customer_privacy block in the toml AND re-checked here.

const AI_HOST = /(^|\.)(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|claude\.ai)$/i;
const AI_UTM = /^(chatgpt|openai|perplexity|gemini|bard|googleai|copilot|claude|ai)$/i;
const KEY = "al_ai_session";

register(async ({ analytics, init, settings, browser }) => {
  // Consent (defense in depth on top of the platform gate).
  if (init && init.customerPrivacy && init.customerPrivacy.analyticsProcessingAllowed === false) return;

  const ingestUrl = (settings && settings.ingest_url) || "";
  if (!ingestUrl) return; // not configured → no-op

  const shop = (init && init.data && init.data.shop && init.data.shop.myshopifyDomain) || "";
  if (!shop) return;

  let rec = await getJson(browser, KEY);
  if (!rec) {
    const ctx = (init && init.context) || {};
    const doc = ctx.document || {};
    const loc = (ctx.window && ctx.window.location) || doc.location || {};
    const referrer = doc.referrer || "";
    const href = loc.href || "";
    const utm = paramOf(href, "utm_source");
    const host = hostOf(referrer);

    const isAi = (host && AI_HOST.test(host)) || (utm && AI_UTM.test(utm));
    if (!isAi) return; // not an AI-referred session

    rec = { sid: newId(), referrer: referrer, utm: utm, landing: pathOf(href), started: false };
    await setJson(browser, KEY, rec);
  }

  const secret = (settings && settings.shared_secret) || "";
  const ingestToken = (settings && settings.ingest_token) || "";
  const beacon = (type) => {
    const body = JSON.stringify({
      shop: shop,
      type: type,
      sessionId: rec.sid,
      eventId: newId(), // per-beacon id → server dedups a double-fired keepalive request
      referrer: rec.referrer,
      utmSource: rec.utm,
      landingPath: rec.landing,
      consent: true,
      occurredAt: new Date().toISOString(),
    });
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["X-Pixel-Secret"] = secret;
    if (ingestToken) headers["X-Pixel-Token"] = ingestToken;
    // keepalive lets the request outlive the page navigation it may trigger.
    return fetch(ingestUrl, { method: "POST", headers: headers, body: body, keepalive: true, mode: "cors" }).catch(() => {});
  };

  if (!rec.started) {
    rec.started = true;
    await setJson(browser, KEY, rec);
    beacon("session_start");
  }

  analytics.subscribe("product_viewed", () => beacon("product_viewed"));
  analytics.subscribe("checkout_started", () => beacon("checkout_started"));
  analytics.subscribe("checkout_completed", () => beacon("checkout_completed"));
});

// ---- helpers (sandbox-safe; no DOM) ----------------------------------------
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ""; }
}
function pathOf(url) {
  try { return new URL(url).pathname; } catch (_) { return null; }
}
function paramOf(url, name) {
  try { return new URL(url).searchParams.get(name) || ""; } catch (_) { return ""; }
}
function newId() {
  return "s" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
async function getJson(browser, key) {
  try {
    const raw = await browser.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
async function setJson(browser, key, value) {
  try { await browser.sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* best effort */ }
}
