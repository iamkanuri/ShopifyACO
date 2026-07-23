import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "./util.js";

// ===========================================================================
// PRE-REGISTRATION GUARD (Stage 3, Rule 5 / test 34). Mechanical enforcement
// of the contamination-control ordering: NO probe-reading code path may run
// unless the manual contracts were committed first, with their hashes recorded
// in preregistration.json. Changing the manual-contract file after
// registration also trips the guard (hash mismatch).
// ===========================================================================

export interface Preregistration {
  gitCommit: string;
  registeredAt: string;
  files: Record<string, string>; // repo-relative path → sha256 of file bytes
}

export function preregistrationPath(): string {
  return (
    process.env.AGENTIC_STAGE3_PREREG ??
    join(process.cwd(), "experiments", "agentic-stage3", "preregistration.json")
  );
}

/** Throws unless pre-registration exists AND every registered file currently
 *  matches its recorded hash. Called by the probe battery and the compiler
 *  BEFORE any probe observation is read, fetched, or parsed. */
export function assertPreregistered(): Preregistration {
  const file = preregistrationPath();
  if (!existsSync(file)) {
    throw new Error(
      "PRE-REGISTRATION GUARD: refusing to touch probe observations — " +
        "experiments/agentic-stage3/preregistration.json does not exist. Author and " +
        "commit the manual contracts first (Rule 5).",
    );
  }
  const reg = JSON.parse(readFileSync(file, "utf8")) as Preregistration;
  if (!reg.gitCommit || !reg.files || Object.keys(reg.files).length === 0) {
    throw new Error("PRE-REGISTRATION GUARD: preregistration.json is malformed");
  }
  for (const [rel, hash] of Object.entries(reg.files)) {
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) throw new Error(`PRE-REGISTRATION GUARD: registered file missing: ${rel}`);
    const current = sha256Hex(readFileSync(p, "utf8").replace(/\r\n/g, "\n"));
    if (current !== hash) {
      throw new Error(
        `PRE-REGISTRATION GUARD: ${rel} was modified after pre-registration (hash mismatch) — Gate B ordering violated`,
      );
    }
  }
  return reg;
}
