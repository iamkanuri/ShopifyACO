import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { shopOf } from "./shopify.js";
import { clientIp, ipHash, rateLimit } from "./guards.js";
import { getShop } from "../db/shops.js";
import { parsePixelEvent } from "../pixel/event.js";
import { classifyAiReferrer } from "../pixel/referrer.js";
import { attribution, insertPixelEvent } from "../db/pixel.js";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pixel-Secret");
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
  try {
    const shop = await getShop(ev.shop);
    if (!shop) {
      res.status(202).json({ ok: true, stored: false, reason: "unknown_shop" });
      return;
    }
  } catch (err) {
    console.error(`[pixel] shop lookup failed: ${(err as Error).message}`);
    res.status(202).json({ ok: true, stored: false, reason: "unavailable" });
    return;
  }

  // Server-authoritative AI classification (don't trust the client's decision).
  const { isAi, source, referrerHost } = classifyAiReferrer({ referrer: ev.referrer, utmSource: ev.utmSource });
  if (!isAi) {
    res.status(202).json({ ok: true, stored: false, reason: "not_ai" });
    return;
  }

  try {
    await insertPixelEvent({
      shop: ev.shop,
      sessionId: ev.sessionId,
      eventType: ev.type,
      aiSource: source,
      referrerHost,
      utmSource: ev.utmSource,
      landingPath: ev.landingPath,
      consent: true,
      ipHash: ipHash(clientIp(req)),
      occurredAt: ev.occurredAt,
    });
    res.status(202).json({ ok: true, stored: true, source });
  } catch (err) {
    console.error(`[pixel] insert failed: ${(err as Error).message}`);
    res.status(202).json({ ok: true, stored: false, reason: "unavailable" });
  }
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
