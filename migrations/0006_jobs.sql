-- 0006_jobs — durable Postgres job system (Phase 1 production foundation).
-- Replaces the single-process in-memory scan lock with atomic, recoverable jobs,
-- multi-instance-safe spend reservations, and a usage ledger.
-- Additive + idempotent. Dormant relative to the live funnel until JOB_QUEUE_ENABLED=1
-- and a worker service exist (see LAUNCH_CHECKLIST.md). Runtime DML uses raw pg
-- (FOR UPDATE SKIP LOCKED), which supabase-js cannot express.

-- ---- jobs -----------------------------------------------------------------
create table if not exists jobs (
  id                 bigint generated always as identity primary key,
  type               text not null,
  status             text not null default 'queued',  -- queued|running|completed|failed|cancelled|dead_letter
  priority           int  not null default 100,        -- lower = sooner
  payload            jsonb not null default '{}'::jsonb,
  result             jsonb,
  idempotency_key    text,
  -- scoping for concurrency controls
  shop               text,
  user_id            text,
  email_hash         text,
  -- retry / lease
  attempts           int  not null default 0,
  max_attempts       int  not null default 5,
  run_after          timestamptz not null default now(),
  locked_at          timestamptz,
  locked_by          text,
  lease_expires_at   timestamptz,
  last_error         text,
  -- spend linkage
  reservation_id     bigint,
  spend_reserved_usd numeric(12,6) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- idempotent enqueue: at most one job per non-null key (across all time).
create unique index if not exists jobs_idempotency_key_uq
  on jobs (idempotency_key) where idempotency_key is not null;
-- claim path: next runnable queued job.
create index if not exists jobs_claim_idx
  on jobs (priority, run_after) where status = 'queued';
-- recovery path: running jobs whose lease expired.
create index if not exists jobs_lease_idx
  on jobs (lease_expires_at) where status = 'running';
create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_shop_idx on jobs (shop) where shop is not null;

-- ---- spend: per-day counter (locked for atomic reservation) ---------------
create table if not exists spend_days (
  day           date primary key,
  reserved_usd  numeric(12,6) not null default 0,  -- estimates currently held
  actual_usd    numeric(12,6) not null default 0,  -- reconciled real spend
  updated_at    timestamptz not null default now()
);

-- ---- spend: per-run reservation ledger ------------------------------------
create table if not exists spend_reservations (
  id          bigint generated always as identity primary key,
  day         date not null default current_date,
  run_id      text,
  estimate_usd numeric(12,6) not null default 0,
  actual_usd  numeric(12,6),
  status      text not null default 'active',  -- active|reconciled|released
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists spend_reservations_day_idx on spend_reservations (day, status);

-- ---- usage ledger ---------------------------------------------------------
create table if not exists usage_ledger (
  id                bigint generated always as identity primary key,
  run_id            text,
  shop              text,
  engine            text,
  model             text,
  plan              text,
  prompt_tokens     int,
  completion_tokens int,
  cost_usd          numeric(12,6) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists usage_ledger_run_idx on usage_ledger (run_id);
create index if not exists usage_ledger_created_idx on usage_ledger (created_at);

-- ---- process heartbeats (health checks for worker/scheduler) --------------
create table if not exists system_heartbeats (
  name       text primary key,   -- e.g. 'worker:<id>' or 'scheduler'
  at         timestamptz not null default now(),
  meta       jsonb not null default '{}'::jsonb
);

grant select, insert, update, delete on table
  jobs, spend_days, spend_reservations, usage_ledger, system_heartbeats to service_role;
