import { ENV } from "../server/env.js";
import { modeFetch, robotsFor, originOf } from "./crawl.js";
import { isAllowedByRobots } from "./robots.js";
import { validateUrl } from "./ssrf.js";
import { isNonProductRef, type DiscoveredProduct, type DiscoveredVariant } from "../artifacts/merchantFacts.js";
import type { FetchLimits } from "./fetch.js";

// ===========================================================================
// Seed discovery for the tier-2a merchant-facts crawl. Given a merchant store URL, find the
// homepage + a bounded set of PRODUCT pages to crawl, in order of reliability:
//   1. Shopify `/products.json?limit=10`  → `/products/{handle}` (JSON is already in the fetch
//      content-type allowlist; skipped if robots disallows the path)
//   2. product sitemap                    → `<loc>…/products/…</loc>`
//   3. same-origin `/products/` links     scraped from the homepage
//   4. seed-only                          just the homepage (still yields store-wide signals)
//
// Every fetch goes through the crawler's mode-aware, SSRF-hardened path (mock fixtures under
// CRAWLER_MODE=mock, safeFetch under live), so discovery costs $0 and no network in tests. Purely
// URL discovery — every returned URL is re-validated by crawlSeeds before it is fetched.
// ===========================================================================

export type SeedMethod = "products_json" | "sitemap" | "homepage_links" | "seed_only";
export interface SeedResult {
  seeds: string[]; // homepage first, then ≤ maxPdps product pages
  method: SeedMethod;
  /** Non-product add-ons (gift cards / warranties / shipping-returns protection) skipped during
   *  discovery so we don't spend a crawl slot on them — surfaced so the exclusion is auditable. */
  excludedNonProducts: string[];
  /** Per-PDP current + compare_at price from products.json (products_json path only; [] otherwise) so
   *  the facts range on everyday prices, not sale prices. */
  products: DiscoveredProduct[];
}

// Tight + bounded — discovery must never dominate the paid run.
const DISCOVERY_LIMITS: FetchLimits = { maxBytes: 1_500_000, timeoutMs: 8_000, maxRedirects: 4 };

/** `raw` → `https://host` origin (homepage). Returns null if unparseable / not http(s). */
function homepageOf(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const origin = originOf(withScheme);
  return origin && validateUrl(origin).ok ? origin : null;
}

/** Build `${origin}/products/{handle}` for a Shopify product handle; null if it fails SSRF/URL checks. */
function productUrl(origin: string, handle: string): string | null {
  const clean = String(handle ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!clean || /[^a-z0-9._-]/i.test(clean)) return null; // Shopify handles are slug-safe
  const url = `${origin}/products/${clean}`;
  return validateUrl(url).ok ? url : null;
}

interface Discovered { pdps: string[]; excluded: string[] }
interface ProductJsonItem { handle: string; variants: DiscoveredVariant[] }

const toPrice = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parse a Shopify `/products.json` body → { real product items (≤limit) each with ALL variant
 *  price/compare_at pairs, excluded add-on handles }. Non-products are skipped (a crawl slot isn't
 *  spent on a gift-card/warranty) but RECORDED so the exclusion is auditable. Malformed JSON → empty. */
function parseProductsJson(body: string, limit: number): { items: ProductJsonItem[]; excluded: string[] } {
  try {
    const parsed = JSON.parse(body) as { products?: Array<{ handle?: unknown; variants?: Array<{ price?: unknown; compare_at_price?: unknown }> }> };
    if (!Array.isArray(parsed.products)) return { items: [], excluded: [] };
    const items: ProductJsonItem[] = [];
    const excluded: string[] = [];
    for (const p of parsed.products) {
      const h = typeof p?.handle === "string" ? p.handle.trim() : "";
      if (!h) continue;
      if (isNonProductRef(h)) { if (!excluded.includes(h)) excluded.push(h); continue; }
      if (items.length >= limit || items.some((it) => it.handle === h)) continue;
      const variants: DiscoveredVariant[] = (Array.isArray(p.variants) ? p.variants : []).map((v) => {
        const price = toPrice(v?.price);
        const compareRaw = toPrice(v?.compare_at_price);
        // compare_at counts as a "regular" price only when genuinely higher than the current price.
        return { price, compareAt: compareRaw != null && price != null && compareRaw > price ? compareRaw : null };
      });
      items.push({ handle: h, variants });
    }
    return { items, excluded };
  } catch {
    return { items: [], excluded: [] };
  }
}

/** Extract same-origin `/products/…` PDP URLs from raw HTML (homepage links) or sitemap XML `<loc>`s.
 *  Non-product add-ons are separated out (recorded, not seeded). Bounded scan. */
function productLinks(text: string, origin: string, limit: number, opts: { fromXml?: boolean } = {}): Discovered {
  const pdps: string[] = [];
  const excluded: string[] = [];
  const re = opts.fromXml
    ? /<loc>\s*([^<\s]+)\s*<\/loc>/gi
    : /<a\b[^>]*href\s*=\s*["']([^"'#?]+)["']/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = re.exec(text)) !== null && scanned < 400 && pdps.length < limit) {
    scanned += 1;
    let abs: string;
    try {
      abs = new URL(m[1]!, origin + "/").toString();
    } catch {
      continue;
    }
    if (originOf(abs) !== origin) continue; // same-origin only
    if (!/\/products\/[a-z0-9._-]+/i.test(abs)) continue;
    const canon = abs.split(/[?#]/)[0]!;
    if (!/\/products\/[a-z0-9._-]+\/?$/i.test(canon)) continue; // a PDP, not /products or a collection
    if (isNonProductRef(canon)) { if (!excluded.includes(canon)) excluded.push(canon); continue; }
    if (!pdps.includes(canon) && validateUrl(canon).ok) pdps.push(canon);
  }
  return { pdps, excluded };
}

/** Find the product-specific sitemap URL inside a Shopify sitemap index (else the index itself). */
function productSitemapUrl(indexXml: string, origin: string): string | null {
  const locs = productLinksRaw(indexXml);
  const products = locs.find((l) => /sitemap_products/i.test(l) && originOf(l) === origin);
  return products ?? null;
}
function productLinksRaw(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < 100) out.push(m[1]!);
  return out;
}

async function tryFetch(url: string): Promise<string | null> {
  if (!validateUrl(url).ok) return null;
  try {
    const res = await modeFetch(url, DISCOVERY_LIMITS);
    if (res.status < 200 || res.status >= 300 || !res.body) return null;
    return res.body;
  } catch {
    return null;
  }
}

/**
 * Discover crawl seeds for a merchant store. Returns the homepage plus ≤ maxPdps product pages.
 * Best-effort and never throws — on total failure it still returns the homepage as a seed.
 */
export async function discoverSeeds(storeUrl: string, maxPdps: number): Promise<SeedResult | null> {
  const origin = homepageOf(storeUrl);
  if (!origin) return null;
  const cap = Math.max(0, maxPdps);

  const robots = await robotsFor(origin, ENV.crawler.respectRobots).catch(() => null);
  const robotsAllows = (path: string) => !robots || isAllowedByRobots(robots, path);

  // 1. Shopify /products.json — the most reliable PDP list, AND the only source of compare_at prices.
  if (robotsAllows("/products.json")) {
    const body = await tryFetch(`${origin}/products.json?limit=10`);
    if (body) {
      const { items, excluded } = parseProductsJson(body, cap);
      const products: DiscoveredProduct[] = [];
      const pdps: string[] = [];
      for (const it of items) {
        const url = productUrl(origin, it.handle);
        if (!url) continue;
        pdps.push(url);
        products.push({ url, variants: it.variants });
      }
      const exUrls = excluded.map((h) => productUrl(origin, h) ?? `${origin}/products/${h}`);
      if (pdps.length) return { seeds: [origin, ...pdps.slice(0, cap)], method: "products_json", excludedNonProducts: exUrls, products };
    }
  }

  // 2. Product sitemap (no compare_at available here → the range will be "as_listed").
  if (robotsAllows("/sitemap.xml")) {
    const index = await tryFetch(`${origin}/sitemap.xml`);
    if (index) {
      const smUrl = productSitemapUrl(index, origin);
      const xml = smUrl ? await tryFetch(smUrl) : index; // fall back to scanning the index itself
      if (xml) {
        const { pdps, excluded } = productLinks(xml, origin, cap, { fromXml: true });
        if (pdps.length) return { seeds: [origin, ...pdps], method: "sitemap", excludedNonProducts: excluded, products: [] };
      }
    }
  }

  // 3. Same-origin /products/ links on the homepage.
  const home = await tryFetch(origin + "/");
  if (home) {
    const { pdps, excluded } = productLinks(home, origin, cap);
    if (pdps.length) return { seeds: [origin, ...pdps], method: "homepage_links", excludedNonProducts: excluded, products: [] };
  }

  // 4. Seed-only: the homepage still yields store-wide signals (and price/stated claims if present).
  return { seeds: [origin], method: "seed_only", excludedNonProducts: [], products: [] };
}
