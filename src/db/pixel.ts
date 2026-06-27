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
 *  Sessions/views/checkouts are DISTINCT session counts (a session that viewed 3
 *  products counts once), so the funnel is honest. */
export async function attribution(shop: string, opts: { windowDays?: number } = {}): Promise<Attribution> {
  const windowDays = Math.min(365, Math.max(1, Math.trunc(opts.windowDays ?? 30)));
  const { rows } = await pgQuery<{ ai_source: string | null; sessions: string; product_views: string; checkouts: string }>(
    `select ai_source,
            count(distinct case when event_type='session_start'      then session_id end)::int as sessions,
            count(distinct case when event_type='product_viewed'     then session_id end)::int as product_views,
            count(distinct case when event_type='checkout_completed' then session_id end)::int as checkouts
       from pixel_events
      where shop_domain=$1 and consent=true and ai_source is not null
        and occurred_at >= now() - make_interval(days => $2::int)
      group by ai_source
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
