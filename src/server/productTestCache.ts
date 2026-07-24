import type { ProductTestResult } from "./productTest.js";

// ===========================================================================
// PHASE B — PRODUCTION RESILIENCE for the public Buyer Test.
//
// In production every request originates from ONE Railway IP across many stores:
// the same crawl footprint, permanently. Dev runs were already 429'd by several
// stores. Three defenses, all in-process (no DB dependency, safe if the DB is down):
//   1. RESULT CACHE   — 24h per normalized product URL. A repeat test is served
//                       from cache and labeled with its age; an explicit re-run
//                       bypasses it at most once per hour per URL.
//   2. ROBOTS CACHE   — one robots.txt per host per hour, shared by all users.
//   3. HOST THROTTLE  — ≤1 request / 2s and ≤10 requests / hour per host, shared
//                       across all users. Exceeding the hourly budget is reported
//                       honestly as rate-limited rather than hammering the store.
// Bounded maps with LRU-ish eviction so a long-lived process can't grow unbounded.
// ===========================================================================

export const RESULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RERUN_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1h between forced re-runs
export const ROBOTS_TTL_MS = 60 * 60 * 1000; // 1h
export const HOST_MIN_INTERVAL_MS = 2_000; // ≤1 request / 2s per host
export const HOST_HOURLY_CAP = 10; // ≤10 requests / hour per host
const MAX_ENTRIES = 500;

interface CachedResult { result: ProductTestResult; storedAt: number; lastForcedAt: number }
const results = new Map<string, CachedResult>();

interface HostState { windowStart: number; count: number; lastRequestAt: number }
const hosts = new Map<string, HostState>();

/** Evict the oldest entries when a map outgrows its bound. */
function bound<T>(map: Map<string, T>): void {
  if (map.size <= MAX_ENTRIES) return;
  const excess = map.size - MAX_ENTRIES;
  let i = 0;
  for (const k of map.keys()) {
    if (i++ >= excess) break;
    map.delete(k);
  }
}

export interface ClockDeps { now?: () => number }
const nowOf = (d: ClockDeps) => (d.now ?? Date.now)();

// ---- result cache -----------------------------------------------------------

/** A cached result within TTL, stamped so the UI can label its age. Returns null
 *  on a miss or when `force` is honored (allowed at most once per hour per URL). */
export function getCachedResult(key: string, opts: { force?: boolean } & ClockDeps = {}): ProductTestResult | null {
  const now = nowOf(opts);
  const hit = results.get(key);
  if (!hit) return null;
  if (now - hit.storedAt > RESULT_TTL_MS) {
    results.delete(key);
    return null;
  }
  if (opts.force && now - hit.lastForcedAt >= RERUN_MIN_INTERVAL_MS) {
    hit.lastForcedAt = now; // consume the re-run allowance; caller does a live run
    return null;
  }
  return { ...hit.result, cached: true, testedAt: new Date(hit.storedAt).toISOString() };
}

export function storeResult(key: string, result: ProductTestResult, opts: ClockDeps = {}): void {
  const now = nowOf(opts);
  // Only successful results are cached — an error must be retryable immediately.
  if (!result.ok) return;
  results.delete(key); // re-insert so iteration order is recency for eviction
  results.set(key, { result: { ...result, cached: false, testedAt: new Date(now).toISOString() }, storedAt: now, lastForcedAt: now });
  bound(results);
}

// ---- per-host throttle ------------------------------------------------------

export type HostDecision = { ok: true; waitMs: number } | { ok: false; reason: "hourly_cap" };

/** Reserve one request against a host's budget. Returns how long the caller must
 *  wait to honor the ≥2s spacing, or refuses when the hourly cap is spent. */
export function reserveHostSlot(host: string, opts: ClockDeps = {}): HostDecision {
  const now = nowOf(opts);
  const s = hosts.get(host) ?? { windowStart: now, count: 0, lastRequestAt: 0 };
  if (now - s.windowStart >= 60 * 60 * 1000) {
    s.windowStart = now;
    s.count = 0;
  }
  if (s.count >= HOST_HOURLY_CAP) {
    hosts.set(host, s);
    return { ok: false, reason: "hourly_cap" };
  }
  const since = now - s.lastRequestAt;
  const waitMs = s.lastRequestAt === 0 ? 0 : Math.max(0, HOST_MIN_INTERVAL_MS - since);
  s.count++;
  s.lastRequestAt = now + waitMs;
  hosts.set(host, s);
  bound(hosts);
  return { ok: true, waitMs };
}

// ---- robots cache -----------------------------------------------------------

interface CachedRobots<T> { policy: T; storedAt: number }
const robots = new Map<string, CachedRobots<unknown>>();

export function getCachedRobots<T>(origin: string, opts: ClockDeps = {}): T | null {
  const hit = robots.get(origin);
  if (!hit) return null;
  if (nowOf(opts) - hit.storedAt > ROBOTS_TTL_MS) {
    robots.delete(origin);
    return null;
  }
  return hit.policy as T;
}

export function storeRobots<T>(origin: string, policy: T, opts: ClockDeps = {}): void {
  robots.set(origin, { policy, storedAt: nowOf(opts) });
  bound(robots);
}

/** Test-only: clear every cache/throttle map. */
export function __resetCaches(): void {
  results.clear();
  hosts.clear();
  robots.clear();
}
