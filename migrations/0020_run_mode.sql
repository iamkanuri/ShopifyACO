-- 0020_run_mode — distinguish MOCK ($0 deterministic) runs from LIVE (real engine) runs on
-- benchmark_runs (S7). Mock runs are created by experiments/monitoring and share the same
-- table as live measurement, so without a mode flag a mock fixture run could become a
-- merchant's "latest" dashboard result. The dashboard now reads only the latest LIVE run.
--
-- Additive + idempotent. Existing rows default to 'live' — we can't retroactively know the
-- mode of past runs, so the fix is forward-looking: every NEW run is labeled at creation.

alter table benchmark_runs add column if not exists mode text not null default 'live';

-- Dashboard access path: latest COMPLETED LIVE run per shop.
create index if not exists benchmark_runs_shop_mode_time_idx
  on benchmark_runs (shop_domain, mode, status, started_at desc);
