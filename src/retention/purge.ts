import { hasPg } from "../db/pg.js";
import { purgeExpiredPixelEvents } from "../db/pixel.js";

// ===========================================================================
// Data-retention purge (compliance). The scheduler (PROCESS_MODE=scheduler) calls
// runRetentionPurge each tick; it self-throttles to once per day and deletes the
// personal-data-adjacent rows we keep past their retention window. Today that's
// pixel_events (AI-referral attribution: referrer host + landing path + salted IP
// hash). Best-effort and logged — a missed day is harmless (data is still within
// retention+1 days) and never crashes the scheduler loop.
// ===========================================================================

// Retention window for pixel_events. MUST stay in sync with the figure stated on the
// /privacy page (viewer/src/pages/PrivacyPage.tsx) — the two are intentionally
// duplicated because the viewer bundle imports nothing from src/.
export const PIXEL_RETENTION_DAYS = 90;

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // run the purge at most once per day

/** Pure: is a purge due given the last run time? True on the first run (lastAt=0). */
export function isPurgeDue(lastAt: number, now: number, intervalMs = PURGE_INTERVAL_MS): boolean {
  return now - lastAt >= intervalMs;
}

let lastPurgeAt = 0;

export interface RetentionResult {
  ran: boolean;
  pixelEventsDeleted?: number;
}

/** Best-effort daily retention purge, called every scheduler tick. Self-throttles to
 *  once per day (in-memory) and no-ops without a Postgres connection. Claims the daily
 *  slot BEFORE the delete so a transient failure waits until tomorrow rather than
 *  retrying every tick. Tests can inject `purge`/`now` to exercise the throttle. */
export async function runRetentionPurge(
  opts: { now?: number; purge?: (days: number) => Promise<number> } = {},
): Promise<RetentionResult> {
  // An injected purge (tests) bypasses the connection gate; the real path needs pg.
  if (!opts.purge && !hasPg()) return { ran: false };
  const now = opts.now ?? Date.now();
  if (!isPurgeDue(lastPurgeAt, now)) return { ran: false };
  lastPurgeAt = now;
  const purge = opts.purge ?? purgeExpiredPixelEvents;
  const pixelEventsDeleted = await purge(PIXEL_RETENTION_DAYS);
  return { ran: true, pixelEventsDeleted };
}

/** Test-only: reset the in-memory throttle so each test starts fresh. */
export function __resetRetentionThrottle(): void {
  lastPurgeAt = 0;
}
