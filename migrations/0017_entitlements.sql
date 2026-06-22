-- 0017_entitlements — Phase 11 commercial product & entitlements / billing.
--
-- `entitlements` is the central grant of plan access to a customer. It is the source
-- of truth for "what is this customer allowed to do" — the plan→limits/features mapping
-- lives in CODE (src/billing/entitlements.ts), this table records WHICH plan is active
-- for WHOM, plus the Stripe references needed to drive the lifecycle (provision, renew,
-- past_due, cancel, expire, refund). NO prices live here (prices come from Stripe).
--
-- Identity is dual-keyed so it reconciles both sides of the funnel:
--   • shop_domain — a connected Shopify install (the embedded /app).
--   • email       — the public, email-based funnel (orders table).
-- At least one is set. A Shopify-initiated checkout can carry both.
--
-- `billing_events` is the idempotency ledger for EVERY processed Stripe webhook event
-- (not just checkout.session.completed — orders already dedupes that on session_id).
-- Recorded only AFTER successful processing, so a failed event is reprocessed on retry.
--
-- Additive + idempotent. shop_domain/email scope every entitlement row.

create table if not exists entitlements (
  id                     bigint generated always as identity primary key,
  shop_domain            text,                              -- Shopify install (nullable)
  email                  text,                              -- public funnel (nullable)
  plan                   text not null,                     -- free | full_report | monitoring | founder_beta
  status                 text not null default 'active',    -- active | past_due | canceled | expired | refunded
  source                 text not null default 'stripe',    -- stripe | manual | comp
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_payment_intent  text,                              -- one-time payments, for refund mapping
  current_period_end     timestamptz,                       -- subscriptions: access lapses here; null = perpetual
  cancel_at_period_end   boolean not null default false,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- One entitlement per subscription (the subscription lifecycle upserts on this).
create unique index if not exists entitlements_subscription_uidx
  on entitlements (stripe_subscription_id) where stripe_subscription_id is not null;
-- One perpetual one-time entitlement per (shop, plan) and per (email, plan) so a repeat
-- purchase of the same one-time plan is idempotent rather than duplicating the grant.
create unique index if not exists entitlements_shop_plan_uidx
  on entitlements (shop_domain, plan)
  where shop_domain is not null and stripe_subscription_id is null;
create unique index if not exists entitlements_email_plan_uidx
  on entitlements (lower(email), plan)
  where email is not null and shop_domain is null and stripe_subscription_id is null;

create index if not exists entitlements_shop_idx on entitlements (shop_domain) where shop_domain is not null;
create index if not exists entitlements_email_idx on entitlements (lower(email)) where email is not null;
create index if not exists entitlements_payment_intent_idx on entitlements (stripe_payment_intent) where stripe_payment_intent is not null;

create table if not exists billing_events (
  id           bigint generated always as identity primary key,
  event_id     text unique not null,        -- Stripe event id (dedupe key)
  type         text not null,
  processed_at timestamptz not null default now()
);

-- Refund mapping: the existing one-time `orders` rows need to tie back to a refund.
-- charge.refunded carries payment_intent, so persist it on the order at checkout time.
alter table orders add column if not exists stripe_payment_intent text;
alter table orders add column if not exists refunded_at timestamptz;
create index if not exists orders_payment_intent_idx on orders (stripe_payment_intent) where stripe_payment_intent is not null;

grant select, insert, update, delete on table entitlements, billing_events to service_role;
