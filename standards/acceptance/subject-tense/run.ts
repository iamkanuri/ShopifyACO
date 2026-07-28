// ===========================================================================
// THE SUBJECT & TENSE ACCEPTANCE RUNNER.
//
//   node --import tsx standards/acceptance/subject-tense/run.ts [--json]
//
// Reports PER STRATUM, never as a single percentage. A fix that closes
// sibling-product while breaking past-tense is a different result from one that
// closes both, and a single number hides it — which is the whole reason the
// decaf review's headline finding ("adjacent vocabulary 7/7, denial 5/5,
// everything about the subject 0") was legible at all.
//
// MATCHING IS ENGINE-REAL. `evaluateWithVocabulary` is the proven mirror of
// `evaluate`'s claim branch from `standards/vocabulary.ts`, and `findSupport`,
// `findViolation`, `normalize`, `isNegated` and `lintStrings` inside it are
// imported from `src/`. Nothing about matching is reimplemented here.
//
// The completion state comes from the real `src/measure/completion.ts`.
// `failedCount` is `number | null` — null when the run did not complete, NEVER
// 0 — so a suite that could not run cannot be read as a suite that passed.
//
// Pure: no network, no database, no clock, no model calls.
// Exit 0 = every case met its EXPECTED outcome. Exit 1 = defects. Exit 2 = the
// run did not complete, which is not a small number of defects.
// ===========================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, type UnitReport } from "../../../src/measure/completion.js";
import type { QuotableSurface } from "../../../src/server/testEvidence.js";
import { asEvidence, evaluateWithVocabulary, type ClaimOutcome, type ClaimTermsView } from "../../vocabulary.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export type Direction = "hostile" | "must_not_regress";

export interface AcceptanceCase {
  id: string;
  stratum: string;
  direction: Direction;
  /** What the engine SHOULD produce. An expectation, never a measurement. */
  expected: "pass" | "not_proven" | "contradicted";
  surface: QuotableSurface;
  text: string;
  why: string;
}

export interface AcceptanceSuite {
  suite_id: string;
  suite_version: string;
  title: string;
  frequency_caveat: { statement: string; precedent: string; second_precedent: string; consequence: string };
  terms: {
    support: string[]; violating: string[];
    derived_from: string; derived_from_hash: string;
    note: string; drift_tripwire: string;
  };
  strata: Record<string, string>;
  cases: AcceptanceCase[];
}

// ---- loading ----------------------------------------------------------------

export interface SuiteProblem { field: string; detail: string }

/** Shape check. A suite that is not the right shape must be REJECTED, not run
 *  partially — a partial run reports a small number of failures, which is the
 *  flattering direction. */
export function suiteProblems(raw: unknown): SuiteProblem[] {
  const p: SuiteProblem[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [{ field: "<root>", detail: "not an object" }];
  const s = raw as Record<string, unknown>;
  if (!s.terms || typeof s.terms !== "object") p.push({ field: "terms", detail: "missing" });
  else if (!Array.isArray((s.terms as { support?: unknown }).support) || (s.terms as { support: unknown[] }).support.length === 0) {
    p.push({ field: "terms.support", detail: "missing or empty — with no terms every case returns not_proven and the hostile half would read as a perfect score" });
  }
  if (!s.strata || typeof s.strata !== "object") p.push({ field: "strata", detail: "missing" });
  if (!Array.isArray(s.cases) || s.cases.length === 0) { p.push({ field: "cases", detail: "missing or empty" }); return p; }

  const ids = new Set<string>();
  (s.cases as unknown[]).forEach((c, i) => {
    const cc = c as Record<string, unknown>;
    for (const f of ["id", "stratum", "direction", "expected", "surface", "text", "why"]) {
      if (typeof cc[f] !== "string" || !(cc[f] as string).trim()) p.push({ field: `cases[${i}].${f}`, detail: "missing or not a non-empty string" });
    }
    if (typeof cc.id === "string") {
      if (ids.has(cc.id)) p.push({ field: `cases[${i}].id`, detail: `duplicate id ${cc.id}` });
      ids.add(cc.id);
    }
    if (cc.direction !== "hostile" && cc.direction !== "must_not_regress") {
      p.push({ field: `cases[${i}].direction`, detail: `must be hostile or must_not_regress, got ${JSON.stringify(cc.direction)}` });
    }
    if (!["pass", "not_proven", "contradicted"].includes(cc.expected as string)) {
      p.push({ field: `cases[${i}].expected`, detail: `must be pass, not_proven or contradicted, got ${JSON.stringify(cc.expected)}` });
    }
    if (s.strata && typeof s.strata === "object" && typeof cc.stratum === "string"
      && !(cc.stratum in (s.strata as Record<string, unknown>))) {
      p.push({ field: `cases[${i}].stratum`, detail: `stratum ${cc.stratum} is not declared in \`strata\`` });
    }
  });

  const cases = s.cases as AcceptanceCase[];
  // THE HALF THAT MAKES THE SUITE HONEST. A suite with no must-not-regress cases
  // measures one direction, and one direction is how v2.6 shipped a fix that was
  // 16/16 on its own set and a net regression when someone else measured it.
  if (!cases.some((c) => c.direction === "must_not_regress")) {
    p.push({ field: "cases", detail: "no `must_not_regress` case — a one-directional suite cannot detect a fix that closes the hostile classes by refusing everything" });
  }
  if (!cases.some((c) => c.direction === "hostile")) {
    p.push({ field: "cases", detail: "no `hostile` case — there is no target" });
  }
  // A declared stratum with no cases is a stratum nobody tested, and an empty row
  // in a per-stratum table reads exactly like a row that passed.
  if (s.strata && typeof s.strata === "object") {
    for (const name of Object.keys(s.strata as Record<string, unknown>)) {
      if (!cases.some((c) => c.stratum === name)) p.push({ field: `strata.${name}`, detail: "declared but has no cases — an empty stratum is untested, not clean" });
    }
  }
  return p;
}

export function loadSuite(path = join(HERE, "suite.json")): { suite: AcceptanceSuite | null; problems: SuiteProblem[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { suite: null, problems: [{ field: path, detail: `unreadable or not JSON: ${(e as Error).message}` }] };
  }
  const problems = suiteProblems(raw);
  return { suite: problems.length ? null : (raw as AcceptanceSuite), problems };
}

// ---- running ----------------------------------------------------------------

export interface CaseResult extends AcceptanceCase { actual: ClaimOutcome; met: boolean; matchedTerm: string | null }

export interface StratumResult {
  stratum: string;
  description: string;
  direction: Direction;
  total: number;
  met: number;
  failedIds: string[];
}

export interface RunResult {
  suiteId: string;
  suiteVersion: string;
  results: CaseResult[];
  strata: StratumResult[];
  state: "verified_clean" | "defects_found" | "incomplete";
  /** null on incomplete, never 0. */
  failedCount: number | null;
  decisive: boolean;
  summary: string;
  problems: SuiteProblem[];
}

export function runSuite(suite: AcceptanceSuite | null, problems: SuiteProblem[]): RunResult {
  if (!suite) {
    const agg = aggregate({
      units: [{ id: "suite", role: "sweep", completed: false, failure: problems.map((p) => `${p.field}: ${p.detail}`).join("; ") || "suite did not load" }],
      candidates: 0, adjudicated: 0, confirmed: 0,
    });
    return {
      suiteId: "<unloaded>", suiteVersion: "<unloaded>", results: [], strata: [],
      state: agg.state, failedCount: agg.confirmedCount, decisive: agg.decisive, problems,
      summary: `INCOMPLETE — the suite did not load (${problems.length} problem(s)): ${problems.map((p) => `${p.field} ${p.detail}`).join("; ")}. Zero cases ran, which is NOT zero failures.`,
    };
  }

  const suiteTerms: ClaimTermsView = { support: suite.terms.support, violating: suite.terms.violating ?? [] };
  const results: CaseResult[] = [];
  const units: UnitReport[] = [];

  // v3.9 — PER-CASE TERMS, additive and strictly opt-in.
  //
  // Suite 1.0's cases all probe ONE pinned vocabulary, so one term list serves the whole
  // file. Suite 2.0's cases are real merchant sentences spanning EIGHT different claim
  // keys, and running them all against the union of eight vocabularies would let an
  // `organic` case be satisfied by a `vegan` term — measuring something nobody asked.
  //
  // A case may therefore carry `claim_key`, resolved against `terms_by_claim_key`. With
  // neither present the behaviour is byte-identical to before, which is what keeps 1.0
  // frozen. A `claim_key` naming a key the suite does not carry is a REFUSAL, not a
  // silent fallback to the union — falling back would answer a different question and
  // report it as this one.
  const byKey = (suite as { terms_by_claim_key?: Record<string, ClaimTermsView> }).terms_by_claim_key;
  const termsFor = (c: AcceptanceCase & { claim_key?: string }): ClaimTermsView => {
    if (!c.claim_key) return suiteTerms;
    const t = byKey?.[c.claim_key];
    if (!t) throw new Error(`case ${c.id} names claim_key '${c.claim_key}' but the suite carries no terms for it`);
    return { support: t.support, violating: t.violating ?? [] };
  };

  for (const c of suite.cases) {
    try {
      const r = evaluateWithVocabulary(asEvidence(c.text, c.surface), termsFor(c));
      results.push({ ...c, actual: r.outcome, met: r.outcome === c.expected, matchedTerm: r.term });
      units.push({ id: `case:${c.id}`, role: "sweep", completed: true });
    } catch (e) {
      // A case that THREW was not adjudicated. It must not be counted as met and
      // must not be counted as failed either — it forces INCOMPLETE.
      units.push({ id: `case:${c.id}`, role: "sweep", completed: false, failure: (e as Error).message });
    }
  }

  const strata: StratumResult[] = Object.entries(suite.strata).map(([name, description]) => {
    const mine = results.filter((r) => r.stratum === name);
    return {
      stratum: name, description,
      direction: (mine[0]?.direction ?? "hostile"),
      total: mine.length,
      met: mine.filter((r) => r.met).length,
      failedIds: mine.filter((r) => !r.met).map((r) => r.id),
    };
  });

  const failed = results.filter((r) => !r.met);
  const agg = aggregate({
    units,
    candidates: suite.cases.length,
    adjudicated: results.length,
    confirmed: failed.length,
  });

  const hostile = results.filter((r) => r.direction === "hostile");
  const guard = results.filter((r) => r.direction === "must_not_regress");
  const line = (label: string, rs: CaseResult[]): string =>
    `${label} ${rs.filter((r) => r.met).length}/${rs.length}`;

  const summary =
    agg.state === "incomplete"
      ? `INCOMPLETE — ${agg.missing.length} case(s) did not run${agg.unadjudicated ? `, ${agg.unadjudicated} never adjudicated` : ""}. failedCount is null, not zero.`
      : agg.state === "defects_found"
        ? `DEFECTS FOUND — ${failed.length} of ${results.length} cases did not meet their EXPECTED outcome. ` +
          `${line("hostile", hostile)}, ${line("must-not-regress", guard)}. ` +
          `This is the target, not a bug report: the hostile half is expected to fail until an engine session closes it.`
        : `VERIFIED CLEAN — all ${results.length} cases met their expected outcome (${line("hostile", hostile)}, ${line("must-not-regress", guard)}). ` +
          `CAPABILITY ONLY. A natural-frequency read against real merchant copy is still required before shipping — see \`frequency_caveat\`.`;

  return {
    suiteId: suite.suite_id, suiteVersion: suite.suite_version, results, strata,
    state: agg.state, failedCount: agg.confirmedCount, decisive: agg.decisive, summary, problems,
  };
}

// ---- rendering --------------------------------------------------------------

export function renderRun(run: RunResult, suite: AcceptanceSuite | null): string {
  const L: string[] = [];
  L.push(`SUBJECT & TENSE ACCEPTANCE — ${run.suiteId} v${run.suiteVersion}`);
  L.push("");
  L.push(run.summary);
  if (!suite) return L.join("\n");

  L.push("");
  L.push("PER STRATUM — never a single number. A fix closing sibling-product while");
  L.push("breaking past-tense is a different result from one closing both.");
  L.push("");
  for (const dir of ["hostile", "must_not_regress"] as Direction[]) {
    L.push(dir === "hostile" ? "  THE TARGET (hostile — each must be refused)" : "  THE GUARD (must not regress — each must keep its outcome)");
    for (const s of run.strata.filter((x) => x.direction === dir)) {
      const pct = s.total ? Math.round((s.met / s.total) * 100) : 0;
      L.push(`    ${s.stratum.padEnd(24)} ${String(s.met).padStart(2)}/${String(s.total).padEnd(2)}  ${String(pct).padStart(3)}%  ${"█".repeat(Math.round(pct / 10))}`);
      if (s.failedIds.length) L.push(`      open: ${s.failedIds.join(", ")}`);
    }
    L.push("");
  }

  const failed = run.results.filter((r) => !r.met);
  if (failed.length) {
    L.push(`CASES NOT MEETING THEIR EXPECTED OUTCOME (${failed.length})`);
    for (const r of failed) {
      L.push(`  [${r.id}] ${r.stratum} — expected ${r.expected}, got ${r.actual}${r.matchedTerm ? ` on ${JSON.stringify(r.matchedTerm)}` : ""}`);
      L.push(`    ${r.text}`);
      L.push(`    ↳ ${r.why}`);
    }
    L.push("");
  }

  L.push("WHAT A GREEN RUN HERE DOES NOT LICENSE.");
  L.push(`  ${suite.frequency_caveat.statement}`);
  L.push(`  Precedent: ${suite.frequency_caveat.precedent}`);
  L.push(`  ${suite.frequency_caveat.consequence}`);
  return L.join("\n");
}

// ---- entry point ------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  // v3.9 — `--suite <file>` selects a suite. Absent, it is `suite.json` exactly as before,
  // so 1.0's invocation and its gated result are untouched.
  const si = process.argv.indexOf("--suite");
  const named = si >= 0 ? process.argv[si + 1] : undefined;
  const { suite, problems } = named ? loadSuite(join(HERE, named)) : loadSuite();
  const run = runSuite(suite, problems);
  process.stdout.write(
    process.argv.includes("--json")
      ? `${JSON.stringify({ ...run, results: run.results }, null, 2)}\n`
      : `${renderRun(run, suite)}\n`,
  );
  process.exitCode = run.state === "incomplete" ? 2 : run.state === "defects_found" ? 1 : 0;
}
