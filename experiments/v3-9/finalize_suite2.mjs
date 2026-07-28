// v3.9 CP-3 — finalize suite 2.0: drop the case that cannot be a sentence-level case,
// record WHY inside the artifact, and pin the baseline measured at creation.
import fs from "node:fs";

const P = "standards/acceptance/subject-tense/suite2.json";
const suite = JSON.parse(fs.readFileSync(P, "utf8"));

const DROP = {
  "hc-08": {
    host: "thursdayboots.com", claim: "organic",
    reason:
      "NOT ADJUDICABLE AS A SENTENCE-LEVEL CASE. The engine answers `pass_evidenced` for this " +
      "row, but it matched against the full evidence text and RENDERS a quote truncated at " +
      "~180 characters — and the truncation cuts off the word `organic`. So the case's text, " +
      "which is the engine's own rendered quote byte-for-byte, does not contain the term it is " +
      "supposed to prove. A must-not-regress case that cannot pass on its own text measures the " +
      "truncation, not the guard. The adjudicator flagged this hazard in its own reasoning " +
      "before the suite existed.",
    filed_as: "the underlying defect is filed as a numbered gap — a rendered quote that omits " +
      "the term it proves. Measured at 2 of 69 quoted rows (1 of them a row a merchant is " +
      "actually shown); 16 of 69 are truncated at all.",
  },
};

const before = suite.cases.length;
suite.cases = suite.cases.filter((c) => !DROP[c.id]);
const used = new Set(suite.cases.map((c) => c.stratum));
for (const k of Object.keys(suite.strata)) if (!used.has(k)) delete suite.strata[k];

suite.excluded_cases = DROP;
suite.baseline_at_creation = {
  measured_at_commit: process.env.GIT_SHA ?? null,
  note:
    "RECORDED, NOT TARGETED. The hostile cases are expected to FAIL — they are defects the " +
    "engine has not fixed, and a suite whose hostile half passed at creation would be " +
    "measuring nothing. The must-not-regress half is the live constraint: those rows are true " +
    "today and a guard must not take them.",
  hostile_met: null,          // filled by the run below
  must_not_regress_met: null,
};

fs.writeFileSync(P, `${JSON.stringify(suite, null, 2)}\n`);
console.log(JSON.stringify({
  cases_before: before, cases_after: suite.cases.length,
  dropped: Object.keys(DROP),
  hostile: suite.cases.filter((c) => c.direction === "hostile").length,
  must_not_regress: suite.cases.filter((c) => c.direction === "must_not_regress").length,
  strata: Object.keys(suite.strata).length,
}, null, 2));
