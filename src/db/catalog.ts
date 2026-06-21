import { pgQuery, pgTx } from "./pg.js";
import type { NormalizedProduct } from "../catalog/normalize.js";

// Catalog persistence (Phase 3). Deterministic upserts: re-running a sync converges
// to the same state, and removed variants/collection-links are pruned.

/** Upsert one product + its variants + collection links + a snapshot, atomically. */
export async function upsertProduct(shop: string, p: NormalizedProduct, syncId?: number): Promise<void> {
  await pgTx(async (c) => {
    await c.query(
      `insert into products (shop_domain, product_gid, handle, title, description, vendor, product_type,
         tags, status, online_url, image_url, seo_title, seo_description, metafields, last_synced_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb, now(), now())
       on conflict (shop_domain, product_gid) do update set
         handle=excluded.handle, title=excluded.title, description=excluded.description, vendor=excluded.vendor,
         product_type=excluded.product_type, tags=excluded.tags, status=excluded.status, online_url=excluded.online_url,
         image_url=excluded.image_url, seo_title=excluded.seo_title, seo_description=excluded.seo_description,
         metafields=excluded.metafields, last_synced_at=now(), updated_at=now()`,
      [shop, p.productGid, p.handle, p.title, p.description, p.vendor, p.productType, p.tags, p.status,
       p.onlineUrl, p.imageUrl, p.seoTitle, p.seoDescription, JSON.stringify(p.metafields)],
    );

    // Variants: upsert current set, then prune any that no longer exist.
    const keepVariantGids: string[] = [];
    for (const v of p.variants) {
      keepVariantGids.push(v.variantGid);
      await c.query(
        `insert into product_variants (shop_domain, product_gid, variant_gid, title, sku, barcode, price,
           available, inventory_quantity, options, last_synced_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
         on conflict (shop_domain, variant_gid) do update set
           product_gid=excluded.product_gid, title=excluded.title, sku=excluded.sku, barcode=excluded.barcode,
           price=excluded.price, available=excluded.available, inventory_quantity=excluded.inventory_quantity,
           options=excluded.options, last_synced_at=now()`,
        [shop, p.productGid, v.variantGid, v.title, v.sku, v.barcode, v.price, v.available, v.inventoryQuantity, JSON.stringify(v.options)],
      );
    }
    await c.query(
      `delete from product_variants where shop_domain=$1 and product_gid=$2 and not (variant_gid = any($3))`,
      [shop, p.productGid, keepVariantGids.length ? keepVariantGids : [""]],
    );

    // Collections + links.
    for (const col of p.collections) {
      await c.query(
        `insert into collections (shop_domain, collection_gid, handle, title, last_synced_at)
         values ($1,$2,$3,$4, now())
         on conflict (shop_domain, collection_gid) do update set handle=excluded.handle, title=excluded.title, last_synced_at=now()`,
        [shop, col.collectionGid, col.handle, col.title],
      );
    }
    await c.query("delete from product_collections where shop_domain=$1 and product_gid=$2", [shop, p.productGid]);
    for (const col of p.collections) {
      await c.query(
        "insert into product_collections (shop_domain, product_gid, collection_gid) values ($1,$2,$3) on conflict do nothing",
        [shop, p.productGid, col.collectionGid],
      );
    }

    if (syncId) {
      await c.query(
        "insert into catalog_snapshots (shop_domain, sync_id, product_gid, data) values ($1,$2,$3,$4::jsonb)",
        [shop, syncId, p.productGid, JSON.stringify(p)],
      );
    }
  });
}

// ---- sync run tracking -----------------------------------------------------
export async function startSync(shop: string, type: "full" | "incremental"): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    "insert into catalog_syncs (shop_domain, type, status) values ($1,$2,'running') returning id",
    [shop, type],
  );
  return Number(rows[0]!.id);
}
export async function updateSyncProgress(id: number, cursor: string | null, productsSynced: number): Promise<void> {
  await pgQuery("update catalog_syncs set cursor=$2, products_synced=$3 where id=$1", [id, cursor, productsSynced]);
}
export async function finishSync(id: number, status: "completed" | "failed", error?: string): Promise<void> {
  await pgQuery("update catalog_syncs set status=$2, error=$3, finished_at=now() where id=$1", [id, status, error ?? null]);
}
export async function latestSync(shop: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pgQuery("select * from catalog_syncs where shop_domain=$1 order by started_at desc limit 1", [shop]);
  return rows[0] ?? null;
}
/** A still-running full sync we can resume (returns id + cursor), if any. */
export async function resumableSync(shop: string): Promise<{ id: number; cursor: string | null; products_synced: number } | null> {
  const { rows } = await pgQuery<{ id: string; cursor: string | null; products_synced: number }>(
    "select id, cursor, products_synced from catalog_syncs where shop_domain=$1 and type='full' and status='running' order by started_at desc limit 1",
    [shop],
  );
  return rows[0] ? { id: Number(rows[0].id), cursor: rows[0].cursor, products_synced: rows[0].products_synced } : null;
}

// ---- read API --------------------------------------------------------------
export async function countProducts(shop: string): Promise<number> {
  const { rows } = await pgQuery<{ n: string }>("select count(*)::int n from products where shop_domain=$1", [shop]);
  return Number(rows[0]?.n ?? 0);
}
export async function listProducts(shop: string, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const q = opts.q?.trim();
  const { rows } = await pgQuery(
    `select p.product_gid, p.title, p.handle, p.vendor, p.product_type, p.status, p.image_url,
            p.seo_title, p.seo_description, jsonb_array_length(p.metafields) as metafield_count,
            (select count(*)::int from product_variants v where v.shop_domain=p.shop_domain and v.product_gid=p.product_gid) as variant_count
     from products p
     where p.shop_domain=$1 and ($2::text is null or p.title ilike '%'||$2||'%' or p.vendor ilike '%'||$2||'%' or p.product_type ilike '%'||$2||'%')
     order by p.title asc limit $3 offset $4`,
    [shop, q ?? null, limit, offset],
  );
  return rows;
}
