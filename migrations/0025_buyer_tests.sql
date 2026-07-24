-- ===========================================================================
-- V2 — CLOSE THE FUNNEL. The public Buyer Test becomes a durable, shop-owned
-- artifact that survives install and can be re-run, fixed and regression-tested.
--
-- The through-line: a merchant who runs a public test must be able to walk from
-- "2 requirements could not be proven" to "fixed, re-tested and permanently
-- monitored" without a discontinuity. That walk needs four things to persist:
--   1. the public result, carried across OAuth      → public_tests
--   2. the test itself, owned by the shop           → buyer_tests
--   3. every execution of it, for before/after      → buyer_test_runs
--   4. the merchant's own answer about their product → requirement_confirmations
--
-- Additive + idempotent, in the house style. No data is ever deleted here.
-- ===========================================================================

-- 1. The PUBLIC test result, keyed to a short single-use token so it can be
--    handed through the install flow and restored on first authenticated load.
--    Holds no PII: a product URL and the rendered result, nothing about a person.
create table if not exists public_tests (
  token          text primary key,             -- crypto-random, ~80 bits, unguessable
  product_url    text not null,
  store_host     text,                         -- the host tested (diagnostics only)
  result         jsonb not null,               -- the full ProductTestResult as rendered
  shop_domain    text,                         -- set when a shop CLAIMS it post-install
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null          -- unclaimed tokens are short-lived
);
create index if not exists public_tests_shop_idx on public_tests (shop_domain, claimed_at desc);
create index if not exists public_tests_expiry_idx on public_tests (expires_at);
grant select, insert, update, delete on table public_tests to service_role;

-- 2. A shop-owned Buyer Test: the pinned CONTRACT (task + requirements) plus the
--    versions it was defined under. Re-running against a different contract or a
--    different engine is refused rather than silently compared — a before/after
--    that changed its own definition in between proves nothing.
create table if not exists buyer_tests (
  id               bigint generated always as identity primary key,
  shop_domain      text not null,
  product_gid      text,                       -- gid://shopify/Product/… once resolved
  product_url      text not null,
  product_title    text,
  name             text,
  contract         jsonb not null,             -- { summary, requirements[] } — the definition
  contract_version text not null,              -- stable hash of the requirements
  engine_version   text not null,              -- evaluator semantics version
  source           text not null default 'public',  -- public | picker
  origin_token     text,                       -- the public_tests.token it came from
  baseline_result  jsonb,                      -- the PUBLIC run (what the merchant first saw)
  latest_result    jsonb,                      -- the most recent authenticated run
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists buyer_tests_shop_idx on buyer_tests (shop_domain, updated_at desc);
create index if not exists buyer_tests_product_idx on buyer_tests (shop_domain, product_gid);
grant select, insert, update, delete on table buyer_tests to service_role;

-- 3. Every execution of a saved test — the history list and the before/after source.
create table if not exists buyer_test_runs (
  id               bigint generated always as identity primary key,
  test_id          bigint not null,
  shop_domain      text not null,
  mode             text not null default 'authenticated',  -- public | authenticated
  result           jsonb not null,
  contract_version text not null,
  engine_version   text not null,
  trigger          text not null default 'manual',         -- manual | post_fix | scheduled
  created_at       timestamptz not null default now()
);
create index if not exists buyer_test_runs_test_idx on buyer_test_runs (test_id, created_at desc);
create index if not exists buyer_test_runs_shop_idx on buyer_test_runs (shop_domain, created_at desc);
grant select, insert, update, delete on table buyer_test_runs to service_role;

-- 4. The merchant's answer to the one question only they can answer ("Is this
--    product fragrance-free?"). This is what upgrades an EVIDENCE-AVAILABILITY
--    finding into a legitimate content fix: without it we know only that we
--    could not verify a claim, which is never grounds to write one into a store.
--    A "no" closes the requirement and must produce no proposal.
create table if not exists requirement_confirmations (
  id                bigint generated always as identity primary key,
  shop_domain       text not null,
  test_id           bigint,
  requirement_id    text not null,
  requirement_label text not null,
  answer            text not null,             -- yes | no | unsure
  actor             text,
  created_at        timestamptz not null default now()
);
create index if not exists requirement_confirmations_test_idx
  on requirement_confirmations (test_id, created_at desc);
grant select, insert, update, delete on table requirement_confirmations to service_role;

-- 5. Tie a fix proposal back to the confirmation that authorized it. A
--    write_products proposal for a claim MUST carry one: it is the audit trail
--    showing the merchant asserted the fact, not us.
alter table fix_proposals add column if not exists confirmation_id bigint;
alter table fix_proposals add column if not exists buyer_test_id bigint;

-- 6. The install flow carries the public token through OAuth so the first
--    authenticated screen can be the merchant's own test, continued.
alter table oauth_states add column if not exists test_token text;
