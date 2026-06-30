import type { GeneratedPrompt, ScanForm } from "./scanTypes";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const generatePrompts = (form: ScanForm) =>
  postJson<{ prompts: GeneratedPrompt[]; miniDefault: string[] }>("/api/prompts/generate", form);

export const suggestPrompts = (form: ScanForm) =>
  postJson<{ prompts: string[]; costUsd: number; error?: string }>("/api/prompts/suggest", form);

export interface StoreInference {
  brand?: string;
  storeUrl?: string;
  category?: string;
  competitors?: string[];
  prompts?: string[];
  costUsd: number;
  error?: string;
}
export const inferStore = (store: string) =>
  postJson<StoreInference>("/api/store/infer", { store });

export const startScan = (body: {
  form: ScanForm;
  prompts: string[];
  engines?: string[];
  hp?: string;
  sourcePage?: string;
}) => postJson<{ runId: string; estimateMaxUsd: number; totalCalls: number }>("/api/scan", body);

export async function getStatus(runId: string) {
  const res = await fetch(`/api/scan/${runId}/status`);
  if (!res.ok) throw new Error("Status unavailable");
  return res.json();
}

export const submitLead = (body: { email: string; plan: string; runId?: string }) =>
  postJson<{ ok: boolean }>("/api/leads", body);

// ---- admin ----
export async function adminMe(): Promise<{ authed: boolean; configured: boolean }> {
  const r = await fetch("/api/admin/me");
  return r.json();
}
export const adminLogin = (password: string) => postJson<{ ok: boolean }>("/api/admin/login", { password });
export async function adminLogout() {
  await fetch("/api/admin/logout", { method: "POST" });
}
export async function adminData<T = unknown>(): Promise<T> {
  const r = await fetch("/api/admin/data");
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
  return r.json();
}
export const adminScan = (body: { form: unknown; mode: string; email?: string }) =>
  postJson<{ runId: string; mode: string; estimateMaxUsd: number; prompts: number }>("/api/admin/scan", body);
export interface EngineKeyStatus {
  engine: string;
  label: string;
  configured: boolean;
  ok?: boolean;
  status?: number;
  detail?: string;
}
export const adminEngineKeys = () =>
  postJson<{ engines: EngineKeyStatus[] }>("/api/admin/engine-keys", {});
export const adminBuildIndex = (body: { label: string; brands: string[]; mode?: string }) =>
  postJson<{ slug: string; runId: string; estimateMaxUsd: number; brands: number }>("/api/admin/index", body);
export const adminFulfillOrder = (id: number) =>
  postJson<{ ok: boolean }>(`/api/admin/orders/${id}/fulfill`, {});
export const adminScanOrder = (id: number) =>
  postJson<{ runId: string; mode: string; estimateMaxUsd: number; prompts: number }>(`/api/admin/orders/${id}/scan`, {});

// ---- AI Visibility Index (public) ----
export interface IndexEntry {
  brand: string;
  rank: number;
  mention: number; // 0..1
  recommendation: number; // 0..1
}
export interface CategoryIndex {
  slug: string;
  label: string;
  run_id?: string | null;
  entries: IndexEntry[];
  updated_at?: string;
}
export async function getIndexes(): Promise<CategoryIndex[]> {
  const r = await fetch("/api/index");
  return r.ok ? r.json() : [];
}
export async function getIndex(slug: string): Promise<CategoryIndex | null> {
  const r = await fetch(`/api/index/${encodeURIComponent(slug)}`);
  return r.ok ? r.json() : null;
}

/** Fire-and-forget funnel analytics. Never throws / blocks the UI. */
export function trackEvent(name: string, runId?: string, metadata?: unknown): void {
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, run_id: runId, metadata }),
  }).catch(() => {});
}
