import { randomBytes } from "node:crypto";
import { ENV } from "../server/env.js";

// Pure OAuth helpers (authorize URL, nonce, redirect URI). Offline access token:
// we deliberately omit grant_options[]=per-user so the token works for background sync.

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function redirectUri(): string {
  return `${ENV.shopify.appUrl ?? ""}/api/shopify/callback`;
}

export function buildAuthorizeUrl(shop: string, state: string): string {
  const params = new URLSearchParams({
    client_id: ENV.shopify.apiKey ?? "",
    scope: ENV.shopify.scopes.join(","),
    redirect_uri: redirectUri(),
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}
