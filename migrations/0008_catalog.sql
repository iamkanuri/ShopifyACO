-- 0008_catalog — normalized Shopify catalog (Phase 3). Shop-scoped product data
-- synced from the GraphQL Admin API. Storage is engine-agnostic so future Gemini/
-- Copilot/Shopify-Catalog adapters reuse it (Phase 9). Additive + idempotent.

create table if not exists products (
  id              bigint generated always as identity primary key,
  shop_domain     text not null,
  product_gid     text not null,           -- gid://shopify/Product/123
  handle          text,
  title           text,
  description     text,
  vendor          text,
  product_type    text,
  tags            text[] not null default '{}',
  status          text,                    -- ACTIVE | DRAFT | ARCHIVED
  online_url      text,
  image_url       text,
  seo_title       text,
  seo_description text,
  metafields      jsonb not null default '[]'::jsonb,
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (shop_domain, product_gid)
);
create index if not exists products_shop_idx on products (shop_domain);
create index if not exists products_title_idx on products (shop_domain, title);

create table if not exists product_variants (
  id                 bigint generated always as identity primary key,
  shop_domain        text not null,
  product_gid        text not null,
  variant_gid        text not null,
  title              text,
  sku                text,
  barcode            text,                 -- GTIN/UPC commonly stored here
  price              numeric(14,2),
  currency           text,
  available          boolean,
  inventory_quantity int,                  -- null unless read_inventory granted
  options            jsonb not null default '[]'::jsonb,  -- [{name,value}]
  last_synced_at     timestamptz not null default now(),
  unique (shop_domain, variant_gid)
);
create index if not exists variants_product_idx on product_variants (shop_domain, product_gid);
create index if not exists variants_sku_idx on product_variants (shop_domain, sku);

create table if not exists collections (
  id              bigint generated always as identity primary key,
  shop_domain     text not null,
  collection_gid  text not null,
  handle          text,
  title           text,
  last_synced_at  timestamptz not null default now(),
  unique (shop_domain, collection_gid)
);

create table if not exists product_collections (
  shop_domain     text not null,
  product_gid     text not null,
  collection_gid  text not null,
  primary key (shop_domain, product_gid, collection_gid)
);

-- Sync runs: resumable full syncs persist the cursor; incremental syncs upsert deltas.
create table if not exists catalog_syncs (
  id               bigint generated always as identity primary key,
  shop_domain      text not null,
  type             text not null default 'full',     -- full | incremental
  status           text not null default 'running',  -- running | completed | failed
  cursor           text,                              -- last endCursor (resume point)
  products_synced  int not null default 0,
  error            text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists catalog_syncs_shop_idx on catalog_syncs (shop_domain, started_at desc);

-- Point-in-time normalized product snapshots (before/after diffs in later phases).
create table if not exists catalog_snapshots (
  id           bigint generated always as identity primary key,
  shop_domain  text not null,
  sync_id      bigint,
  product_gid  text not null,
  data         jsonb not null,
  taken_at     timestamptz not null default now()
);
create index if not exists catalog_snapshots_idx on catalog_snapshots (shop_domain, product_gid, taken_at desc);

grant select, insert, update, delete on table
  products, product_variants, collections, product_collections, catalog_syncs, catalog_snapshots to service_role;
