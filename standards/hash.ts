// ===========================================================================
// STANDARD HASH — so a citation resolves to a specific text.
//
// An agency writing "your PDPs fail ALS-COFFEE-1.0-DECAF-002" in a client report
// is citing a specific text. Without a content hash, "1.0" is a promise that the
// text has not changed, enforced by nothing.
//
// The canonicalisation is deliberately boring and stated in the artifact itself
// (`standard_hash.canonicalisation`), so a third party can recompute it:
//   1. remove the `standard_hash` object (a hash cannot cover itself);
//   2. sort every object's keys recursively;
//   3. JSON.stringify with no whitespace;
//   4. sha256 of the UTF-8 bytes, lowercase hex.
//
// Array ORDER is preserved — entry order is content, not presentation.
// Pure apart from node:crypto.
// ===========================================================================

import { createHash } from "node:crypto";

type Json = unknown;

/** Recursively sort object keys. Arrays keep their order. */
export function canonicalise(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const k of Object.keys(value as Record<string, Json>).sort()) {
      out[k] = canonicalise((value as Record<string, Json>)[k]);
    }
    return out;
  }
  return value;
}

/** The exact byte string that gets hashed. Exported so a mismatch is debuggable
 *  rather than just "the hash is wrong". */
export function canonicalForm(standard: Json): string {
  const clone = JSON.parse(JSON.stringify(standard)) as Record<string, Json>;
  delete clone.standard_hash;
  return JSON.stringify(canonicalise(clone));
}

export function standardHash(standard: Json): string {
  return createHash("sha256").update(canonicalForm(standard), "utf8").digest("hex");
}

/** True when the stored hash matches the content. */
export function hashMatches(standard: Json): { ok: boolean; stored: string | null; computed: string } {
  const stored = (standard as { standard_hash?: { value?: string } })?.standard_hash?.value ?? null;
  const computed = standardHash(standard);
  return { ok: stored === computed, stored, computed };
}
