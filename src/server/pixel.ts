import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { shopOf } from "./shopify.js";
import { clientIp, ipHash, rateLimit } from "./guards.js";
import { getShop } from "../db/shops.js";
import { parsePixelEvent } from "../pixel/event.js";
import { classifyAiReferrer } from "../pixel/referrer.js";
import { attribution, insertPixelEvent, pixelActivity } from "../db/pixel.js";
import { activatePixelForShop, hasPixelScope } from "../pixel/activate.js";
import { safeEqualStr } from "../shopify/crypto.js";

// Phase 10 — AI-referral pixel API.
//   POST /api/pixel/ingest        PUBLIC beacon from the storefront Web Pixel (CORS).
//   GET  /app/api/pixel/attribution  shop-scoped, tenant-isolated dashboard read.
//
// SECURITY POSTURE (honest): the ingest endpoint is public and the data is browser-
// self-reported — a storefront pixel cannot hold a real secret. PIXEL_SHARED_SECRET is
// a WEAK anti-noise gate (it ships to the browser), not authentication. Real scoping:
// the shop must be installed, consent must be granted, the source must classify as AI,
// the payload is typed/length-capped, and the dashboard only ever reads the caller's
// own shop. No PII / no raw IP is stored. The endpoint always 202s fast so a beacon
// never blocks or breaks the storefront.

function cors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pixel-Secret, X-Pixel-Token");
  res.setHeader("Vary", "Origin");
}

/** OPTIONS /api/pixel/ingest — CORS preflight for the cross-origin beacon. */
export function ingestPreflightHandler(_req: Request, res: Response): void {
  cors(res);
  res.status(204).end();
}

/** POST /api/pixel/ingest — store one consented, AI-referred storefront event. */
export async function ingestHandler(req: Request, res: Response): Promise<void> {
  cors(res);
  if (!ENV.pixel.ingestEnabled) {
    res.status(202).json({ ok: true, stored: false, reason: "ingest_disabled" });
    return;
  }
  // Tighter per-IP limit on top of the global /api limiter.
  if (!rateLimit(`pixel:${clientIp(req)}`, 120, 60_000)) {
    res.status(429).json({ ok: false, error: "rate_limited" });
    return;
  }
  // Optional weak anti-noise gate (NOT auth — the secret ships to the browser).
  if (ENV.pixel.sharedSecret && req.get("x-pixel-secret") !== ENV.pixel.sharedSecret) {
    res.status(401).json({ ok: false, error: "bad_secret" });
    return;
  }

  const parsed = parsePixelEvent(req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, error: parsed.error });
    return;
  }
  const ev = parsed.event;

  // Respect consent: never store when analytics consent isn't granted.
  if (!ev.consent) {
    res.status(202).json({ ok: true, stored: false, reason: "no_consent" });
    return;
  }

  // Only store events for installed shops (scopes the public write surface). DB hiccup
  // → degrade to a no-op 202 rather than 500 (the beacon must not break the storefront).
  let shopToken: string | null = null;
  try {
    const shop = await getShop(ev.shop);
    if (!shop || shop.status === "uninstalled") {
      // Unknown OR uninstalled — don't accept beacons (avoids contaminating attribution
      // for a shop that removed the app). Same opaque reason either way (public surface).
      res.status(202).json({ ok: true, stored: false, reason: "unknown_shop" });
      return;
    }
    shopToken = shop.pixel_ingest_token;
  } catch (err) {
    console.error(`[pixel] shop lookup failed: ${(err as Error).message}`);
    res.status(202).json({ ok: true, stored: false, reason: "unavailable" });
    return;
  }

  // Per-shop ingest token (anti-abuse, NOT auth — it ships to the browser). It scopes forgery
  // to a single shop rather than the global shared secret. SOFT by default: a present-but-WRONG
  // token is rejected; a MISSING token is accepted so pixels activated before the token rollout
  // keep working. PIXEL_REQUIRE_TOKEN=1 makes it STRICT (reject missing) once all pixels carry one.
  const presented = req.get("x-pixel-token") ?? null;
  if (presented && shopToken && !safeEqualStr(presented, shopToken)) {
    res.status(401).json({ ok: false, error: "bad_token" });
    return;
  }
  if (!presented && ENV.pixel.requireToken) {
    res.status(401).json({ ok: false, error: "token_required" });
    return;
  }

  // Server-authoritative AI classification (don't trust the client's decision).
  const { isAi, source, referrerHost } = classifyAiReferrer({ referrer: ev.referrer, utmSource: ev.utmSource });
  if (!isAi) {
    res.status(202).json({ ok: true, stored: false, reason: "not_ai" });
    return;
  }

  try {
    const stored = await insertPixelEvent({
      shop: ev.shop,
      sessionId: ev.sessionId,
      eventId: ev.eventId,
      eventType: ev.type,
      aiSource: source,
      referrerHost,
      utmSource: ev.utmSource,
      landingPath: ev.landingPath,
      consent: true,
      ipHash: ipHash(clientIp(req)),
      occurredAt: ev.occurredAt,
    });
    // stored=false here means a duplicate beacon (same shop+event_id) — deduped, not an error.
    res.status(202).json({ ok: true, stored, source, ...(stored ? {} : { reason: "duplicate" }) });
  } catch (err) {
    console.error(`[pixel] insert failed: ${(err as Error).message}`);
    res.status(202).json({ ok: true, stored: false, reason: "unavailable" });
  }
}

/** POST /app/api/pixel/activate — create/update the shop's app-owned Web Pixel so the
 *  deployed extension actually runs. Scope-gated (write_pixels + read_customer_events). */
export async function activateHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  try {
    const r = await activatePixelForShop(shop);
    if (r.activated) {
      res.json(r);
      return;
    }
    if (r.reason === "missing_scope") {
      res.status(409).json({
        ...r,
        message: `Reconnect the app granting ${r.neededScopes!.join(", ")} to activate the AI-referral pixel.`,
      });
      return;
    }
    res.status(422).json(r);
  } catch (err) {
    res.status(502).json({ activated: false, error: (err as Error).message });
  }
}

/** GET /app/api/pixel/health — is the pixel actually running? Surfaces activation state,
 *  scope grant, and recent activity so "no AI-referred sessions" can be told apart from a
 *  pixel that was never activated / lost its scope / isn't receiving beacons. */
export async function pixelHealthHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const [row, activity] = await Promise.all([getShop(shop), pixelActivity(shop)]);
  res.json({
    webPixelId: row?.web_pixel_id ?? null,
    activated: Boolean(row?.web_pixel_id),
    hasScope: hasPixelScope(row?.scopes),
    ingestTokenSet: Boolean(row?.pixel_ingest_token),
    lastEventAt: activity.lastEventAt,
    totalEvents: activity.totalEvents,
    eventsLast7d: activity.eventsLast7d,
    sessionsLast7d: activity.sessionsLast7d,
  });
}

/** GET /app/api/pixel/attribution?days=30 — directional AI-referral funnel. */
export async function attributionHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const days = Number(req.query.days) || 30;
  const data = await attribution(shop, { windowDays: days });
  res.json({
    ...data,
    note: "Directional: identifiable AI-referred sessions (referrer/UTM), not causal attribution. " +
      "AI assistants often strip the referrer, so this undercounts; treat as a floor.",
  });
}
