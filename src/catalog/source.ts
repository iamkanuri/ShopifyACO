import { ENV } from "../server/env.js";

// Catalog source: pulls product pages from Shopify's GraphQL Admin API (live) or a
// deterministic fixture (mock). Cursor pagination + adaptive rate-limit handling.
// Shopify reads are FREE (rate-limited by a leaky-bucket cost model, never billed).

export interface ProductPage {
  nodes: Array<Record<string, unknown>>;
  hasNextPage: boolean;
  endCursor: string | null;
}

const PRODUCTS_QUERY = `
query CatalogProducts($cursor: String) {
  products(first: 50, after: $cursor, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle descriptionHtml vendor productType tags status onlineStoreUrl
      seo { title description }
      featuredImage { url }
      variants(first: 50) {
        nodes { id title sku barcode price availableForSale selectedOptions { name value } }
      }
      collections(first: 20) { nodes { id title handle } }
      metafields(first: 20) { nodes { namespace key value type } }
    }
  }
}`;

const SINGLE_PRODUCT_QUERY = `
query CatalogProduct($id: ID!) {
  product(id: $id) {
    id title handle descriptionHtml vendor productType tags status onlineStoreUrl
    seo { title description }
    featuredImage { url }
    variants(first: 50) { nodes { id title sku barcode price availableForSale selectedOptions { name value } } }
    collections(first: 20) { nodes { id title handle } }
    metafields(first: 20) { nodes { namespace key value type } }
  }
}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch a single product by GID (for incremental webhook syncs). Null if gone. */
export async function fetchProduct(shop: string, token: string, productGid: string): Promise<Record<string, unknown> | null> {
  if (ENV.shopify.mode === "mock") {
    const n = Number(productGid.split("/").pop()) - 1000;
    return n >= 1 && n <= 7 ? mockProduct(n) : null;
  }
  const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: SINGLE_PRODUCT_QUERY, variables: { id: productGid } }),
    signal: AbortSignal.timeout(15_000),
  });
  // Surface Shopify's reason verbatim (it explains 403s: scope/approval/version), mirroring
  // fetchProductsPage. Without the body a 403 is undiagnosable from the UI.
  if (!res.ok) throw new Error(`product fetch failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    data?: { product?: Record<string, unknown> | null };
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  };
  // A 200 with a GraphQL error (e.g. ACCESS_DENIED for a missing scope) must NOT be silently
  // treated as "product not found" — that would mislabel a permissions problem as a deletion.
  if (json.errors?.length) {
    const e = json.errors[0];
    throw new Error(`product query error: ${e?.extensions?.code ?? ""} ${e?.message ?? "unknown"}`.trim());
  }
  return json.data?.product ?? null;
}

/** Fetch one page of products. `token` is the shop's decrypted offline token. */
export async function fetchProductsPage(shop: string, token: string, cursor: string | null): Promise<ProductPage> {
  if (ENV.shopify.mode === "mock") return mockPage(cursor);

  // Up to 3 attempts on transient throttle/5xx.
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { cursor } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      await sleep(1000 * attempt * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`products fetch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      data?: { products?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string }; nodes?: Array<Record<string, unknown>> } };
      errors?: Array<{ message?: string; extensions?: { code?: string } }>;
      extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
    };
    // GraphQL-level throttle → back off using the leaky-bucket restore rate.
    if (json.errors?.some((e) => e.extensions?.code === "THROTTLED")) {
      const ts = json.extensions?.cost?.throttleStatus;
      const waitMs = ts?.restoreRate ? Math.min(5000, (500 / ts.restoreRate) * 1000) : 1500 * attempt;
      lastErr = "THROTTLED";
      await sleep(waitMs);
      continue;
    }
    if (json.errors?.length) throw new Error(`products query error: ${json.errors[0]?.message ?? "unknown"}`);
    const p = json.data?.products;
    // Proactively pace if the bucket is low, so the next page doesn't trip the limit.
    const ts = json.extensions?.cost?.throttleStatus;
    if (ts && typeof ts.currentlyAvailable === "number" && ts.currentlyAvailable < 150 && ts.restoreRate) {
      await sleep(Math.min(3000, ((150 - ts.currentlyAvailable) / ts.restoreRate) * 1000));
    }
    return { nodes: p?.nodes ?? [], hasNextPage: Boolean(p?.pageInfo?.hasNextPage), endCursor: p?.pageInfo?.endCursor ?? null };
  }
  throw new Error(`products fetch exhausted retries (${lastErr})`);
}

// ---- mock: deterministic 7-product catalog across 2 pages -----------------
function mockPage(cursor: string | null): ProductPage {
  const all = Array.from({ length: 7 }, (_, i) => mockProduct(i + 1));
  const pageSize = 5;
  const start = cursor ? Number(cursor) : 0;
  const slice = all.slice(start, start + pageSize);
  const end = start + slice.length;
  return { nodes: slice, hasNextPage: end < all.length, endCursor: end < all.length ? String(end) : null };
}

function mockProduct(n: number): Record<string, unknown> {
  return {
    id: `gid://shopify/Product/${1000 + n}`,
    title: `Mock Product ${n}`,
    handle: `mock-product-${n}`,
    descriptionHtml: `<p>Description for <b>product ${n}</b>.</p>`,
    vendor: "AisleLens Test Co",
    productType: n % 2 ? "Cookware" : "Accessories",
    tags: ["mock", `tag${n}`],
    status: "ACTIVE",
    onlineStoreUrl: `https://ai-visibility-dev.myshopify.com/products/mock-product-${n}`,
    seo: { title: `Mock Product ${n} — SEO`, description: `SEO desc ${n}` },
    featuredImage: { url: `https://cdn.example.com/p${n}.jpg` },
    variants: {
      nodes: [
        { id: `gid://shopify/ProductVariant/${2000 + n}`, title: "Default", sku: `SKU-${n}`, barcode: `00000000000${n}`, price: `${19.99 + n}`, availableForSale: true, selectedOptions: [{ name: "Title", value: "Default" }] },
      ],
    },
    collections: { nodes: [{ id: `gid://shopify/Collection/${3000 + (n % 3)}`, title: `Collection ${n % 3}`, handle: `collection-${n % 3}` }] },
    metafields: { nodes: [{ namespace: "custom", key: "material", value: n % 2 ? "ceramic" : "steel", type: "single_line_text_field" }] },
  };
}
