import { createHash } from "node:crypto";
import type { Request } from "express";
import { ENV } from "./env.js";
import { countRunsByEmailToday, countRunsByIpToday, sumSpendTodayUsd } from "../db/supabase.js";

// Abuse + spend protection. These are the deployment TODOs made real.

// ---- client IP (spoof-resistant behind Railway's edge proxy) ---------------
// Railway's edge (Envoy) sets X-Envoy-External-Address to the REAL external client IP —
// a single, trusted value the client cannot forge (Envoy sanitizes inbound x-envoy-*
// headers at the edge). Prefer it. Fall back to Express's proxy-aware req.ip, then the raw
// socket (local dev). We deliberately do NOT trust the leftmost X-Forwarded-For entry: it
// is client-controlled, so using it would let an attacker evade per-IP rate limits or
// poison another visitor's abuse counts by forging the header. For a legitimate client the
// Envoy value equals what XFF would have been, so normal rate-limiting behavior is unchanged.
export function clientIp(req: Request): string {
  const envoy = (req.headers["x-envoy-external-address"] as string | undefined)?.trim();
  if (envoy) return envoy;
  return req.ip || req.socket.remoteAddress || "unknown";
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

// Value-first: the RUN is now ungated (no email), so it's bounded per-IP/day (+ the global
// spend cap). Claiming a report (adding an email) is bounded per-email/day.
export interface UngatedScanCheck { ok: boolean; ipCount: number; perIp: number }
export async function ungatedScanAllowed(ipHashValue: string): Promise<UngatedScanCheck> {
  const ipCount = await countRunsByIpToday(ipHashValue);
  return { ok: ipCount < ENV.freeScansPerIpUngated, ipCount, perIp: ENV.freeScansPerIpUngated };
}

export interface ClaimCheck { ok: boolean; emailCount: number; perEmail: number }
export async function claimAllowed(email: string): Promise<ClaimCheck> {
  const emailCount = await countRunsByEmailToday(email);
  return { ok: emailCount < ENV.freeScansPerEmailPerDay, emailCount, perEmail: ENV.freeScansPerEmailPerDay };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (e: unknown): e is string =>
  typeof e === "string" && e.length <= 254 && EMAIL_RE.test(e);
