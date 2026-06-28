import { normalizeShopDomain } from "../shopify/domain.js";

// Pure validation + normalization of an inbound pixel beacon (Phase 10). The ingest
// endpoint is PUBLIC and called from untrusted storefront browsers, so every field is
// treated as untrusted: typed, length-capped, and enum-checked here before anything
// touches the DB. PII is minimized — we keep a referrer HOST and a landing PATH only.

export const PIXEL_EVENT_TYPES = ["session_start", "product_viewed", "checkout_started", "checkout_completed"] as const;
export type PixelEventType = (typeof PIXEL_EVENT_TYPES)[number];
const isEventType = (v: unknown): v is PixelEventType =>
  typeof v === "string" && (PIXEL_EVENT_TYPES as readonly string[]).includes(v);

export interface ParsedPixelEvent {
  shop: string;
  type: PixelEventType;
  sessionId: string;
  referrer: string | null;   // raw referrer (used to derive host, never stored whole)
  utmSource: string | null;
  landingPath: string | null;
  consent: boolean;
  occurredAt: string;        // ISO 8601 (server clamps to now if absent/invalid)
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

/** Reduce a URL/path to just its pathname (drop scheme/host/query → no PII), capped. */
export function toLandingPath(v: unknown): string | null {
  const s = str(v, 2048);
  if (!s) return null;
  let path = s;
  try {
    path = new URL(s).pathname;
  } catch {
    path = s.split(/[?#]/)[0]!; // already a path
  }
  if (!path.startsWith("/")) path = "/" + path;
  return path.slice(0, 512);
}

function toIso(v: unknown): string {
  if (typeof v === "string") {
    const t = Date.parse(v);
    // Accept only sane timestamps within ±1 day of now (don't trust client clocks far off).
    if (!Number.isNaN(t) && Math.abs(t - Date.now()) <= 86_400_000) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

export type ParseResult = { ok: true; event: ParsedPixelEvent } | { ok: false; error: string };

/** Validate a single inbound beacon body into a normalized event (or an error). */
export function parsePixelEvent(body: unknown): ParseResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const shop = normalizeShopDomain(typeof b.shop === "string" ? b.shop : null);
  if (!shop) return { ok: false, error: "invalid_shop" };

  if (!isEventType(b.type)) return { ok: false, error: "invalid_type" };

  const sessionId = str(b.sessionId, 128);
  if (!sessionId || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) return { ok: false, error: "invalid_session" };

  return {
    ok: true,
    event: {
      shop,
      type: b.type,
      sessionId,
      referrer: str(b.referrer, 2048),
      utmSource: str(b.utmSource, 128),
      landingPath: toLandingPath(b.landingPath),
      // Require EXPLICIT consent — anything but a literal `true` is treated as no-consent
      // (the beacon always sends consent:true). A missing/forged field never grants consent.
      consent: b.consent === true,
      occurredAt: toIso(b.occurredAt),
    },
  };
}
