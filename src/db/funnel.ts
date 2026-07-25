import { hasPg, pgQuery } from "./pg.js";
import { ENV } from "../server/env.js";
import { registrableDomain } from "../analysis/citedSources.js";

// ===========================================================================
// FUNNEL INSTRUMENTATION (v2.2 CP2) — the write + read side of `funnel_events`.
//
// Two rules this module exists to enforce, in code rather than in review notes:
//
//  1. NOTHING IDENTIFYING GETS IN. `toDomain()` is the only way a host reaches
//     the table, and it returns a registrable domain or null — a full URL cannot
//     survive it. There is no parameter here for a URL, an email, an IP or a
//     shop domain, so a future caller cannot pass one by accident.
//
//  2. TELEMETRY NEVER BREAKS THE REQUEST. `pgQuery` THROWS (unlike the
//     supabase-js helpers, which are graceful by construction), and this runs on
//     the public product-test path. Every write goes through `record()`, which
//     swallows and logs. A visitor must never lose a result because a counter
//     could not be written.
// ===========================================================================

export type FunnelEventName =
  | "test_requested"
  | "test_completed"
  | "test_failed"
  | "install_clicked"
  | "install_completed"
  | "case_viewed";

/** direct = no referrer; hosted_case = arrived from one of our /c/:token pages. */
export type ReferrerClass = "direct" | "hosted_case" | "other";

export interface FunnelEvent {
  name: FunnelEventName;
  testToken?: string | null;
  /** A HOST or URL — reduced to its registrable domain before it is stored. */
  host?: string | null;
  cached?: boolean | null;
  referrerClass?: ReferrerClass | null;
  durationMs?: number | null;
  fetchTier?: string | null;
  evidenced?: number | null;
  noBlocking?: number | null;
  notProven?: number | null;
  requiresAccess?: number | null;
  requirements?: number | null;
  semanticInvoked?: boolean | null;
  semanticCostUsd?: number | null;
  errorKind?: string | null;
  throttleSource?: string | null;
  robotsStatus?: string | null;
  policyStatus?: string | null;
  reconciled?: boolean | null;
  caseToken?: string | null;
}

/**
 * Reduce anything host-shaped to a registrable domain, or null.
 *
 * This is the privacy boundary. `registrableDomain` drops scheme, port, path,
 * query and `www.`, so "https://shop.example.com/products/blue-widget?utm=x"
 * becomes "example.com" — the product path, which is what actually reveals a
 * visitor's intent, cannot reach storage.
 */
export function toDomain(hostOrUrl: string | null | undefined): string | null {
  if (!hostOrUrl) return null;
  const d = registrableDomain(hostOrUrl);
  if (!d) return null;
  // `registrableDomain` deliberately passes bare IPs through unchanged — for citation
  // analysis, merging two distinct IPs into one bucket would be wrong. Here the
  // opposite is true: an IP literal is never a Shopify storefront's registrable
  // domain, it carries no analytic value, and storing it would contradict this
  // table's stated guarantee that no column can hold an IP (migration 0028). Covers
  // IPv4, bracketed IPv6, and the IPv4-mapped form `[::ffff:…]`, which the URL parser
  // rewrites to hex and which would otherwise slip past a dotted-quad check.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.includes(":") || d.startsWith("[")) return null;
  return d;
}

/**
 * Classify a Referer header WITHOUT storing it.
 *
 * `ourHost` is this deployment's own host, so a link from one of our hosted case
 * pages is recognised as outreach rather than as generic traffic — that is the
 * whole point of the class. Any other referrer collapses to "other"; we keep no
 * record of where it came from.
 */
export function classifyReferrer(referer: string | null | undefined, ourHost: string | null | undefined): ReferrerClass {
  const raw = (referer ?? "").trim();
  if (!raw) return "direct";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "other";
  }
  const sameHost = Boolean(ourHost) && u.host.toLowerCase() === String(ourHost).toLowerCase();
  if (sameHost && /^\/c\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return "hosted_case";
  return "other";
}

const COLUMNS = [
  "name", "test_token", "domain", "cached", "referrer_class", "duration_ms", "fetch_tier",
  "evidenced", "no_blocking", "not_proven", "requires_access", "requirements",
  "semantic_invoked", "semantic_cost_usd", "error_kind", "throttle_source",
  "robots_status", "policy_status", "reconciled", "case_token",
] as const;

/** Write one event. Never throws; returns whether the row landed. */
export async function recordFunnelEvent(ev: FunnelEvent): Promise<boolean> {
  // Kill switch (`FUNNEL_EVENTS=0`) — stop recording without a redeploy.
  if (!ENV.funnel.enabled) return false;
  if (!hasPg()) return false;
  const values = [
    ev.name,
    ev.testToken ?? null,
    toDomain(ev.host),
    ev.cached ?? null,
    ev.referrerClass ?? null,
    ev.durationMs ?? null,
    ev.fetchTier ?? null,
    ev.evidenced ?? null,
    ev.noBlocking ?? null,
    ev.notProven ?? null,
    ev.requiresAccess ?? null,
    ev.requirements ?? null,
    ev.semanticInvoked ?? null,
    ev.semanticCostUsd ?? null,
    ev.errorKind ?? null,
    ev.throttleSource ?? null,
    ev.robotsStatus ?? null,
    ev.policyStatus ?? null,
    ev.reconciled ?? null,
    ev.caseToken ?? null,
  ];
  const placeholders = values.map((_, i) => `$${i + 1}`).join(",");
  try {
    await pgQuery(`insert into funnel_events (${COLUMNS.join(",")}) values (${placeholders})`, values);
    return true;
  } catch (err) {
    // Deliberately a warning, not a throw: the caller is on a visitor's request path.
    console.warn(`[funnel] could not record ${ev.name}: ${(err as Error).message}`);
    return false;
  }
}

// ---- read surface -----------------------------------------------------------

export interface FunnelWindow {
  days: number;
  testsRequested: number;
  testsCompleted: number;
  testsFailed: number;
  uniqueDomains: number;
  /** (upstream throttles) / (completed + failed) — OUR OWN limiter is excluded. */
  throttleRate: number | null;
  throttleUpstream: number;
  throttleOurs: number;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
  /** Summed across every completed test in the window. */
  states: { evidenced: number; noBlocking: number; notProven: number; requiresAccess: number };
  /** Share of completed tests that produced at least one `not_proven` row. */
  actionableRate: number | null;
  installClicks: number;
  installCompleted: number;
  installsReconciled: number;
  /** Clicks per completed test, and completions per click. */
  installClickRate: number | null;
  installCompletionRate: number | null;
  caseViews: number;
  caseViewsByToken: Array<{ token: string; views: number }>;
  semanticSpendUsd: number;
  errorsByKind: Array<{ kind: string; n: number }>;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** Aggregate the last `days` days. Read-only; throws if the DB is unreachable
 *  (the caller is an authenticated admin surface, which should see the failure). */
export async function funnelWindow(days: number): Promise<FunnelWindow> {
  const since = `${days} days`;

  const { rows: counts } = await pgQuery<{ name: string; n: string }>(
    `select name, count(*)::bigint as n from funnel_events
      where at > now() - $1::interval group by name`,
    [since],
  );
  const byName = new Map(counts.map((r) => [r.name, Number(r.n)]));
  const n = (k: FunnelEventName) => byName.get(k) ?? 0;

  // Unique domains spans EVERY test, not just the completed ones. Scoping it to
  // `test_completed` reported 0 distinct hosts while nine real tests had run and
  // failed — which would have read as "no traffic" at exactly the moment the
  // product was most broken. (Caught by running it, not by review.)
  const { rows: domRows } = await pgQuery<{ unique_domains: string }>(
    `select count(distinct domain)::bigint as unique_domains from funnel_events
      where domain is not null and at > now() - $1::interval`,
    [since],
  );

  const { rows: aggRows } = await pgQuery<{
    median_ms: string | null; p95_ms: string | null;
    evidenced: string | null; no_blocking: string | null; not_proven: string | null;
    requires_access: string | null; actionable: string; completed: string; semantic_usd: string | null;
  }>(
    `select
       percentile_cont(0.5) within group (order by duration_ms)           as median_ms,
       percentile_cont(0.95) within group (order by duration_ms)          as p95_ms,
       sum(evidenced)                                                     as evidenced,
       sum(no_blocking)                                                   as no_blocking,
       sum(not_proven)                                                    as not_proven,
       sum(requires_access)                                               as requires_access,
       count(*) filter (where not_proven > 0)::bigint                     as actionable,
       count(*)::bigint                                                   as completed,
       coalesce(sum(semantic_cost_usd), 0)                                as semantic_usd
     from funnel_events
      where name = 'test_completed' and at > now() - $1::interval`,
    [since],
  );

  // The throttle split. `our_*` sources are OUR limiter/budget/cooldown and are
  // excluded from the numerator — counting them would report our own back-pressure
  // as a store refusing us, which is the failure mode CP2_METHOD.md warns about.
  const { rows: thrRows } = await pgQuery<{ upstream: string; ours: string }>(
    `select
       count(*) filter (where throttle_source = 'upstream')::bigint as upstream,
       count(*) filter (where throttle_source like 'our_%')::bigint as ours
     from funnel_events
      where name in ('test_completed','test_failed') and at > now() - $1::interval`,
    [since],
  );

  const { rows: recRows } = await pgQuery<{ reconciled: string }>(
    `select count(*) filter (where reconciled)::bigint as reconciled
       from funnel_events where name = 'install_completed' and at > now() - $1::interval`,
    [since],
  );

  const { rows: cases } = await pgQuery<{ case_token: string; n: string }>(
    `select case_token, count(*)::bigint as n from funnel_events
      where name = 'case_viewed' and case_token is not null and at > now() - $1::interval
      group by case_token order by n desc limit 50`,
    [since],
  );

  const { rows: errs } = await pgQuery<{ error_kind: string; n: string }>(
    `select coalesce(error_kind,'(none)') as error_kind, count(*)::bigint as n from funnel_events
      where name = 'test_failed' and at > now() - $1::interval
      group by 1 order by n desc`,
    [since],
  );

  const agg = aggRows[0];
  const thr = thrRows[0];
  const rec = recRows[0];
  const completed = Number(agg?.completed ?? 0);
  const failed = n("test_failed");
  const upstream = Number(thr?.upstream ?? 0);
  const ours = Number(thr?.ours ?? 0);
  const clicks = n("install_clicked");
  const installs = n("install_completed");

  return {
    days,
    testsRequested: n("test_requested"),
    testsCompleted: completed,
    testsFailed: failed,
    uniqueDomains: Number(domRows[0]?.unique_domains ?? 0),
    throttleRate: ratio(upstream, completed + failed),
    throttleUpstream: upstream,
    throttleOurs: ours,
    medianDurationMs: agg?.median_ms == null ? null : Math.round(Number(agg.median_ms)),
    p95DurationMs: agg?.p95_ms == null ? null : Math.round(Number(agg.p95_ms)),
    states: {
      evidenced: Number(agg?.evidenced ?? 0),
      noBlocking: Number(agg?.no_blocking ?? 0),
      notProven: Number(agg?.not_proven ?? 0),
      requiresAccess: Number(agg?.requires_access ?? 0),
    },
    actionableRate: ratio(Number(agg?.actionable ?? 0), completed),
    installClicks: clicks,
    installCompleted: installs,
    installsReconciled: Number(rec?.reconciled ?? 0),
    installClickRate: ratio(clicks, completed),
    installCompletionRate: ratio(installs, clicks),
    caseViews: n("case_viewed"),
    caseViewsByToken: cases.map((c) => ({ token: c.case_token, views: Number(c.n) })),
    semanticSpendUsd: Number(agg?.semantic_usd ?? 0),
    errorsByKind: errs.map((e) => ({ kind: e.error_kind, n: Number(e.n) })),
  };
}
