-- 0022_pixel_integrity — attribution-ingest integrity (#12 follow-up). Two additive parts:
--   1. pixel_events.event_id + a partial unique index → idempotent ingest: a beacon that
--      retries (keepalive fetch can double-fire) is deduped instead of double-counted.
--   2. shops.pixel_ingest_token → a per-shop, unguessable token injected into that shop's
--      Web Pixel settings and required (soft → strict) on ingest. It ships to the browser so
--      it's anti-abuse, NOT auth — but it scopes forgery to a single shop (vs the global
--      shared secret), which is the defense-in-depth the audit asked for.
-- Additive + idempotent.

alter table pixel_events add column if not exists event_id text;
-- Unique only where present, so legacy rows (no event_id) don't collide on NULL.
create unique index if not exists pixel_events_shop_event_uidx
  on pixel_events (shop_domain, event_id) where event_id is not null;

alter table shops add column if not exists pixel_ingest_token text;
