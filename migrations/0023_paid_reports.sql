-- Paid-report Phase 2: the automated $29 deep report + artifacts, persisted to the DB so the
-- durable-queue WORKER (which has no DATA_DIR volume) can generate and the web service can serve.
-- Additive only. Keyed by the Stripe checkout session so generation is idempotent (Stripe re-sends).

create table if not exists paid_reports (
  id            bigserial primary key,
  session_id    text unique not null,          -- Stripe checkout session — the idempotency key
  run_id        text not null,                  -- the original free mini-scan this upgrades
  email         text,
  plan          text,
  status        text not null default 'pending', -- pending | generating | complete | held | refunded
  report        jsonb,                          -- the deep MerchantAnalysis + run meta
  artifacts     jsonb,                          -- the ArtifactBundle (done-for-you assets)
  cost_usd      numeric default 0,
  attempts      int default 0,
  error         text,
  alerted_at    timestamptz,                    -- when the owner was last alerted about a failure
  refunded_at   timestamptz,
  stripe_payment_intent text,                   -- for the refund API call
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists paid_reports_run_id_idx on paid_reports (run_id);
create index if not exists paid_reports_status_idx on paid_reports (status);
