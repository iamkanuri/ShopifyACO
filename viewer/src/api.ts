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
}) => postJson<{ runId: string; estimateMaxUsd: number; totalCalls: number }>("/api/scan", body);

export async function getStatus(runId: string) {
  const res = await fetch(`/api/scan/${runId}/status`);
  if (!res.ok) throw new Error("Status unavailable");
  return res.json();
}

export const submitLead = (body: { email: string; plan: string; runId?: string }) =>
  postJson<{ ok: boolean }>("/api/leads", body);

/** Fire-and-forget funnel analytics. Never throws / blocks the UI. */
export function trackEvent(name: string, runId?: string, metadata?: unknown): void {
  fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, run_id: runId, metadata }),
  }).catch(() => {});
}
