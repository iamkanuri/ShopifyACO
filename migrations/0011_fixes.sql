-- 0011_fixes — Fix Studio: evidence-backed change proposals + gated write-back (Phase 6).
-- A proposal is a single, reviewable change to ONE product field (or a copy-ready
-- theme snippet). Direct writes go through Shopify's GraphQL Admin productUpdate ONLY
-- after explicit merchant approval, with a re-read conflict check and a rollback
-- snapshot. We NEVER fabricate data — write_products proposals only reformat/expose
-- values the merchant already has. Additive + idempotent. shop_domain scopes every row.

create table if not exists fix_proposals (
  id                bigint generated always as identity primary key,
  shop_domain       text not null,
  run_id            bigint,                         -- benchmark_runs.id that motivated it
  finding_id        bigint,                         -- findings.id this proposal addresses (nullable)
  product_gid       text,                           -- gid://shopify/Product/123 (null for store-wide copy)
  kind              text not null default 'copy_ready', -- write_products | copy_ready
  target            text not null,                  -- 'seo.title' | 'seo.description' | 'descriptionHtml' | 'jsonld:Product' | …
  label             text not null,
  current_value     text,                           -- live value at proposal time (also the conflict baseline)
  proposed_value    text not null,
  based_on          text,                           -- the value we based the change on (re-read must still match)
  rationale         text,
  evidence          jsonb not null default '{}'::jsonb, -- {findingKind, intervention, mechanism, citations[]}
  -- lifecycle: proposed → approved → applied | failed | conflict | rolled_back | dismissed
  status            text not null default 'proposed',
  applied_snapshot  jsonb,                          -- before-state captured at apply time (for rollback)
  error             text,                           -- userErrors / failure / conflict detail
  actor             text,                           -- who approved/applied (merchant session / admin)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  approved_at       timestamptz,
  applied_at        timestamptz
);
create index if not exists fix_proposals_shop_idx on fix_proposals (shop_domain, created_at desc);
create index if not exists fix_proposals_run_idx on fix_proposals (run_id);
create index if not exists fix_proposals_status_idx on fix_proposals (shop_domain, status);

grant select, insert, update, delete on table fix_proposals to service_role;

-- Phase 5 findings gain the structural `signal` they diagnose, so Phase 6 can map a
-- finding → the right fix proposal. Additive + idempotent (column may already exist).
alter table findings add column if not exists signal text;
