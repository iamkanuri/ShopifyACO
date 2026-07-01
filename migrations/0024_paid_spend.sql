-- Paid-report Phase 2 (hard budget isolation): a SEPARATE daily spend counter for paid deep-report
-- generation. The shared queue counter (spend_days) is drawn on by live benchmarks/monitoring; the
-- free funnel counts against `runs.cost_usd`. Paid reserves/settles against THIS table ONLY, so
-- nothing else in the system can starve a paying customer's generation — the guarantee, not "low
-- risk unless MONITORING_LIVE flips". Additive.
create table if not exists paid_spend_days (
  day        date primary key,
  spent_usd  numeric not null default 0,
  updated_at timestamptz not null default now()
);
