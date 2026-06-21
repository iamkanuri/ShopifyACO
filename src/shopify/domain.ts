// Strict Shopify shop-domain validation. Every OAuth/redirect/API call is built
// against the shop domain, so loose parsing = open-redirect / SSRF. Only canonical
// `<name>.myshopify.com` is ever accepted.

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string | undefined | null): boolean {
  return typeof shop === "string" && SHOP_RE.test(shop);
}

/** Accept a bare handle, a domain, or a URL and return the canonical
 *  `<name>.myshopify.com`, or null if it isn't a valid Shopify shop. */
export function normalizeShopDomain(input: string | undefined | null): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  // strip scheme + path if a URL was pasted
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (!s) return null;
  // bare handle → add the suffix
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  return isValidShopDomain(s) ? s : null;
}
