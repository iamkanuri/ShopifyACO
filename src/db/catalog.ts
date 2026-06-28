import { pgQuery, pgTx } from "./pg.js";
import type { NormalizedProduct } from "../catalog/normalize.js";

// Catalog persistence (Phase 3). Deterministic upserts: re-running a sync converges
// to the same state, and removed variants/collection-links are pruned.

/** Upsert one product + its variants + collection links + a snapshot, atomically. */
export async function upsertProduct(shop: string, p: NormalizedProduct, syncId?: number): Promise<void> {
  await pgTx(async (c) => {
    await c.query(
      `insert into products (shop_domain, product_gid, handle, title, description, vendor, product_type,
         tags, status, online_url, image_url, seo_title, seo_description, metafields, last_sync_id, nested_truncated,
         last_synced_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16, now(), now())
       on conflict (shop_domain, product_gid) do update set
         handle=excluded.handle, title=excluded.title, description=excluded.description, vendor=excluded.vendor,
         product_type=excluded.product_type, tags=excluded.tags, status=excluded.status, online_url=excluded.online_url,
         image_url=excluded.image_url, seo_title=excluded.seo_title, seo_description=excluded.seo_description,
         metafields=excluded.metafields, nested_truncated=excluded.nested_truncated,
         last_sync_id=coalesce($15, products.last_sync_id), last_synced_at=now(), updated_at=now()`,
      [shop, p.productGid, p.handle, p.title, p.description, p.vendor, p.productType, p.tags, p.status,
       p.onlineUrl, p.imageUrl, p.seoTitle, p.seoDescription, JSON.stringify(p.metafields), syncId ?? null, p.nestedTruncated ?? false],
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
/** Count products, optionally restricted to the same `q` filter as listProducts (so the UI's
 *  "showing X of Y" total matches a search). No `q` → the shop's full synced count. */
export async function countProducts(shop: string, opts: { q?: string } = {}): Promise<number> {
  const q = opts.q?.trim();
  const { rows } = await pgQuery<{ n: string }>(
    `select count(*)::int n from products
       where shop_domain=$1 and ($2::text is null or title ilike '%'||$2||'%' or vendor ilike '%'||$2||'%' or product_type ilike '%'||$2||'%')`,
    [shop, q ?? null],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Remove products that a COMPLETED full sync didn't see — Shopify's webhook delivery isn't
 *  guaranteed, so a missed products/delete would otherwise leave a stale product eligible for
 *  fixes/feeds. Conservative: only deletes rows NOT stamped by this sync AND not touched since
 *  the sync started (so a concurrent webhook upsert is never clobbered). Returns rows removed. */
export async function sweepDeletedProducts(shop: string, syncId: number): Promise<number> {
  return pgTx(async (c) => {
    const { rows } = await c.query<{ product_gid: string }>(
      `select product_gid from products
         where shop_domain=$1 and last_sync_id is distinct from $2
           and last_synced_at < (select started_at from catalog_syncs where id=$2)`,
      [shop, syncId],
    );
    const gids = rows.map((r) => r.product_gid);
    if (!gids.length) return 0;
    await c.query("delete from product_variants where shop_domain=$1 and product_gid = any($2)", [shop, gids]);
    await c.query("delete from product_collections where shop_domain=$1 and product_gid = any($2)", [shop, gids]);
    await c.query("delete from products where shop_domain=$1 and product_gid = any($2)", [shop, gids]);
    return gids.length;
  });
}
/** True if a product GID belongs to this shop's catalog (tenant-ownership check). */
export async function productExists(shop: string, productGid: string): Promise<boolean> {
  const { rows } = await pgQuery("select 1 from products where shop_domain=$1 and product_gid=$2 limit 1", [shop, productGid]);
  return rows.length > 0;
}

/** A representative storefront URL for the shop — the most-recently-updated synced product
 *  page that has a public URL. Used to crawl the merchant's OWN page during diagnosis when
 *  the benchmark didn't carry one. Null if nothing usable is synced. */
export async function getStorefrontUrl(shop: string): Promise<string | null> {
  const { rows } = await pgQuery<{ online_url: string | null }>(
    `select online_url from products
       where shop_domain=$1 and online_url is not null and online_url <> '' and coalesce(status,'') <> 'ARCHIVED'
       order by updated_at desc nulls last limit 1`,
    [shop],
  );
  return rows[0]?.online_url ?? null;
}
export async function listProducts(shop: string, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  const q = opts.q?.trim();
  const { rows } = await pgQuery(
    `select p.product_gid, p.title, p.handle, p.vendor, p.product_type, p.status, p.image_url,
            p.seo_title, p.seo_description, p.nested_truncated, jsonb_array_length(p.metafields) as metafield_count,
            (select count(*)::int from product_variants v where v.shop_domain=p.shop_domain and v.product_gid=p.product_gid) as variant_count
     from products p
     where p.shop_domain=$1 and ($2::text is null or p.title ilike '%'||$2||'%' or p.vendor ilike '%'||$2||'%' or p.product_type ilike '%'||$2||'%')
     order by p.title asc limit $3 offset $4`,
    [shop, q ?? null, limit, offset],
  );
  return rows;
}

/** Reconstruct the FULL normalized catalog (products + their variants) for the shop,
 *  for downstream consumers like the Phase 9 feed generator. Collections aren't
 *  reattached (the feed mapper doesn't use them) — `collections` is left empty. A
 *  hard `cap` bounds memory; feed generation processes the whole catalog at once. */
export async function loadNormalizedProducts(shop: string, opts: { cap?: number } = {}): Promise<NormalizedProduct[]> {
  const cap = Math.min(100_000, Math.max(1, opts.cap ?? 50_000));
  const { rows: prods } = await pgQuery<{
    product_gid: string; handle: string | null; title: string | null; description: string | null;
    vendor: string | null; product_type: string | null; tags: string[] | null; status: string | null;
    online_url: string | null; image_url: string | null; seo_title: string | null; seo_description: string | null;
    metafields: unknown; nested_truncated: boolean | null;
  }>(
    `select product_gid, handle, title, description, vendor, product_type, tags, status,
            online_url, image_url, seo_title, seo_description, metafields, nested_truncated
       from products where shop_domain=$1 order by product_gid asc limit $2`,
    [shop, cap],
  );
  if (!prods.length) return [];

  const { rows: vars } = await pgQuery<{
    product_gid: string; variant_gid: string; title: string | null; sku: string | null; barcode: string | null;
    price: string | null; available: boolean | null; inventory_quantity: number | null; options: unknown;
  }>(
    `select product_gid, variant_gid, title, sku, barcode, price, available, inventory_quantity, options
       from product_variants where shop_domain=$1 order by product_gid asc, variant_gid asc`,
    [shop],
  );
  const byProduct = new Map<string, NormalizedProduct["variants"]>();
  for (const v of vars) {
    const list = byProduct.get(v.product_gid) ?? [];
    list.push({
      variantGid: v.variant_gid,
      title: v.title,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price != null ? Number(v.price) : null,
      available: v.available,
      inventoryQuantity: v.inventory_quantity,
      options: Array.isArray(v.options) ? (v.options as Array<{ name: string; value: string }>) : [],
    });
    byProduct.set(v.product_gid, list);
  }

  return prods.map((p) => ({
    productGid: p.product_gid,
    handle: p.handle,
    title: p.title,
    description: p.description,
    vendor: p.vendor,
    productType: p.product_type,
    tags: Array.isArray(p.tags) ? p.tags : [],
    status: p.status,
    onlineUrl: p.online_url,
    imageUrl: p.image_url,
    seoTitle: p.seo_title,
    seoDescription: p.seo_description,
    metafields: Array.isArray(p.metafields) ? (p.metafields as NormalizedProduct["metafields"]) : [],
    variants: byProduct.get(p.product_gid) ?? [],
    collections: [],
    nestedTruncated: Boolean(p.nested_truncated),
  }));
}
