import { ENV } from "../server/env.js";
import { fetchProduct } from "../catalog/source.js";
import { normalizeProduct, type NormalizedProduct } from "../catalog/normalize.js";

// Write-back source for Fix Studio (Phase 6). Re-reads a single product (for the
// conflict check) and performs the gated GraphQL Admin `productUpdate`. mock mode
// simulates the mutation with NO network/credentials so the entire apply/rollback/
// conflict/partial-failure flow is testable at $0. Live writes require write_products.

export interface WriteResult {
  ok: boolean;
  userErrors: Array<{ field?: string[] | null; message: string }>;
}

const PRODUCT_UPDATE = `
mutation FixProductUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id }
    userErrors { field message }
  }
}`;

// In mock mode the write must be OBSERVABLE on the next read so the full
// apply → re-read → rollback lifecycle (and conflict detection) is exercisable at
// $0. We record applied fields per (shop, product) — shop-scoped so two mock shops
// operating on the same fixture GID don't contaminate each other's state.
const mockWrites = new Map<string, Partial<Record<"seoTitle" | "seoDescription", string>>>();
const mockKey = (shop: string, gid: string) => `${shop}::${gid}`;
/** Test/maintenance helper — clear simulated mock writes. */
export function __resetMockWrites(): void {
  mockWrites.clear();
}

/** Re-read the LIVE product for the conflict check. Returns null if it's gone. */
export async function rereadProduct(shop: string, token: string, productGid: string): Promise<NormalizedProduct | null> {
  const node = await fetchProduct(shop, token, productGid);
  if (!node) return null;
  const norm = normalizeProduct(node);
  if (norm && ENV.shopify.mode === "mock") {
    const ov = mockWrites.get(mockKey(shop, productGid));
    if (ov) {
      if (ov.seoTitle !== undefined) norm.seoTitle = ov.seoTitle;
      if (ov.seoDescription !== undefined) norm.seoDescription = ov.seoDescription;
    }
  }
  return norm;
}

/** Build a minimal ProductInput for one writable field. An empty value clears the field with
 *  `null` (not ""), which is how Shopify reliably removes an SEO override — important for
 *  rollback, where the original value was empty (a backfill). Only the two SEO fields are
 *  writable (matches `writableField`); nothing may write the raw product body. */
export function buildProductInput(productGid: string, field: "seoTitle" | "seoDescription", value: string): Record<string, unknown> {
  switch (field) {
    case "seoTitle": return { id: productGid, seo: { title: value || null } };
    case "seoDescription": return { id: productGid, seo: { description: value || null } };
  }
}

/** Apply a single ProductInput via productUpdate. mock returns success without a
 *  network call; live calls the GraphQL Admin API and surfaces userErrors verbatim
 *  (partial-failure reporting). Throws only on transport/HTTP failure. */
export async function productUpdate(shop: string, token: string, input: Record<string, unknown>): Promise<WriteResult> {
  if (ENV.shopify.mode === "mock") {
    // Record the write so a subsequent rereadProduct reflects it (shop-scoped).
    const gid = typeof input.id === "string" ? input.id : null;
    if (gid) {
      const key = mockKey(shop, gid);
      const ov = mockWrites.get(key) ?? {};
      const seo = input.seo as { title?: string; description?: string } | undefined;
      if (seo?.title !== undefined) ov.seoTitle = seo.title;
      if (seo?.description !== undefined) ov.seoDescription = seo.description;
      mockWrites.set(key, ov);
    }
    return { ok: true, userErrors: [] };
  }
  const res = await fetch(`https://${shop}/admin/api/${ENV.shopify.apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: PRODUCT_UPDATE, variables: { input } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`productUpdate failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    data?: { productUpdate?: { product?: { id?: string } | null; userErrors?: Array<{ field?: string[] | null; message: string }> } };
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) throw new Error(`productUpdate query error: ${json.errors[0]?.message ?? "unknown"}`);
  const userErrors = json.data?.productUpdate?.userErrors ?? [];
  return { ok: userErrors.length === 0 && Boolean(json.data?.productUpdate?.product?.id), userErrors };
}
