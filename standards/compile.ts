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
//     ✅ THIS MECHANISM HAS SINCE FIRED, and it is worth recording that it worked
//     rather than leaving it hypothetical. The engine DID gain a ninth kind at
//     v3.1 CP1 — `unsupported` — and the answer was NOT "a new assertion becomes
//     executable": it is an engine-internal outcome for a row that could not be
//     re-asked, so the `case` below REFUSES it. That is the useful shape of this
//     guard. It does not decide what a new kind means; it guarantees a human has
//     to decide, which is the opposite of a new kind arriving silently.
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
  /** ⚠️ `unbound` ARRIVED AT GRAMMAR 1.2 and is NOT a flavour of `blocked`. It names the
   *  one state whose obstacle is ours: the engine has a kind that fits and public data can
   *  adjudicate it, and this standard has not written the binding or run the adversarial
   *  pass. Until this member existed, its five entries fell through the skip-reason ternary
   *  to the `blocked` wording and told a reader the ENGINE could not run them — the exact
   *  opposite of what the tier means. */
  tier: "executable" | "unbound" | "advisory" | "blocked" | "not_discriminating";
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

// ⚠️ THE COMMIT PIN BELOW IS THE LOAD-BEARING HALF, and it had gone stale across twelve
// commits. Both comments read `(commit 96ceacd)`, while `src/server/productTest.ts` grew
// from 1,600 to 2,267 lines in the interval — so ATTRIBUTE_SPECS had moved from line 243
// to line 537, and a reader following the citation landed in an unrelated tombstone.
// CLAIM_TERMS at line 47 did not move, which is the trap: one of the two still resolved.
//
// A line number without a commit is not a citation, it is a guess with a colon in it.
// Re-verified by execution at v3.4 CP-2 (experiments/v3-4/verify_contract.mjs), which
// anchors on the BYTES at the pinned commit rather than on the number. If you move either
// declaration, re-run it — do not hand-edit the number.

/** Keys of CLAIM_TERMS at src/server/productTest.ts:47 (commit 9843cb6).
 *  Unchanged since 96ceacd — the one citation in this file that did not drift. */
export const ENGINE_CLAIM_KEYS = [
  "aluminum_free", "baking_soda_free", "cruelty_free", "vegan", "fragrance_free",
  "paraben_free", "sulfate_free", "single_origin", "organic", "fair_trade",
  "gluten_free", "third_party_tested", "bpa_free",
] as const;

/** Keys of ATTRIBUTE_SPECS at src/server/productTest.ts:537 (commit 9843cb6; was line
 *  243 at 96ceacd). `origin` was REMOVED in v2.8 CP2 and `warranty` was dropped before
 *  shipping — neither may be referenced. */
export const ENGINE_ATTRIBUTE_KEYS = ["materials", "dimensions", "care"] as const;

/** Kinds that can never reach `pass_evidenced` — the engine returns an
 *  absence-based inference instead (src/server/productTest.ts:1772-1776, commit 9843cb6). */
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
        // ⚠️ STALE AS OF 9843cb6, AND THE THROWN MESSAGE BELOW IS STALE WITH IT.
        // This used to read: the engine does `CLAIM_TERMS[req.claim!]!` with a non-null
        // assertion, so an unknown key is a THROWN TypeError at evaluate time, not a
        // failed row. G-06 §2 closed that in d35b26e — `evaluate` now reads
        // `CLAIM_TERMS[req.claim!]` and returns `unsupportedRow` (productTest.ts:1635),
        // an honest `requires_store_access` row naming OUR limitation.
        //
        // THE COMPILE-TIME REFUSAL IS STILL CORRECT AND MUST STAY. The runtime change
        // makes a bad key survivable, not acceptable: it costs the merchant one unchecked
        // row, and a conformance list silently answering "we couldn't check this" for an
        // entry the standard publishes is exactly the failure G-10 was built to prevent.
        // Compile time is where an unresolvable key should die.
        //
        // The message string one line down still says "evaluate() would throw" and is now
        // wrong. It is user-visible output, i.e. logic, so it is NOT edited here — it is
        // filed as a proposal row in ENGINE_GAPS.md under the standing proposal register.
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
    case "unsupported":
      // The engine gained this kind in v3.1 CP1 for a row it could not RECONSTRUCT
      // from a rendered label. It is an engine-internal outcome, never something a
      // standard may declare: an entry that compiled to it would be a published
      // assertion guaranteed to return "unchecked" for every product forever.
      throw new CompileError(entryId, "req_kind 'unsupported' is an engine-internal outcome and cannot be bound by a standard entry");
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

/**
 * Why a non-executable entry was not compiled — ONE SENTENCE PER TIER, and the four
 * sentences must stay mutually exclusive, because this string is what a reader is told
 * about why a published question did not run.
 *
 * ⚠️ TWO THINGS WERE WRONG HERE BEFORE GRAMMAR 1.2, AND THEY WERE WRONG IN OPPOSITE WAYS.
 *
 *   • `not_discriminating` restated a rule that has since been DELETED. It said "the
 *     PREDICTED failure rate is outside 15-85% so the row would carry no information" —
 *     a prediction. At 1.2 the tier is a MEASURED verdict: the schema rejects it without
 *     a `measured_discrimination` behind it whose 95% interval lies wholly outside the
 *     band. That is the difference between an authoring guess and a run against 100 real
 *     products, and the authored bands held 1 of 10 against that very sample.
 *   • `unbound` had no branch at all, so all five of its entries fell to the `blocked`
 *     wording and were reported as "the engine cannot yet" — the precise opposite of the
 *     tier's meaning, which is that the engine CAN and this standard has not authored the
 *     binding. A ternary with no branch for a new enum value does not fail; it lies. The
 *     switch below is exhaustive over the union so the next tier cannot do this again.
 */
export function skipReason(tier: StandardEntry["tier"]): string {
  switch (tier) {
    case "advisory":
      return "advisory — published, never tested; public data cannot adjudicate it";
    case "unbound":
      return "unbound — the engine HAS a requirement kind that fits and public data can adjudicate it; this standard has not authored a binding or an adversarial pass for it (see unbound_reason). The obstacle is unwritten work in the document, not the engine";
    case "not_discriminating":
      return "not_discriminating — a MEASURED verdict: the entry was run against a recorded sample and the whole 95% interval of its failure rate lies outside the 15-85% target band, so the answer separates almost nobody from anybody (see measured_discrimination)";
    case "blocked":
      return "blocked — should be executable, the engine cannot yet (see blocked_by)";
    case "executable":
      return "executable — not skipped";
    default: {
      // A tier this file has never heard of must not be described by the last branch of
      // a ternary. Naming it is worse than a guess only in that it is honest.
      const never: never = tier;
      return `unrecognised tier '${String(never)}' — compile.ts has no branch for it, so nothing here describes why this entry did not run`;
    }
  }
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
      skipped.push({ id: entry.id, tier: entry.tier, reason: skipReason(entry.tier) });
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
 * The engine keys every lookup off `label`, never `id` — at commit 9843cb6:
 * src/server/productTest.ts:2140 (`kindOf`), src/server/productTest.ts:1932 (`byLabel`),
 * src/server/authenticatedTest.ts:262 (the prior-status map).
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
  // ⚠️ COUNTED FROM THE SKIPPED ROWS THEMSELVES, not from a fixed list of three tiers.
  // The old version named advisory/blocked/not_discriminating literally, so grammar 1.2's
  // five `unbound` entries were in `skipped.length` and in none of the parenthesised
  // counts — a total that does not add up, which is how a reader discovers a whole tier
  // is missing only if they do the arithmetic.
  const tiers = [...new Set(r.skipped.map((s) => s.tier))].sort();
  const breakdown = tiers.map((t) => `${r.skipped.filter((s) => s.tier === t).length} ${t}`).join(", ");
  return `COMPILED — ${r.requirements.length}/${r.expectedExecutable} executable entries -> engine Requirements; ` +
    `${r.skipped.length} entries skipped (${breakdown}).`;
}
