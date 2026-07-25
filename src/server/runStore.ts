import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve, sep } from "node:path";
import type { Config } from "../types.js";
import { ENV } from "./env.js";

// Result files live under DATA_DIR — on Railway this is the attached volume mount
// (e.g. /data) so runs survive redeploys.
export const RUNS_DIR = ENV.dataDir;

export type RunStatus = "pending" | "running" | "complete" | "failed";

export interface RunStatusFile {
  runId: string;
  status: RunStatus;
  brand: string;
  engines: string[];
  promptCount: number;
  estimateMaxUsd?: number;
  costUsd?: number;
  error?: string;
  engineErrors?: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

// Single-run lock: this is a one-scan-at-a-time local tool. A simple in-process
// flag is enough; concurrent requests are rejected with a clear message.
// TODO(deploy): replace with a real queue + per-user concurrency when this runs
// on Railway with multiple users.
let activeRunId: string | null = null;
export const isBusy = () => activeRunId !== null;
export const activeRun = () => activeRunId;
export function acquireLock(runId: string): boolean {
  if (activeRunId) return false;
  activeRunId = runId;
  return true;
}
export function releaseLock(runId: string): void {
  if (activeRunId === runId) activeRunId = null;
}

// A run id is a timestamp prefix + 80 bits of hex entropy (see newRunId). Public routes
// take :runId from the URL, so validate the shape before it ever touches the filesystem.
const RUN_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{20}$/;
export function isValidRunId(s: unknown): s is string {
  return typeof s === "string" && RUN_ID_RE.test(s);
}

export function runDir(runId: string): string {
  // Defense in depth against path traversal (Express decodes %2F in params): resolve and
  // confirm the result stays inside RUNS_DIR. Trusted callers pass a newRunId; a malformed
  // or escaping id throws rather than reading/writing outside the data dir.
  const root = resolve(RUNS_DIR);
  const dir = resolve(root, runId);
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new Error("invalid run id");
  }
  return dir;
}

export function newRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // Sortable timestamp prefix (admin convenience) + 80 bits of crypto entropy so a
  // report URL can't be guessed or enumerated — reports contain competitive intel.
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${randomBytes(10).toString("hex")}`;
}

export async function createRun(runId: string, config: Config, status: RunStatusFile): Promise<void> {
  await mkdir(runDir(runId), { recursive: true });
  await writeFile(join(runDir(runId), "config.json"), JSON.stringify(config, null, 2), "utf8");
  await setStatus(runId, status);
}

export async function setStatus(runId: string, patch: Partial<RunStatusFile> & { status?: RunStatus }): Promise<RunStatusFile> {
  const path = join(runDir(runId), "status.json");
  let current: Partial<RunStatusFile> = {};
  if (existsSync(path)) current = JSON.parse(await readFile(path, "utf8"));
  const next = { ...current, ...patch } as RunStatusFile;
  await writeFile(path, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function getStatus(runId: string): Promise<RunStatusFile | null> {
  const path = join(runDir(runId), "status.json");
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

export async function appendProgress(runId: string, line: string): Promise<void> {
  await appendFile(join(runDir(runId), "progress.log"), line + "\n", "utf8");
}

export async function readProgress(runId: string): Promise<string> {
  const path = join(runDir(runId), "progress.log");
  if (!existsSync(path)) return "";
  return readFile(path, "utf8");
}

export async function getResults(runId: string): Promise<unknown | null> {
  const path = join(runDir(runId), "results.json");
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

/** Persist a merchant store URL onto a run's config (results.json), OVERWRITING any stale free-scan
 *  value — so the paid report generator (which reads getResults(runId).config) crawls the URL the
 *  buyer confirmed at checkout. Runs on the web process (has the volume), which is also where the
 *  Stripe webhook reads the config. Post-scan, config.brand.storeUrl only feeds the paid crawler —
 *  the free report's analysis is already computed — so this never alters the displayed scorecard. */
export async function setRunStoreUrl(runId: string, storeUrl: string): Promise<boolean> {
  const path = join(runDir(runId), "results.json");
  if (!existsSync(path)) return false;
  const results = JSON.parse(await readFile(path, "utf8")) as { config?: Config };
  if (!results.config?.brand) return false;
  results.config.brand.storeUrl = storeUrl;
  await writeFile(path, JSON.stringify(results), "utf8");
  return true;
}

// ---- claim state (value-first funnel) --------------------------------------
// A run is created without an email (ungated preview). Providing an email "claims" the
// report → it becomes publicly viewable at its unguessable /report/:id (full breakdown, no
// PII). We keep ONLY a boolean + timestamp on the volume; the email lives in the leads table.
export interface ClaimState { claimed: boolean; claimedAt?: string }

export async function getClaim(runId: string): Promise<ClaimState> {
  const path = join(runDir(runId), "claim.json");
  if (!existsSync(path)) return { claimed: false };
  try { return JSON.parse(await readFile(path, "utf8")) as ClaimState; } catch { return { claimed: false }; }
}

export async function setClaimed(runId: string): Promise<void> {
  await writeFile(join(runDir(runId), "claim.json"), JSON.stringify({ claimed: true, claimedAt: new Date().toISOString() }), "utf8");
}

/** Path of the cached OG card PNG for a report (rasterized once, then served from disk).
 *  Versioned filename: bumping it invalidates every cached card when the DESIGN changes
 *  (v2 = the doctrine redesign — category-framed, no merchant score on the poster;
 *  v3 = safe-area margins so platform tile crops can't cut content). */
export function ogPngPath(runId: string): string {
  return join(runDir(runId), "og-v3.png");
}
