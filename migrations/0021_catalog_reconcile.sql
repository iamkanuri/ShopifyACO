-- 0021_catalog_reconcile — full-sync reconciliation + nested-truncation disclosure (#18/C7).
-- A full catalog sync upserts every product it sees but, until now, never removed products
-- that vanished from Shopify between syncs (webhook delivery isn't guaranteed), leaving stale
-- products eligible for fixes/feeds. We now stamp each upsert with the sync id and, on a
-- COMPLETED full sync, sweep products not seen by it. `nested_truncated` records when a
-- product's variants/collections/metafields connections were capped (>50/20/20) so the UI can
-- disclose that some data wasn't synced. Additive + idempotent.

alter table products add column if not exists last_sync_id    bigint;
alter table products add column if not exists nested_truncated boolean not null default false;

-- Sweep lookup: "this shop's products not stamped by sync N".
create index if not exists products_shop_lastsync_idx on products (shop_domain, last_sync_id);
