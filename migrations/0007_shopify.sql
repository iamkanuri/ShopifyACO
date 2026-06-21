-- 0007_shopify — Shopify public-app OAuth + multi-tenancy (Phase 2).
-- Models: shops, encrypted credentials, installation lifecycle, webhook idempotency,
-- audit log, and an OAuth nonce store (multi-instance-safe CSRF/replay protection).
-- Additive + idempotent. Dormant until the Shopify app is configured (LAUNCH_CHECKLIST.md).
-- Tokens are NEVER stored in plaintext — only AES-256-GCM blobs (src/shopify/crypto.ts).

create table if not exists shops (
  shop_domain     text primary key,            -- canonical <name>.myshopify.com
  status          text not null default 'installed',  -- installed|active|uninstalled
  scopes          text,
  plan            text,
  installed_at    timestamptz not null default now(),
  uninstalled_at  timestamptz,
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists shop_credentials (
  shop_domain         text primary key references shops (shop_domain) on delete cascade,
  access_token_enc    text not null,           -- AES-256-GCM blob (versioned)
  scope               text,
  encryption_version  text not null default 'v1',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists installations (
  id          bigint generated always as identity primary key,
  shop_domain text not null,
  event       text not null,                   -- install|reconnect|revoke|uninstall
  scopes      text,
  at          timestamptz not null default now()
);
create index if not exists installations_shop_idx on installations (shop_domain, at desc);

-- Webhook idempotency + replay protection: unique dedupe_key (X-Shopify-Webhook-Id).
create table if not exists webhook_events (
  id           bigint generated always as identity primary key,
  shop_domain  text,
  topic        text not null,
  dedupe_key   text not null,
  payload_hash text,
  received_at  timestamptz not null default now()
);
create unique index if not exists webhook_events_dedupe_uq on webhook_events (dedupe_key);
create index if not exists webhook_events_shop_idx on webhook_events (shop_domain, received_at desc);

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  shop_domain text,
  actor       text,                            -- 'system' | 'webhook' | user id
  action      text not null,
  target      text,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);
create index if not exists audit_log_shop_idx on audit_log (shop_domain, at desc);

-- OAuth state/nonce store (DB-backed so it survives across web replicas).
create table if not exists oauth_states (
  state        text primary key,
  shop_domain  text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists oauth_states_expiry_idx on oauth_states (expires_at);

grant select, insert, update, delete on table
  shops, shop_credentials, installations, webhook_events, audit_log, oauth_states to service_role;
