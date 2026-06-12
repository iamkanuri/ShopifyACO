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

export const startScan = (body: {
  form: ScanForm;
  prompts: string[];
  engines?: string[];
  email: string;
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
export const adminFulfillOrder = (id: number) =>
  postJson<{ ok: boolean }>(`/api/admin/orders/${id}/fulfill`, {});
export const adminScanOrder = (id: number) =>
  postJson<{ runId: string; mode: string; estimateMaxUsd: number; prompts: number }>(`/api/admin/orders/${id}/scan`, {});

/** Fire-and-forget funnel analytics. Never throws / blocks the UI. */
export function trackEvent(name: string, runId?: string, metadata?: unknown): void {
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, run_id: runId, metadata }),
  }).catch(() => {});
}
