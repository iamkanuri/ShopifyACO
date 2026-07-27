// ===========================================================================
// COMPILE A STANDARD TO ENGINE REQUIREMENTS.
//
// "A standard that has not been compiled is a wish."
//
// This module imports the engine's ACTUAL exported types (`Requirement`,
// `ReqKind`) rather than restating them, so a contract mismatch is a TYPE ERROR
// here instead of a discovery at merge time. Two mechanisms make that real:
//
//   • `import type` only — no runtime coupling to the engine at all, so this file
//     cannot be the reason a standard test touches the network. The runtime
//     executability proof (does `evaluate()` actually accept this Requirement?)
//     lives in `standards/__tests__/executable.test.ts`, which imports the real
//     `evaluate`.
//   • `bindingToRequirement` switches EXHAUSTIVELY over `ReqKind` with a `never`
//     assertion in the default branch. If the engine gains a ninth requirement
//     kind, this file stops compiling — which is the notification a standard
//     author needs, because a new kind means new assertions become executable.
//
// Pure: no network, no filesystem, no clock, no engine runtime.
// ===========================================================================

import type { Requirement, ReqKind } from "../src/server/productTest.js";

// ---- the shape of what we compile FROM (mirrors schema.json's $defs/binding) ---
// Deliberately a local structural type rather than a generated one: the standard
// is JSON on disk, so what arrives here is `unknown` until checked. Every field
// is narrowed before use and a missing one is a thrown error, never a default.

export interface StandardBinding {
  req_kind: ReqKind;
  label: string;
  passing_states: Array<"pass_evidenced" | "pass_no_blocking">;
  claim?: string;
  attribute?: string;
  option_value?: string;
  cap_usd?: number;
}

export interface StandardEntry {
  id: string;
  tier: "executable" | "advisory" | "blocked" | "not_discriminating";
  binding?: StandardBinding;
  [k: string]: unknown;
}

export interface Standard {
  standard_id: string;
  version: string;
  entries: StandardEntry[];
  [k: string]: unknown;
}

export class CompileError extends Error {
  constructor(public readonly entryId: string, message: string) {
    super(`${entryId}: ${message}`);
    this.name = "CompileError";
  }
}

// ---- the engine's closed vocabularies, restated as data ---------------------
//
// ⚠️ THESE MIRROR NON-EXPORTED ENGINE CONSTANTS AND CAN THEREFORE DRIFT.
// `CLAIM_TERMS` and `ATTRIBUTE_SPECS` are declared without `export` in
// src/server/productTest.ts, so there is no way to import them. A drifted copy
// is the classic failure: this file would happily compile a claim key the engine
// deleted, and `evaluate` would throw
// `Cannot read properties of undefined (reading 'violating')` at runtime.
//
// The containment is NOT this list — it is `standards/__tests__/executable.test.ts`,
// which EXECUTES the real `evaluate()` against every compiled Requirement. That
// test is the authority; these lists exist only to produce a readable error early.
// Do not "fix" a drift by editing the list alone; the test will still fail, and
// it is right to.

/** Keys of CLAIM_TERMS at src/server/productTest.ts:47 (commit 96ceacd). */
export const ENGINE_CLAIM_KEYS = [
  "aluminum_free", "baking_soda_free", "cruelty_free", "vegan", "fragrance_free",
  "paraben_free", "sulfate_free", "single_origin", "organic", "fair_trade",
  "gluten_free", "third_party_tested", "bpa_free",
] as const;

/** Keys of ATTRIBUTE_SPECS at src/server/productTest.ts:243 (commit 96ceacd).
 *  `origin` was REMOVED in v2.8 CP2 and `warranty` was dropped before shipping —
 *  neither may be referenced. */
export const ENGINE_ATTRIBUTE_KEYS = ["materials", "dimensions", "care"] as const;

/** Kinds that can never reach `pass_evidenced` — the engine returns an
 *  absence-based inference instead (src/server/productTest.ts:1179-1183). */
const ABSENCE_BASED_KINDS: ReadonlySet<ReqKind> = new Set<ReqKind>(["no_subscription"]);

// ---- compile ---------------------------------------------------------------

/**
 * Map one binding to a real engine `Requirement`.
 *
 * `id` is set to the STANDARD entry id rather than the engine's own scheme
 * ("claim0", "attr_materials"). The engine never matches on `id` — it keys
 * everything off `label` — so this is free, and it makes an engine row traceable
 * back to the citable assertion that produced it.
 */
export function bindingToRequirement(entryId: string, b: StandardBinding): Requirement {
  if (!b.label || !b.label.trim()) throw new CompileError(entryId, "binding.label is empty");
  if (!Array.isArray(b.passing_states) || b.passing_states.length === 0) {
    throw new CompileError(entryId, "binding.passing_states is empty");
  }

  // An absence-based kind CANNOT produce pass_evidenced, and a non-absence kind
  // producing pass_no_blocking is impossible. Either mismatch means the standard
  // claims a proof strength the engine does not deliver, which is exactly the
  // overclaim this whole grammar exists to prevent.
  const absence = ABSENCE_BASED_KINDS.has(b.req_kind);
  for (const st of b.passing_states) {
    if (st === "pass_evidenced" && absence) {
      throw new CompileError(entryId, `req_kind '${b.req_kind}' can never return pass_evidenced — it is absence-based`);
    }
    if (st === "pass_no_blocking" && !absence) {
      throw new CompileError(entryId, `req_kind '${b.req_kind}' never returns pass_no_blocking; listing it claims proof the engine does not produce`);
    }
  }

  const base = { id: entryId, kind: b.req_kind, label: b.label } as const;

  switch (b.req_kind) {
    case "claim": {
      if (!b.claim) throw new CompileError(entryId, "req_kind 'claim' requires binding.claim");
      if (!(ENGINE_CLAIM_KEYS as readonly string[]).includes(b.claim)) {
        // The engine does `CLAIM_TERMS[req.claim!]!` with a non-null assertion, so an
        // unknown key is a THROWN TypeError at evaluate time, not a failed row.
        throw new CompileError(entryId, `unknown engine claim key '${b.claim}' — evaluate() would throw, not fail the row. Known: ${ENGINE_CLAIM_KEYS.join(", ")}`);
      }
      return { ...base, claim: b.claim };
    }
    case "attribute": {
      if (!b.attribute) throw new CompileError(entryId, "req_kind 'attribute' requires binding.attribute");
      if (!(ENGINE_ATTRIBUTE_KEYS as readonly string[]).includes(b.attribute)) {
        throw new CompileError(entryId, `unknown engine attribute key '${b.attribute}'. Known: ${ENGINE_ATTRIBUTE_KEYS.join(", ")}. Note 'origin' was removed in v2.8 CP2 and 'warranty' was never shipped.`);
      }
      return { ...base, attribute: b.attribute };
    }
    case "variant_option": {
      if (!b.option_value) throw new CompileError(entryId, "req_kind 'variant_option' requires binding.option_value");
      return { ...base, optionValue: b.option_value };
    }
    case "price_under": {
      if (typeof b.cap_usd !== "number" || !Number.isFinite(b.cap_usd) || b.cap_usd <= 0) {
        throw new CompileError(entryId, "req_kind 'price_under' requires a positive numeric binding.cap_usd");
      }
      return { ...base, capUsd: b.cap_usd };
    }
    case "in_stock":
    case "no_subscription":
    case "delivery":
    case "identifiers":
      return { ...base };
    default: {
      // Exhaustiveness. If the engine gains a ninth ReqKind this line stops
      // compiling, which is the notification a standard author needs.
      const never: never = b.req_kind;
      throw new CompileError(entryId, `unhandled engine requirement kind '${String(never)}'`);
    }
  }
}

export interface CompileReport {
  requirements: Requirement[];
  /** Non-executable entries and why they were not compiled. */
  skipped: Array<{ id: string; tier: string; reason: string }>;
  errors: CompileError[];
  /** Executable entries counted from the standard, BEFORE compiling. If this does
   *  not equal `requirements.length` with zero errors, the compile did not complete
   *  — and an incomplete compile must never read as a clean one. */
  expectedExecutable: number;
}

/** Compile every `executable` entry. Collects errors rather than throwing on the
 *  first, so a failing build names every problem in one pass. */
export function compileStandard(standard: Standard): CompileReport {
  const requirements: Requirement[] = [];
  const skipped: CompileReport["skipped"] = [];
  const errors: CompileError[] = [];
  let expectedExecutable = 0;

  for (const entry of standard.entries) {
    if (entry.tier !== "executable") {
      skipped.push({
        id: entry.id,
        tier: entry.tier,
        reason: entry.tier === "advisory"
          ? "advisory — published, never tested; public data cannot adjudicate it"
          : entry.tier === "not_discriminating"
            ? "not_discriminating — the engine could run it; the predicted failure rate is outside 15-85% so the row would carry no information"
            : "blocked — should be executable, the engine cannot yet (see blocked_by)",
      });
      continue;
    }
    expectedExecutable++;
    if (!entry.binding) {
      errors.push(new CompileError(entry.id, "tier is 'executable' but there is no binding"));
      continue;
    }
    try {
      requirements.push(bindingToRequirement(entry.id, entry.binding));
    } catch (e) {
      errors.push(e instanceof CompileError ? e : new CompileError(entry.id, String(e)));
    }
  }
  return { requirements, skipped, errors, expectedExecutable };
}

/**
 * The engine keys every lookup off `label`, never `id`
 * (src/server/productTest.ts:1478, :1323; src/server/authenticatedTest.ts:175).
 * Two requirements sharing a label therefore collide in `byLabel` maps — the
 * semantic tier would update the wrong row and `kindOf` would resolve to the
 * wrong kind. Uniqueness is a hard requirement, not a style preference.
 */
export function duplicateLabels(requirements: Requirement[]): string[] {
  const seen = new Map<string, number>();
  for (const r of requirements) seen.set(r.label, (seen.get(r.label) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([l]) => l).sort();
}

/** Render a compile report. Never prints a bare "0 errors" for a run that
 *  compiled nothing — see src/measure/completion.ts for why that matters. */
export function renderCompileReport(r: CompileReport): string {
  if (r.expectedExecutable === 0) {
    return "INCOMPLETE — the standard declares zero executable entries, so compiling it proves nothing.";
  }
  if (r.errors.length) {
    return `FAILED — ${r.requirements.length}/${r.expectedExecutable} executable entries compiled; ` +
      `${r.errors.length} error(s):\n` + r.errors.map((e) => `  ${e.message}`).join("\n");
  }
  const n = (t: string) => r.skipped.filter((s) => s.tier === t).length;
  return `COMPILED — ${r.requirements.length}/${r.expectedExecutable} executable entries -> engine Requirements; ` +
    `${r.skipped.length} entries skipped (${n("advisory")} advisory, ${n("blocked")} blocked, ` +
    `${n("not_discriminating")} not_discriminating).`;
}
