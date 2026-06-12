import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV, hasSupabase } from "../server/env.js";

// Runtime persistence via the Supabase client + service-role key (SERVER ONLY).
// Every call is wrapped so a missing config or unreachable DB degrades gracefully
// (logs once, returns a safe default) instead of crashing a scan.

let client: SupabaseClient | null = null;
let warned = false;

function db(): SupabaseClient | null {
  if (!hasSupabase()) {
    if (!warned) {
      console.warn("[db] Supabase not configured — persistence disabled (file storage still works).");
      warned = true;
    }
    return null;
  }
  if (!client) {
    client = createClient(ENV.supabaseUrl!, ENV.supabaseServiceRoleKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

function startOfUtcDay(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

async function safe<T>(label: string, fn: (c: SupabaseClient) => Promise<T>, fallback: T): Promise<T> {
  const c = db();
  if (!c) return fallback;
  try {
    return await fn(c);
  } catch (err) {
    console.error(`[db] ${label} failed:`, (err as Error).message);
    return fallback;
  }
}

export interface LeadRow {
  email: string;
  plan: string;
  source?: string;
  run_id?: string;
  source_page?: string;
  ip_hash?: string;
}

export const insertLead = (lead: LeadRow) =>
  safe("insertLead", async (c) => {
    const { error } = await c.from("leads").insert({ ...lead, source: lead.source ?? "cta" });
    if (error) throw error;
    return true;
  }, false);

export interface RunRow {
  id: string;
  brand?: string;
  category?: string;
  status?: string;
  cost_usd?: number;
  email?: string;
  ip_hash?: string;
  mode?: string;
  error?: string;
}

export const insertRun = (run: RunRow) =>
  safe("insertRun", async (c) => {
    const { error } = await c.from("runs").insert(run);
    if (error) throw error;
    return true;
  }, false);

export const updateRun = (id: string, patch: Partial<RunRow>) =>
  safe("updateRun", async (c) => {
    const { error } = await c.from("runs").update(patch).eq("id", id);
    if (error) throw error;
    return true;
  }, false);

export const insertEvent = (name: string, run_id?: string, metadata?: unknown) =>
  safe("insertEvent", async (c) => {
    const { error } = await c.from("events").insert({ name, run_id, metadata: metadata ?? null });
    if (error) throw error;
    return true;
  }, false);

/** Count today's runs for an email (case-insensitive). DB unreachable -> 0 (in-memory limiter still applies). */
export const countRunsByEmailToday = (email: string) =>
  safe("countRunsByEmailToday", async (c) => {
    const { count, error } = await c
      .from("runs")
      .select("id", { count: "exact", head: true })
      .ilike("email", email)
      .gte("created_at", startOfUtcDay());
    if (error) throw error;
    return count ?? 0;
  }, 0);

export const countRunsByIpToday = (ipHash: string) =>
  safe("countRunsByIpToday", async (c) => {
    const { count, error } = await c
      .from("runs")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", startOfUtcDay());
    if (error) throw error;
    return count ?? 0;
  }, 0);

/** Sum today's run cost (authoritative across restarts). DB unreachable -> 0. */
export const sumSpendTodayUsd = () =>
  safe("sumSpendTodayUsd", async (c) => {
    const { data, error } = await c.from("runs").select("cost_usd").gte("created_at", startOfUtcDay());
    if (error) throw error;
    return (data ?? []).reduce((s, r) => s + Number((r as { cost_usd: number }).cost_usd ?? 0), 0);
  }, 0);

// ---- orders (paid, webhook-confirmed) --------------------------------------

export interface OrderRow {
  session_id: string;
  event_id?: string;
  email?: string | null;
  plan?: string;
  amount_usd?: number;
  currency?: string;
  status?: string;
  source_run_id?: string | null;
  scan_run_id?: string;
}

/**
 * Insert a paid order. Idempotent on session_id (Stripe re-delivers webhooks):
 * a duplicate is ignored and returns false, so callers never double-process.
 * Returns true only when this call inserted a new row.
 */
export const upsertOrder = (order: OrderRow) =>
  safe("upsertOrder", async (c) => {
    const { data, error } = await c
      .from("orders")
      .upsert(order, { onConflict: "session_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }, false);

export const getOrder = (id: number) =>
  safe<Record<string, unknown> | null>("getOrder", async (c) => {
    const { data, error } = await c.from("orders").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ?? null;
  }, null);

export const updateOrder = (id: number, patch: Partial<OrderRow> & { fulfilled_at?: string }) =>
  safe("updateOrder", async (c) => {
    const { error } = await c.from("orders").update(patch).eq("id", id);
    if (error) throw error;
    return true;
  }, false);

export const listOrders = (limit = 100) =>
  safe<Record<string, unknown>[]>("listOrders", async (c) => {
    const { data, error } = await c.from("orders").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }, []);

export const orderCountAll = () =>
  safe("orderCountAll", async (c) => {
    const { count, error } = await c.from("orders").select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }, 0);

// ---- admin queries ---------------------------------------------------------

export const utcDayStart = startOfUtcDay;

export const runsSince = (iso: string) =>
  safe<Record<string, unknown>[]>("runsSince", async (c) => {
    const { data, error } = await c.from("runs").select("*").gte("created_at", iso).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }, []);

export const eventsSince = (iso: string) =>
  safe<{ name: string; run_id: string | null; metadata: unknown }[]>("eventsSince", async (c) => {
    const { data, error } = await c.from("events").select("name,run_id,metadata").gte("created_at", iso);
    if (error) throw error;
    return (data ?? []) as { name: string; run_id: string | null; metadata: unknown }[];
  }, []);

export const leadsSince = (iso: string) =>
  safe<Record<string, unknown>[]>("leadsSince", async (c) => {
    const { data, error } = await c.from("leads").select("*").gte("created_at", iso).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }, []);

export const listRuns = (limit = 100) =>
  safe<Record<string, unknown>[]>("listRuns", async (c) => {
    const { data, error } = await c.from("runs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }, []);

export const listLeads = (limit = 100) =>
  safe<Record<string, unknown>[]>("listLeads", async (c) => {
    const { data, error } = await c.from("leads").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }, []);

/** All-time count of a single event name (for launch metrics). */
export const eventCountAll = (name: string) =>
  safe("eventCountAll", async (c) => {
    const { count, error } = await c.from("events").select("id", { count: "exact", head: true }).eq("name", name);
    if (error) throw error;
    return count ?? 0;
  }, 0);

export const runCountAll = () =>
  safe("runCountAll", async (c) => {
    const { count, error } = await c.from("runs").select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }, 0);

export const leadCountAll = () =>
  safe("leadCountAll", async (c) => {
    const { count, error } = await c.from("leads").select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }, 0);
