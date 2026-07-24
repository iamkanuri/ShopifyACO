import type { ProductTestResult } from "./productTest.js";

// ===========================================================================
// PHASE B — PRODUCTION RESILIENCE for the public Buyer Test.
//
// In production every request originates from ONE Railway IP across many stores:
// the same crawl footprint, permanently. Dev runs were already 429'd by several
// stores. Five defenses, all in-process (no DB dependency, safe if the DB is down):
//   1. RESULT CACHE   — 7d per normalized product URL. A repeat test is served
//                       from cache and labeled with its age; an explicit re-run
//                       bypasses it at most once per hour per URL.
//   2. ROBOTS CACHE   — one robots.txt per host per hour, shared by all users.
//   3. HOST THROTTLE  — ≤1 request / 2s and ≤10 requests / hour per host, shared
//                       across all users. Exceeding the hourly budget is reported
//                       honestly as rate-limited rather than hammering the store.
//   4. GLOBAL EGRESS  — V2 §2.2. The observed 429 was `local_rate_limited`, applied
//                       PER-EGRESS-IP and ENDPOINT-SPECIFIC across ALL Shopify
//                       stores — untouched stores 429'd while their robots.txt and
//                       policy pages answered 200. Per-host limiting cannot help
//                       because the limiter does not count per host. So the process
//                       also holds ONE Shopify-wide budget (default 20 fetches/min)
//                       plus a small concurrency gate: bursts WAIT, they never
//                       stampede one IP into a global block.
//   5. THROTTLE COOLDOWN — V2 §2.4. A host that just 429'd is negatively cached for
//                       10 minutes, so repeat visitors don't burn the global budget
//                       re-discovering the same block.
// Bounded maps with LRU-ish eviction so a long-lived process can't grow unbounded.
// ===========================================================================

export const RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d (V2 §2.4)
export const RERUN_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1h between forced re-runs
export const ROBOTS_TTL_MS = 60 * 60 * 1000; // 1h
export const HOST_MIN_INTERVAL_MS = 2_000; // ≤1 request / 2s per host
export const HOST_HOURLY_CAP = 10; // ≤10 requests / hour per host
/** A host that answered 429/403 is not retried for this long (V2 §2.4). */
export const THROTTLE_COOLDOWN_MS = 10 * 60 * 1000; // 10min
const MAX_ENTRIES = 500;

// ---- global (process-wide, all-hosts) Shopify egress budget — V2 §2.2 -------
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Shopify-wide fetch budget per rolling minute. Deliberately conservative: the
 *  limiter we are protecting against counts our EGRESS IP, not the store. */
export const EGRESS_PER_MIN = num(process.env.PRODUCT_TEST_EGRESS_PER_MIN, 20);
/** How many outbound Shopify fetches may be in flight at once (anti-stampede). */
export const EGRESS_CONCURRENCY = num(process.env.PRODUCT_TEST_EGRESS_CONCURRENCY, 2);
/** Past this the request is refused rather than parked — a visitor must never sit
 *  on a spinner. A refusal degrades honestly (§2.3), it does not error the test. */
export const EGRESS_MAX_WAIT_MS = num(process.env.PRODUCT_TEST_EGRESS_MAX_WAIT_MS, 10_000);
const EGRESS_WINDOW_MS = 60_000;

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

// ---- global egress budget + concurrency gate (V2 §2.2) ----------------------

/** Timestamps of reserved Shopify fetches inside the rolling window. */
let egressWindow: number[] = [];

export type EgressDecision = { ok: true; waitMs: number } | { ok: false; reason: "global_budget" };

/** Reserve one slot against the PROCESS-WIDE Shopify budget. Returns how long the
 *  caller must wait before firing; refuses only when that wait would exceed
 *  `EGRESS_MAX_WAIT_MS` (the caller then degrades honestly rather than erroring).
 *
 *  This is the defense the per-host throttle structurally cannot provide: the
 *  upstream limiter counts our egress IP across every Shopify store, so the budget
 *  has to be counted the same way. */
export function reserveEgressSlot(opts: ClockDeps = {}): EgressDecision {
  const now = nowOf(opts);
  egressWindow = egressWindow.filter((t) => now - t < EGRESS_WINDOW_MS);
  if (egressWindow.length < EGRESS_PER_MIN) {
    egressWindow.push(now);
    return { ok: true, waitMs: 0 };
  }
  // The window is full: the oldest reservation dictates when a slot frees.
  const oldest = Math.min(...egressWindow);
  const waitMs = Math.max(0, EGRESS_WINDOW_MS - (now - oldest));
  if (waitMs > EGRESS_MAX_WAIT_MS) return { ok: false, reason: "global_budget" };
  egressWindow.push(now + waitMs); // reserve the future slot so callers queue, not race
  return { ok: true, waitMs };
}

// A tiny semaphore. Concurrent visitors share one egress IP, so N simultaneous
// tests must not become N simultaneous outbound requests.
let egressActive = 0;
const egressWaiters: Array<() => void> = [];

/** Run `fn` holding one of `EGRESS_CONCURRENCY` outbound slots. */
export async function withEgressSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (egressActive >= EGRESS_CONCURRENCY) {
    await new Promise<void>((resolve) => egressWaiters.push(resolve));
  }
  egressActive++;
  try {
    return await fn();
  } finally {
    egressActive--;
    egressWaiters.shift()?.();
  }
}

// ---- throttled-host negative cache (V2 §2.4) --------------------------------

const throttledHosts = new Map<string, number>(); // host → when it throttled us

/** Record that a host answered 429/403 so we stop re-discovering the block. */
export function markHostThrottled(host: string, opts: ClockDeps = {}): void {
  throttledHosts.delete(host);
  throttledHosts.set(host, nowOf(opts));
  bound(throttledHosts);
}

/** Milliseconds remaining on a host's cooldown, or 0 when it is clear. */
export function hostThrottleCooldownMs(host: string, opts: ClockDeps = {}): number {
  const at = throttledHosts.get(host);
  if (at === undefined) return 0;
  const left = THROTTLE_COOLDOWN_MS - (nowOf(opts) - at);
  if (left <= 0) {
    throttledHosts.delete(host);
    return 0;
  }
  return left;
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
  throttledHosts.clear();
  egressWindow = [];
}
