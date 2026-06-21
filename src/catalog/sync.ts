import { getAccessToken } from "../db/shops.js";
import { fetchProduct, fetchProductsPage } from "./source.js";
import { normalizeProduct } from "./normalize.js";
import { finishSync, resumableSync, startSync, updateSyncProgress, upsertProduct } from "../db/catalog.js";
import { pgQuery } from "../db/pg.js";
import { registerHandler } from "../queue/handlers.js";

// Catalog sync orchestration (Phase 3). Full syncs are cursor-paginated and
// resumable (the cursor persists per page); incremental syncs upsert single
// products from product webhooks. Deterministic — re-running converges.

export interface SyncResult {
  syncId: number;
  productsSynced: number;
}

/** Full catalog sync. Pass resume:true to continue an interrupted run. */
export async function syncCatalog(shop: string, opts: { resume?: boolean } = {}): Promise<SyncResult> {
  const token = await getAccessToken(shop);
  if (!token) throw new Error(`No access token for ${shop} — shop not connected.`);

  let syncId: number | undefined;
  let cursor: string | null = null;
  let count = 0;
  if (opts.resume) {
    const r = await resumableSync(shop);
    if (r) {
      syncId = r.id;
      cursor = r.cursor;
      count = r.products_synced;
    }
  }
  if (syncId === undefined) syncId = await startSync(shop, "full");

  try {
    let hasNext = true;
    while (hasNext) {
      const page = await fetchProductsPage(shop, token, cursor);
      for (const node of page.nodes) {
        const norm = normalizeProduct(node);
        if (norm) {
          await upsertProduct(shop, norm, syncId);
          count++;
        }
      }
      cursor = page.endCursor;
      hasNext = page.hasNextPage;
      await updateSyncProgress(syncId, cursor, count);
    }
    await finishSync(syncId, "completed");
    return { syncId, productsSynced: count };
  } catch (err) {
    await finishSync(syncId, "failed", (err as Error).message);
    throw err;
  }
}

/** Incremental: re-fetch + upsert a single product (products/create|update webhook). */
export async function syncOneProduct(shop: string, productGid: string): Promise<boolean> {
  const token = await getAccessToken(shop);
  if (!token) return false;
  const node = await fetchProduct(shop, token, productGid);
  if (!node) return false;
  const norm = normalizeProduct(node);
  if (!norm) return false;
  await upsertProduct(shop, norm);
  return true;
}

/** Incremental: remove a product (products/delete webhook). */
export async function deleteProduct(shop: string, productGid: string): Promise<void> {
  await pgQuery("delete from product_variants where shop_domain=$1 and product_gid=$2", [shop, productGid]);
  await pgQuery("delete from product_collections where shop_domain=$1 and product_gid=$2", [shop, productGid]);
  await pgQuery("delete from products where shop_domain=$1 and product_gid=$2", [shop, productGid]);
}

/** Numeric REST id (from a webhook) → GraphQL GID. */
export function productGidFromId(id: string | number): string {
  return `gid://shopify/Product/${id}`;
}

/** Register the queue handler so catalog syncs can run on the worker. */
export function registerCatalogJobs(): void {
  registerHandler("catalog_sync", async (payload) => {
    const shop = String(payload.shop ?? "");
    if (!shop) throw new Error("catalog_sync: missing shop");
    const r = await syncCatalog(shop, { resume: true });
    return { ...r };
  });
}
