import { DEMO, type AppAlertRow, type AppAttribution, type AppBilling, type AppDashboard, type AppExperimentRow, type AppFindingRow, type AppPixelHealth, type AppProductRow, type AppProposalRow, type AppRunRow, type AppScheduleRow, type AppShopInfo, type Proportion } from "./fixtures";

// Client for the authenticated /app/api/* surface. Every call tries the live API; if
// there's no shop session (401) or the backend is unavailable, it transparently falls
// back to DEMO fixtures and flags `demo: true` so the UI can show a "Demo data" badge.
// This doubles as the spec's unavailable/denied state — we never fake liveness.

export interface Loaded<T> { data: T; demo: boolean; error?: string }

// App Bridge (loaded server-side only on /app routes) exposes a global `shopify`. When the
// app runs embedded in Shopify admin's iframe the SameSite cookie isn't sent, so we attach
// a short-lived session token (Authorization: Bearer) the server verifies. Outside the embed
// `shopify` is absent and the signed cookie is used instead — same code path either way.
function appBridge(): { idToken?: () => Promise<string> } | undefined {
  return (window as unknown as { shopify?: { idToken?: () => Promise<string> } }).shopify;
}
async function idToken(): Promise<string | null> {
  try { return (await appBridge()?.idToken?.()) ?? null; } catch { return null; }
}
async function withAuth(headers: Record<string, string>): Promise<Record<string, string>> {
  const token = await idToken();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

// Embedded install handshake. On a merchant's FIRST embedded load there's a valid App
// Bridge session token but no shop row yet (Shopify's managed install never hits our OAuth
// callback), so /app/api/* returns 401. We do a one-time token-exchange bootstrap
// (POST /api/shopify/token) which installs the shop server-side, then retry the request.
// Deduped across concurrent calls; success is cached for the page's lifetime, a failure
// resets so a later call can retry. Non-embedded (no token) → returns false → demo path.
let sessionBootstrap: Promise<boolean> | null = null;
async function doBootstrap(): Promise<boolean> {
  const token = await idToken();
  if (!token) return false;
  try {
    const res = await fetch(`/api/shopify/token`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}
function ensureSession(): Promise<boolean> {
  if (sessionBootstrap) return sessionBootstrap;
  const p = doBootstrap();
  sessionBootstrap = p;
  p.then((ok) => { if (!ok) sessionBootstrap = null; }).catch(() => { sessionBootstrap = null; });
  return p;
}

/**
 * Proactively refresh the embedded session on app load. Shopify offline tokens now EXPIRE
 * (and legacy non-expiring tokens are rejected), so the server must re-exchange the App Bridge
 * session token for a fresh offline token periodically. Relying on a 401 to trigger that fails
 * once a token lapses but the shop row still looks valid (requireShop passes, no 401 fires).
 * Running the bootstrap once on mount keeps a currently-valid token on file. No-op outside the
 * Shopify admin iframe (no App Bridge → no session token).
 */
export function primeSession(): void {
  if (appBridge()) void ensureSession();
}

// Are we in a CONNECTED merchant context (embedded, or a prior call already succeeded)?
// Used to tell a genuine no-session PREVIEW (show the labeled sample cleanly) apart from a
// real backend failure for a connected store (must surface an error, never silently pass
// fixtures off as live — that would mask outages/regressions). Set once a call succeeds.
let knownConnected = false;
function inMerchantContext(): boolean {
  return knownConnected || Boolean(appBridge());
}

async function load<T>(url: string, fallback: T): Promise<Loaded<T>> {
  try {
    let res = await fetch(url, { headers: await withAuth({ accept: "application/json" }) });
    if (res.status === 401 && (await ensureSession())) {
      res = await fetch(url, { headers: await withAuth({ accept: "application/json" }) });
    }
    if (res.ok) {
      knownConnected = true;
      return { data: (await res.json()) as T, demo: false };
    }
    // A genuine no-session preview (401/503 and NOT a merchant context) → clean sample.
    // Anything else (a connected merchant's failure, or any 5xx) → sample BUT flagged with
    // an error so the UI shows "live data unavailable", not a silent demo.
    if ((res.status === 401 || res.status === 503) && !inMerchantContext()) {
      return { data: fallback, demo: true };
    }
    return { data: fallback, demo: true, error: `HTTP ${res.status}` };
  } catch {
    return { data: fallback, demo: true, error: inMerchantContext() ? "network error" : undefined };
  }
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string; demo?: boolean }> {
  try {
    const send = async () => fetch(url, { method: "POST", headers: await withAuth({ "content-type": "application/json" }), body: JSON.stringify(body) });
    let res = await send();
    if (res.status === 401 && (await ensureSession())) res = await send();
    if (res.status === 401) return { ok: false, demo: true, error: "Connect your store to perform this action." };
    const data = await res.json().catch(() => ({}));
    // Surface the server's real reason: handlers return `error` OR `detail` (apply/rollback
    // use `detail`). Showing a bare "HTTP 422" hid why a fix apply failed.
    if (!res.ok) return { ok: false, error: (data as { error?: string; detail?: string }).error ?? (data as { detail?: string }).detail ?? `HTTP ${res.status}` };
    knownConnected = true;
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// The connected merchant's own dashboard. Falls back to the labeled Olipop sample only
// when there's no shop session (401) or the backend is unavailable — never to imply the
// sample is the merchant's. `connected:false` marks the fallback explicitly.
const DEMO_DASHBOARD: AppDashboard = {
  connected: false, hasData: true, brand: DEMO.brand, category: DEMO.category, runId: null, data: DEMO.dashboard,
};
export const getDashboard = () => load<AppDashboard>(`/app/api/dashboard`, DEMO_DASHBOARD);

// ---- reads -----------------------------------------------------------------
export const getFindings = (runId?: number) =>
  load<{ findings: AppFindingRow[] }>(`/app/api/evidence/findings${runId ? `?runId=${runId}` : ""}`, { findings: DEMO.findings });

/** Trigger the Phase-5 crawl + diagnosis for a run (mock crawl by default, $0). */
export const diagnose = (runId: number) => post<{ findings: number; evidenceBacked: number }>(`/app/api/evidence/diagnose`, { runId });

export const getFixes = () => load<{ proposals: AppProposalRow[] }>(`/app/api/fixes`, { proposals: DEMO.proposals });

/** Generate fix proposals for a product from a run's findings (writes nothing to the store). */
export const proposeFixes = (runId: number, productGid: string) => post<{ created: number; writeProducts: number; copyReady: number }>(`/app/api/fixes/propose`, { runId, productGid });

export const getExperiments = () => load<{ experiments: AppExperimentRow[] }>(`/app/api/experiments`, { experiments: DEMO.experiments });

/** Start a verification: build a benchmark, plan the intervention, capture a LIVE baseline
 *  (real spend) so the eventual verdict is real proof — never a mock simulation. */
export const startVerification = (body: { brand: string; category: string; competitors: string[]; description: string }) =>
  post<{ experimentId: number; baselineRunId: number; mode: string }>(`/app/api/experiments/start`, { ...body, live: true });
/** Run the AFTER benchmark LIVE + compare to the baseline. */
export const verifyExperiment = (id: number) => post<{ verdict: string; mode: string }>(`/app/api/experiments/${id}/verify`, { live: true });

/** The connected shop's recorded grant (scopes/plan/status) for the Settings screen. */
export const getShopInfo = () => load<AppShopInfo>(`/app/api/shop`, DEMO.shopInfo);

export const getSchedules = () => load<{ schedules: AppScheduleRow[] }>(`/app/api/schedules`, { schedules: DEMO.schedules });

export const getAlerts = (status = "open") => load<{ alerts: AppAlertRow[] }>(`/app/api/alerts?status=${status}`, { alerts: DEMO.alerts });

export const getCatalog = (opts: { q?: string; limit?: number; offset?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set("q", opts.q);
  if (opts.limit != null) p.set("limit", String(opts.limit));
  if (opts.offset) p.set("offset", String(opts.offset));
  const qs = p.toString();
  return load<{ total: number; products: AppProductRow[] }>(`/app/api/catalog/products${qs ? `?${qs}` : ""}`, { total: DEMO.catalog.total, products: DEMO.catalog.products });
};

export const getCatalogStatus = () => load<{ products: number; lastSync: { finished_at?: string; status?: string } | null }>(`/app/api/catalog/sync/status`, { products: DEMO.catalog.total, lastSync: { finished_at: DEMO.catalog.lastSyncAt, status: "completed" } });

export const getBenchmarks = () => load<{ runs: AppRunRow[] }>(`/app/api/benchmarks`, { runs: DEMO.runs });

export const getBilling = () => load<AppBilling>(`/app/api/billing`, DEMO.billing);

/** Directional AI-referral attribution funnel (Phase 10). Consent-gated, browser-reported. */
export const getAttribution = (days = 30) => load<AppAttribution>(`/app/api/pixel/attribution?days=${days}`, DEMO.attribution);

/** Pixel health: is it activated/scoped and receiving beacons? (distinguishes no-traffic from broken). */
export const getPixelHealth = () => load<AppPixelHealth>(`/app/api/pixel/health`, DEMO.pixelHealth);

/** Re-create/refresh the shop's app-owned Web Pixel (the Attribution "Reconnect" action). */
export const activatePixel = () => post<{ activated: boolean; webPixelId?: string; reason?: string; message?: string }>(`/app/api/pixel/activate`, {});

/** Open the Stripe billing portal (returns a hosted URL to redirect to). */
export const openBillingPortal = () => post<{ url: string }>(`/app/api/billing/portal`, {});

export interface RunBenchmarkResult { ok: boolean; runId?: number; observationCount?: number; promptCount?: number; recommendationRate?: Proportion; mentionRate?: Proportion; mode?: string; error?: string; demo?: boolean }
export const runBenchmark = (body: { brand: string; category: string; competitors: string[]; priceRange?: string; live?: boolean }) =>
  post<RunBenchmarkResult>(`/app/api/benchmarks/run`, body).then((r) => ({ ...(r.data ?? {}), ok: r.ok, error: r.error, demo: r.demo } as RunBenchmarkResult));

// ---- writes ----------------------------------------------------------------
export const approveFix = (id: number) => post(`/app/api/fixes/${id}/approve`, {});
export const applyFix = (id: number) => post(`/app/api/fixes/${id}/apply`, {});
export const rollbackFix = (id: number) => post(`/app/api/fixes/${id}/rollback`, {});
export const dismissFix = (id: number) => post(`/app/api/fixes/${id}/dismiss`, {});
export const acknowledgeAlert = (id: number) => post(`/app/api/alerts/${id}/acknowledge`, {});
export const syncCatalog = () => post(`/app/api/catalog/sync`, {});
/** Create a recurring monitoring schedule for a benchmark (re-runs on the cadence, alerts on credible change). */
export const createSchedule = (body: { kind?: string; benchmarkId: number; cadence: string }) => post<{ id: number }>(`/app/api/schedules`, body);
export const updateSchedule = (id: number, body: { cadence?: string; enabled?: boolean }) => post(`/app/api/schedules/${id}`, body);
/** Run a schedule NOW. live=true does a real (daily-cap-bounded) benchmark so the result is
 *  comparable; mock is deterministic and never alerts. Returns mode + alerts raised. */
export const runSchedule = (id: number, opts: { live?: boolean } = {}) =>
  post<{ mode: string; runId: number | null; alerts: number; skipped?: string }>(`/app/api/schedules/${id}/run`, { live: opts.live === true });
export const deleteSchedule = (id: number) => post(`/app/api/schedules/${id}/delete`, {});
