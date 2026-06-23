import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeShopDomain } from "./domain.js";

// ===========================================================================
// Shopify App Bridge session-token (JWT) verification — NO SDK, manual HS256
// (same discipline as the Stripe/webhook HMAC code). Embedded apps run in a
// third-party iframe where the SameSite=Lax session cookie isn't sent (and Safari
// ITP blocks third-party cookies outright), so the embedded UI authenticates each
// /app/api call with a short-lived session token App Bridge mints client-side
// (`shopify.idToken()`), sent as `Authorization: Bearer <token>`.
//
// The token is a JWT signed HS256 with the app's CLIENT SECRET. We verify the
// signature (constant-time, supporting secret rotation), the standard claims, and
// derive the shop from `dest`. Reference: Shopify session-token docs.
// ===========================================================================

const LEEWAY_SEC = 10; // small allowance for clock skew

export type SessionTokenResult =
  | { ok: true; shop: string; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/** Decode a base64url segment to a Buffer (tolerant of missing padding). */
function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/**
 * Verify a Shopify App Bridge session token. `secrets` is the app's client secret(s)
 * (accepts both during a rotation, like the OAuth/webhook HMAC paths). `apiKey` is the
 * app's client id (the token's expected `aud`). `now` is injectable for tests.
 */
export function verifySessionToken(
  token: string | undefined,
  secrets: string[],
  apiKey: string | undefined,
  now: number = Date.now(),
): SessionTokenResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [h, p, sig] = parts as [string, string, string];

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlToBuf(h).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid token encoding" };
  }
  // Pin the algorithm — never honor `alg:none` or an attacker-chosen alg.
  if (header.alg !== "HS256") return { ok: false, reason: "unexpected alg" };
  if (!secrets.length) return { ok: false, reason: "no secret configured" };

  // Signature (constant-time; accept either secret during a rotation).
  const signingInput = `${h}.${p}`;
  const provided = b64urlToBuf(sig);
  const signatureOk = secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(signingInput).digest();
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
  if (!signatureOk) return { ok: false, reason: "signature mismatch" };

  // Standard claims.
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_SEC < nowSec) return { ok: false, reason: "token expired" };
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY_SEC > nowSec) return { ok: false, reason: "token not yet valid" };
  if (apiKey && payload.aud !== apiKey) return { ok: false, reason: "audience mismatch" };

  // Derive + validate the shop from `dest` (https://<shop>.myshopify.com). The strict
  // domain validator rejects anything that isn't a canonical myshopify.com host.
  const dest = typeof payload.dest === "string" ? payload.dest : "";
  const shop = normalizeShopDomain(dest.replace(/^https?:\/\//, ""));
  if (!shop) return { ok: false, reason: "invalid dest shop" };
  // Defense in depth: the issuer host must match the destination shop.
  const iss = typeof payload.iss === "string" ? payload.iss : "";
  const issHost = normalizeShopDomain(iss.replace(/^https?:\/\//, ""));
  if (issHost && issHost !== shop) return { ok: false, reason: "iss/dest mismatch" };

  return { ok: true, shop, payload };
}
