import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ENV } from "./env.js";
import {
  eventCountAll,
  eventsSince,
  leadCountAll,
  leadsSince,
  listLeads,
  listRuns,
  runCountAll,
  runsSince,
  sumSpendTodayUsd,
  utcDayStart,
} from "../db/supabase.js";

export const ADMIN_COOKIE = "aco_admin";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Constant-time password check. Always false if no ADMIN_PASSWORD is configured. */
export function checkPassword(input: unknown): boolean {
  if (!ENV.adminPassword || typeof input !== "string") return false;
  return safeEqual(input, ENV.adminPassword);
}

function sign(payload: string): string {
  return createHmac("sha256", ENV.adminPassword ?? "no-admin").update(payload).digest("hex");
}

export function makeToken(): string {
  const ts = Date.now().toString();
  return `${ts}.${sign(ts)}`;
}

export function verifyToken(tok: string | undefined): boolean {
  if (!ENV.adminPassword || !tok) return false;
  const [ts, sig] = tok.split(".");
  if (!ts || !sig) return false;
  const age = Date.now() - Number(ts);
  if (Number.isNaN(age) || age < 0 || age > SESSION_MS) return false;
  return safeEqual(sig, sign(ts));
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function isAdmin(req: Request): boolean {
  return verifyToken(readCookie(req, ADMIN_COOKIE));
}

/** Gate for /api/admin/* — 401 if not authenticated. No public caching. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}

const count = (rows: { name: string }[], name: string) => rows.filter((r) => r.name === name).length;

/** Everything the admin cockpit renders, composed from Supabase. */
export async function buildAdminData() {
  const today = utcDayStart();
  const [runsToday, eventsToday, leadsTodayRows, spendToday, runs, leads] = await Promise.all([
    runsSince(today),
    eventsSince(today),
    leadsSince(today),
    sumSpendTodayUsd(),
    listRuns(100),
    listLeads(100),
  ]);

  const byStatus = (s: string) => runsToday.filter((r) => r.status === s).length;
  const leadsBySource = (src: string) => leadsTodayRows.filter((l) => l.source === src).length;
  const ctaToday = count(eventsToday, "cta_full_report") + count(eventsToday, "cta_monitoring");

  const summary = {
    scansStarted: runsToday.length,
    scansCompleted: byStatus("complete"),
    scansFailed: byStatus("failed"),
    spendUsd: Number(spendToday.toFixed(4)),
    capUsd: ENV.dailySpendCapUsd,
    remainingUsd: Number(Math.max(0, ENV.dailySpendCapUsd - spendToday).toFixed(4)),
    leads: leadsTodayRows.length,
    ctaClicks: ctaToday,
    scanGateSubmissions: leadsBySource("scan_gate"),
    rateLimitBlocks: count(eventsToday, "rate_limit_block"),
    dailyLimitBlocks: count(eventsToday, "daily_limit_block"),
    spendCapBlocks: count(eventsToday, "spend_cap_block"),
  };

  const funnel = [
    { step: "Email gate submitted", count: leadsBySource("scan_gate") },
    { step: "Scan started", count: count(eventsToday, "scan_started") },
    { step: "Scan completed", count: count(eventsToday, "scan_completed") },
    { step: "Report viewed", count: count(eventsToday, "report_viewed") },
    { step: "Pricing CTA clicked", count: ctaToday },
    { step: "Lead submitted", count: count(eventsToday, "lead_submitted") },
    { step: "Payment link clicked", count: count(eventsToday, "payment_link_clicked") },
  ];

  const errors = runs
    .filter((r) => r.status === "failed")
    .slice(0, 25)
    .map((r) => ({ runId: r.id, brand: r.brand, error: r.error ?? "(no detail)", createdAt: r.created_at }));

  // Launch metrics (all-time progress toward beta targets).
  const [totalRuns, totalLeads, payClicks, paidReports] = await Promise.all([
    runCountAll(),
    leadCountAll(),
    eventCountAll("payment_link_clicked"),
    eventCountAll("payment_completed"),
  ]);
  const launch = [
    { label: "Real store scans", value: totalRuns, target: 25 },
    { label: "Leads captured", value: totalLeads, target: 5 },
    { label: "Payment-link clicks", value: payClicks, target: 3 },
    { label: "Paid reports", value: paidReports, target: 1 },
  ];

  return { summary, funnel, runs, leads, errors, launch, generatedAt: new Date().toISOString() };
}
