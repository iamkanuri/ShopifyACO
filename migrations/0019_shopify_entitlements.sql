-- 0019_shopify_entitlements — one entitlement grant per shop for the Shopify Managed
-- Pricing channel (source='shopify'), updated in place as the merchant's plan changes
-- (free <-> pro). The partial unique index lets us upsert by shop_domain for that source
-- without colliding with the Stripe one-time/subscription grants. Additive + idempotent.

create unique index if not exists entitlements_shop_shopify_ux
  on entitlements (shop_domain) where source = 'shopify';
