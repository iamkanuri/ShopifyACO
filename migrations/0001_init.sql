-- 0001_init — leads, runs, events. Minimal persistence for the public funnel.

create table if not exists leads (
  id          bigserial primary key,
  email       text not null,
  plan        text not null,
  source      text not null default 'cta',   -- cta | scan_gate | spend_cap
  run_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists leads_email_created_idx on leads (lower(email), created_at);

create table if not exists runs (
  id          text primary key,
  brand       text,
  category    text,
  status      text not null default 'pending', -- pending | running | complete | failed
  cost_usd    numeric not null default 0,
  email       text,                            -- for per-email daily limits
  ip          text,                            -- for per-IP daily limits
  created_at  timestamptz not null default now()
);
create index if not exists runs_created_idx on runs (created_at);
create index if not exists runs_email_created_idx on runs (lower(email), created_at);
create index if not exists runs_ip_created_idx on runs (ip, created_at);

create table if not exists events (
  id          bigserial primary key,
  name        text not null,                   -- scan_started | scan_completed | report_viewed | cta_full_report | cta_monitoring | lead_submitted
  run_id      text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_name_created_idx on events (name, created_at);
