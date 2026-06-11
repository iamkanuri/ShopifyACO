import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

export function runDir(runId: string): string {
  return join(RUNS_DIR, runId);
}

export function newRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
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
