import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate, sweepAggregate, requireDecisive, type UnitReport,
} from "../src/measure/completion.js";

// ===========================================================================
// The regression test for the single most dangerous pattern in this codebase:
// an instrument that fails in the direction of looking clean.
//
// Every case below is a REAL harness failure from a prior session, replayed as
// the numbers that harness actually reported. Each one was read as a pass.
// ===========================================================================

const attacker = (id: string, completed = true, failure?: string): UnitReport =>
  ({ id, role: "attacker", completed, failure });
const verifier = (id: string, completed = true, failure?: string): UnitReport =>
  ({ id, role: "verifier", completed, failure });

// --- the v2.7 shape, verbatim ------------------------------------------------

test("zero confirmations with DEAD verifiers is INCOMPLETE, not clean", () => {
  // v2.7, exactly: 3 attackers scheduled, 2 returned holding 24 candidates,
  // all 3 verifiers died on a session limit. The workflow returned
  // `confirmed: 0, falsePassCount: 0` and that was read as "no defects".
  const a = aggregate({
    units: [
      attacker("attack_dimensions"), attacker("attack_origin"),
      attacker("attack_boundary", false, "session limit"),
      verifier("verify_dimensions", false, "session limit"),
      verifier("verify_origin", false, "session limit"),
      verifier("verify_boundary", false, "session limit"),
    ],
    candidates: 24, adjudicated: 0, confirmed: 0,
  });
  assert.equal(a.state, "incomplete");
  assert.equal(a.decisive, false);
  // The load-bearing assertion: the count is null, NOT 0. A caller that sums
  // defect counts across passes cannot silently absorb this run as clean.
  assert.equal(a.confirmedCount, null);
  assert.equal(a.unadjudicated, 24);
  assert.equal(a.completed.verifiers, 0);
  assert.match(a.summary, /INCOMPLETE/);
  assert.doesNotMatch(a.summary, /VERIFIED CLEAN/);
});

test("a genuinely clean run is VERIFIED CLEAN and decisive", () => {
  const a = aggregate({
    units: [attacker("a1"), attacker("a2"), verifier("v1"), verifier("v2")],
    candidates: 9, adjudicated: 9, confirmed: 0,
  });
  assert.equal(a.state, "verified_clean");
  assert.equal(a.decisive, true);
  assert.equal(a.confirmedCount, 0);
  assert.equal(a.missing.length, 0);
});

test("confirmed defects with every unit alive is DEFECTS FOUND", () => {
  const a = aggregate({
    units: [attacker("a1"), verifier("v1")],
    candidates: 12, adjudicated: 12, confirmed: 3,
  });
  assert.equal(a.state, "defects_found");
  assert.equal(a.confirmedCount, 3);
  assert.equal(a.decisive, true);
});

test("a dead verifier makes even a DEFECTS-FOUND run non-decisive", () => {
  // "3 confirmed" out of a partial verification is a floor of unknown depth.
  // Reporting it as the answer understates in the flattering direction too.
  const a = aggregate({
    units: [attacker("a1"), verifier("v1"), verifier("v2", false, "timeout")],
    candidates: 20, adjudicated: 12, confirmed: 3,
  });
  assert.equal(a.state, "incomplete");
  assert.equal(a.confirmedCount, null);
  assert.equal(a.decisive, false);
});

// --- the degenerate shapes ---------------------------------------------------

test("an empty run is INCOMPLETE — nothing scheduled is not nothing found", () => {
  const a = aggregate({ units: [], candidates: 0, adjudicated: 0, confirmed: 0 });
  assert.equal(a.state, "incomplete");
  assert.equal(a.confirmedCount, null);
  assert.match(a.summary, /no units were scheduled/);
});

test("attackers with no verifier scheduled is INCOMPLETE even with zero candidates", () => {
  // The `npx tsx -e` / `python -c` shape: the attacking half ran, the
  // confirming half was never wired up, and the output was silence.
  const a = aggregate({
    units: [attacker("a1"), attacker("a2")],
    candidates: 0, adjudicated: 0, confirmed: 0,
  });
  assert.equal(a.state, "incomplete");
  assert.match(a.summary, /no verifier scheduled/);
});

test("confirmed exceeding adjudicated is INCOMPLETE — broken bookkeeping", () => {
  const a = aggregate({
    units: [attacker("a1"), verifier("v1")],
    candidates: 5, adjudicated: 2, confirmed: 4,
  });
  assert.equal(a.state, "incomplete");
  assert.match(a.summary, /exceeds adjudicated/);
});

test("missing units are NAMED with their failure reason", () => {
  const a = aggregate({
    units: [attacker("attack_origin", false, "session limit"), verifier("v1")],
    candidates: 0, adjudicated: 0, confirmed: 0,
  });
  assert.deepEqual(a.missing, ["attack_origin: session limit"]);
});

test("a unit that failed without a reason still reports as missing", () => {
  const a = aggregate({
    units: [attacker("a1", false), verifier("v1")],
    candidates: 0, adjudicated: 0, confirmed: 0,
  });
  assert.equal(a.state, "incomplete");
  assert.match(a.missing[0]!, /no failure reason recorded/);
});

// --- sweeps ------------------------------------------------------------------

test("a sweep that visited ZERO files is INCOMPLETE, not clean", () => {
  // The v2.4 `git ls-files | xargs grep` failure: the batch was dropped, the
  // sweep reported no hits, and the report said CLEAN over a real leak.
  const a = sweepAggregate({ expectedFiles: null, sweptFiles: 0, errors: [], findings: 0 });
  assert.equal(a.state, "incomplete");
  assert.equal(a.confirmedCount, null);
  assert.match(a.summary, /swept 0 files/);
});

test("a sweep short of its expected file count is INCOMPLETE", () => {
  const a = sweepAggregate({ expectedFiles: 412, sweptFiles: 130, errors: [], findings: 0 });
  assert.equal(a.state, "incomplete");
  assert.match(a.summary, /swept 130 of 412/);
});

test("a sweep with unreadable files is INCOMPLETE", () => {
  const a = sweepAggregate({ expectedFiles: 10, sweptFiles: 10, errors: ["a.ts: EACCES"], findings: 0 });
  assert.equal(a.state, "incomplete");
  assert.match(a.summary, /could not be read/);
});

test("a complete sweep with no hits is VERIFIED CLEAN and says how many files", () => {
  const a = sweepAggregate({ expectedFiles: 412, sweptFiles: 412, errors: [], findings: 0 });
  assert.equal(a.state, "verified_clean");
  assert.equal(a.confirmedCount, 0);
  assert.match(a.summary, /412\/412 files/);
});

test("a complete sweep WITH hits is DEFECTS FOUND", () => {
  const a = sweepAggregate({ expectedFiles: 412, sweptFiles: 412, errors: [], findings: 2 });
  assert.equal(a.state, "defects_found");
  assert.equal(a.confirmedCount, 2);
});

// --- the gate ----------------------------------------------------------------

test("requireDecisive blocks a ship decision on an incomplete measurement", () => {
  const incomplete = aggregate({
    units: [attacker("a1"), verifier("v1", false, "session limit")],
    candidates: 4, adjudicated: 0, confirmed: 0,
  });
  assert.throws(
    () => requireDecisive(incomplete, "cp1 deploy gate"),
    /cp1 deploy gate: measurement is not decisive/,
  );
  const clean = aggregate({
    units: [attacker("a1"), verifier("v1")], candidates: 4, adjudicated: 4, confirmed: 0,
  });
  assert.doesNotThrow(() => requireDecisive(clean, "cp1 deploy gate"));
});
