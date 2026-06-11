import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { RUNS_DIR } from "./runStore.js";

// Captured leads contain user emails — the file is gitignored. See README.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}

export interface Lead {
  email: string;
  plan: string;
  runId?: string;
  timestamp: string;
}

export async function captureLead(lead: Lead): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  await appendFile(join(RUNS_DIR, "leads.jsonl"), JSON.stringify(lead) + "\n", "utf8");
}
