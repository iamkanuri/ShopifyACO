-- 0015_pixel — directional AI-referral attribution (Phase 10). A Shopify Web Pixel
-- extension (official Web Pixels API) runs on the storefront, detects sessions that
-- arrived from an AI assistant (ChatGPT/Perplexity/Gemini/Copilot/Claude) via the
-- referrer/UTM, and — only when customer-privacy ANALYTICS consent is granted — beacons
-- consent-aware funnel events to a public ingest endpoint. We store one row per event.
--
-- HONESTY: this is DIRECTIONAL ("identifiable AI-referred sessions"), NOT causal
-- attribution. The data is browser-self-reported and unauthenticated (a storefront
-- pixel can't hold a real secret); we scope it to installed shops, gate on consent,
-- and never store PII or raw IPs. Additive + idempotent. shop_domain scopes every row.

create table if not exists pixel_events (
  id            bigint generated always as identity primary key,
  shop_domain   text not null,
  session_id    text not null,                 -- random client nonce (NOT PII) tying a session's events
  event_type    text not null,                 -- session_start | product_viewed | checkout_started | checkout_completed
  ai_source     text,                          -- ChatGPT | Perplexity | Gemini | Copilot | Claude (server-classified)
  referrer_host text,                           -- host only (no full URL / query → no PII)
  utm_source    text,                           -- normalized utm_source when present
  landing_path  text,                           -- path only (query stripped)
  consent       boolean not null default true,  -- analytics consent state at capture (rows only stored when true)
  ip_hash       text,                           -- sha256(ip+salt), never the raw IP
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists pixel_events_shop_time_idx on pixel_events (shop_domain, occurred_at desc);
create index if not exists pixel_events_shop_source_idx on pixel_events (shop_domain, ai_source);
create index if not exists pixel_events_session_idx on pixel_events (shop_domain, session_id);

grant select, insert, update, delete on table pixel_events to service_role;
