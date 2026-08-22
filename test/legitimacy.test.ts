// ===========================================================================
// THE LEGITIMACY SUITE (G-11) — factual correctness and finding legitimacy,
// measured as TWO INDEPENDENT DIMENSIONS against the real `evaluate`.
//
// `adversarialCorpus.test.ts` asks whether the matcher reads a SENTENCE correctly. It
// structurally cannot see the failure this file exists for: the matcher read the page
// perfectly, the sentence is TRUE, and it is still not a finding. Every case here is
// scored on both questions, because a case can be right on the first and wrong on the
// second, and that combination is the whole subject.
//
// ⚠️ THE MUST-NOT-REGRESS FLOOR IS ENFORCED, NOT DOCUMENTED. A suppression gate scores
// 100% against hostile cases alone while deleting the findings the business runs on, and
// this system has measured that outcome once already: v2.6 scored 16/16 on its own
// hostile set and an independent pass measured it as 7 false passes closed against 46
// false FAILS opened. So the runner fails any category whose `must_not_regress` share
// falls below `MIN_REGRESSION_SHARE`. The balance cannot rot by accretion, because
// adding hostile cases alone eventually fails the build.
//
// ⚠️ `EXPECTED_KNOWN_GAPS` IS PINNED IN BOTH DIRECTIONS, like `EXPECTED_OPEN_GAPS` in the
// adversarial corpus. A case the engine gets wrong keeps its TRUE-CORRECT expectation and
// is counted. Fixing one fails this test, which is correct: the fix should be recorded
// deliberately, not absorbed silently.
//
// Pure: no network, no DB, no model calls, no clock.
// ===========================================================================
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluate, type Requirement, type Assertion } from "../src/server/productTest.js";
import { mkProduct } from "./support/adversarial.js";
import {
  ALL_CASES, COFFEE, APPAREL, FOOTWEAR, ELECTRONICS, FURNITURE, BEAUTY, ADVERSARIAL,
  type LegitimacyCase,
} from "./support/legitimacyCorpus.js";

// `adversarial` is a seventh GROUP rather than a seventh category: its cases span all six
// and are grouped by provenance, because what they have in common is that an independent
// executing review found each of them in the gate itself.
const BY_CATEGORY: Array<[string, LegitimacyCase[]]> = [
  ["coffee", COFFEE], ["apparel", APPAREL], ["footwear", FOOTWEAR],
  ["electronics", ELECTRONICS], ["furniture", FURNITURE], ["beauty", BEAUTY],
  ["adversarial", ADVERSARIAL],
];

/** Every category must carry at least this share of must-not-regress cases. */
const MIN_REGRESSION_SHARE = 0.4;

/**
 * Cases the engine gets wrong today. Their expectations record the TRUTH, not the bug.
 *
 * 1 — `an animal-free upper is not read as stating the opposite`. The fix is one line and is
 * filed at ENGINE_GAPS P-30 with its measured cost. It is not banked here because banking it
 * means re-deriving the G-14 table and acceptance suite 2.0, which are published measurements
 * of our own error rate, and this session's subject is G-11.
 */
const EXPECTED_KNOWN_GAPS = 1;

function toRequirement(c: LegitimacyCase): Requirement {
  const r = c.requirement;
  return {
    id: c.name,
    kind: r.kind,
    label: r.label ?? `${r.kind}:${r.claim ?? r.attribute ?? r.optionValue ?? ""}`,
    ...(r.claim ? { claim: r.claim } : {}),
    ...(r.attribute ? { attribute: r.attribute } : {}),
    ...(r.optionValue ? { optionValue: r.optionValue } : {}),
    ...(r.satisfiedByOptionValues ? { satisfiedByOptionValues: r.satisfiedByOptionValues } : {}),
    ...(r.expectation ? { expectation: r.expectation } : {}),
  };
}

interface Scored {
  c: LegitimacyCase;
  a: Assertion;
  /** Dimension 1: is the engine's statement supported by the evidence? */
  factual: boolean;
  /** Dimension 2: is raising this as a deficiency reasonable and useful? */
  legitimacy: boolean;
}

function score(c: LegitimacyCase): Scored {
  const a = evaluate(mkProduct(c.product), toRequirement(c));
  const factual = a.status === c.expect.status;
  const gotActionable = !a.notActionable;
  const legitimacy =
    gotActionable === c.expect.actionable &&
    (c.expect.actionable || !c.expect.reason || a.notActionable?.reason === c.expect.reason);
  return { c, a, factual, legitimacy };
}

const describeGot = (s: Scored): string =>
  `${s.a.status}${s.a.notActionable ? ` / ${s.a.notActionable.reason}` : " / actionable"}`;
const describeWant = (c: LegitimacyCase): string =>
  `${c.expect.status}${c.expect.actionable ? " / actionable" : ` / ${c.expect.reason ?? "not actionable"}`}`;

// ---- the two dimensions, scored separately ---------------------------------

describe("G-11 legitimacy corpus", () => {
  for (const [category, cases] of BY_CATEGORY) {
    describe(category, () => {
      for (const c of cases) {
        const scored = score(c);

        // DIMENSION 1 — FACTUAL CORRECTNESS.
        test(`[${c.direction}] ${c.name} — factually correct`, () => {
          if (c.knownGap && !scored.factual) return; // recorded below, not asserted here
          assert.equal(
            scored.a.status, c.expect.status,
            `${c.why}\n  want ${describeWant(c)}\n  got  ${describeGot(scored)}\n  detail: ${scored.a.detail}`,
          );
        });

        // DIMENSION 2 — FINDING LEGITIMACY. Deliberately a separate test, so a run
        // reports how many cases are true-but-illegitimate rather than collapsing the
        // two failures into one line.
        test(`[${c.direction}] ${c.name} — legitimate finding judgement`, () => {
          if (c.knownGap && !scored.legitimacy) return;
          assert.equal(
            !scored.a.notActionable, c.expect.actionable,
            `${c.why}\n  want ${describeWant(c)}\n  got  ${describeGot(scored)}\n  detail: ${scored.a.detail}`,
          );
          if (!c.expect.actionable && c.expect.reason) {
            assert.equal(
              scored.a.notActionable?.reason, c.expect.reason,
              `${c.name}: the right answer for the wrong reason is a different bug.\n  detail: ${scored.a.notActionable?.detail}`,
            );
          }
        });
      }
    });
  }
});

// ---- structural guards on the corpus itself --------------------------------

describe("the corpus cannot quietly become one-sided", () => {
  for (const [category, cases] of BY_CATEGORY) {
    test(`${category} carries a real must-not-regress half`, () => {
      const keep = cases.filter((c) => c.direction === "must_not_regress").length;
      const share = keep / cases.length;
      assert.ok(
        share >= MIN_REGRESSION_SHARE,
        `${category}: ${keep}/${cases.length} (${(share * 100).toFixed(0)}%) must_not_regress, ` +
        `below the ${(MIN_REGRESSION_SHARE * 100).toFixed(0)}% floor. A gate that only ever ` +
        `suppresses scores perfectly against hostile cases alone — this floor is what makes ` +
        `that impossible to achieve by adding cases.`,
      );
    });
  }

  test("every case name is unique, so a failure names one case", () => {
    const names = ALL_CASES.map((c) => `${c.category}/${c.name}`);
    assert.equal(new Set(names).size, names.length, "duplicate case name");
  });

  test("every group is represented, and none is a token entry", () => {
    for (const [category, cases] of BY_CATEGORY) {
      assert.ok(cases.length >= 6, `${category} has only ${cases.length} cases`);
    }
  });

  test("the corpus exercises every notActionable reason the engine can emit", () => {
    // A reason with no case is a code path no test has ever run.
    const reasons = new Set(ALL_CASES.filter((c) => !c.expect.actionable).map((c) => c.expect.reason));
    for (const r of ["optional_unstated", "contradicted_by_evidence", "catalog_level_unknown"]) {
      assert.ok(reasons.has(r as never), `no case expects reason "${r}"`);
    }
  });
});

// ---- the pinned measurement ------------------------------------------------

test("[known-gaps] the corpus result has not moved", () => {
  const scored = ALL_CASES.map(score);
  const failures = scored.filter((s) => !s.factual || !s.legitimacy);
  const declared = scored.filter((s) => s.c.knownGap);

  const undeclared = failures.filter((s) => !s.c.knownGap);
  assert.equal(
    undeclared.length, 0,
    `${undeclared.length} case(s) fail without being declared a known gap:\n` +
    undeclared.map((s) => `  ${s.c.category}/${s.c.name}\n    want ${describeWant(s.c)}\n    got  ${describeGot(s)}`).join("\n"),
  );

  const fixed = declared.filter((s) => s.factual && s.legitimacy);
  assert.equal(
    fixed.length, 0,
    `${fixed.length} case(s) marked knownGap now PASS. That is good news and it must be ` +
    `recorded deliberately: drop the flag and lower EXPECTED_KNOWN_GAPS in the same commit.\n` +
    fixed.map((s) => `  ${s.c.category}/${s.c.name}`).join("\n"),
  );

  assert.equal(
    declared.length, EXPECTED_KNOWN_GAPS,
    `known gaps changed (${declared.length} vs ${EXPECTED_KNOWN_GAPS}).`,
  );
});

// ---- the whole-result view, printed so a reader sees the shape --------------

test("[report] every case, both dimensions", () => {
  const lines: string[] = [];
  for (const [category, cases] of BY_CATEGORY) {
    const scored = cases.map(score);
    const f = scored.filter((s) => s.factual).length;
    const l = scored.filter((s) => s.legitimacy).length;
    const keep = cases.filter((c) => c.direction === "must_not_regress").length;
    lines.push(
      `${category.padEnd(12)} factual ${String(f).padStart(2)}/${String(cases.length).padStart(2)}  ` +
      `legitimacy ${String(l).padStart(2)}/${String(cases.length).padStart(2)}  ` +
      `(${keep} must-not-regress, ${cases.length - keep} hostile)`,
    );
  }
  console.log(`\n${lines.join("\n")}\n`);
  assert.ok(ALL_CASES.length >= 40, `the corpus is ${ALL_CASES.length} cases; it should not shrink`);
});
