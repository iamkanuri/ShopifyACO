import { DEMO, type AppAlertRow, type AppExperimentRow, type AppFindingRow, type AppProductRow, type AppProposalRow, type AppScheduleRow } from "./fixtures";

// Client for the authenticated /app/api/* surface. Every call tries the live API; if
// there's no shop session (401) or the backend is unavailable, it transparently falls
// back to DEMO fixtures and flags `demo: true` so the UI can show a "Demo data" badge.
// This doubles as the spec's unavailable/denied state — we never fake liveness.

export interface Loaded<T> { data: T; demo: boolean; error?: string }

async function load<T>(url: string, fallback: T): Promise<Loaded<T>> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 401 || res.status === 503) return { data: fallback, demo: true };
    if (!res.ok) return { data: fallback, demo: true, error: `HTTP ${res.status}` };
    return { data: (await res.json()) as T, demo: false };
  } catch {
    return { data: fallback, demo: true };
  }
}

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string; demo?: boolean }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) return { ok: false, demo: true, error: "Connect your store to perform this action." };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---- reads -----------------------------------------------------------------
export const getFindings = (runId?: number) =>
  load<{ findings: AppFindingRow[] }>(`/app/api/evidence/findings${runId ? `?runId=${runId}` : ""}`, { findings: DEMO.findings });

export const getFixes = () => load<{ proposals: AppProposalRow[] }>(`/app/api/fixes`, { proposals: DEMO.proposals });

export const getExperiments = () => load<{ experiments: AppExperimentRow[] }>(`/app/api/experiments`, { experiments: DEMO.experiments });

export const getSchedules = () => load<{ schedules: AppScheduleRow[] }>(`/app/api/schedules`, { schedules: DEMO.schedules });

export const getAlerts = (status = "open") => load<{ alerts: AppAlertRow[] }>(`/app/api/alerts?status=${status}`, { alerts: DEMO.alerts });

export const getCatalog = () => load<{ total: number; products: AppProductRow[] }>(`/app/api/catalog/products`, { total: DEMO.catalog.total, products: DEMO.catalog.products });

export const getCatalogStatus = () => load<{ products: number; lastSync: { finished_at?: string; status?: string } | null }>(`/app/api/catalog/sync/status`, { products: DEMO.catalog.total, lastSync: { finished_at: DEMO.catalog.lastSyncAt, status: "completed" } });

// ---- writes ----------------------------------------------------------------
export const approveFix = (id: number) => post(`/app/api/fixes/${id}/approve`, {});
export const applyFix = (id: number) => post(`/app/api/fixes/${id}/apply`, {});
export const dismissFix = (id: number) => post(`/app/api/fixes/${id}/dismiss`, {});
export const acknowledgeAlert = (id: number) => post(`/app/api/alerts/${id}/acknowledge`, {});
export const syncCatalog = () => post(`/app/api/catalog/sync`, {});
export const updateSchedule = (id: number, body: { cadence?: string; enabled?: boolean }) => post(`/app/api/schedules/${id}`, body);
export const runSchedule = (id: number) => post(`/app/api/schedules/${id}/run`, {});
