import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { funnelWindow, type FunnelWindow } from "../db/funnel.js";

// ===========================================================================
// THE FUNNEL READ SURFACE (v2.2 CP2) — internal, double-gated, never public.
//
// Deliberately an ENDPOINT rather than a React page. The SPA catch-all serves
// viewer/dist/index.html for every non-/api path with NO server-side auth (the
// /admin page itself is publicly loadable; only its data is protected). A new
// internal *page* would inherit that, ship another eager bundle to every
// visitor, and still need the API gate anyway. An endpoint under /api/admin
// gets the existing `requireAdmin` gate, is already Disallow-ed in robots.txt,
// and renders fine in a browser as text/plain.
//
// Two locks, because either alone is weaker than it looks:
//   • FUNNEL_ADMIN_ENABLED — opt-in, so the surface does not exist by default;
//   • requireAdmin         — the constant-time cookie session.
// ===========================================================================

const pct = (r: number | null): string => (r == null ? "     —" : `${(r * 100).toFixed(1).padStart(5)}%`);
const num = (n: number | null): string => (n == null ? "—" : String(n));

/** Fixed-width text so it is readable over curl and in a browser without a bundle. */
export function renderFunnel(windows: FunnelWindow[]): string {
  const lines: string[] = [];
  lines.push("AisleLens — funnel");
  lines.push("=".repeat(64));
  for (const w of windows) {
    lines.push("");
    lines.push(`LAST ${w.days} DAYS`);
    lines.push("-".repeat(64));
    lines.push(`  tests requested        ${w.testsRequested}`);
    lines.push(`  tests completed        ${w.testsCompleted}`);
    lines.push(`  tests failed           ${w.testsFailed}`);
    lines.push(`  unique domains         ${w.uniqueDomains}`);
    lines.push("");
    // The metric EGRESS_DECISION.md named as the thing to watch. Our own
    // back-pressure is reported alongside but NEVER inside the rate.
    // Never render the rate without its denominator: "0%" over 3 attempts and "0%"
    // over 300 are different facts, and the egress decision turns on this number.
    lines.push(`  throttle rate          ${pct(w.throttleRate)}   (upstream ${w.throttleUpstream} of ${w.throttleAttempted} that reached a store)`);
    lines.push(`    our own throttles    ${w.throttleOurs}   (excluded from BOTH sides of the rate)`);
    lines.push(`  duration median / p95  ${num(w.medianDurationMs)}ms / ${num(w.p95DurationMs)}ms`);
    lines.push("");
    lines.push("  result states (summed over completed tests)");
    lines.push(`    evidenced            ${w.states.evidenced}`);
    lines.push(`    no blocking evidence ${w.states.noBlocking}`);
    lines.push(`    not proven           ${w.states.notProven}`);
    lines.push(`    requires access      ${w.states.requiresAccess}`);
    lines.push(`  tests with >=1 not-proven row   ${pct(w.actionableRate)}`);
    lines.push("");
    lines.push(`  install clicks         ${w.installClicks}   (${pct(w.installClickRate)} of completed tests)`);
    lines.push(`  installs completed     ${w.installCompleted}   (${pct(w.installCompletionRate)} of clicks)`);
    lines.push(`    of which reconciled  ${w.installsReconciled}`);
    lines.push("");
    lines.push(`  case views             ${w.caseViews}`);
    for (const c of w.caseViewsByToken) lines.push(`    ${c.token}  ${c.views}`);
    lines.push("");
    lines.push(`  semantic spend         $${w.semanticSpendUsd.toFixed(4)}`);
    if (w.errorsByKind.length) {
      lines.push("  failures by kind");
      for (const e of w.errorsByKind) lines.push(`    ${e.kind.padEnd(20)} ${e.n}`);
    }
  }
  lines.push("");
  lines.push("Rates are counts over a small sample; read them as direction, not precision.");
  return lines.join("\n");
}

/** GET /api/admin/funnel — text by default, `?format=json` for the raw windows. */
export async function funnelHandler(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (!ENV.funnel.adminEnabled) {
    // 404 rather than 403, so an authenticated admin can't tell "off" from "absent"
    // and a stale bookmark reads as gone rather than forbidden. Note this is reached
    // only AFTER `requireAdmin`, so an unauthenticated prober still sees 401 — the
    // same 401 every other /api/admin/* route gives. The flag is a second lock on
    // the data, not concealment of the path.
    res.status(404).json({ error: "Not found." });
    return;
  }
  try {
    const windows = await Promise.all([funnelWindow(7), funnelWindow(30)]);
    if (req.query.format === "json") {
      res.json({ windows });
      return;
    }
    res.type("text/plain; charset=utf-8").send(renderFunnel(windows));
  } catch (err) {
    // An admin surface SHOULD see its own failure — unlike the write path, which
    // degrades silently so a visitor never pays for a broken counter.
    res.status(503).json({ error: `funnel unavailable: ${(err as Error).message}` });
  }
}
