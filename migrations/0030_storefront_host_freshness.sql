-- 0030 — make `shops.storefront_host` self-healing.
--
-- Migration 0029 added the column and wrote it in exactly ONE place: install. It
-- shipped no refresh and no backfill, and the consequence was measured on real
-- rows rather than imagined:
--
--   • a shop installed before 0029 holds NULL forever, so host-match reconciliation
--     can never fire for it — and a `shop/update` webhook arrived for exactly such a
--     shop without populating the column;
--   • the dev store holds a STALE value (its myshopify domain, captured before its
--     custom domain was connected and made primary), so reconciliation would match
--     the wrong host.
--
-- A merchant connecting a custom domain AFTER installing is the normal order of
-- events, not an edge case, so "written once at install" was never going to hold.
--
-- The fix is a freshness stamp rather than a one-off backfill script: any row whose
-- host has not been confirmed recently is re-resolved from Shopify on the next
-- authenticated request, and `shop/update` forces it. Existing rows have a NULL
-- stamp and are therefore stale by construction, which IS the backfill.
alter table shops add column if not exists storefront_host_checked_at timestamptz;

-- Partial index: the refresh sweep only ever asks for rows that are stale.
create index if not exists shops_storefront_host_stale_idx
  on shops (storefront_host_checked_at)
  where status <> 'uninstalled';
