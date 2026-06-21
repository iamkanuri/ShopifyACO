import { createHmac, timingSafeEqual } from "node:crypto";

// Shopify HMAC verification — timing-safe. Two schemes:
//  - OAuth callback: hex HMAC-SHA256 over the sorted query string (minus hmac/signature).
//  - Webhooks: base64 HMAC-SHA256 over the RAW request body (header X-Shopify-Hmac-Sha256).

function timingSafeHexEqual(a: string, b: string): boolean {
  // Compare as bytes; bail on length mismatch (timingSafeEqual throws otherwise).
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Verify the OAuth callback HMAC. `query` is the parsed query (strings only). */
export function verifyOAuthHmac(query: Record<string, string | string[] | undefined>, secret: string): boolean {
  const provided = typeof query.hmac === "string" ? query.hmac : "";
  if (!provided) return false;
  const message = Object.keys(query)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => {
      const v = query[k];
      return `${k}=${Array.isArray(v) ? v.join(",") : v ?? ""}`;
    })
    .join("&");
  const digest = createHmac("sha256", secret).update(message).digest("hex");
  return timingSafeHexEqual(digest, provided);
}

/** Verify a webhook HMAC over the raw body. `header` = X-Shopify-Hmac-Sha256 (base64). */
export function verifyWebhookHmac(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return timingSafeHexEqual(digest, header);
}

/** Compute a webhook HMAC (used by tests/mocks to produce valid signatures). */
export function webhookHmac(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}
