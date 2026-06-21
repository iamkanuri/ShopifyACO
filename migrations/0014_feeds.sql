-- 0014_feeds — product feeds & agentic readiness (Phase 9). A versioned feed
-- generator over the normalized catalog (Phase 3): map → validate against the
-- current official OpenAI Agentic Commerce product-feed spec → score readiness
-- (FACTUAL validations only — never a black box) → export. Storage is engine-
-- agnostic (`format` column) so Gemini/Copilot/Shopify-Catalog adapters slot in
-- without rewriting these tables. Generating a feed is NOT submitting it —
-- delivery/onboarding stays an external, config-gated step. Additive + idempotent.
-- shop_domain scopes every row (tenant isolation).

-- A feed DEFINITION: the merchant's named, configured target. config holds the
-- merchant decisions the catalog can't supply (currency, eligibility flags,
-- seller identity, target/store countries). Versions are generated from it.
create table if not exists feeds (
  id            bigint generated always as identity primary key,
  shop_domain   text not null,
  name          text not null,
  format        text not null default 'openai',   -- openai | gemini | copilot | shopify_catalog (only openai implemented)
  spec_version  text,                              -- the spec version a version was validated against
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (shop_domain, name)
);
create index if not exists feeds_shop_idx on feeds (shop_domain, created_at desc);

-- One GENERATION of a feed: a point-in-time snapshot + its validation summary +
-- the readiness score breakdown. version increments per feed (1,2,3,…).
create table if not exists feed_versions (
  id              bigint generated always as identity primary key,
  feed_id         bigint not null references feeds (id) on delete cascade,
  shop_domain     text not null,
  version         int not null,
  format          text not null default 'openai',
  spec_version    text,
  status          text not null default 'generated',  -- generated | failed
  item_count      int not null default 0,
  valid_count     int not null default 0,             -- items with zero error-level issues
  warning_count   int not null default 0,             -- items with at least one warning (no error)
  error_count     int not null default 0,             -- items with at least one error
  readiness_score numeric(5,2),                        -- 0..100; null if generation failed
  readiness       jsonb not null default '{}'::jsonb,  -- the documented component breakdown
  summary         jsonb not null default '{}'::jsonb,  -- issue counts by rule code
  error           text,
  created_at      timestamptz not null default now(),
  unique (feed_id, version)
);
create index if not exists feed_versions_feed_idx on feed_versions (feed_id, version desc);
create index if not exists feed_versions_shop_idx on feed_versions (shop_domain, created_at desc);

-- One mapped feed RECORD per purchasable item (per variant, matching the OpenAI
-- per-item granularity) plus its validation result. record is the spec-shaped
-- payload; issues is [{level,code,field,message}]. Replaced wholesale per version.
create table if not exists feed_items (
  id               bigint generated always as identity primary key,
  feed_version_id  bigint not null references feed_versions (id) on delete cascade,
  shop_domain      text not null,
  product_gid      text not null,
  variant_gid      text,
  item_id          text,                              -- the feed's item_id (merchant SKU or variant id)
  status           text not null default 'valid',     -- valid | warning | error
  record           jsonb not null default '{}'::jsonb,
  issues           jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists feed_items_version_idx on feed_items (feed_version_id);
create index if not exists feed_items_status_idx on feed_items (feed_version_id, status);
create index if not exists feed_items_shop_idx on feed_items (shop_domain, product_gid);

grant select, insert, update, delete on table feeds, feed_versions, feed_items to service_role;
