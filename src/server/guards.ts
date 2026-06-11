import { createHash } from "node:crypto";
import type { Request } from "express";
import { ENV } from "./env.js";
import { countRunsByEmailToday, countRunsByIpToday, sumSpendTodayUsd } from "../db/supabase.js";

// Abuse + spend protection. These are the deployment TODOs made real.

// ---- client IP (Railway sits behind a proxy; trust X-Forwarded-For) --------
export function clientIp(req: Request): string {
  const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xff || req.ip || req.socket.remoteAddress || "unknown";
}

/** Privacy-preserving IP fingerprint for storage + per-IP daily counts. */
export function ipHash(ip: string): string {
  return createHash("sha256").update(ip + ENV.ipHashSalt).digest("hex").slice(0, 32);
}

// ---- in-memory sliding-window IP rate limiter ------------------------------
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length <= max;
}
// Periodically drop stale buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const live = arr.filter((t) => now - t < 60_000);
    if (live.length) hits.set(k, live);
    else hits.delete(k);
  }
}, 60_000).unref();

// ---- global daily spend cap ------------------------------------------------
// Authoritative = DB sum of today's run costs; in-memory accumulator is a backup
// that's always enforced even if the DB is unreachable. We use the max of both.
let memDay = utcDay();
let memSpend = 0;

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}
function rollover() {
  const d = utcDay();
  if (d !== memDay) {
    memDay = d;
    memSpend = 0;
  }
}

export function recordSpend(usd: number): void {
  rollover();
  memSpend += usd;
}

export async function currentSpendUsd(): Promise<number> {
  rollover();
  const dbSpend = await sumSpendTodayUsd();
  return Math.max(memSpend, dbSpend);
}

export interface SpendCheck {
  ok: boolean;
  spentUsd: number;
  capUsd: number;
}

/** True when starting a scan whose worst case is `estimateMaxUsd` stays under the cap. */
export async function spendAllows(estimateMaxUsd: number): Promise<SpendCheck> {
  rollover();
  const spentUsd = await currentSpendUsd();
  const capUsd = ENV.dailySpendCapUsd;
  return { ok: spentUsd + estimateMaxUsd <= capUsd, spentUsd, capUsd };
}

// ---- per-email / per-IP free-scan daily limits -----------------------------
export interface FreeScanCheck {
  ok: boolean;
  emailCount: number;
  ipCount: number;
  perEmail: number;
  perIp: number;
}

export async function freeScanAllowed(email: string, ipHashValue: string): Promise<FreeScanCheck> {
  const [emailCount, ipCount] = await Promise.all([countRunsByEmailToday(email), countRunsByIpToday(ipHashValue)]);
  return {
    ok: emailCount < ENV.freeScansPerEmailPerDay && ipCount < ENV.freeScansPerIpPerDay,
    emailCount,
    ipCount,
    perEmail: ENV.freeScansPerEmailPerDay,
    perIp: ENV.freeScansPerIpPerDay,
  };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (e: unknown): e is string =>
  typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e);
