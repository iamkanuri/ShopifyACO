// ===========================================================================
// INTERNAL STOREFRONT DISCOVERY (v2.8 CP3) — flag-gated, never publicly reachable.
//
// WHY THIS EXISTS. The fitness measurement needs 30+ real Shopify stores, and it is
// blocked on discovery, not on the engine: from the dev machine 13 of 14 Shopify
// hosts return 429 on `/products.json`, while production egress measures clean (0%
// throttle across 15 hosts). The throttle is per-egress-IP and upstream, so the only
// honest way to assemble a sample is to ask production to do the reading.
//
// WHAT IT IS NOT. It is not a crawler, not a catalogue importer, and not a feature.
// It reads ONE public endpoint, returns ONE product handle, and stores nothing.
//
// SAFETY POSTURE (third-party stores are read-only forever):
//   • DOUBLE-GATED — mounted behind `requireAdmin` AND behind `DISCOVERY_ENABLED`.
//     An admin session alone is not enough; the flag must be on. Off ⇒ 503.
//   • SSRF-hardened via the shared `validateUrl` + `safeFetch` (validated DNS pin,
//     byte cap, bounded redirects each re-validated, content-type allowlist).
//   • robots.txt fetched, cached and RESPECTED for `/products.json`.
//   • Per-host spacing + hourly cap + the process-wide egress budget — the same two
//     budgets the buyer test uses, so discovery cannot starve or outrun it.
//   • No PII: the response carries a handle and a title, nothing about any person.
//   • Honest typed errors — a throttle is reported as a throttle, never as "empty".
//
// PRODUCT SELECTION IS DELIBERATELY ARBITRARY. It returns the FIRST product in the
// store's own `/products.json` ordering. Choosing the product with the richest
// description would bias a fitness sample toward stores that happen to look good to
// this engine, which is precisely the measurement being made.
// ===========================================================================

import { safeFetch } from "../crawler/fetch.js";
import { validateUrl } from "../crawler/ssrf.js";
import { parseRobots, isAllowedByRobots, type RobotsPolicy } from "../crawler/robots.js";
import {
  reserveHostSlot, reserveEgressSlot, withEgressSlot, getCachedRobots, storeRobots,
  markHostThrottled, hostThrottleCooldownMs,
} from "./productTestCache.js";
import { ENV } from "./env.js";

const LIMITS = { maxBytes: 1_500_000, timeoutMs: 8_000, maxRedirects: 3 };

export type DiscoverErrorKind =
  | "disabled" | "bad_url" | "robots_disallowed" | "rate_limited"
  | "not_shopify" | "no_products" | "unreachable";

export interface DiscoverResult {
  ok: boolean;
  origin: string;
  /** The product handle, when one was found. */
  handle?: string;
  /** The URL the buyer test would be given. */
  productUrl?: string;
  title?: string;
  productType?: string | null;
  /** How many products the endpoint listed — context for "is this a real store". */
  productCount?: number;
  errorKind?: DiscoverErrorKind;
  error?: string;
}

const MESSAGE: Record<DiscoverErrorKind, string> = {
  disabled: "Discovery is disabled. Set DISCOVERY_ENABLED=1 to turn it on.",
  bad_url: "Not a usable https origin.",
  robots_disallowed: "This store asks automated tools not to read /products.json, and we respect that.",
  rate_limited: "This store is limiting automated requests right now.",
  not_shopify: "No Shopify /products.json at this origin.",
  no_products: "The store's /products.json listed no products.",
  unreachable: "Could not reach this origin.",
};

const fail = (origin: string, kind: DiscoverErrorKind): DiscoverResult =>
  ({ ok: false, origin, errorKind: kind, error: MESSAGE[kind] });

export interface DiscoverDeps {
  fetchUrl?: (url: string) => Promise<{ status: number; contentType: string | null; body: string; finalUrl?: string }>;
  loadRobots?: (origin: string) => Promise<RobotsPolicy>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Test seam only — bypasses the env flag so the gate itself stays testable. */
  enabled?: boolean;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const defaultFetchUrl: NonNullable<DiscoverDeps["fetchUrl"]> = async (url) => {
  const r = await safeFetch(url, LIMITS);
  return { status: r.status, contentType: r.contentType, body: r.body, finalUrl: r.finalUrl };
};

interface ProductsJson {
  products?: Array<{ handle?: string; title?: string; product_type?: string; published_at?: string | null }>;
}

/** Read a storefront's public product list and return ONE usable product handle. */
export async function discoverProduct(rawOrigin: string, deps: DiscoverDeps = {}): Promise<DiscoverResult> {
  const enabled = deps.enabled ?? ENV.discoveryEnabled;
  if (!enabled) return fail(rawOrigin, "disabled");

  // Only supply a scheme when there is NONE. Testing for `https?://` and prefixing
  // otherwise turns `file:///etc/passwd` into `https://file:///etc/passwd`, which
  // parses to host `file` — the SSRF check then never sees the scheme it was meant
  // to refuse. Any string that already carries a scheme goes to `validateUrl` as-is,
  // where a non-http(s) one is rejected on its own terms.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(rawOrigin);
  const withScheme = hasScheme ? rawOrigin : `https://${rawOrigin}`;
  const check = validateUrl(withScheme);
  if (!check.ok || !check.url) return fail(rawOrigin, "bad_url");
  const origin = `${check.url.protocol}//${check.url.host}`;
  const host = check.url.host.toLowerCase();

  // Echo an earlier upstream refusal rather than re-probing a host that just said no.
  if (hostThrottleCooldownMs(host, deps) > 0) return fail(origin, "rate_limited");

  const rawFetch = deps.fetchUrl ?? defaultFetchUrl;
  const fetchUrl = async (url: string) => {
    const slot = reserveHostSlot(host, deps);
    if (!slot.ok) throw new Error("host hourly budget exhausted");
    const egress = reserveEgressSlot(deps);
    if (!egress.ok) throw new Error("global egress budget exhausted");
    const waitMs = Math.max(slot.waitMs, egress.waitMs);
    if (waitMs > 0) await (deps.sleep ?? realSleep)(waitMs);
    return withEgressSlot(() => rawFetch(url));
  };

  const getRobots = deps.loadRobots ?? (async (o: string): Promise<RobotsPolicy> => {
    const cached = getCachedRobots<RobotsPolicy>(o, deps);
    if (cached) return cached;
    try {
      const r = await fetchUrl(`${o}/robots.txt`);
      if (r.status === 429 || r.status === 403) { markHostThrottled(host, deps); throw new Error("robots refused"); }
      const policy: RobotsPolicy = r.status === 200 ? parseRobots(r.body) : { rules: [], fetched: false };
      storeRobots(o, policy, deps);
      return policy;
    } catch {
      // No robots.txt is normal and permissive; a refusal was already recorded above.
      return { rules: [], fetched: false };
    }
  });

  const PATH = "/products.json";
  let robots: RobotsPolicy;
  try { robots = await getRobots(origin); } catch { return fail(origin, "rate_limited"); }
  if (!isAllowedByRobots(robots, PATH)) return fail(origin, "robots_disallowed");

  let res: Awaited<ReturnType<typeof defaultFetchUrl>>;
  try { res = await fetchUrl(`${origin}${PATH}`); }
  catch { return fail(origin, "rate_limited"); }

  if (res.status === 429 || res.status === 403) { markHostThrottled(host, deps); return fail(origin, "rate_limited"); }
  if (res.status !== 200) return fail(origin, res.status === 404 ? "not_shopify" : "unreachable");

  let parsed: ProductsJson;
  try { parsed = JSON.parse(res.body) as ProductsJson; }
  catch { return fail(origin, "not_shopify"); }   // an HTML 200 is not a product list
  const products = Array.isArray(parsed.products) ? parsed.products : null;
  if (!products) return fail(origin, "not_shopify");
  if (!products.length) return fail(origin, "no_products");

  // FIRST product with a handle, in the store's own ordering. Arbitrary by design.
  const first = products.find((p) => typeof p.handle === "string" && p.handle.trim());
  if (!first?.handle) return fail(origin, "no_products");

  // The robots redirect may reveal a different canonical host; the buyer test does its
  // own canonicalisation, so the requested origin is what we hand back.
  return {
    ok: true, origin, handle: first.handle,
    productUrl: `${origin}/products/${first.handle}`,
    title: typeof first.title === "string" ? first.title : undefined,
    productType: typeof first.product_type === "string" ? first.product_type : null,
    productCount: products.length,
  };
}
