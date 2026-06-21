-- 0012_experiments — interventions + matched baseline/verification experiments (Phase 7).
-- THE differentiator: prove whether a change actually moved AI visibility. An
-- intervention is something the merchant changed (an applied fix, or a manual edit);
-- an experiment is ONE matched measurement of it — the SAME benchmark run before
-- (baseline) and after (verification), compared with confidence intervals. We report
-- improved | regressed | inconclusive (CI of the difference must exclude 0), never
-- a causal claim. Additive + idempotent. shop_domain scopes every row.

create table if not exists interventions (
  id            bigint generated always as identity primary key,
  shop_domain   text not null,
  benchmark_id  bigint,                          -- the benchmark that measures this change
  kind          text not null default 'manual',  -- fix_applied | copy_applied | manual | other
  description   text not null,
  proposal_id   bigint,                          -- fix_proposals.id, when it came from Fix Studio
  product_gid   text,
  -- planned → measuring (baseline captured) → verified | inconclusive | regressed
  status        text not null default 'planned',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists interventions_shop_idx on interventions (shop_domain, created_at desc);

create table if not exists experiments (
  id                 bigint generated always as identity primary key,
  shop_domain        text not null,
  intervention_id    bigint references interventions (id) on delete cascade,
  benchmark_id       bigint,
  baseline_run_id    bigint,                       -- benchmark_runs.id captured BEFORE the change
  verification_run_id bigint,                      -- benchmark_runs.id captured AFTER the change
  primary_metric     text not null default 'recommendationRate',
  -- pending (awaiting verification) → improved | regressed | inconclusive
  verdict            text not null default 'pending',
  result             jsonb not null default '{}'::jsonb,  -- ExperimentResult: per-metric comparisons + CIs
  comparability      jsonb not null default '[]'::jsonb,  -- warnings (model/prompt/sample mismatch)
  created_at         timestamptz not null default now(),
  verified_at        timestamptz
);
create index if not exists experiments_shop_idx on experiments (shop_domain, created_at desc);
create index if not exists experiments_intervention_idx on experiments (intervention_id);

grant select, insert, update, delete on table interventions, experiments to service_role;
