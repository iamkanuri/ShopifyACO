import { pgQuery } from "./pg.js";

// GDPR shop/redact (Phase 2 compliance). Shopify sends a `shop/redact` webhook ~48h after
// a store owner uninstalls the app; if we've stored data about the shop, we must erase it.
// This deletes EVERY shop-scoped row we hold. app/uninstalled already removed the offline
// token (markUninstalled); this completes the erasure of the remaining business data.

/**
 * All shop-scoped tables, ordered child → parent so a plain per-table delete never trips an
 * FK constraint (the benchmarks/feeds/monitoring/experiments groups have internal
 * `on delete cascade`, but deleting children first is correct regardless). Most tables key on
 * `shop_domain`; the durable-queue tables (migration 0006) key on `shop`.
 *
 * The table/column names are a FIXED internal allowlist — never user input — so interpolating
 * them into the SQL is safe; the shop value is always parameterized.
 */
export const SHOP_SCOPED_DELETES: ReadonlyArray<{ table: string; col: "shop_domain" | "shop" }> = [
  // measurement (observations → benchmark_runs → benchmarks)
  { table: "observations", col: "shop_domain" },
  { table: "benchmark_runs", col: "shop_domain" },
  { table: "benchmarks", col: "shop_domain" },
  // diagnosis / crawler
  { table: "findings", col: "shop_domain" },
  { table: "crawl_pages", col: "shop_domain" },
  // fix studio
  { table: "fix_proposals", col: "shop_domain" },
  // experiments (experiments → interventions)
  { table: "experiments", col: "shop_domain" },
  { table: "interventions", col: "shop_domain" },
  // monitoring (notifications → alerts → schedules)
  { table: "notifications", col: "shop_domain" },
  { table: "alerts", col: "shop_domain" },
  { table: "schedules", col: "shop_domain" },
  // product feeds (feed_items → feed_versions → feeds)
  { table: "feed_items", col: "shop_domain" },
  { table: "feed_versions", col: "shop_domain" },
  { table: "feeds", col: "shop_domain" },
  // catalog
  { table: "product_collections", col: "shop_domain" },
  { table: "product_variants", col: "shop_domain" },
  { table: "products", col: "shop_domain" },
  { table: "collections", col: "shop_domain" },
  { table: "catalog_snapshots", col: "shop_domain" },
  { table: "catalog_syncs", col: "shop_domain" },
  // AI-referral attribution
  { table: "pixel_events", col: "shop_domain" },
  // billing entitlements (the shop-keyed grant)
  { table: "entitlements", col: "shop_domain" },
  // durable queue + usage ledger (column is `shop`)
  { table: "usage_ledger", col: "shop" },
  { table: "jobs", col: "shop" },
  // shopify core: oauth/install/webhook/audit, then credentials, then the shop row last
  { table: "oauth_states", col: "shop_domain" },
  { table: "webhook_events", col: "shop_domain" },
  { table: "installations", col: "shop_domain" },
  { table: "audit_log", col: "shop_domain" },
  { table: "shop_credentials", col: "shop_domain" },
  { table: "shops", col: "shop_domain" },
];

/**
 * Erase all data we hold for `shop`. Best-effort per table — one table's failure is logged
 * and the rest still run, so the erasure is as complete as possible (compliance goal). Returns
 * rows removed per table (and a `<table>:error` marker for any table that failed).
 */
export async function redactShop(shop: string): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  for (const { table, col } of SHOP_SCOPED_DELETES) {
    try {
      const { rowCount } = await pgQuery(`delete from ${table} where ${col} = $1`, [shop]);
      if (rowCount) summary[table] = rowCount;
    } catch (err) {
      console.error(`[redact] failed to purge ${table} for ${shop}:`, (err as Error).message);
      summary[`${table}:error`] = -1;
    }
  }
  return summary;
}
