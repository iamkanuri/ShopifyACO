// Pure, dependency-free retry/backoff logic for the job queue. Kept separate from
// the DB layer so it is fully unit-testable (see test/queue.test.ts).

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "dead_letter";

export interface BackoffOpts {
  baseMs?: number; // first retry delay
  maxMs?: number; // cap
  factor?: number; // exponential factor
  jitter?: number; // 0..1 fraction of full jitter
}

const DEFAULTS: Required<BackoffOpts> = { baseMs: 2_000, maxMs: 5 * 60_000, factor: 2, jitter: 0.25 };

/** Exponential backoff with bounded jitter for retry `attempt` (1-based). */
export function backoffMs(attempt: number, opts: BackoffOpts = {}, rnd: () => number = Math.random): number {
  const o = { ...DEFAULTS, ...opts };
  const a = Math.max(1, Math.floor(attempt));
  const raw = Math.min(o.maxMs, o.baseMs * Math.pow(o.factor, a - 1));
  const jitterSpan = raw * o.jitter;
  const delta = (rnd() * 2 - 1) * jitterSpan; // ±jitterSpan
  return Math.max(0, Math.round(raw + delta));
}

/** After a failure on `attempts` (already incremented), retry or dead-letter? */
export function decideFailure(attempts: number, maxAttempts: number): "retry" | "dead_letter" {
  return attempts >= maxAttempts ? "dead_letter" : "retry";
}

/** Next eligible run time after a retry. */
export function nextRunAfter(attempt: number, now: Date = new Date(), opts: BackoffOpts = {}, rnd?: () => number): Date {
  return new Date(now.getTime() + backoffMs(attempt, opts, rnd));
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "cancelled", "dead_letter"]);
export const isTerminal = (s: JobStatus): boolean => TERMINAL.has(s);

/** Normalize an idempotency key (trim, lowercase, collapse whitespace). Empty → undefined. */
export function normalizeIdempotencyKey(key: string | undefined | null): string | undefined {
  if (!key) return undefined;
  const k = key.trim().toLowerCase().replace(/\s+/g, " ");
  return k.length ? k.slice(0, 200) : undefined;
}
