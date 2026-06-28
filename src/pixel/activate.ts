import { ENV } from "../server/env.js";
import { getShopifyClient } from "../shopify/client.js";
import { getAccessToken, getOrCreatePixelIngestToken, getShop, setWebPixelId } from "../db/shops.js";

// Web Pixel activation (Phase 10). Deploying the extension (`shopify app deploy`) only
// REGISTERS it; an app-owned web pixel must be CREATED per shop via the Admin API
// (webPixelCreate, then webPixelUpdate to change settings) with the ingest URL passed
// as settings. This is gated on the write_pixels + read_customer_events scopes — like
// Phase 6's write_products, we degrade gracefully (missing_scope) rather than fail when
// the merchant hasn't re-consented. Mock mode simulates the whole thing at $0.

export const REQUIRED_PIXEL_SCOPES = ["read_customer_events", "write_pixels"] as const;

/** True only when BOTH pixel scopes are granted (honest gate, mirrors hasWriteScope). */
export function hasPixelScope(scopes: string | null | undefined): boolean {
  if (!scopes) return false;
  const set = new Set(scopes.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
  return REQUIRED_PIXEL_SCOPES.every((s) => set.has(s));
}

/** The settings JSON injected into the storefront pixel: where to beacon + the anti-noise
 *  secret + the per-shop ingest token. The ingest URL is derived from the app/public base URL.
 *  IMPORTANT: webPixelCreate requires EVERY field declared in the extension's settings schema
 *  to be present and NON-BLANK, so shared_secret is always a string (empty = no gate) and
 *  ingest_token is the shop's always-non-blank token. The extension toml MUST declare
 *  ingest_token (deploy the extension at the same time as this). */
export function pixelSettings(ingestToken: string): string {
  const base = (ENV.shopify.appUrl ?? ENV.publicBaseUrl ?? "").replace(/\/+$/, "");
  return JSON.stringify({
    ingest_url: `${base}/api/pixel/ingest`,
    shared_secret: ENV.pixel.sharedSecret ?? "",
    ingest_token: ingestToken,
  });
}

export interface ActivateResult {
  activated: boolean;
  reason?: "no_shop" | "missing_scope" | "no_token" | "no_base_url";
  webPixelId?: string;
  neededScopes?: readonly string[];
}

/** Create-or-update the shop's AI-referral Web Pixel. Idempotent via the stored id. */
export async function activatePixelForShop(shop: string): Promise<ActivateResult> {
  const row = await getShop(shop);
  if (!row) return { activated: false, reason: "no_shop" };
  if (!hasPixelScope(row.scopes)) return { activated: false, reason: "missing_scope", neededScopes: REQUIRED_PIXEL_SCOPES };

  const client = getShopifyClient();
  // A live pixel needs a real ingest URL; refuse rather than register a broken relative
  // one. (Mock ignores settings, so it doesn't need a base URL.)
  if (client.mode === "live" && !(ENV.shopify.appUrl ?? ENV.publicBaseUrl)) return { activated: false, reason: "no_base_url" };

  const token = await getAccessToken(shop);
  if (!token) return { activated: false, reason: "no_token" };

  const ingestToken = await getOrCreatePixelIngestToken(shop);
  const { id } = await client.activateWebPixel(shop, token, pixelSettings(ingestToken), row.web_pixel_id ?? undefined);
  await setWebPixelId(shop, id);
  return { activated: true, webPixelId: id };
}
