-- 0009_benchmarks — reusable benchmarks, runs, and per-response observations (Phase 4).
-- A benchmark is a versioned, reusable definition; a run executes it once; an
-- observation is ONE engine response (the atomic unit for statistics with CIs).
-- shop_domain is nullable so the URL-only free scan can reuse the same machinery.

create table if not exists benchmarks (
  id           bigint generated always as identity primary key,
  shop_domain  text,
  name         text not null,
  tier         text not null default 'baseline',  -- free_diagnostic | baseline | monitoring | verification
  config       jsonb not null default '{}'::jsonb, -- {products[], competitors[], prompts[], engines[], models[], locale, language, geo, priceConstraint, repetitions}
  version      int not null default 1,
  schedule     text,                                -- null | weekly | biweekly | monthly
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists benchmarks_shop_idx on benchmarks (shop_domain);

create table if not exists benchmark_runs (
  id                bigint generated always as identity primary key,
  benchmark_id      bigint references benchmarks (id) on delete cascade,
  shop_domain       text,
  tier              text not null default 'baseline',
  status            text not null default 'queued',  -- queued | running | completed | failed
  engines           text[] not null default '{}',
  prompt_count      int not null default 0,
  repetitions       int not null default 1,
  observation_count int not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  model_versions    jsonb not null default '{}'::jsonb, -- engine -> model (for comparability warnings)
  grounding_modes   jsonb not null default '{}'::jsonb,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists benchmark_runs_bench_idx on benchmark_runs (benchmark_id, started_at desc);
create index if not exists benchmark_runs_shop_idx on benchmark_runs (shop_domain, started_at desc);

create table if not exists observations (
  id                    bigint generated always as identity primary key,
  run_id                bigint references benchmark_runs (id) on delete cascade,
  benchmark_id          bigint,
  shop_domain           text,
  response_id           text,                          -- groups the brands assessed from ONE engine answer
  prompt_text           text not null,
  intent                text,
  prompt_version        int not null default 1,
  engine                text not null,
  model                 text,
  grounding_mode        text,                          -- web_grounded | api_model_only | unknown
  target_brand          text,                          -- brand/product the row is about
  product_gid           text,                          -- matched merchant product, if any
  recommendation_status text,                          -- recommended | mentioned_neutral | not_mentioned | ...
  rank                  int,                            -- position in the answer's list
  sentiment             text,
  citations             jsonb not null default '[]'::jsonb,
  evidence_snippet      text,
  latency_ms            int,
  cost_usd              numeric(12,6) not null default 0,
  classification_method text not null default 'deterministic', -- deterministic | llm_adjudicated
  created_at            timestamptz not null default now()
);
create index if not exists observations_run_idx on observations (run_id);
create index if not exists observations_target_idx on observations (run_id, target_brand);

grant select, insert, update, delete on table benchmarks, benchmark_runs, observations to service_role;
