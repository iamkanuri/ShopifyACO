import { createHmac, createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ENV, hasShopify } from "./env.js";
import { normalizeShopDomain, isValidShopDomain } from "../shopify/domain.js";
import { verifyOAuthHmac, verifyWebhookHmac, webhookHmac } from "../shopify/hmac.js";
import { buildAuthorizeUrl, generateState, redirectUri } from "../shopify/oauth.js";
import { verifySessionToken } from "../shopify/sessionToken.js";
import { getShopifyClient, effectiveSecret, effectiveSecrets } from "../shopify/client.js";
import { safeEqualStr } from "../shopify/crypto.js";
import { chooseScopes, parseScopes, hasScope } from "../shopify/scopes.js";
import {
  audit, consumeOAuthState, getAccessToken, getShop, markUninstalled, recordInstallation,
  saveOAuthState, storeCredentials, upsertShop, webhookSeen,
} from "../db/shops.js";
import { deleteProduct, productGidFromId, syncOneProduct } from "../catalog/sync.js";
import { activatePixelForShop } from "../pixel/activate.js";

// Shopify OAuth + webhook routes (Phase 2). Disabled (503) until configured; in
// SHOPIFY_MODE=mock the whole flow runs end-to-end with no real Shopify.

const SHOP_COOKIE = "al_shop";

// Fail CLOSED: no hard-coded fallback secret. Without a real secret (Shopify client
// secret or APP_ENCRYPTION_KEY) we refuse to sign or accept cookies, so a misconfigured
// deploy can't be tricked by a cookie forged against a guessable key. In practice
// hasShopify() guarantees a secret on every OAuth/token path, so signing never fails there.
function cookieSecret(): string | undefined {
  return effectiveSecret() ?? ENV.appEncryptionKey ?? undefined;
}
function signShop(shop: string): string {
  const secret = cookieSecret();
  if (!secret) throw new Error("cannot sign shop cookie: no shop secret configured");
  const sig = createHmac("sha256", secret).update(shop).digest("hex");
  return `${shop}.${sig}`;
}
function verifyShopCookie(value: string | undefined): string | null {
  if (!value) return null;
  const secret = cookieSecret();
  if (!secret) return null; // no secret → no cookie auth (fail closed)
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const shop = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = createHmac("sha256", secret).update(shop).digest("hex");
  return safeEqualStr(sig, expected) && isValidShopDomain(shop) ? shop : null;
}
function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** The shop domain set on the request by requireShop (call only behind it). */
export function shopOf(req: Request): string {
  return (req as Request & { shopDomain?: string }).shopDomain!;
}

/**
 * Resolve the shop from a Shopify App Bridge session token, when present. Embedded apps
 * run in a third-party iframe where the SameSite cookie isn't sent, so the UI sends a
 * Bearer token instead. Returns null when there's no token / it doesn't verify (the caller
 * then falls back to the signed cookie used for direct, non-embedded access).
 */
function shopFromSessionToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const secrets = effectiveSecrets();
  if (!secrets.length || !ENV.shopify.apiKey) return null;
  const verdict = verifySessionToken(auth.slice(7).trim(), secrets, ENV.shopify.apiKey);
  return verdict.ok ? verdict.shop : null;
}

/** Shop-scoped authorization for /app/* merchant routes. Sets req.shopDomain. Accepts an
 *  App Bridge session token (embedded) OR the signed shop cookie (direct access). */
export async function requireShop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shop = shopFromSessionToken(req) ?? verifyShopCookie(readCookie(req, SHOP_COOKIE));
    if (!shop) {
      res.status(401).json({ error: "Not connected. Install the app from Shopify.", code: "no_shop_session" });
      return;
    }
    const row = await getShop(shop);
    if (!row || row.status === "uninstalled") {
      res.status(401).json({ error: "Shop is not connected.", code: "shop_inactive" });
      return;
    }
    (req as Request & { shopDomain?: string }).shopDomain = shop;
    next();
  } catch (err) {
    res.status(500).json({ error: "Authorization check failed." });
    console.error("[shopify] requireShop error:", (err as Error).message);
  }
}

// ---- install: redirect merchant to Shopify's OAuth consent ----------------
export async function installHandler(req: Request, res: Response): Promise<void> {
  if (!hasShopify()) {
    res.status(503).json({ error: "Shopify integration not configured.", code: "shopify_not_configured" });
    return;
  }
  const shop = normalizeShopDomain(typeof req.query.shop === "string" ? req.query.shop : undefined);
  if (!shop) {
    res.status(400).json({ error: "A valid ?shop=<name>.myshopify.com is required." });
    return;
  }
  const state = generateState();
  await saveOAuthState(state, shop);

  if (ENV.shopify.mode === "mock") {
    // Simulate Shopify redirecting back with a signed callback (no real Shopify).
    const params = new URLSearchParams({ shop, code: "mock_auth_code", state, timestamp: String(Math.floor(Date.now() / 1000)) });
    const sorted = [...params.entries()].filter(([k]) => k !== "hmac").sort().map(([k, v]) => `${k}=${v}`).join("&");
    const hmac = createHmac("sha256", effectiveSecret()!).update(sorted).digest("hex");
    params.set("hmac", hmac);
    res.redirect(`${ENV.shopify.appUrl ?? ""}/api/shopify/callback?${params.toString()}`);
    return;
  }
  res.redirect(buildAuthorizeUrl(shop, state));
}

/**
 * Resolve the scopes a shop ACTUALLY granted. The `scope` string returned by code/token
 * exchange can under-report (Shopify has handed back just "read_products" even when the
 * merchant approved write_products) — and we gate store writes on the recorded scopes, so
 * an under-report wrongly blocks Fix Studio's one-click apply. We therefore read the live
 * grant (currentAppInstallation.accessScopes) as the source of truth, falling back to the
 * exchange scope and then the configured scopes if that read fails. Never throws.
 */
async function resolveGrantedScopes(shop: string, accessToken: string, exchangeScope?: string | null): Promise<string> {
  let live: string[] = [];
  try {
    live = await getShopifyClient().fetchGrantedScopes(shop, accessToken);
  } catch (err) {
    console.error(`[shopify] could not read granted scopes for ${shop}:`, (err as Error).message);
  }
  return chooseScopes(live, exchangeScope, ENV.shopify.scopes);
}

/** Persist an install: encrypt+store the offline token, mark the shop active, register
 *  webhooks (best-effort), audit, and activate the Web Pixel (best-effort). Shared by the
 *  classic OAuth callback and the embedded token-exchange path so both behave identically.
 *  `source` distinguishes them in installations/audit ("install" | "install_token_exchange"). */
async function completeInstall(shop: string, accessToken: string, scope: string, source: string): Promise<void> {
  // Record the REAL granted scopes (not just what exchange reported) so the write gate is accurate.
  const granted = await resolveGrantedScopes(shop, accessToken, scope);
  await upsertShop(shop, { scopes: granted, status: "active" });
  await storeCredentials(shop, accessToken, granted);
  await recordInstallation(shop, source, granted);
  let topics: string[] = [];
  try {
    topics = await getShopifyClient().registerWebhooks(shop, accessToken);
  } catch (err) {
    console.error(`[shopify] webhook registration failed for ${shop}:`, (err as Error).message);
  }
  await audit(shop, "system", source, "shop", null, { scope: granted, webhooks: topics.length });

  // Best-effort: activate the AI-referral Web Pixel (Phase 10). No-op unless the
  // write_pixels + read_customer_events scopes were granted — degrades gracefully.
  try {
    const act = await activatePixelForShop(shop);
    if (!act.activated) console.log(`[shopify] web pixel not activated for ${shop}: ${act.reason}`);
  } catch (err) {
    console.error(`[shopify] web pixel activation failed for ${shop}:`, (err as Error).message);
  }
}

// ---- callback: verify, exchange code, encrypt+store, register webhooks -----
export async function callbackHandler(req: Request, res: Response): Promise<void> {
  if (!hasShopify()) {
    res.status(503).json({ error: "Shopify integration not configured." });
    return;
  }
  const secrets = effectiveSecrets();
  if (!secrets.length) {
    res.status(503).json({ error: "Shopify secret not configured." });
    return;
  }
  // 1) HMAC over the query (timing-safe). Accept EITHER secret during a rotation.
  const query = req.query as Record<string, string | string[] | undefined>;
  if (!secrets.some((s) => verifyOAuthHmac(query, s))) {
    res.status(400).json({ error: "Invalid HMAC." });
    return;
  }
  // 2) shop domain
  const shop = normalizeShopDomain(typeof req.query.shop === "string" ? req.query.shop : undefined);
  if (!shop) {
    res.status(400).json({ error: "Invalid shop." });
    return;
  }
  // 3) single-use state nonce (CSRF + replay protection)
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stateShop = await consumeOAuthState(state);
  if (!stateShop || stateShop !== shop) {
    res.status(403).json({ error: "Invalid or expired OAuth state." });
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    res.status(400).json({ error: "Missing authorization code." });
    return;
  }

  // 4) exchange + persist (encrypted) — shared with the embedded token-exchange path.
  const client = getShopifyClient();
  const { accessToken, scope } = await client.exchangeCode(shop, code);
  await completeInstall(shop, accessToken, scope, "install");

  // 5) shop session cookie (signed) → onboarding
  res.cookie(SHOP_COOKIE, signShop(shop), {
    httpOnly: true, secure: ENV.isProd, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000, path: "/",
  });
  res.redirect("/app");
}

// ---- token exchange: embedded install handshake (no redirect) --------------
/**
 * POST /api/shopify/token — the EMBEDDED install path. When an embedded app first loads in
 * the Shopify admin iframe (managed install), App Bridge mints a session token but no shop
 * row exists yet, so requireShop 401s. The UI then calls this endpoint with the session
 * token (Authorization: Bearer); we verify it and exchange it for an offline access token
 * (RFC 8693 token exchange) — completing the install with no OAuth redirect. Authenticated
 * by the session token itself, NOT requireShop. Idempotent: an already-installed shop just
 * refreshes (no redundant exchange).
 */
export async function tokenExchangeHandler(req: Request, res: Response): Promise<void> {
  if (!hasShopify()) {
    res.status(503).json({ error: "Shopify integration not configured.", code: "shopify_not_configured" });
    return;
  }
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const verdict = verifySessionToken(token, effectiveSecrets(), ENV.shopify.apiKey);
  if (!verdict.ok) {
    res.status(401).json({ error: "Invalid or missing session token.", code: "bad_session_token" });
    return;
  }
  const shop = verdict.shop;

  try {
    const existing = await getShop(shop);
    const installed = existing && existing.status !== "uninstalled" ? await getAccessToken(shop) : null;
    if (installed) {
      // Re-exchange to REFRESH the offline token, then re-sync scopes. Shopify now rejects
      // non-expiring legacy tokens AND issues EXPIRING offline tokens via token exchange, so a
      // stored token eventually lapses — and requireShop can't see that (the shop row still
      // looks valid), so the 401-triggered bootstrap would never fire to recover. Refreshing on
      // each embedded load keeps a currently-valid token on file. Graceful: a transient exchange
      // failure keeps the shop active on its existing token rather than locking it out.
      try {
        const { accessToken, scope } = await getShopifyClient().exchangeSessionToken(shop, token);
        const granted = await resolveGrantedScopes(shop, accessToken, scope);
        await storeCredentials(shop, accessToken, granted);
        await upsertShop(shop, { scopes: granted, status: "active" });
      } catch (err) {
        console.error(`[shopify] offline-token refresh failed for ${shop}:`, (err as Error).message);
        await upsertShop(shop, { status: "active" });
      }
    } else {
      const { accessToken, scope } = await getShopifyClient().exchangeSessionToken(shop, token);
      await completeInstall(shop, accessToken, scope, "install_token_exchange");
    }
    // Also set the signed cookie so any later NON-embedded request authenticates too.
    res.cookie(SHOP_COOKIE, signShop(shop), {
      httpOnly: true, secure: ENV.isProd, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000, path: "/",
    });
    res.json({ ok: true, shop, newInstall: !installed });
  } catch (err) {
    console.error(`[shopify] token exchange failed for ${shop}:`, (err as Error).message);
    res.status(502).json({ error: "Token exchange failed.", code: "token_exchange_failed" });
  }
}

// ---- webhooks: HMAC-verified, idempotent, audited (RAW body) ---------------
export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const secrets = effectiveSecrets();
  if (!secrets.length) {
    res.status(401).end();
    return;
  }
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  // Accept EITHER secret during a rotation (old + new both valid for a grace period).
  if (!secrets.some((s) => verifyWebhookHmac(raw, hmacHeader, s))) {
    res.status(401).end();
    return;
  }
  const topic = (req.get("X-Shopify-Topic") ?? "").toLowerCase();
  const shop = normalizeShopDomain(req.get("X-Shopify-Shop-Domain"));
  const dedupe = req.get("X-Shopify-Webhook-Id") ?? webhookHmac(raw, secrets[0]!);
  const payloadHash = createHash("sha256").update(raw).digest("hex");

  // Idempotency / replay protection: ack duplicates without reprocessing.
  const fresh = await webhookSeen(dedupe, topic, shop, payloadHash);
  if (!fresh) {
    res.status(200).end();
    return;
  }

  try {
    if (shop) {
      switch (topic) {
        case "app/uninstalled":
          await markUninstalled(shop);
          await recordInstallation(shop, "uninstall");
          await audit(shop, "webhook", "app_uninstalled", "shop");
          break;
        case "shop/update":
          await upsertShop(shop, {});
          await audit(shop, "webhook", "shop_update", "shop");
          break;
        case "products/create":
        case "products/update":
        case "products/delete": {
          await audit(shop, "webhook", topic.replace("/", "_"), "product");
          // Incremental catalog reconciliation (best-effort; never fail the webhook).
          try {
            const body = JSON.parse(raw.toString("utf8")) as { id?: string | number };
            if (body.id != null) {
              const gid = productGidFromId(body.id);
              if (topic === "products/delete") await deleteProduct(shop, gid);
              else await syncOneProduct(shop, gid);
            }
          } catch (e) {
            console.error(`[shopify] incremental catalog sync failed (${topic}):`, (e as Error).message);
          }
          break;
        }
        case "customers/data_request":
        case "customers/redact":
        case "shop/redact":
          // GDPR compliance webhooks: we store no customer PII, so just audit the request.
          await audit(shop, "webhook", topic.replace("/", "_"), "compliance");
          break;
        default:
          await audit(shop, "webhook", `unhandled:${topic}`, "webhook");
      }
    }
  } catch (err) {
    console.error(`[shopify] webhook ${topic} handler error:`, (err as Error).message);
    // Still 200 — we've recorded receipt; Shopify retries are deduped.
  }
  res.status(200).end();
}

/** GET /app/api/shop — the connected shop's recorded grant (for the Settings screen). Shows
 *  the REAL granted scopes and whether write-back is enabled, so the UI never hardcodes a
 *  scope list that contradicts the actual install. Shop-scoped (behind requireShop). */
export async function shopInfoHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const row = await getShop(shop);
  const scopes = parseScopes(row?.scopes);
  res.json({
    shop,
    status: row?.status ?? "unknown",
    plan: row?.plan ?? null,
    scopes,
    writeProducts: hasScope(row?.scopes, "write_products"),
  });
}

/** Status for /healthz/deep + admin (no secrets). */
export function shopifyStatus(): Record<string, unknown> {
  return {
    configured: hasShopify(),
    mode: ENV.shopify.mode,
    scopes: ENV.shopify.scopes,
    apiVersion: ENV.shopify.apiVersion,
    callbackUrl: redirectUri(),
  };
}
