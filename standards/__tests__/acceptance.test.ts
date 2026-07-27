import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  loadSuite, renderRun, runSuite, suiteProblems,
  type AcceptanceSuite,
} from "../acceptance/subject-tense/run.js";
import type { Vocabulary } from "../vocabulary.js";
import { STANDARDS_DIR, loadJson } from "./support.js";

// ===========================================================================
// PURE. No database, no network, no server, no model calls. Matching inside the
// runner is the REAL engine's, through the proven `evaluateWithVocabulary`
// mirror; nothing about matching is reimplemented.
// ===========================================================================

const SUITE_PATH = join(STANDARDS_DIR, "acceptance", "subject-tense", "suite.json");
const loaded = loadSuite(SUITE_PATH);

// ---- GROUP 1 — the suite is well-formed ------------------------------------

test("[acceptance] the suite parses with zero problems", () => {
  assert.deepEqual(loaded.problems, [], "a suite that half-loads runs a subset and reports a small number of failures — the flattering direction");
  assert.ok(loaded.suite, "suite did not load");
});

test("[acceptance] every case is in a declared stratum, and every declared stratum has cases", () => {
  const s = loaded.suite!;
  const declared = new Set(Object.keys(s.strata));
  const used = new Set(s.cases.map((c) => c.stratum));
  for (const c of s.cases) assert.ok(declared.has(c.stratum), `case ${c.id} is in undeclared stratum ${c.stratum}`);
  for (const d of declared) assert.ok(used.has(d), `stratum ${d} is declared but empty — an empty row in a per-stratum table reads exactly like a row that passed`);
});

test("[acceptance] THE MUST-NOT-REGRESS HALF IS NON-EMPTY AND SUBSTANTIAL", () => {
  // The half that makes the suite honest. v2.6 measured 16/16 on its own hostile
  // set and an independent pass measured it as a NET REGRESSION: 7 false passes
  // it stopped catching, 46 false fails. A one-directional suite cannot see that.
  const s = loaded.suite!;
  const guard = s.cases.filter((c) => c.direction === "must_not_regress");
  const hostile = s.cases.filter((c) => c.direction === "hostile");
  assert.ok(guard.length >= 15, `only ${guard.length} must-not-regress cases — too few to detect a fix that closes the hostile classes by refusing everything`);
  assert.ok(hostile.length >= 30, `only ${hostile.length} hostile cases`);

  // Both flavours of guard must be present. Only true-positives-that-must-pass
  // catches over-refusal; only hostile-shapes-already-closed catches a fix that
  // unwires an existing guard while closing a new class.
  assert.ok(guard.some((c) => c.expected === "pass"), "no must-not-regress case expects a PASS — over-refusal would be invisible");
  assert.ok(guard.some((c) => c.expected === "not_proven"), "no must-not-regress case expects a REFUSAL — unwiring an existing guard would be invisible");
});

test("[acceptance] the near-identical pairs across directions are actually present", () => {
  // The whole difficulty lives in the difference between these. A suite whose
  // hostile and guard halves are easy to tell apart proves nothing.
  const s = loaded.suite!;
  const byId = new Map(s.cases.map((c) => [c.id, c]));
  const pairs: Array<[string, string]> = [["fps-01", "sit-01"], ["fps-03", "sit-02"], ["pln-02", "pst-01"]];
  for (const [pass, refuse] of pairs) {
    const a = byId.get(pass); const b = byId.get(refuse);
    assert.ok(a && b, `pair ${pass}/${refuse} is missing`);
    assert.equal(a!.expected, "pass");
    assert.equal(b!.expected, "not_proven");
    assert.notEqual(a!.text, b!.text);
  }
});

test("[acceptance] every case carries a reason a human can act on", () => {
  for (const c of loaded.suite!.cases) {
    assert.ok(c.why.length > 40, `case ${c.id} has no usable rationale`);
    assert.ok(c.text.trim().length > 5, `case ${c.id} has no copy`);
  }
  const texts = loaded.suite!.cases.map((c) => c.text);
  assert.equal(new Set(texts).size, texts.length, "two cases share the same sentence — one of them is not measuring what it claims");
});

test("[acceptance] THE FREQUENCY CAVEAT IS PRESENT AND NOT A STUB", () => {
  // The most important field in the file, asserted so it cannot be quietly
  // trimmed to a sentence. The `origin` tombstone is what it exists to carry:
  // a narrowing that closed every false pass in hand-built sets cost 17 true
  // statements per 0 false passes gained on naturally-occurring copy.
  const f = loaded.suite!.frequency_caveat;
  assert.ok(f, "the frequency caveat is gone");
  for (const [k, v] of Object.entries(f)) assert.ok(String(v).length > 60, `frequency_caveat.${k} has been reduced to a stub`);
  assert.match(f.statement, /CAPABILITY, NOT VALUE/);
  assert.match(f.precedent, /origin/i);
  assert.match(f.consequence, /licence to MEASURE/);
});

// ---- GROUP 2 — THE DRIFT TRIPWIRE ------------------------------------------

test("[acceptance] every pinned term is still a supporting term in the source vocabulary", () => {
  // ⚠️ IF THIS FAILS, THE VOCABULARY WAS NARROWED AND THE SUITE MUST BE
  // RE-DERIVED. It is not a licence to edit this assertion. The suite pins its
  // own terms so that subject/tense handling is measured as a property of the
  // ENGINE — but a pin that silently diverges from its source is a pin that
  // measures nothing anybody can locate.
  const s = loaded.suite!;
  const source = loadJson<Vocabulary>(s.terms.derived_from.replace(/^standards\//, ""));
  const shipped = new Set(source.supporting_terms.map((t) => t.term));
  const missing = s.terms.support.filter((t) => !shipped.has(t));
  assert.deepEqual(missing, [], `pinned term(s) no longer in ${s.terms.derived_from}: ${missing.join(", ")}. RE-DERIVE the suite; do not edit this test.`);
  assert.ok(s.terms.derived_from_hash.length === 64, "the source hash must be recorded so drift is locatable");
});

test("[acceptance] the pinned terms cover all four term shapes", () => {
  // A suite whose terms are all one shape measures one grammatical frame.
  const s = loaded.suite!;
  assert.ok(s.terms.support.some((t) => /^decaffeinated /.test(t)), "no predicate-shaped term");
  assert.ok(s.terms.support.some((t) => /process$/.test(t)), "no process-name-shaped term");
  assert.ok(s.terms.support.some((t) => /decaf$/.test(t)), "no product-noun-shaped term");
  assert.ok(s.terms.support.length >= 5);
});

// ---- GROUP 3 — the runner --------------------------------------------------

test("[acceptance] the run completes and is DECISIVE", () => {
  const run = runSuite(loaded.suite, loaded.problems);
  assert.notEqual(run.state, "incomplete", `\n${run.summary}`);
  assert.ok(run.decisive);
  assert.equal(run.results.length, loaded.suite!.cases.length, "a case did not run");
  assert.equal(typeof run.failedCount, "number");
});

test("[acceptance] results stratify per class, never as a single number", () => {
  const run = runSuite(loaded.suite, loaded.problems);
  const declared = Object.keys(loaded.suite!.strata);
  assert.equal(run.strata.length, declared.length);
  for (const s of run.strata) {
    assert.ok(s.total > 0, `stratum ${s.stratum} reported zero cases`);
    assert.ok(s.met <= s.total);
    assert.equal(s.failedIds.length, s.total - s.met);
  }
  const rendered = renderRun(run, loaded.suite);
  assert.match(rendered, /PER STRATUM/);
  assert.match(rendered, /THE TARGET \(hostile/);
  assert.match(rendered, /THE GUARD \(must not regress/);
  // The caveat is printed on every run, not filed in a document nobody opens.
  assert.match(rendered, /CAPABILITY, NOT VALUE/);
});

test("[acceptance] the MUST-NOT-REGRESS half is green — this is a live regression guard", () => {
  // Asserted, unlike the hostile half. A must-not-regress failure is a defect
  // NOW, not a target: it means the engine (or the pinned term list) has moved
  // in the direction v2.6 moved.
  const run = runSuite(loaded.suite, loaded.problems);
  const failed = run.results.filter((r) => r.direction === "must_not_regress" && !r.met);
  assert.deepEqual(
    failed.map((f) => `${f.id} [${f.stratum}] expected ${f.expected}, got ${f.actual}: ${f.text}`),
    [],
    "a must-not-regress case broke. Either a true positive stopped passing, or a guard that used to refuse stopped refusing.",
  );
});

test("[acceptance] the hostile half is a REAL target, not an already-solved one", () => {
  // Deliberately NOT an assertion on the current count. Encoding "33 fail" would
  // make an engine improvement look like a test failure, and this suite exists
  // to be beaten. What IS asserted: the gap is non-empty, so the target means
  // something — and if it ever empties, that is a result to record, not a pass
  // to slide past.
  const run = runSuite(loaded.suite, loaded.problems);
  const hostile = run.results.filter((r) => r.direction === "hostile");
  const open = hostile.filter((r) => !r.met);
  assert.ok(
    open.length > 0,
    "EVERY hostile case now meets its expectation. If real, the subject/tense gap is closed: " +
    "update acceptance/subject-tense/README.md §5, record the commit, and run the natural-frequency " +
    "read the frequency caveat requires BEFORE treating it as shipped.",
  );
  // …and at least some strata are fully open, which is what makes per-stratum
  // reporting worth having.
  assert.ok(run.strata.some((s) => s.direction === "hostile" && s.met === 0), "no stratum is fully open");
});

// ---- GROUP 4 — INCOMPLETE beats a small clean number -----------------------

const base = (): AcceptanceSuite => JSON.parse(JSON.stringify(loaded.suite)) as AcceptanceSuite;

test("[acceptance] a deliberately broken suite reports INCOMPLETE, not a small clean number", () => {
  const mutations: Array<[string, (s: AcceptanceSuite) => unknown]> = [
    ["no must-not-regress half", (s) => ({ ...s, cases: s.cases.filter((c) => c.direction === "hostile") })],
    ["no hostile half", (s) => ({ ...s, cases: s.cases.filter((c) => c.direction === "must_not_regress") })],
    ["no cases at all", (s) => ({ ...s, cases: [] })],
    ["no terms", (s) => ({ ...s, terms: { ...s.terms, support: [] } })],
    ["a stratum with no cases", (s) => ({ ...s, strata: { ...s.strata, invented_stratum: "never used" } })],
    ["a case in an undeclared stratum", (s) => ({ ...s, cases: [{ ...s.cases[0]!, stratum: "nowhere" }, ...s.cases.slice(1)] })],
    ["a duplicate id", (s) => ({ ...s, cases: [s.cases[0]!, ...s.cases] })],
    ["an unknown expected value", (s) => ({ ...s, cases: [{ ...s.cases[0]!, expected: "probably" }, ...s.cases.slice(1)] })],
    ["not an object", () => null],
  ];
  for (const [name, mutate] of mutations) {
    const mutated = mutate(base());
    const problems = suiteProblems(mutated);
    assert.ok(problems.length > 0, `${name}: suiteProblems found nothing — the shape check is not enforcing this`);
    const run = runSuite(null, problems);
    assert.equal(run.state, "incomplete", `${name}: must be INCOMPLETE`);
    assert.equal(run.failedCount, null, `${name}: failedCount must be null on incomplete — never 0`);
    assert.equal(run.decisive, false);
    assert.match(run.summary, /INCOMPLETE/);
    assert.doesNotMatch(run.summary, /VERIFIED CLEAN/);
  }
});

test("[acceptance] REMOVING THE TERMS IS THE MOST DANGEROUS MUTATION, and it is caught", () => {
  // With no terms every case returns not_proven, so the hostile half would score
  // 37/37 and read as a perfect result. That is the instrument-fails-flatteringly
  // failure in its purest form, and the shape check must stop it before the
  // runner ever produces a number.
  const noTerms = { ...base(), terms: { ...base().terms, support: [] } };
  const problems = suiteProblems(noTerms);
  assert.ok(problems.some((p) => p.field === "terms.support"), `expected a terms.support problem, got ${JSON.stringify(problems)}`);
  assert.match(problems.find((p) => p.field === "terms.support")!.detail, /perfect score|would read as/i);
});

test("[acceptance] an unreadable suite file is INCOMPLETE, not an empty pass", () => {
  const { suite, problems } = loadSuite(join(STANDARDS_DIR, "acceptance", "subject-tense", "does-not-exist.json"));
  assert.equal(suite, null);
  assert.ok(problems.length > 0);
  const run = runSuite(suite, problems);
  assert.equal(run.state, "incomplete");
  assert.equal(run.failedCount, null);
  assert.match(renderRun(run, null), /INCOMPLETE/);
});
