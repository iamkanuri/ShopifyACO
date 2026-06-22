import { createHmac, createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ENV, hasShopify } from "./env.js";
import { normalizeShopDomain, isValidShopDomain } from "../shopify/domain.js";
import { verifyOAuthHmac, verifyWebhookHmac, webhookHmac } from "../shopify/hmac.js";
import { buildAuthorizeUrl, generateState, redirectUri } from "../shopify/oauth.js";
import { getShopifyClient, effectiveSecret } from "../shopify/client.js";
import { safeEqualStr } from "../shopify/crypto.js";
import {
  audit, consumeOAuthState, getShop, markUninstalled, recordInstallation,
  saveOAuthState, storeCredentials, upsertShop, webhookSeen,
} from "../db/shops.js";
import { deleteProduct, productGidFromId, syncOneProduct } from "../catalog/sync.js";
import { activatePixelForShop } from "../pixel/activate.js";

// Shopify OAuth + webhook routes (Phase 2). Disabled (503) until configured; in
// SHOPIFY_MODE=mock the whole flow runs end-to-end with no real Shopify.

const SHOP_COOKIE = "al_shop";

function cookieSecret(): string {
  return effectiveSecret() ?? ENV.appEncryptionKey ?? "al-shop-cookie";
}
function signShop(shop: string): string {
  const sig = createHmac("sha256", cookieSecret()).update(shop).digest("hex");
  return `${shop}.${sig}`;
}
function verifyShopCookie(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const shop = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = createHmac("sha256", cookieSecret()).update(shop).digest("hex");
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

/** Shop-scoped authorization for /app/* merchant routes. Sets req.shopDomain. */
export async function requireShop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shop = verifyShopCookie(readCookie(req, SHOP_COOKIE));
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

// ---- callback: verify, exchange code, encrypt+store, register webhooks -----
export async function callbackHandler(req: Request, res: Response): Promise<void> {
  if (!hasShopify()) {
    res.status(503).json({ error: "Shopify integration not configured." });
    return;
  }
  const secret = effectiveSecret();
  if (!secret) {
    res.status(503).json({ error: "Shopify secret not configured." });
    return;
  }
  // 1) HMAC over the query (timing-safe)
  if (!verifyOAuthHmac(req.query as Record<string, string | string[] | undefined>, secret)) {
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

  // 4) exchange + persist (encrypted)
  const client = getShopifyClient();
  const { accessToken, scope } = await client.exchangeCode(shop, code);
  await upsertShop(shop, { scopes: scope, status: "active" });
  await storeCredentials(shop, accessToken, scope);
  await recordInstallation(shop, "install", scope);
  let topics: string[] = [];
  try {
    topics = await client.registerWebhooks(shop, accessToken);
  } catch (err) {
    console.error(`[shopify] webhook registration failed for ${shop}:`, (err as Error).message);
  }
  await audit(shop, "system", "install", "shop", null, { scope, webhooks: topics.length });

  // 4b) best-effort: activate the AI-referral Web Pixel (Phase 10). No-op unless the
  //     write_pixels + read_customer_events scopes were granted — degrades gracefully.
  try {
    const act = await activatePixelForShop(shop);
    if (!act.activated) console.log(`[shopify] web pixel not activated for ${shop}: ${act.reason}`);
  } catch (err) {
    console.error(`[shopify] web pixel activation failed for ${shop}:`, (err as Error).message);
  }

  // 5) shop session cookie (signed) → onboarding
  res.cookie(SHOP_COOKIE, signShop(shop), {
    httpOnly: true, secure: ENV.isProd, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000, path: "/",
  });
  res.redirect("/app");
}

// ---- webhooks: HMAC-verified, idempotent, audited (RAW body) ---------------
export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const secret = effectiveSecret();
  if (!secret) {
    res.status(401).end();
    return;
  }
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  if (!verifyWebhookHmac(raw, hmacHeader, secret)) {
    res.status(401).end();
    return;
  }
  const topic = (req.get("X-Shopify-Topic") ?? "").toLowerCase();
  const shop = normalizeShopDomain(req.get("X-Shopify-Shop-Domain"));
  const dedupe = req.get("X-Shopify-Webhook-Id") ?? webhookHmac(raw, secret);
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
