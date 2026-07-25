-- 0029_shop_storefront_host — persist the shop's PRIMARY storefront host at install
-- time, resolved from Shopify (`{ shop { myshopifyDomain primaryDomain { host } } }`).
--
-- Why: install reconciliation could not fire on a fresh App Store install. The
-- candidate host list was built from `products.online_url`, which is only populated
-- by a catalog sync — and nothing syncs on install. So the only candidate was the
-- `*.myshopify.com` domain, while a real merchant tests their CUSTOM domain, and the
-- two sets could never intersect. See experiments/v2-2/FIRST_RUN_AUDIT.md §F1.
--
-- This column removes the dependency on a synced catalog entirely.
-- Additive + idempotent. Nullable: an install whose host query fails is still a
-- valid install, it just falls back to the previous (catalog-derived) behaviour.

alter table shops add column if not exists storefront_host text;
