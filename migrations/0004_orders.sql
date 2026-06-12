-- 0004_orders — paid orders confirmed by the Stripe webhook (proof of payment).
-- /thanks is only a funnel event; a row here means a verified checkout.session.completed.
-- Idempotent on session_id so duplicate webhook deliveries never double-insert.

create table if not exists orders (
  id            bigserial primary key,
  session_id    text unique not null,            -- Stripe checkout session id (dedupe key)
  event_id      text,                            -- Stripe event id (for tracing)
  email         text,
  plan          text,                            -- full_report | monitoring | founder_beta | unknown
  amount_usd    numeric not null default 0,
  currency      text not null default 'usd',
  status        text not null default 'paid',    -- paid | scanning | fulfilled
  source_run_id text,                            -- run that generated the report (client_reference_id)
  scan_run_id   text,                            -- deep scan started for fulfillment
  created_at    timestamptz not null default now(),
  fulfilled_at  timestamptz
);
create index if not exists orders_created_idx on orders (created_at);
create index if not exists orders_status_idx on orders (status, created_at);

-- service_role connects with the secret key; new table + sequence need explicit grants
-- (see 0002_grants). Re-granting all sequences also covers this table's bigserial.
grant select, insert, update, delete on table orders to service_role;
grant usage, select on all sequences in schema public to service_role;
