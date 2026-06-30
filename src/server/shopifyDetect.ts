import { safeFetch } from "../crawler/fetch.js";

// Best-effort "is this a Shopify store?" detection for funnel CTA routing. Uses the
// SSRF-HARDENED safeFetch (validated DNS pin, byte cap, redirect re-validation) on an
// untrusted merchant URL, with a TIGHT timeout. It runs in PARALLEL with the scan's AI
// calls, never on the critical path, and DEFAULTS TO FALSE on any uncertainty/failure —
// a miss just shows both CTAs, which is the safe outcome.

export interface ShopifyDetection {
  isShopify: boolean;
  signal: string | null; // which marker matched (for the run record / debugging)
}

const NEGATIVE: ShopifyDetection = { isShopify: false, signal: null };

// Tight + bounded: this must never slow or endanger the scan.
const LIMITS = { maxBytes: 600_000, timeoutMs: 4_000, maxRedirects: 4 };

/** HTML/host markers that reliably indicate a Shopify storefront. */
const BODY_MARKERS: Array<{ re: RegExp; signal: string }> = [
  { re: /cdn\.shopify\.com/i, signal: "cdn.shopify.com" },
  { re: /\/cdn\/shop\//i, signal: "cdn-shop-path" },
  { re: /(window|var)\.Shopify\b|Shopify\.theme|Shopify\.shop\b/, signal: "shopify-js" },
  { re: /<meta[^>]+(name|property)=["']shopify-[^"']+["']/i, signal: "shopify-meta" },
  { re: /shopify-section|data-shopify/i, signal: "shopify-section" },
  { re: /x-shopify-stage|myshopify\.com/i, signal: "myshopify-ref" },
];

function normalizeUrl(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Detect whether `storeUrl` is a Shopify store. Always resolves (never throws). */
export async function detectShopify(storeUrl: string | undefined | null): Promise<ShopifyDetection> {
  const url = normalizeUrl(storeUrl ?? "");
  if (!url) return NEGATIVE;
  try {
    const res = await safeFetch(url, LIMITS);
    // A redirect to *.myshopify.com (final hop) is the strongest signal.
    try {
      const host = new URL(res.finalUrl).hostname.toLowerCase();
      if (host === "myshopify.com" || host.endsWith(".myshopify.com")) return { isShopify: true, signal: "myshopify-host" };
    } catch { /* finalUrl unparseable → fall through to body markers */ }

    if (res.status >= 200 && res.status < 400 && res.body) {
      for (const m of BODY_MARKERS) if (m.re.test(res.body)) return { isShopify: true, signal: m.signal };
    }
    return NEGATIVE;
  } catch {
    // SSRF refusal, timeout, transport error → default false (show both CTAs).
    return NEGATIVE;
  }
}
