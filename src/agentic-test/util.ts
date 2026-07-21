import { createHash } from "node:crypto";

// Small deterministic helpers shared by the snapshot / mutator / validator layers.
// Everything here is pure.

/** Normalize text for matching: lowercase, hyphens→spaces, collapse whitespace.
 *  The SAME normalization is applied to store text and to matching terms (spec 4.4). */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-‐‑‒–—―]/g, " ") // ASCII hyphen + unicode hyphen/dash family
    .replace(/\s+/g, " ")
    .trim();
}

/** True when normalized `text` contains normalized `term`. */
export function containsTerm(text: string, term: string): boolean {
  return normalizeForMatch(text).includes(normalizeForMatch(term));
}

/** All terms from `terms` that occur in `text` (normalized comparison). */
export function matchingTermsIn(text: string, terms: string[]): string[] {
  const norm = normalizeForMatch(text);
  return terms.filter((t) => norm.includes(normalizeForMatch(t)));
}

const NEGATION_IN_WINDOW = /(^|[^a-z])(not|never|isn't|isnt)([^a-z]|$)/;

/** Negation guard (spec 4.8.3): a match is negated when "not" / "never" / "isn't"
 *  appears within the 12 characters preceding it in normalized text. Returns true
 *  only when EVERY occurrence of the term is negated (or the term never occurs) —
 *  callers must check occurrence separately before treating this as support. */
export function isNegatedMatch(text: string, term: string): boolean {
  const norm = normalizeForMatch(text);
  const t = normalizeForMatch(term);
  let idx = norm.indexOf(t);
  while (idx !== -1) {
    const preceding = norm.slice(Math.max(0, idx - 12), idx);
    if (!NEGATION_IN_WINDOW.test(preceding)) return false; // a non-negated occurrence exists
    idx = norm.indexOf(t, idx + 1);
  }
  return true;
}

/** Split plain text into sentences. Deterministic: split after . ! ? followed by
 *  whitespace. A text without terminal punctuation is one sentence. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Canonical JSON: recursively sorted object keys, no whitespace. Arrays keep order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Deep clone via JSON (snapshot objects are plain JSON by construction). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Recursively freeze an object (ground-truth immutability). */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
