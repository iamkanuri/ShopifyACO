import { normalizeProduct } from "../catalog/normalize.js";
import { adaptWildProductJson } from "./run-experiment2.js";
import { toSnapshotProduct, buildSnapshot } from "./snapshot-service.js";
import type { EvidenceSurface, SnapshotPage, SnapshotProduct, StoreSnapshot } from "./types.js";
import { PublicFetcher } from "./public-fetch.js";

// ===========================================================================
// STAGE 5 — public catalog ingestion (spec 4.3). Generalizes the Stage 3 WILD
// fixture loader into a LIVE, rate-limited, robots-respecting, cached fetch
// that produces a `provenance: "public"` snapshot through the SAME normalizer
// used since Stage 1. Surfaces absent from public data are marked
// `not_inspectable` (never "absent"); every evidence reference records its
// fetch URL + timestamp.
// ===========================================================================

/** Public data can never see metafields. Product page + policies are fetched
 *  on demand; anything not fetched for a given store stays not_inspectable. */
export const PUBLIC_NOT_INSPECTABLE_BASE: EvidenceSurface[] = ["product_metafields"];

export interface PublicProductRaw {
  id: number;
  title: string;
  handle: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  options?: Array<{ name: string }>;
  variants?: Array<Record<string, unknown>>;
  images?: Array<{ src?: string }>;
}

/** Deterministic category-fit score for picking the best product in a catalog. */
export function scoreProductForCategory(p: PublicProductRaw, keywords: string[]): number {
  const hay = `${p.title ?? ""} ${p.product_type ?? ""} ${Array.isArray(p.tags) ? p.tags.join(" ") : p.tags ?? ""}`.toLowerCase();
  let score = 0;
  for (const k of keywords) if (hay.includes(k.toLowerCase())) score += k.split(" ").length; // multiword hits weigh more
  // Prefer a single-purchase product over bundles/subscriptions (cleaner contract fit).
  if (/bundle|set|kit|subscription/i.test(`${p.title} ${p.product_type}`)) score -= 2;
  if (p.variants?.length) score += 1;
  return score;
}

export interface PublicSnapshotResult {
  snapshot: StoreSnapshot | null;
  reason?: string;
  fetchLog: PublicFetcher["log"];
  productHandle?: string;
  isShopify: boolean;
}

/** Detect Shopify hosting deterministically (Phase 0E §4): /products.json?limit=1
 *  → 200 JSON with a `products` array. Returns the parsed products on success. */
export async function fetchShopifyCatalog(
  fetcher: PublicFetcher,
  origin: string,
): Promise<{ isShopify: boolean; products: PublicProductRaw[]; url: string }> {
  const url = `${origin.replace(/\/$/, "")}/products.json?limit=250`;
  const res = await fetcher.get(url.replace("?limit=250", "")); // path check ignores query; fetch full
  // isPermittedPublicPath validates the PATH; add the query back for the actual fetch.
  const full = await fetcher.get(url);
  const chosen = full ?? res;
  if (!chosen || chosen.status !== 200) return { isShopify: false, products: [], url };
  try {
    const json = JSON.parse(chosen.body) as { products?: PublicProductRaw[] };
    if (!Array.isArray(json.products)) return { isShopify: false, products: [], url };
    return { isShopify: true, products: json.products, url };
  } catch {
    return { isShopify: false, products: [], url };
  }
}

/** Parse Product JSON-LD blocks out of a product page HTML into a structured_data page. */
export function extractJsonLdProduct(html: string, pageUrl: string): SnapshotPage | null {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const inner = block.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "").trim();
    try {
      const parsed = JSON.parse(inner) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : (parsed as { "@graph"?: unknown[] })["@graph"] ?? [parsed];
      for (const n of nodes as Array<Record<string, unknown>>) {
        if (n && (n["@type"] === "Product" || (Array.isArray(n["@type"]) && (n["@type"] as string[]).includes("Product")))) {
          const text = [n.name, n.description].filter((x) => typeof x === "string").join(". ");
          if (text) return { pageId: `structured_data:${pageUrl}`, surface: "structured_data", title: null, text };
        }
      }
    } catch {
      /* skip malformed block */
    }
  }
  return null;
}

export interface BuildPublicSnapshotOpts {
  fetcher: PublicFetcher;
  origin: string;
  categoryKeywords: string[];
  /** Fetch the product page for JSON-LD structured_data (one extra request). */
  wantStructuredData?: boolean;
  now?: () => number;
}

export async function buildPublicSnapshot(opts: BuildPublicSnapshotOpts): Promise<PublicSnapshotResult> {
  const { fetcher, origin, categoryKeywords } = opts;
  const now = opts.now ?? Date.now;
  const cat = await fetchShopifyCatalog(fetcher, origin);
  if (!cat.isShopify) return { snapshot: null, reason: "not-shopify-or-no-public-catalog", fetchLog: fetcher.log, isShopify: false };
  if (!cat.products.length) return { snapshot: null, reason: "empty-catalog", fetchLog: fetcher.log, isShopify: true };

  const best = [...cat.products].sort((a, b) => scoreProductForCategory(b, categoryKeywords) - scoreProductForCategory(a, categoryKeywords))[0]!;
  if (scoreProductForCategory(best, categoryKeywords) <= 0) {
    return { snapshot: null, reason: "no-category-matching-product", fetchLog: fetcher.log, isShopify: true, productHandle: best.handle };
  }

  const product = toSnapshotProduct(normalizeProduct(adaptWildProductJson(best as unknown as Record<string, unknown>) as never)!);
  const fetchedAt = new Date(now()).toISOString();

  const pages: SnapshotPage[] = [];
  const notInspectable = new Set<EvidenceSurface>(PUBLIC_NOT_INSPECTABLE_BASE);
  if (opts.wantStructuredData) {
    const pageUrl = `${origin.replace(/\/$/, "")}/products/${best.handle}`;
    const page = await fetcher.get(pageUrl);
    if (page && page.status === 200) {
      const ld = extractJsonLdProduct(page.body, pageUrl);
      if (ld) pages.push(ld);
      else notInspectable.add("structured_data");
    } else {
      notInspectable.add("structured_data");
    }
  } else {
    notInspectable.add("structured_data");
  }
  // faq + policies are not fetched by default → not inspectable.
  for (const s of ["faq", "shipping_policy", "returns_policy"] as EvidenceSurface[]) notInspectable.add(s);

  const products: SnapshotProduct[] = [product];
  const snap = buildSnapshot(
    origin,
    `public-catalog(${cat.url})+v1`,
    products,
    pages,
    [],
    "",
    fetchedAt,
    [], // nothing is "absent" — public surfaces are either present or not_inspectable
  );
  // Stamp public provenance + not_inspectable surfaces + fetch URLs (for the
  // case provenance footer). buildSnapshot already derived the evidence index.
  const stamped: StoreSnapshot & { fetchUrls?: Record<string, string> } = {
    ...snap,
    provenance: "public",
    surfacesNotInspectable: [...notInspectable],
    fetchUrls: {
      catalog: cat.url,
      ...(pages.length ? { productPage: `${origin.replace(/\/$/, "")}/products/${best.handle}` } : {}),
    },
  };
  return { snapshot: stamped, fetchLog: fetcher.log, productHandle: best.handle, isShopify: true };
}
