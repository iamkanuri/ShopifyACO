import { pgQuery } from "../db/pg.js";

// Usage counters for entitlement-limit enforcement (Phase 11). Read straight from the
// existing tables that already record the work — no new bookkeeping to drift out of sync.
// Shop-scoped. Graceful: any counter that can't be read returns 0 (fail-open on read).

export interface ShopUsage {
  benchmarksLast30d: number;
  monitoringSchedules: number; // active (enabled) schedules
  feeds: number;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  try {
    const { rows } = await pgQuery<{ n: string }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    console.error("[usage] count failed:", (err as Error).message);
    return 0;
  }
}

/** Benchmark runs started by a shop in the last 30 days (mock + live). */
export function benchmarksLast30d(shop: string): Promise<number> {
  return count(
    "select count(*)::int n from benchmark_runs where shop_domain=$1 and started_at > now() - interval '30 days'",
    [shop],
  );
}

/** Active (enabled) recurring monitoring schedules for a shop. */
export function activeSchedules(shop: string): Promise<number> {
  return count("select count(*)::int n from schedules where shop_domain=$1 and enabled = true", [shop]);
}

/** Distinct product feeds defined by a shop. */
export function feedCount(shop: string): Promise<number> {
  return count("select count(*)::int n from feeds where shop_domain=$1", [shop]);
}

export async function shopUsage(shop: string): Promise<ShopUsage> {
  const [benchmarksLast30dN, monitoringSchedules, feeds] = await Promise.all([
    benchmarksLast30d(shop),
    activeSchedules(shop),
    feedCount(shop),
  ]);
  return { benchmarksLast30d: benchmarksLast30dN, monitoringSchedules, feeds };
}
