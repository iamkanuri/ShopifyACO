-- ===========================================================================
-- 0028 — FUNNEL INSTRUMENTATION (v2.2 CP2).
--
-- Why a table at all: today a visitor can land on /test, run a Buyer Test and
-- leave, and we learn nothing. The previous product failed *silently* — no
-- signal, nothing to iterate on. Three numbers are worth more than any feature
-- we could build blind:
--   • the THROTTLE RATE, which is the metric the egress decision named as the
--     thing to monitor (EGRESS_DECISION.md);
--   • the aggregate RESULT-STATE DISTRIBUTION, which is the standing answer to
--     "do real stores produce findings worth reading";
--   • CASE VIEWS, which are the only way outreach becomes measured rather than
--     guessed at.
--
-- Why NOT the existing `events` table: `events` is a jsonb-metadata bag with a
-- single (name, created_at) index. Median/p95 duration, spend sums and rate
-- ratios over jsonb would full-scan and cast on every read, and the shape would
-- be unenforced. Typed columns make the aggregate queries plain SQL and make the
-- privacy guarantee STRUCTURAL rather than a convention:
--
--   *** THERE IS DELIBERATELY NO COLUMN HERE THAT CAN HOLD A URL, AN EMAIL, AN
--       IP, OR A SHOP DOMAIN. ***
--
-- `domain` is the REGISTRABLE domain of a tested storefront (public information,
-- and the same class of data `public_tests.store_host` already holds), never the
-- pasted URL — the product path is what identifies a person's interest, and it
-- is dropped at the boundary in `registrableDomain()`.
--
-- GDPR note: this table holds no shop identifier, so `shop/redact` cannot and
-- need not delete from it. The only join back to a store is `test_token` →
-- `public_tests`, and `public_tests` IS erased on redact (src/db/redact.ts) —
-- after which the token here is an unlinkable random string and the row is a
-- pure anonymous counter. That is the intended end state, not an oversight.
--
-- Additive + idempotent, in the house style.
-- ===========================================================================

create table if not exists funnel_events (
  id            bigint generated always as identity primary key,
  -- test_requested | test_completed | test_failed | install_clicked
  -- | install_completed | case_viewed
  name          text        not null,
  at            timestamptz not null default now(),

  -- ---- correlation (unguessable, ~80-bit random; not derived from a person) ----
  test_token    text,

  -- ---- test_requested ----
  -- REGISTRABLE domain only ("example.com"), never a full URL. Nullable because a
  -- malformed paste has no domain to speak of, and inventing one would be a lie.
  domain        text,
  cached        boolean,
  -- direct | hosted_case | other. Derived from the Referer header and then
  -- DISCARDED — the header itself is never stored.
  referrer_class text,

  -- ---- test_completed ----
  duration_ms   integer,
  fetch_tier    text,                 -- page | json | null (nothing answered)
  evidenced     smallint,
  no_blocking   smallint,
  not_proven    smallint,
  requires_access smallint,
  requirements  smallint,             -- rows in the buyer task
  semantic_invoked boolean,
  semantic_cost_usd numeric(10, 6),   -- measured, never estimated

  -- ---- test_failed / egress diagnosis (CP5.1) ----
  error_kind    text,                 -- bad_url | not_shopify | not_found | rate_limited | robots_disallowed | unreachable | http_400 | http_429 | exception
  -- upstream | our_budget | our_cooldown | our_rate_limit | null.
  -- A throttle rate that silently counts our OWN limiter measures nothing, which
  -- is the single worst way this instrumentation could fail — so the cause is a
  -- first-class column, not an inference.
  throttle_source text,
  robots_status text,                 -- ok | refused | unreachable | cached | not_fetched
  policy_status text,                 -- not_fetched | readable | unreachable | robots_disallowed | rate_limited

  -- ---- install_completed ----
  reconciled    boolean,              -- did a prior public test attach by host match?

  -- ---- case_viewed ----
  case_token    text
);

-- The read surface always filters "recent, by name", so that is the index.
create index if not exists funnel_events_name_at_idx on funnel_events (name, at desc);
create index if not exists funnel_events_at_idx on funnel_events (at desc);
-- Joining a click back to the test that produced it.
create index if not exists funnel_events_token_idx on funnel_events (test_token) where test_token is not null;

grant select, insert, update, delete on table funnel_events to service_role;
