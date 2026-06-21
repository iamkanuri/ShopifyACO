-- 0013_monitoring — recurring schedules + alerts + notifications (Phase 8).
-- A schedule re-runs a benchmark (or a verification) on a cadence; after each run we
-- compare it to the previous one and raise an ALERT only when the change is
-- statistically credible (the 95% CI of the difference excludes 0 — never on
-- run-to-run noise). Alerts fan out through a notification provider (dev logger by
-- default; email when configured). Additive + idempotent. shop_domain scopes every row.

create table if not exists schedules (
  id            bigint generated always as identity primary key,
  shop_domain   text not null,
  kind          text not null default 'benchmark',  -- benchmark | verification
  benchmark_id  bigint,                              -- what to re-run
  experiment_id bigint,                              -- for kind=verification
  cadence       text not null default 'weekly',      -- daily | weekly | biweekly | monthly
  enabled       boolean not null default true,
  next_run_at   timestamptz not null default now(),
  last_run_at   timestamptz,
  last_run_id   bigint,                              -- benchmark_runs.id of the most recent run
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists schedules_due_idx on schedules (enabled, next_run_at);
create index if not exists schedules_shop_idx on schedules (shop_domain, created_at desc);

create table if not exists alerts (
  id            bigint generated always as identity primary key,
  shop_domain   text not null,
  schedule_id   bigint references schedules (id) on delete set null,
  run_id        bigint,                              -- the run that triggered evaluation
  prev_run_id   bigint,                              -- the baseline it was compared against
  type          text not null,                       -- regression | improvement | threshold | competitor_overtake
  severity      text not null default 'info',        -- info | warning | critical
  metric        text,                                -- e.g. recommendationRate
  title         text not null,
  detail        text,
  comparison    jsonb not null default '{}'::jsonb,   -- the CI-backed comparison behind the alert
  status        text not null default 'open',        -- open | acknowledged
  created_at    timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index if not exists alerts_shop_idx on alerts (shop_domain, created_at desc);
create index if not exists alerts_status_idx on alerts (shop_domain, status);

create table if not exists notifications (
  id            bigint generated always as identity primary key,
  shop_domain   text not null,
  alert_id      bigint references alerts (id) on delete cascade,
  channel       text not null default 'log',         -- log | email
  recipient     text,
  subject       text,
  body          text,
  status        text not null default 'sent',        -- sent | failed | skipped
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_shop_idx on notifications (shop_domain, created_at desc);

grant select, insert, update, delete on table schedules, alerts, notifications to service_role;
