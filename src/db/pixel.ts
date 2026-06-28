import { pgQuery } from "./pg.js";

// Pixel-event persistence + directional attribution aggregation (Phase 10). Shop-scoped.

export interface PixelEventRow {
  shop: string;
  sessionId: string;
  eventType: string;
  aiSource: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  landingPath: string | null;
  consent: boolean;
  ipHash: string | null;
  occurredAt: string;
}

export async function insertPixelEvent(e: PixelEventRow): Promise<void> {
  await pgQuery(
    `insert into pixel_events
       (shop_domain, session_id, event_type, ai_source, referrer_host, utm_source, landing_path, consent, ip_hash, occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.shop, e.sessionId, e.eventType, e.aiSource, e.referrerHost, e.utmSource, e.landingPath, e.consent, e.ipHash, e.occurredAt],
  );
}

/** Delete pixel_events older than `retentionDays` (data-retention purge). pixel_events
 *  holds personal-data-adjacent fields (referrer host, landing path, salted IP hash), so
 *  honoring a retention period lets us answer "yes" to Shopify's protected-data retention
 *  question. Purges on `created_at` (server ingestion time — not client-influenced like
 *  `occurred_at`). Returns the number of rows removed. */
export async function purgeExpiredPixelEvents(retentionDays: number): Promise<number> {
  const days = Math.max(1, Math.trunc(retentionDays));
  const { rowCount } = await pgQuery(
    `delete from pixel_events where created_at < now() - make_interval(days => $1::int)`,
    [days],
  );
  return rowCount ?? 0;
}

export interface PixelActivity {
  lastEventAt: string | null;
  totalEvents: number;
  eventsLast7d: number;
  sessionsLast7d: number; // distinct started sessions in the last 7 days
}

/** Recent pixel activity for the health panel — lets the merchant tell "no AI traffic"
 *  apart from "the pixel isn't running". Counts consented rows only. */
export async function pixelActivity(shop: string): Promise<PixelActivity> {
  const { rows } = await pgQuery<{ last_event: string | null; total: string; last7: string; sessions7: string }>(
    `select max(occurred_at)                                                       as last_event,
            count(*)::int                                                          as total,
            count(*) filter (where occurred_at >= now() - interval '7 days')::int  as last7,
            count(distinct case when event_type='session_start'
                                 and occurred_at >= now() - interval '7 days'
                            then session_id end)::int                              as sessions7
       from pixel_events where shop_domain=$1 and consent=true`,
    [shop],
  );
  const r = rows[0];
  return {
    lastEventAt: r?.last_event ?? null,
    totalEvents: Number(r?.total ?? 0),
    eventsLast7d: Number(r?.last7 ?? 0),
    sessionsLast7d: Number(r?.sessions7 ?? 0),
  };
}

export interface AttributionBySource {
  aiSource: string;
  sessions: number;       // distinct sessions that started from this source
  productViews: number;   // distinct such sessions that viewed a product
  checkouts: number;      // distinct such sessions that completed checkout
}

export interface Attribution {
  windowDays: number;
  totals: { sessions: number; productViews: number; checkouts: number };
  bySource: AttributionBySource[];
}

/** Directional AI-referral funnel over a trailing window. Only consented rows count.
 *  The funnel is computed PER SESSION and anchored on a real `session_start`: a session
 *  counts only if it started, and views/checkouts are subsets of started sessions. This
 *  keeps the funnel monotonic (views ≤ sessions, checkouts ≤ sessions) and forge-resistant
 *  — orphan product_viewed/checkout beacons with no session_start can't inflate the counts.
 *  Each session is attributed to the AI source on its session_start event. */
export async function attribution(shop: string, opts: { windowDays?: number } = {}): Promise<Attribution> {
  const windowDays = Math.min(365, Math.max(1, Math.trunc(opts.windowDays ?? 30)));
  const { rows } = await pgQuery<{ ai_source: string | null; sessions: string; product_views: string; checkouts: string }>(
    `with sess as (
       select session_id,
              max(ai_source) filter (where event_type='session_start') as source,
              bool_or(event_type='session_start')      as started,
              bool_or(event_type='product_viewed')     as viewed,
              bool_or(event_type='checkout_completed') as checked_out
         from pixel_events
        where shop_domain=$1 and consent=true and ai_source is not null
          and occurred_at >= now() - make_interval(days => $2::int)
        group by session_id
     )
     select coalesce(source, 'Unknown') as ai_source,
            count(*) filter (where started)::int                    as sessions,
            count(*) filter (where started and viewed)::int         as product_views,
            count(*) filter (where started and checked_out)::int    as checkouts
       from sess
      where started
      group by source
      order by sessions desc`,
    [shop, windowDays],
  );

  const bySource: AttributionBySource[] = rows.map((r) => ({
    aiSource: r.ai_source ?? "Unknown",
    sessions: Number(r.sessions),
    productViews: Number(r.product_views),
    checkouts: Number(r.checkouts),
  }));
  const totals = bySource.reduce(
    (t, s) => ({ sessions: t.sessions + s.sessions, productViews: t.productViews + s.productViews, checkouts: t.checkouts + s.checkouts }),
    { sessions: 0, productViews: 0, checkouts: 0 },
  );
  return { windowDays, totals, bySource };
}
