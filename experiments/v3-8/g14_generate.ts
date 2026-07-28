// ===========================================================================
// G-14 STEP 1 — GENERATION + EXECUTION for the thirteen built-in claim keys.
//
//   node --import tsx experiments/v3-8/g14_generate.ts
//
// WHAT THIS DOES, and the three properties that make it trustworthy:
//
//  1. THE KEYS AND TERMS ARE ENUMERATED BY EXECUTION, not copied. `CLAIM_TERMS`
//     has no `export`, so the literal is lifted out of the source BYTES and
//     evaluated as the object it is (parsed, not regexed — a regex over the file
//     would also match the copy in standards/__tests__/vocabulary.engine.test.ts
//     and could not tell them apart). Every lifted term is then ROUND-TRIPPED
//     through the real `evaluate`: a term the parse invented would not pass, and
//     a term the engine has that the parse lacks is caught by cross-checking the
//     key set against `ENGINE_CLAIM_KEYS`. The brief says "do not trust any
//     doc's list"; this trusts no list at all.
//
//  2. EVERY SENTENCE IS RUN DOWN BOTH PATHS — the real `evaluate` (with a real
//     `Requirement` and a real `PublicProduct`) and `evaluateWithVocabulary`
//     (the proven mirror). They must agree on outcome. A disagreement is a
//     FINDING about the mirror, not a nuisance, and it forces INCOMPLETE.
//
//  3. NOTHING IS REIMPLEMENTED. Generation is `standards/attack/generate.ts`.
//     Matching is `src/server/productTest.ts`. Completion is
//     `src/measure/completion.ts`. This file is wiring and nothing else.
//
// IT ADJUDICATES NOTHING. `expected` is not computed here and no verdict is
// emitted. The engine's answer is recorded; whether that answer is WRONG is a
// human judgement made downstream, by agents who did not write this file.
//
// Pure: no network, no database, no clock, no model calls, no randomness.
// ===========================================================================

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregate, type UnitReport } from "../../src/measure/completion.js";
import { evaluate, type Requirement, type PublicProduct } from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";
import { evaluateWithVocabulary, type ClaimTermsView, asEvidence } from "../../standards/vocabulary.js";
import { ENGINE_CLAIM_KEYS } from "../../standards/compile.js";
import { generateAttacks, DEFAULT_CONTEXT } from "../../standards/attack/generate.js";
import { parseContext } from "../../standards/attack/context.js";
import { ATTACK_CLASSES, type AttackClass, type AttackSentence } from "../../standards/attack/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// v3.9 CP-1B — THE CONTEXT IS NOW SELECTABLE, AND THAT IS THE WHOLE OF STEP 2.
//
// v3.8 ran this with `DEFAULT_CONTEXT`, whose `adjacentDomains` is `[]`. The generator's
// class-2 domain-collision half (`generate.ts:151-188`) therefore emitted nothing for all
// 13 keys, and `adjacent_vocabulary` has read as fragment-probes-only ever since — the
// "attacked and found nothing" illusion, where an untested half is indistinguishable from
// a clean one. The 36 authored collisions existed the whole time in a subagent return
// value that no consumer read.
//
// CONTEXT_FILE selects a context; absent, behaviour is byte-identical to v3.8's.
// `parseContext` reports malformed entries rather than dropping them silently, and a
// dropped collision is a COVERAGE REDUCTION, so its problems are fatal here rather than
// advisory.
// ---------------------------------------------------------------------------
const CONTEXT_FILE = process.env.CONTEXT_FILE ?? null;
let ACTIVE_CONTEXT = DEFAULT_CONTEXT;
let CONTEXT_PROBLEMS: string[] = [];
if (CONTEXT_FILE) {
  const parsed = parseContext(JSON.parse(readFileSync(CONTEXT_FILE, "utf8")));
  ACTIVE_CONTEXT = parsed.context;
  CONTEXT_PROBLEMS = parsed.problems;
  if (CONTEXT_PROBLEMS.length) {
    throw new Error(
      `context ${CONTEXT_FILE} produced ${CONTEXT_PROBLEMS.length} problem(s) — refusing to run, ` +
      `because a dropped collision reduces coverage while looking exactly like a key that has none:\n` +
      CONTEXT_PROBLEMS.map((p) => `  - ${p}`).join("\n"),
    );
  }
}

// ---------------------------------------------------------------------------
// 1. ENUMERATE THE DICTIONARIES BY EXECUTION
// ---------------------------------------------------------------------------

/**
 * Lift the `CLAIM_TERMS` object literal out of the engine's own source bytes.
 *
 * Brace-balanced, so it cannot run past the literal, and anchored on the typed
 * declaration so it cannot match the untyped copy in the fidelity test. Then
 * EVALUATED — the literal is valid JS with unquoted keys, and `JSON.parse`
 * cannot read it. `new Function` on a slice of our own repo's source is the same
 * trust boundary as importing it.
 */
function liftClaimTerms(): { terms: Record<string, ClaimTermsView>; sourceSpan: [number, number] } {
  const src = readFileSync(join(REPO, "src", "server", "productTest.ts"), "utf8");
  const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
  const start = src.indexOf(anchor);
  if (start < 0) {
    throw new Error(
      "CLAIM_TERMS declaration not found in src/server/productTest.ts. The engine moved or renamed it; " +
      "this harness must be repaired rather than run — a silent empty dictionary would report a perfect score.",
    );
  }
  const open = start + anchor.length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("CLAIM_TERMS literal is not brace-balanced — refusing to guess.");
  const literal = src.slice(open, end);
  // eslint-disable-next-line no-new-func
  const value = new Function(`return ${literal};`)() as Record<string, ClaimTermsView>;
  return { terms: value, sourceSpan: [open, end] };
}

const { terms: CLAIM_TERMS, sourceSpan } = liftClaimTerms();
const KEYS = Object.keys(CLAIM_TERMS);

// ---------------------------------------------------------------------------
// 2. THE TWO EXECUTION PATHS
// ---------------------------------------------------------------------------

/** A real `PublicProduct` carrying exactly one sentence on exactly one surface. */
function productWith(text: string, surface: QuotableSurface): PublicProduct {
  return {
    origin: "https://store.example",
    handle: "p",
    title: "Thing",
    vendor: "Acme",
    productType: "Thing",
    tags: [],
    descriptionText: surface === "product_description" ? text : "",
    variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: 12,
    optionNames: [],
    optionValues: [],
    extracted: null,
    evidence: buildEvidence([{ surface, text }]),
    ldAvailability: null,
    storefrontObjectId: null,
    policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct;
}

/** The REAL engine, through a real `Requirement`. */
function realEvaluate(claimKey: string, text: string, surface: QuotableSurface):
  { status: string; detail: string; quote: string | null; surface: string | null } {
  const req: Requirement = { id: "claim0", kind: "claim", claim: claimKey, label: claimKey } as Requirement;
  // ⚠️ ARGUMENT ORDER IS (product, requirement). Written the other way round it
  // returns `undefined` rather than throwing, and every row would have read as a
  // silent `not_proven` — a broken instrument scoring a perfect hostile sweep.
  const r = evaluate(productWith(text, surface), req);
  return {
    status: r.status,
    detail: r.detail ?? "",
    quote: (r as { quote?: string | null }).quote ?? null,
    surface: (r as { evidenceSurface?: string | null }).evidenceSurface ?? null,
  };
}

/**
 * The engine's status vocabulary, collapsed onto the mirror's three outcomes.
 *
 * ⚠️ THE ENGINE HAS NO `contradicted` STATUS FOR A CLAIM. `evaluate`'s claim
 * branch returns `status: "not_proven"` for contrary evidence and distinguishes
 * it ONLY by the detail sentence (productTest.ts:1758-1764). Written the obvious
 * way — `status === "contradicted"` — this comparison reported 13 real violating
 * terms as broken and 293 sentences as path disagreements, all of them artefacts
 * of my own mapping. The detail string is the discriminator, so it is pinned
 * here and asserted against the source below rather than typed from memory.
 */
export const CONTRA_DETAIL = "Your public copy states the opposite of this requirement.";

function statusToOutcome(status: string, detail: string): "pass" | "contradicted" | "not_proven" {
  if (status === "pass_evidenced") return "pass";
  if (status === "not_proven" && detail === CONTRA_DETAIL) return "contradicted";
  return "not_proven";
}

/**
 * Surfaces the real claim branch REFUSES outright.
 *
 * `productTest.ts:1746` filters `e.surface !== "shipping_policy"`. The mirror
 * `evaluateWithVocabulary` does NOT apply that filter — so on this one surface
 * the two paths differ by construction, and the fidelity test could never see it
 * because it only ever probes `product_description`. Recorded as a finding, and
 * excluded from the agreement assertion so a known structural difference does
 * not drown the unknown ones.
 */
const CLAIM_REFUSED_SURFACES = new Set<string>(["shipping_policy"]);

// ---------------------------------------------------------------------------
// 3. VERIFY THE LIFT — every lifted term must round-trip through the real engine
// ---------------------------------------------------------------------------

interface LiftCheck { key: string; term: string; role: "supporting" | "violating"; got: string; ok: boolean }

function verifyLift(): { checks: LiftCheck[]; failures: LiftCheck[] } {
  const checks: LiftCheck[] = [];
  for (const key of KEYS) {
    for (const t of CLAIM_TERMS[key]!.support) {
      // The plainest possible frame. A supporting term the engine really has must
      // pass here; a term the parse invented cannot.
      const r = realEvaluate(key, `This product is ${t}.`, "product_description");
      checks.push({ key, term: t, role: "supporting", got: r.status, ok: r.status === "pass_evidenced" });
    }
    for (const t of CLAIM_TERMS[key]!.violating) {
      const r = realEvaluate(key, `This product ${t}.`, "product_description");
      const got = statusToOutcome(r.status, r.detail);
      checks.push({ key, term: t, role: "violating", got, ok: got === "contradicted" });
    }
  }
  return { checks, failures: checks.filter((c) => !c.ok) };
}

// ---------------------------------------------------------------------------
// 4. GENERATE
// ---------------------------------------------------------------------------

/** Adapt a built-in key to the `Vocabulary` shape the templatizer consumes.
 *  This adds no term and drops none — it is a shape change only. */
function asVocabulary(key: string) {
  const t = CLAIM_TERMS[key]!;
  return {
    claim_key: key,
    standard_id: "ENGINE-BUILTIN",
    standard_version: "n/a",
    version: null,
    supporting_terms: t.support.map((term) => ({ term })),
    violating_terms: t.violating.map((term) => ({ term })),
  };
}

const PER_CELL = Number(process.env.PER_CELL ?? 6);
const SEED = process.env.SEED ?? "v3-8-g14-step1";

interface Row extends AttackSentence {
  claimKey: string;
  engineStatus: string;
  engineDetail: string;
  engineQuote: string | null;
  engineSurface: string | null;
  engineOutcome: string;
  mirrorOutcome: string;
  /** The real claim branch refuses this surface outright; the mirror does not. */
  surfaceRefusedByEngine: boolean;
  agree: boolean;
}

function main(): void {
  const units: UnitReport[] = [];

  // --- lift verification -----------------------------------------------------
  const lift = verifyLift();
  units.push({
    id: "lift:round-trip",
    role: "sweep",
    completed: lift.failures.length === 0,
    failure: lift.failures.length
      ? `${lift.failures.length} lifted term(s) did not round-trip through the real evaluate(): ` +
        lift.failures.slice(0, 8).map((f) => `${f.key}/${f.term} -> ${f.got}`).join("; ")
      : undefined,
  });

  const keysMatch =
    JSON.stringify([...KEYS].sort()) === JSON.stringify([...ENGINE_CLAIM_KEYS].sort());
  units.push({
    id: "lift:key-set",
    role: "sweep",
    completed: keysMatch,
    failure: keysMatch ? undefined
      : `lifted keys ${JSON.stringify([...KEYS].sort())} != ENGINE_CLAIM_KEYS ${JSON.stringify([...ENGINE_CLAIM_KEYS].sort())}`,
  });

  // --- generate + execute ----------------------------------------------------
  const rows: Row[] = [];
  const perKeySets: Record<string, ReturnType<typeof generateAttacks>> = {};
  const disagreements: Row[] = [];
  const surfaceDiffs: Row[] = [];

  // TRIPWIRE. The contrary-evidence mapping keys on a detail STRING. If that
  // sentence is ever reworded, `statusToOutcome` silently stops recognising a
  // contradiction and every violation reads as a plain `not_proven` — the
  // flattering direction. Assert it exists in the engine's own source.
  const engineSrc = readFileSync(join(REPO, "src", "server", "productTest.ts"), "utf8");
  units.push({
    id: "tripwire:contra-detail",
    role: "sweep",
    completed: engineSrc.includes(CONTRA_DETAIL),
    failure: engineSrc.includes(CONTRA_DETAIL) ? undefined
      : `the contrary-evidence detail sentence ${JSON.stringify(CONTRA_DETAIL)} is no longer in productTest.ts — ` +
        `the outcome mapping in this harness is stale and every violation would read as not_proven`,
  });

  for (const key of KEYS) {
    const set = generateAttacks(asVocabulary(key), {
      seed: SEED,
      perCellLimit: PER_CELL,
      context: ACTIVE_CONTEXT,
      includeControls: true,
    });
    perKeySets[key] = set;

    units.push({
      id: `generate:${key}`,
      role: "sweep",
      completed: set.state !== "incomplete",
      failure: set.state === "incomplete" ? `generation INCOMPLETE for ${key}: ${set.summary}` : undefined,
    });

    for (const s of [...set.attacks, ...set.controls]) {
      let real: ReturnType<typeof realEvaluate>;
      let mirror: string;
      try {
        real = realEvaluate(key, s.text, s.surface);
        mirror = evaluateWithVocabulary(asEvidence(s.text, s.surface), CLAIM_TERMS[key]!).outcome;
      } catch (e) {
        units.push({ id: `exec:${key}:${s.id}`, role: "sweep", completed: false, failure: (e as Error).message });
        continue;
      }
      const row: Row = {
        ...s,
        claimKey: key,
        engineStatus: real.status,
        engineDetail: real.detail,
        engineQuote: real.quote,
        engineSurface: real.surface,
        engineOutcome: statusToOutcome(real.status, real.detail),
        mirrorOutcome: mirror,
        surfaceRefusedByEngine: CLAIM_REFUSED_SURFACES.has(s.surface),
        agree: statusToOutcome(real.status, real.detail) === mirror,
      };
      rows.push(row);
      if (!row.agree) (row.surfaceRefusedByEngine ? surfaceDiffs : disagreements).push(row);
    }
  }

  units.push({
    id: "exec:paths-agree",
    role: "verifier",
    completed: disagreements.length === 0,
    failure: disagreements.length
      ? `${disagreements.length} sentence(s) where the real evaluate() and the proven mirror DISAGREE on a surface ` +
        `the engine does NOT refuse — that is a finding about the mirror and it makes this run non-decisive: ` +
        disagreements.slice(0, 5).map((d) => `${d.claimKey}/${d.id} [${d.surface}] real=${d.engineOutcome} mirror=${d.mirrorOutcome}`).join("; ")
      : undefined,
  });

  // A two-sided liveness canary on the comparison itself. If the mapping were
  // broken in the other direction — collapsing everything to one outcome — the
  // agreement assertion above would read PERFECT. It must see all three outcomes
  // actually occurring, or it is not measuring anything.
  const outcomesSeen = new Set(rows.map((r) => r.engineOutcome));
  units.push({
    id: "canary:outcomes-distinguished",
    role: "verifier",
    completed: outcomesSeen.size >= 3,
    failure: outcomesSeen.size >= 3 ? undefined
      : `the engine produced only ${[...outcomesSeen].join("/")} across ${rows.length} sentences. ` +
        `A comparison that cannot tell the outcomes apart agrees with everything; this run is not decisive.`,
  });

  // --- the key x class table -------------------------------------------------
  interface Cell {
    key: string; attackClass: AttackClass;
    hostile: number; controls: number;
    hostilePassing: number;      // hostile sentence the engine answered `pass_evidenced`
    hostileContradicted: number;
    controlsPassing: number;
    controlsMeetingExpectation: number;
    omissions: string[];
    /**
     * The per-cell completion state the brief requires.
     *   populated              — the class ran against this key and produced sentences
     *   not_applicable         — the class does not attack this term role (e.g. `violation`
     *                            against a key with an empty violating list)
     *   requires_human_input   — scheduled and applicable, but the sentences it needs are
     *                            not derivable (adjacent_vocabulary's domain-collision half)
     * An empty cell is NEVER "clean".
     */
    state: "populated" | "not_applicable" | "requires_human_input";
  }
  const cells: Cell[] = [];
  for (const key of KEYS) {
    for (const cls of ATTACK_CLASSES) {
      const mine = rows.filter((r) => r.claimKey === key && r.attackClass === cls);
      const hostile = mine.filter((r) => !r.control);
      const controls = mine.filter((r) => r.control);
      const cov = perKeySets[key]!.coverage.cells.filter((c) => c.attackClass === cls && c.omission);
      const reasons = [...new Set(cov.map((c) => c.omission!.reason))];
      const state: Cell["state"] = mine.length
        ? "populated"
        : reasons.includes("requires_category_context")
          ? "requires_human_input"
          : "not_applicable";
      cells.push({
        key, attackClass: cls,
        hostile: hostile.length, controls: controls.length,
        hostilePassing: hostile.filter((r) => r.engineOutcome === "pass").length,
        hostileContradicted: hostile.filter((r) => r.engineOutcome === "contradicted").length,
        controlsPassing: controls.filter((r) => r.engineOutcome === "pass").length,
        controlsMeetingExpectation: controls.filter((r) => r.engineOutcome === (r.termRole === "violating" ? "contradicted" : "pass")).length,
        omissions: reasons,
        state,
      });
    }
  }

  const agg = aggregate({
    units,
    candidates: rows.length,
    adjudicated: rows.length,
    // NOT a defect count. Generation+execution finds no defects; it produces
    // candidates. `confirmed` is 0 by construction and the state comes from the
    // UNITS — a failed lift or a path disagreement is what makes this INCOMPLETE.
    confirmed: 0,
  });

  const droppedTotal = KEYS.reduce((n, k) => n + perKeySets[k]!.coverage.droppedByCap.length, 0);

  const out = {
    generated_at_commit: process.env.GIT_SHA ?? null,
    seed: SEED,
    per_cell_limit: PER_CELL,
    context_id: ACTIVE_CONTEXT.id,
    context_file: CONTEXT_FILE,
    adjacent_domain_count: ACTIVE_CONTEXT.adjacentDomains.length,
    adjacent_domain_sentences: ACTIVE_CONTEXT.adjacentDomains.reduce((n, d) => n + d.sentences.length, 0),
    source_span: sourceSpan,
    keys: KEYS,
    key_count: KEYS.length,
    term_count: KEYS.reduce((n, k) => n + CLAIM_TERMS[k]!.support.length + CLAIM_TERMS[k]!.violating.length, 0),
    dictionaries: CLAIM_TERMS,
    lift: { checked: lift.checks.length, failures: lift.failures },
    key_set_matches_engine_claim_keys: keysMatch,
    attack_classes: [...ATTACK_CLASSES],
    sentence_count: rows.length,
    hostile_count: rows.filter((r) => !r.control).length,
    control_count: rows.filter((r) => r.control).length,
    dropped_by_cap: droppedTotal,
    path_disagreements: disagreements,
    // A FINDING, not a nuisance: the real claim branch filters `shipping_policy`
    // (productTest.ts:1746) and `evaluateWithVocabulary` does not. Every sentence
    // here is one the mirror answers and the engine structurally cannot.
    surface_refusal_diffs: surfaceDiffs.map((r) => ({
      key: r.claimKey, id: r.id, surface: r.surface, text: r.text,
      engine: r.engineOutcome, mirror: r.mirrorOutcome,
    })),
    surface_refusal_note:
      "The real evaluate() claim branch refuses `shipping_policy` outright; evaluateWithVocabulary does not. " +
      "standards/__tests__/vocabulary.engine.test.ts only ever probes `product_description`, so its fidelity " +
      "proof cannot see this. The templatizer's `merchant_controlled_string/shipping_policy` template states in " +
      "its own intent that 'the claim branch restricts no surface' — that comment is STALE.",
    cells,
    rows,
    state: agg.state,
    decisive: agg.decisive,
    missing: agg.missing,
    summary: agg.state === "incomplete"
      ? `INCOMPLETE — ${agg.missing.length} unit(s) did not complete. This run must NOT be read as coverage.`
      : `${rows.length} sentences executed against the real evaluate() over ${KEYS.length} keys x ${ATTACK_CLASSES.length} classes. ` +
        `Hostile ${rows.filter((r) => !r.control).length}, controls ${rows.filter((r) => r.control).length}. ` +
        `${droppedTotal} sentence(s) dropped by the per-cell cap of ${PER_CELL} — a cell showing ${PER_CELL} is not a cell with ${PER_CELL} available. ` +
        `NO ADJUDICATION HAS HAPPENED: an engine answer is not a verdict.`,
  };

  // v3.9: OUT_FILE lets a second context write elsewhere. v3.8's `g14_sentences.json` is
  // the frozen record its whole table was computed from; a re-run under a different
  // context must never land on top of it.
  const outPath = process.env.OUT_FILE ?? join(OUT, "g14_sentences.json");
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

  // Console summary
  const L: string[] = [];
  L.push("G-14 STEP 1 — generation + execution");
  L.push("");
  L.push(`keys lifted from source bytes : ${KEYS.length}  (${KEYS.join(", ")})`);
  L.push(`key set == ENGINE_CLAIM_KEYS  : ${keysMatch}`);
  L.push(`terms                          : ${out.term_count}`);
  L.push(`lift round-trip                : ${lift.checks.length - lift.failures.length}/${lift.checks.length} ok`);
  if (lift.failures.length) for (const f of lift.failures) L.push(`   FAIL ${f.key} / ${JSON.stringify(f.term)} (${f.role}) -> ${f.got}`);
  L.push(`sentences executed             : ${rows.length}  (hostile ${out.hostile_count}, controls ${out.control_count})`);
  L.push(`dropped by cap (limit ${PER_CELL})       : ${droppedTotal}`);
  L.push(`real evaluate() vs mirror      : ${disagreements.length} disagreement(s)`);
  L.push("");
  L.push("HOSTILE SENTENCES THE ENGINE ANSWERED `pass_evidenced`, by key x class");
  L.push("(a candidate list, NOT a defect list)");
  L.push("");
  const header = ["key".padEnd(20), ...ATTACK_CLASSES.map((c) => c.slice(0, 9).padStart(10))].join("");
  L.push(header);
  for (const key of KEYS) {
    const line = [key.padEnd(20)];
    for (const cls of ATTACK_CLASSES) {
      const c = cells.find((x) => x.key === key && x.attackClass === cls)!;
      line.push(
        c.state === "not_applicable" ? "n/a".padStart(10)
          : c.state === "requires_human_input" ? "HUMAN".padStart(10)
            : `${c.hostilePassing}/${c.hostile}`.padStart(10),
      );
    }
    L.push(line.join(""));
  }
  L.push("");
  L.push("CONTROLS NOT MEETING THEIR EXPECTED OUTCOME (must-not-regress direction; baseline)");
  // ⚠️ A CONTROL'S EXPECTED OUTCOME DEPENDS ON THE TERM'S ROLE. `control_plain_disclosure`
  // is a VIOLATING-term control: the honest disclosure the violating list SHOULD catch,
  // so its expected outcome is `contradicted`, not `pass`. Checking every control for
  // `pass_evidenced` reported all 13 of them as broken when the engine was answering
  // exactly right — and `engineStatus` alone cannot show it, because a contradiction and
  // a plain miss are BOTH `not_proven` and differ only in the detail sentence.
  const badControls = rows.filter((r) => r.control && r.engineOutcome !== (r.termRole === "violating" ? "contradicted" : "pass"));
  L.push(`  ${badControls.length} of ${out.control_count}`);
  for (const b of badControls.slice(0, 40)) {
    L.push(`    ${b.claimKey} ${b.id} [${b.termRole}] expected ${b.termRole === "violating" ? "contradicted" : "pass"}, got ${b.engineOutcome}  ${JSON.stringify(b.text)}`);
  }
  L.push("");
  L.push(`completion: ${agg.state.toUpperCase()}`);
  L.push(out.summary);
  process.stdout.write(`${L.join("\n")}\n`);

  process.exitCode = agg.state === "incomplete" ? 2 : 0;
}

main();
