import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, renderResult } from "../validate.js";
import { MINIMAL_VALID, MINIMAL_VALID_V12, deepClone } from "./fixtures.js";
import { loadJson } from "./support.js";
import {
  Z_95, TARGET_BAND, MIN_ADJUDICATED_N, ALL_RULES, INTERVAL_TOLERANCE_PP,
  wilson95, minimumAdjudicatedN, verdictFor, familyWiseFloor, marginToBandPp,
  checkMeasuredDiscrimination, checkCategoryFitness, checkRetirementAttested,
  type RuleError,
} from "../discrimination.js";

// ===========================================================================
// THE CORRECTED DISCRIMINATION LIFECYCLE.
//
// Every test here exists because a specific measurement invalidated a specific
// rule the method previously used:
//
//   • tiers were assigned on PREDICTION. On the first valid sample the
//     predictions held 2 of 10 with all eight misses HIGH; on the 100-product
//     sample they held 1 OF 10 (`coffee/v1.0/fitness.json`,
//     `entry_discrimination.bands_held`). More data made the record worse.
//   • verdicts were recorded at n=9. Three of ten inverted at n=43, and the one
//     the method was about to delete (WEIGHT-001, 11.1% -> 48.8% -> 49.0%) is
//     among the standard's best entries.
//   • the publication gate said nothing about the sample. Same engine, same
//     audit discipline, from `coffee/v1.0/fitness.json`: the COFFEE sample —
//     77 storefronts, 100 products, 162 pass rows each audited individually
//     against full untruncated evidence — confirmed 10 false positives, 12.78%
//     cluster-adjusted at ICC 0.2. The GENERAL DTC sample — 172 products over
//     169 stores, 509 pass rows — confirmed 18, 7.80%, AND THAT ONE IS A FLOOR:
//     only a single defect class has been re-checked mechanically, so the two
//     are not audited to the same depth and the ratio between them is not
//     itself a measurement. The DIRECTION is what the gate rests on.
//
// ⚠️ THE GENERAL FIGURE CORRECTS ONE THIS FILE USED TO QUOTE. It was published
// as 0.83% over 507 rendered rows with ZERO confirmed false positives, from an
// audit that read every rendered row. One mechanical check of one class —
// `identifiers` rows passing on an `mpn` that is the store's own Shopify
// product id — found eighteen in that same sample, because that row RENDERS NO
// QUOTE and is invisible to any audit reading rendered evidence, however many
// rows it reads.
//
// TWO LIVE GRAMMARS, AND THE TESTS BELOW ARE TAGGED WITH WHICH ONE THEY MEAN.
// 1.0/1.1 keep their SHIPPED meaning — a required numeric prediction band and
// the first `measured_discrimination` shape — because `coffee/v1.1` is issued,
// served at a stable URL and hash-frozen, and a citation resolves through that
// hash. (Its own `status` is `applied_by_author`, NOT `published`: the author
// has run it against real stores and no second party has. The distinction is
// asserted below rather than described.) The reconciled grammar is 1.2 rather
// than a redefinition of 1.1, because redefining 1.1 would make a hash-frozen
// document invalid against the version it names. 1.2: no band, an optional
// numberless
// `discrimination_prediction`, a measurement carrying an interval and a sample,
// `category_fitness`, and the `unbound` tier. See experiments/v3-4/DECISION.md.
//
// PURE: no database, no network, no server, no model calls, no clock.
// ===========================================================================

const schema = loadJson<Record<string, unknown>>("schema.json");
type Json = Record<string, unknown>;

const entryOf = (s: Json): Json => (s.entries as Json[])[0]!;
const md = (s: Json): Json => entryOf(s).measured_discrimination as Json;

/**
 * THE GRAMMAR-1.2 BASELINE, and the default for this file.
 *
 * (It used to say "a grammar-1.0 baseline", which was wrong before the
 * reconciliation and is wrong twice now.) Almost everything below exercises the
 * RICH measurement record — an interval, a derived minimum n, a recorded
 * sample — plus `category_fitness`, and those exist only at 1.2. Its entry[0]
 * measures 15 of 30, so the Wilson interval the suite recomputes is
 * [33.1541, 66.8459] and the verdict is `discriminating`.
 */
const base = (): Json => deepClone(MINIMAL_VALID_V12);

/**
 * THE SHIPPED GRAMMAR-1.1 BASELINE. Used only by the tests that genuinely
 * exercise 1.0/1.1 behaviour — the required numeric band, the first measurement
 * shape, and the `measured: true` rule that hangs off the band. Those rules did
 * not stop existing when 1.2 was written: `coffee/v1.1` is authored against
 * them, is issued, and is hash-frozen.
 */
const shipped11 = (): Json => deepClone(MINIMAL_VALID);

const rejects = (s: Json, why: string): void => {
  const r = validate(s, schema);
  assert.ok(!r.ok, `${why}\nBut the schema ACCEPTED it. ${renderResult(r)}`);
};
const accepts = (s: Json, why: string): void => {
  const r = validate(s, schema);
  assert.ok(r.ok, `${why}\n${renderResult(r)}`);
};
const ruleNames = (errs: RuleError[]): string[] => errs.map((e) => e.rule).sort();

// Every rule name any negative fixture in this file provokes. Group 12 asserts
// this ends up covering ALL_RULES.
const provoked = new Set<string>();
const expectRule = (errs: RuleError[], rule: string, why: string): void => {
  errs.forEach((e) => provoked.add(e.rule));
  assert.ok(
    errs.some((e) => e.rule === rule),
    `${why}\nExpected rule \`${rule}\`; got ${JSON.stringify(ruleNames(errs))}`,
  );
};
const expectClean = (errs: RuleError[], why: string): void => {
  assert.deepEqual(errs, [], `${why}\n${JSON.stringify(errs, null, 2)}`);
};

// ===========================================================================
// GROUP 1 — THE ARITHMETIC IS REAL.
//
// The interval is the load-bearing part of every rule below it. Checking the
// closed form against itself would prove nothing, so the bounds are checked
// against the equation that DEFINES them: the Wilson bounds are the two roots
// of (p̂ − p)² = z²·p(1−p)/n.
// ===========================================================================

test("[wilson] the returned bounds satisfy the equation that defines them", () => {
  const misses: string[] = [];
  for (let n = 5; n <= 120; n += 7) {
    for (let x = 0; x <= n; x++) {
      const { lowerPct, upperPct } = wilson95(x, n);
      const p = x / n;
      for (const [name, b] of [["lower", lowerPct / 100], ["upper", upperPct / 100]] as const) {
        // At x=0 and x=n a bound sits ON the boundary, where the true bound is
        // exactly 0 or 1 and the identity is trivially 0 = 0. Floating point puts
        // it a few ulps off, so skip a neighbourhood rather than the exact value.
        if (b < 1e-9 || b > 1 - 1e-9) continue;
        const lhs = Math.abs(p - b);
        const rhs = Z_95 * Math.sqrt((b * (1 - b)) / n);
        if (Math.abs(lhs - rhs) > 1e-9) misses.push(`${name} bound of ${x}/${n}: |p̂−b|=${lhs} vs z√(b(1−b)/n)=${rhs}`);
      }
    }
  }
  assert.deepEqual(misses.slice(0, 5), [], `${misses.length} bound(s) do not solve the Wilson equation`);
});

test("[wilson] does not collapse at 0/n and n/n, which is why it is not Wald", () => {
  // Wald gives p̂ ± z√(p̂(1−p̂)/n) = a ZERO-WIDTH interval at both extremes. Those
  // are exactly the observations a discrimination verdict is recorded on, so a
  // Wald interval would certify every near-unanimous entry as certainly-extreme
  // and retire it. This test is the reason for the choice, executed.
  for (const n of [22, 43, 172]) {
    const zero = wilson95(0, n), all = wilson95(n, n);
    assert.ok(zero.upperPct > 0, `Wilson upper for 0/${n} collapsed to zero width`);
    assert.ok(all.lowerPct < 100, `Wilson lower for ${n}/${n} collapsed to zero width`);
  }
});

test("[wilson] refuses input it cannot interpret rather than returning a number", () => {
  assert.throws(() => wilson95(0, 0), /n > 0/);
  assert.throws(() => wilson95(5, 4), /outside/);
  assert.throws(() => wilson95(1.5, 10), /integer/);
});

// ===========================================================================
// GROUP 2 — THE MINIMUM n IS DERIVED, NOT CHOSEN.
//
// The brief for this rule was explicit that a number the next author cannot
// reconstruct will be ignored. So the constant is not asserted against itself:
// it is re-derived here by SEARCH, from the band, by a different route than the
// closed form the module uses.
// ===========================================================================

/** Smallest n at which the most extreme observation obtainable — 0 of n, or n
 *  of n — puts the whole 95% interval outside the band. Brute force. */
function floorBySearch(bandEdgePct: number): number {
  for (let n = 2; n <= 5000; n++) {
    const low = wilson95(0, n).upperPct < bandEdgePct;
    const high = wilson95(n, n).lowerPct > 100 - bandEdgePct;
    if (low && high) return n;
  }
  throw new Error("no floor found");
}

test("[min-n] the floor for the grammar's 15-85% band is 22, and search agrees with the closed form", () => {
  assert.equal(MIN_ADJUDICATED_N, 22);
  assert.equal(floorBySearch(TARGET_BAND.lowerPct), MIN_ADJUDICATED_N,
    "the closed form n > z²(1−b)/b and an exhaustive search must give the same floor");
});

test("[min-n] one short of the floor, no observation whatsoever can support a verdict", () => {
  const n = MIN_ADJUDICATED_N - 1;
  assert.ok(wilson95(0, n).upperPct >= TARGET_BAND.lowerPct,
    `at n=${n} even 0 failures leaves the interval reaching into the band`);
  assert.ok(wilson95(n, n).lowerPct <= TARGET_BAND.upperPct,
    `at n=${n} even ${n} failures leaves the interval reaching into the band`);
  assert.equal(verdictFor(0, n).verdict, null);
  assert.equal(verdictFor(n, n).verdict, null);
});

test("[min-n] the floor moves with the band, so a widened band cannot silently weaken it", () => {
  for (const edge of [10, 15, 20, 25]) {
    const band = { lowerPct: edge, upperPct: 100 - edge };
    assert.equal(minimumAdjudicatedN(band), floorBySearch(edge), `floor at a ${edge}% band edge`);
  }
  // Recorded so a future session sees the trade rather than rediscovering it.
  assert.deepEqual(
    [10, 15, 20, 25].map((e) => minimumAdjudicatedN({ lowerPct: e, upperPct: 100 - e })),
    [35, 22, 16, 12],
  );
});

test("[min-n] the family-wise floor is exposed for standards that publish a COUNT", () => {
  // Per-entry control at 5% is what the grammar adopts, because the decision is
  // per-entry retirement. A document that says "six of ten entries carry no
  // information" is making a joint claim, and this is what it would cost.
  assert.equal(familyWiseFloor(1), MIN_ADJUDICATED_N);
  assert.equal(familyWiseFloor(10), 45);
  assert.equal(familyWiseFloor(50), 62);
  assert.ok(familyWiseFloor(10) > familyWiseFloor(1), "a joint claim must cost more than a single one");
});

// ===========================================================================
// GROUP 3 — THE RULE REPRODUCES THE MEASURED RECORD.
//
// Run 2 of the coffee standard: 43 valid brands, applicability enforced, the
// duplicate brand removed. These are its actual adjudicated counts.
// ===========================================================================

// `adjudicated`/`fail` are the numbers the run PUBLISHED. `dedup` is the same
// count with the duplicated brand removed — see the deduplication test below.
const RUN_2: Array<{ id: string; adjudicated: number; fail: number; dedup: [number, number]; expect: string; kept: boolean }> = [
  { id: "FORMAT-001", adjudicated: 41, fail: 31, dedup: [31, 41], expect: "discriminating", kept: true },
  { id: "FORMAT-002", adjudicated: 41, fail: 39, dedup: [39, 41], expect: "indeterminate", kept: false },
  { id: "GRIND-001", adjudicated: 41, fail: 34, dedup: [34, 41], expect: "discriminating", kept: true },
  { id: "GRIND-002", adjudicated: 41, fail: 36, dedup: [36, 41], expect: "indeterminate", kept: false },
  { id: "WEIGHT-001", adjudicated: 43, fail: 21, dedup: [21, 42], expect: "discriminating", kept: true },
  { id: "CERT-001", adjudicated: 43, fail: 41, dedup: [40, 42], expect: "indeterminate", kept: false },
  { id: "CERT-002", adjudicated: 43, fail: 42, dedup: [41, 42], expect: "not_discriminating", kept: false },
  { id: "SOURCE-001", adjudicated: 43, fail: 38, dedup: [37, 42], expect: "indeterminate", kept: false },
  { id: "IDENT-001", adjudicated: 34, fail: 31, dedup: [30, 33], expect: "indeterminate", kept: false },
  { id: "DELIV-001", adjudicated: 32, fail: 19, dedup: [18, 31], expect: "discriminating", kept: true },
];

test("[record] the decision rule's verdict on every entry of the first valid run", () => {
  for (const r of RUN_2) {
    const v = verdictFor(r.fail, r.adjudicated);
    assert.equal(v.verdict, r.expect, `${r.id} (${r.fail}/${r.adjudicated}) — ${v.reason}`);
  }
});

test("[record] the rule keeps exactly the four entries the human record kept", () => {
  // Run 2's own reading was that four entries carry information: FORMAT-001,
  // GRIND-001, WEIGHT-001 and DELIV-001 (the last two being the pair it rescued
  // from n=9 verdicts). The rule agrees, without being told.
  for (const r of RUN_2) {
    assert.equal(verdictFor(r.fail, r.adjudicated).verdict === "discriminating", r.kept,
      `${r.id}: the rule and the run disagree about whether this entry carries information`);
  }
});

test("[record] THE RULE IS UNMOVED BY THE SAMPLING DEFECT THAT MOVED THE PUBLISHED RATES", () => {
  // STANDARD_RUN_2 says the duplicated brand was "removed from every
  // denominator". Recomputed from the run's own JSONL, it was removed from the
  // false-positive bound (70 pass rows -> 69) and NOT from the discrimination
  // table: every published denominator matches the tally that counts
  // deathwishcoffee twice. Deduplicated, WEIGHT-001 is 21/42 = 50.0%, not 48.8%.
  //
  // Not one verdict changes. A rule that reads an interval rather than a point
  // is insensitive to exactly the defect that moved the numbers under it, which
  // is the strongest argument available for reading the interval.
  for (const r of RUN_2) {
    const asPublished = verdictFor(r.fail, r.adjudicated).verdict;
    const deduplicated = verdictFor(r.dedup[0], r.dedup[1]).verdict;
    assert.equal(deduplicated, asPublished,
      `${r.id}: ${r.fail}/${r.adjudicated} gives ${asPublished} but ${r.dedup[0]}/${r.dedup[1]} gives ${deduplicated}`);
  }
  // And the specific inflation is real, not hypothetical.
  assert.notEqual((21 / 43 * 100).toFixed(1), (21 / 42 * 100).toFixed(1));
});

test("[record] THE ENTRY THE OLD METHOD WAS ABOUT TO DELETE IS ONE THE NEW RULE REFUSES TO DELETE", () => {
  // WEIGHT-001, run 1: one failure in nine products, 11.1%, outside the 15-85%
  // band, flagged `not_discriminating` — one reclassification from deletion.
  const runOne = verdictFor(1, 9);
  assert.equal(runOne.verdict, null, "a verdict at n=9 must be refused outright, not recorded as not_discriminating");
  assert.match(runOne.reason, /below the derived floor/);

  // Run 2, the valid sample: 48.8%, and the interval sits wholly inside the band.
  const runTwo = verdictFor(21, 43);
  assert.equal(runTwo.verdict, "discriminating");
});

test("[record] minimum n is necessary and NOT sufficient — and the evidence for that is documentary", () => {
  // It is tempting to argue that the two WEIGHT-001 measurements disagree beyond
  // sampling error. THEY DO NOT, and this test exists so nobody re-derives the
  // overclaim: the later POINT ESTIMATE falls outside the earlier interval, but
  // the two INTERVALS OVERLAP, and Fisher's exact test on 1/9 versus 21/43 gives
  // p = 0.062, which does not reject at 5%.
  const a = wilson95(1, 9), b = wilson95(21, 43);
  assert.ok(!(a.upperPct < b.lowerPct || b.upperPct < a.lowerPct),
    "the two intervals overlap; any argument that treats them as disjoint is wrong");
  assert.ok(48.837 > a.upperPct,
    "run 2's point estimate does sit outside run 1's interval — which is a weaker claim than disagreement");

  // The real argument for sample validity is not statistical at all. Re-running
  // the applicability predicate over run 1's OWN snapshots excluded 16 of its 25
  // products as merchandise. A verdict can be defeated by a bad sample at any n,
  // which is why `sample` is required beside `n`.
  const floorOnly = verdictFor(21, 43).verdict;
  assert.equal(floorOnly, "discriminating",
    "the arithmetic alone would certify a verdict drawn from a sample of t-shirts, so the floor cannot be the only gate");
});

test("[record] the marginal call stays marginal instead of being decided by rounding", () => {
  // STANDARD_RUN_2 calls GRIND-002 at 87.8% "a marginal call that a third run
  // could move back" — 2.8pp over the line. The rule agrees with the human.
  const v = verdictFor(36, 41);
  assert.equal(v.verdict, "indeterminate");
  assert.ok(v.interval!.lowerPct < TARGET_BAND.upperPct && v.interval!.upperPct > TARGET_BAND.upperPct);
});

test("[record] at this project's real sample sizes retirement is possible but hard", () => {
  // The rule must not be decorative — a rule that can never fire is a rule that
  // says "never retire anything" while looking like a criterion. At n≈43 exactly
  // one of ten entries clears it, and it takes a near-unanimous observation.
  const retirable = RUN_2.filter((r) => verdictFor(r.fail, r.adjudicated).verdict === "not_discriminating");
  assert.deepEqual(retirable.map((r) => r.id), ["CERT-002"], "only 42 of 43 clears the bar on run 2");
  // And the asymmetry is real: at the same n a 95%-failing entry does NOT clear it.
  assert.equal(verdictFor(41, 43).verdict, "indeterminate");
  // A point-estimate rule — what the method used before — would have retired SIX
  // of these on the same data, including two the run itself rescued at n=9.
  const byPointEstimate = RUN_2.filter((r) => {
    const p = r.fail / r.adjudicated * 100;
    return p < TARGET_BAND.lowerPct || p > TARGET_BAND.upperPct;
  });
  assert.equal(byPointEstimate.length, 6, "the point-estimate rule retires six; the interval rule retires one");
});

test("[record] R3 — the ONE arithmetically-permitted retirement is blocked by the instrument", () => {
  // CERT-002 clears the 85% edge by a hair. Measure it.
  const margin = marginToBandPp(42, 43)!;
  assert.ok(margin > 2.9 && margin < 3.0, `CERT-002's margin is ${margin.toFixed(2)}pp`);

  // One row reclassified from fail to pass takes it to 41/43 and refuses — on an
  // instrument whose own audit put the false-pass rate at 4.35% over run 2's 69
  // pass rows, and which the larger run then measured at 6.17% point / 12.78%
  // cluster-adjusted over 162 (`coffee/v1.0/fitness.json`). The later figure is
  // the higher one, so re-measuring the instrument strengthened this refusal
  // rather than relaxing it.
  assert.equal(verdictFor(41, 43).verdict, "indeterminate");

  // And CERT-002 is a CLAIM row, measured with the semantic tier off, which can
  // only overstate a claim row's fail rate. A retirement decided by a margin
  // smaller than a disclosed bias is decided by the bias.
  const s = base();
  md(s).n_asked = 43; md(s).n_adjudicated = 43; md(s).fail_count = 42; md(s).fail_rate_pct = 97.6744;
  (md(s).sample as Json).stores = 43; (md(s).sample as Json).products = 43;
  md(s).interval_95 = { lower_pct: 87.941, upper_pct: 99.5883 };
  md(s).verdict = "not_discriminating";
  md(s).instrument_bias = [{
    source: "the semantic tier was off for this run; it can only understate claim-row passes, so a claim row's fail rate is an upper bound",
    direction: "inflates_fail_rate",
  }];
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "bias_exceeds_margin",
    "an UNQUANTIFIED bias toward the cleared edge blocks a retirement outright");
});

test("[record] a retirement with no bias declaration at all is refused", () => {
  const s = base();
  md(s).n_asked = 43; md(s).n_adjudicated = 43; md(s).fail_count = 42; md(s).fail_rate_pct = 97.6744;
  (md(s).sample as Json).stores = 43; (md(s).sample as Json).products = 43;
  md(s).interval_95 = { lower_pct: 87.941, upper_pct: 99.5883 };
  md(s).verdict = "not_discriminating";
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "retirement_needs_bias_declaration",
    "an undeclared bias is not an absent one");
});

test("[record] a quantified bias smaller than the margin, pointing the other way, does not block", () => {
  const s = base();
  md(s).n_asked = 43; md(s).n_adjudicated = 43; md(s).fail_count = 42; md(s).fail_rate_pct = 97.6744;
  (md(s).sample as Json).stores = 43; (md(s).sample as Json).products = 43;
  md(s).interval_95 = { lower_pct: 87.941, upper_pct: 99.5883 };
  md(s).verdict = "not_discriminating";
  md(s).instrument_bias = [
    { source: "the audited false-pass rate depresses measured fail rates by at most this much", direction: "deflates_fail_rate", magnitude_pp: 4.35 },
    { source: "a quantified upward bias well inside the interval's margin to the band edge", direction: "inflates_fail_rate", magnitude_pp: 0.5 },
  ];
  expectClean(checkMeasuredDiscrimination(entryOf(s), "entries/0"),
    "a bias pushing AWAY from the cleared edge cannot have manufactured the retirement, and a small quantified one is inside the margin");
});

// ===========================================================================
// GROUP 4-6 — THE SCHEMA REJECTS A MALFORMED VERDICT, AND THE CROSS-FIELD
// RULES REJECT AN INCOHERENT ONE. Every rule has a negative fixture.
// ===========================================================================

test("[schema] BOTH baselines carrying a measurement are valid, else every mutation below is vacuous", () => {
  // A mutation only proves a constraint if the UNMUTATED document validates. If
  // the baseline were already rejected, every `rejects()` below would match an
  // error belonging to a defect in the fixture and the suite would be green over
  // a document nothing had ever validated. Both baselines are anchored, because
  // both are mutated below.
  accepts(base(), "the grammar-1.2 fixture with a rich measured_discrimination must validate");
  expectClean(checkMeasuredDiscrimination(entryOf(base()), "entries/0"), "and it must be internally coherent");

  accepts(shipped11(), "the shipped grammar-1.1 fixture, with the band and the first measurement shape, must validate too");
});

test("[schema] a verdict recorded below the minimum n is rejected by the SCHEMA", () => {
  const s = base();
  md(s).n_adjudicated = MIN_ADJUDICATED_N - 1;
  rejects(s, `n_adjudicated=${MIN_ADJUDICATED_N - 1} is below the derived floor of ${MIN_ADJUDICATED_N}`);
  const r = validate(s, schema);
  assert.ok(r.errors.some((e) => e.keyword === "minimum" && e.path.includes("n_adjudicated")),
    `expected a \`minimum\` error on n_adjudicated; got ${JSON.stringify(r.errors.map((e) => `${e.keyword}@${e.path}`))}`);
});

test("[schema] a measured verdict without an n, a date or a sample is rejected", () => {
  for (const field of ["n_adjudicated", "measured_on", "sample", "verdict", "interval_95", "fail_count", "fail_rate_pct", "decision_rule"]) {
    const s = base();
    delete md(s)[field];
    rejects(s, `a measurement missing \`${field}\` is not a verdict — it is a number with no provenance`);
  }
});

test("[schema] a sample with no provenance is rejected", () => {
  for (const field of ["sample_id", "category_scope", "stores", "selection", "deduplicated_by_brand", "applicability_gate_enforced", "captured_on"]) {
    const s = base();
    delete (md(s).sample as Json)[field];
    rejects(s, `a sample missing \`${field}\` cannot be shown to be the sample it claims to be`);
  }
});

test("[schema][1.0/1.1] claiming a band was measured requires the measurement", () => {
  // Stays on the SHIPPED baseline: `predicted_discrimination` — and therefore
  // `measured` — exists only at 1.0/1.1. There is no 1.2 equivalent, because 1.2
  // removed the band this flag was a claim about.
  const s = shipped11();
  delete entryOf(s).measured_discrimination;
  (entryOf(s).predicted_discrimination as Json).measured = true;
  rejects(s, "`measured: true` alone is the flattering-instrument failure in miniature — no n, no date, no sample");
});

test("[rule] the published interval must recompute from the published counts", () => {
  const s = base();
  (md(s).interval_95 as Json).lower_pct = 5;
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "interval_recomputes",
    "an interval nobody recomputes is a number, not evidence");
});

test("[rule] the tolerance on a published interval is tight enough to catch a different formula", () => {
  // Wald's lower bound for 15/30 is 32.11%; Wilson's is 33.15% — 1.04pp apart.
  const s = base();
  (md(s).interval_95 as Json).lower_pct = 32.11;
  assert.ok(1.04 > INTERVAL_TOLERANCE_PP, "the tolerance must be smaller than the Wald/Wilson gap it has to catch");
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "interval_recomputes",
    "a Wald interval must not pass as a Wilson one");
});

test("[rule] the verdict must follow from the interval, not from the author", () => {
  const s = base();
  md(s).verdict = "not_discriminating";
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "verdict_follows_interval",
    "15 of 30 sits wholly inside the band; calling it not_discriminating is the old failure with a record attached");
});

test("[rule] the rate is computed over ADJUDICATED rows, never over asked rows", () => {
  // DELIV-001: 19 of 32 adjudicated is 59.4%; 19 of 43 asked is 44.2%. Counting
  // rows the engine could not decide as failures silently changes the answer.
  const s = base();
  md(s).fail_rate_pct = 15 / 32 * 100;
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "rate_matches_counts",
    "a rate that does not equal fail_count/n_adjudicated is measuring something else");
});

test("[rule] counts must cohere with each other", () => {
  const a = base(); md(a).fail_count = 31; md(a).n_adjudicated = 30;
  expectRule(checkMeasuredDiscrimination(entryOf(a), "entries/0"), "counts_coherent", "more failures than rows");

  const b = base(); md(b).n_asked = 4;
  expectRule(checkMeasuredDiscrimination(entryOf(b), "entries/0"), "asked_ge_adjudicated", "a row cannot be adjudicated without being asked");

  const c = base(); delete md(c).n_adjudicated;
  expectRule(checkMeasuredDiscrimination(entryOf(c), "entries/0"), "counts_present", "no counts, no verdict");

  const d = base(); md(d).n_adjudicated = 9; md(d).fail_count = 1;
  expectRule(checkMeasuredDiscrimination(entryOf(d), "entries/0"), "minimum_n", "the floor is enforced by the cross-field rules too, not only by the schema");

  const e = base(); delete md(e).interval_95;
  expectRule(checkMeasuredDiscrimination(entryOf(e), "entries/0"), "interval_present", "a verdict with no interval cannot be checked");
});

test("[rule] the unit is one row per store, because the interval assumes independence", () => {
  // 30 adjudicated rows drawn as two products from each of fifteen stores has an
  // effective n of about 25 at ICC 0.2, and no field in the record would show it.
  // The same design effect the false-positive bound is REQUIRED to apply is
  // silently absent from a per-entry rate unless the unit is pinned.
  const s = base();
  (md(s).sample as Json).stores = 15;
  expectRule(checkMeasuredDiscrimination(entryOf(s), "entries/0"), "one_row_per_store",
    "30 rows over 15 stores is a clustered sample claiming an unclustered n");
});

// ===========================================================================
// GROUP 7 — RE-MEASUREMENT. What happens when the second measurement
// contradicts the first.
// ===========================================================================

const withPrior = (prior: Json): Json => {
  const s = base();
  md(s).supersedes = [prior];
  return s;
};

/** The real history: run 1 measured WEIGHT-001 at 1 of 9. */
const RUN_1_WEIGHT: Json = {
  verdict: "not_discriminating",
  n_adjudicated: 22,
  fail_rate_pct: 4.5455,
  interval_95: { lower_pct: 0.8, upper_pct: 21.8 },
  measured_on: "2026-07-20",
  sample_id: "COFFEE-RUN-1",
  superseded_because: "applicability_gate_added",
};

test("[remeasure] a superseded measurement is kept, and a coherent supersession passes", () => {
  expectClean(checkMeasuredDiscrimination(entryOf(withPrior(deepClone(RUN_1_WEIGHT))), "entries/0"),
    "naming the systematic defect is the correct way to overturn an earlier verdict");
});

test("[remeasure] a superseded measurement cannot be dated after the one replacing it", () => {
  const p = deepClone(RUN_1_WEIGHT); p.measured_on = "2026-12-31";
  expectRule(checkMeasuredDiscrimination(entryOf(withPrior(p)), "entries/0"), "supersedes_is_older",
    "history runs forwards");
});

test("[remeasure] `larger_sample` must actually be larger", () => {
  const p = deepClone(RUN_1_WEIGHT);
  p.superseded_because = "larger_sample"; p.n_adjudicated = 40;
  expectRule(checkMeasuredDiscrimination(entryOf(withPrior(p)), "entries/0"), "larger_sample_is_larger",
    "40 is not smaller than the replacing sample's 30");
});

test("[remeasure] DISJOINT INTERVALS MAY NOT BE EXPLAINED BY SAMPLE SIZE", () => {
  // Two disjoint 95% intervals cannot both cover the true rate, so at most one of
  // the samples measured what the entry claims. Size changes an interval's WIDTH;
  // it does not move it off the old one. The prior below is CONSTRUCTED to be
  // disjoint — the real WEIGHT-001 pair is not (see the [record] test above) —
  // because the rule has to be watched firing.
  const p = deepClone(RUN_1_WEIGHT);
  p.superseded_because = "larger_sample";
  p.n_adjudicated = 22;
  p.interval_95 = { lower_pct: 0.8, upper_pct: 21.8 };  // wholly below the new [33.2, 66.8]
  expectRule(checkMeasuredDiscrimination(entryOf(withPrior(p)), "entries/0"), "disjoint_intervals_need_a_named_defect",
    "`larger_sample` is not an explanation for two intervals that do not overlap");

  // Naming the defect instead is accepted — that is the whole point of the enum.
  const named = deepClone(p); named.superseded_because = "prior_sample_invalid";
  expectClean(checkMeasuredDiscrimination(entryOf(withPrior(named)), "entries/0"),
    "a named systematic defect explains a disjoint pair; sample size does not");
});

// ===========================================================================
// GROUP 8 — GRAMMAR 1.2: THE PREDICTION CANNOT DRIVE TIER ASSIGNMENT.
//
// ⚠️ THIS GROUP USED TO BE TAGGED [1.1] AND THE TAG WAS RETARGETED, NOT THE
// ASSERTIONS. Two sessions each authored a grammar they both called 1.1, and the
// shipped coffee document declares `grammar_version: "1.1"` — so redefining 1.1
// to mean the reshaped prediction would make a published, hash-frozen document
// invalid against the version it names. The reconciled grammar is 1.2. Every
// assertion below is the one this group has always made; only the version it is
// made at moved.
// ===========================================================================

/**
 * The baseline with its prediction stated explicitly.
 *
 * Under the reconciliation this is NEAR-IDENTITY: `MINIMAL_VALID_V12` is already
 * grammar 1.2, already carries no band, and already carries a
 * `discrimination_prediction`. The restatement is kept rather than collapsed to
 * `base()` because the tests below assert things ABOUT the prediction, and a
 * prediction they can see beats one they inherit — including the fact that
 * setting it to its most confident possible value changes nothing.
 */
function v12(): Json {
  const s = base();
  s.grammar_version = "1.2";
  entryOf(s).discrimination_prediction = {
    direction: "expect_most_to_fail",
    confidence: "high",
    reasoning: "A fixture prediction, long enough to satisfy the minimum length rule for reasoning.",
  };
  return s;
}

test("[1.2] the reshaped prediction validates", () => {
  accepts(v12(), "a grammar-1.2 entry with a direction, a confidence and reasoning must validate");
});

test("[1.2] the prediction is OPTIONAL — an author with no grounded expectation may say nothing", () => {
  const s = v12();
  delete entryOf(s).discrimination_prediction;
  accepts(s, "a field wrong 90% of the time in a known direction must not be mandatory");
});

test("[1.2] THE PREDICTION CANNOT PRODUCE A TIER", () => {
  // The whole of CP1 in one assertion. Under grammar 1.0/1.1 an author wrote
  // `in_target_band: false` and the entry became `not_discriminating` — published
  // and never run. Under 1.2 that requires a measurement.
  const s = v12();
  entryOf(s).tier = "not_discriminating";
  delete entryOf(s).binding;
  delete entryOf(s).adversarial;
  delete entryOf(s).pass_means;
  delete entryOf(s).measured_discrimination;
  rejects(s, "the most confident possible prediction must not be able to retire an entry");

  // With the measurement, and only with it, the tier is reachable.
  const ok = v12();
  entryOf(ok).tier = "not_discriminating";
  delete entryOf(ok).binding; delete entryOf(ok).adversarial; delete entryOf(ok).pass_means;
  md(ok).verdict = "not_discriminating";
  md(ok).n_adjudicated = 43; md(ok).fail_count = 42; md(ok).fail_rate_pct = 97.6744;
  md(ok).n_asked = 43;
  (md(ok).sample as Json).stores = 43; (md(ok).sample as Json).products = 43;
  md(ok).interval_95 = { lower_pct: 87.941, upper_pct: 99.5883 };
  md(ok).instrument_bias = [];  // R3: declared and empty is a claim; absent is not
  accepts(ok, "42 of 43 puts the whole interval above the band; this is what a retirement looks like");
  expectClean(checkMeasuredDiscrimination(entryOf(ok), "entries/0"), "and it must be internally coherent");
});

test("[1.2] a retirement whose measurement does NOT say not_discriminating is rejected", () => {
  const s = v12();
  entryOf(s).tier = "not_discriminating";
  delete entryOf(s).binding; delete entryOf(s).adversarial; delete entryOf(s).pass_means;
  // The measurement says `discriminating` — the entry must keep running.
  rejects(s, "a tier of not_discriminating with a discriminating measurement is a contradiction");

  const ind = v12();
  entryOf(ind).tier = "not_discriminating";
  delete entryOf(ind).binding; delete entryOf(ind).adversarial; delete entryOf(ind).pass_means;
  md(ind).verdict = "indeterminate";
  md(ind).n_adjudicated = 41; md(ind).n_asked = 41; md(ind).fail_count = 36; md(ind).fail_rate_pct = 87.8049;
  (md(ind).sample as Json).stores = 41; (md(ind).sample as Json).products = 41;
  md(ind).interval_95 = { lower_pct: 74.4558, upper_pct: 94.6767 };
  rejects(ind, "`indeterminate` means the measurement decided nothing — it may not retire an entry");
});

test("[1.2] the prediction carries no number, structurally", () => {
  const defs = (schema.$defs as Json).discriminationPrediction as Json;
  const props = Object.keys((defs.properties ?? {}) as Json).sort();
  assert.deepEqual(props, ["confidence", "direction", "notes", "reasoning"],
    "a numeric band, an `in_target_band`, or any threshold field would reintroduce the thing that was measured wrong");
  for (const [name, sub] of Object.entries((defs.properties ?? {}) as Record<string, Json>)) {
    assert.notEqual(sub.type, "number", `\`${name}\` is numeric — the reshaped prediction must not carry a rate`);
    assert.notEqual(sub.type, "integer", `\`${name}\` is numeric — the reshaped prediction must not carry a rate`);
  }
});

test("[1.2] the field's own documentation carries the measured bias, so an author cannot miss it", () => {
  const desc = String(((schema.$defs as Json).discriminationPrediction as Json).description ?? "");
  assert.match(desc, /2 of 10/, "the documentation must state the measured hit rate");
  assert.match(desc, /1 OF 10/, "and the WORSE rate the larger sample produced — more data made the record worse");
  assert.match(desc, /HIGH/, "and the direction of every miss");
  assert.match(desc, /may not determine `tier`/, "and that it is unranked");
});

test("[1.2] changing the prediction to its most extreme value changes nothing about validity", () => {
  for (const direction of ["expect_most_to_fail", "expect_most_to_pass", "expect_a_split", "no_prediction"]) {
    for (const confidence of ["low", "medium", "high"]) {
      const s = v12();
      (entryOf(s).discrimination_prediction as Json).direction = direction;
      (entryOf(s).discrimination_prediction as Json).confidence = confidence;
      accepts(s, `an executable entry predicted ${direction}/${confidence} must still be executable`);
    }
  }
});

// ===========================================================================
// GROUP 9 — THE GRAMMARS DO NOT LEAK INTO EACH OTHER.
//
// The shape of `measured_discrimination` and of the prediction is resolved by
// the document's declared `grammar_version`, never by guessing from the keys
// present — so both directions of that gate need a fixture, or half of it is
// unproved.
// ===========================================================================

test("[grammar] 1.0/1.1 require the band and forbid the reshaped prediction", () => {
  const a = shipped11(); delete entryOf(a).predicted_discrimination;
  rejects(a, "a 1.0/1.1 entry with no predicted_discrimination");

  const b = shipped11();
  entryOf(b).discrimination_prediction = { direction: "no_prediction", confidence: "low", reasoning: "x".repeat(45) };
  rejects(b, "a 1.0/1.1 entry may not carry the 1.2 field — two prediction shapes in one document is unreadable");
});

test("[grammar] 1.2 forbids the numeric band", () => {
  const s = v12();
  entryOf(s).predicted_discrimination = { predicted_fail_rate_band: "40-60%", reasoning: "x".repeat(45), measured: false };
  rejects(s, "the band is removed at 1.2, not deprecated in place");
});

test("[grammar] an undefined grammar version is rejected", () => {
  const s = base(); s.grammar_version = "2.0";
  rejects(s, "a standard is only readable against a stated grammar version");

  const t = shipped11(); t.grammar_version = "0.9";
  rejects(t, "and the enum is the gate at every version, not only at the newest one");
});

test("[grammar] the state of the shipped documents, recorded rather than assumed", () => {
  // ⚠️ THIS TEST USED TO BE CALLED "the shipped standards are grammar 1.0 and
  // carry NO measurement yet", AND THAT TITLE WENT FALSE. `coffee/v1.1` is
  // shipped, is grammar 1.1, and carries ten measurements. It was invisible
  // because the loop only ever listed two files, which is the "an absence sweep
  // cannot see a page that is simply wrong" failure in a test.
  for (const rel of ["coffee/v1.0/standard.json", "accessory/v0.1-draft/standard.json"]) {
    const std = loadJson<Json>(rel);
    assert.equal(std.grammar_version, "1.0", `${rel} grammar version`);
    const measured = (std.entries as Json[]).filter((e) => e.measured_discrimination);
    assert.equal(measured.length, 0,
      `${rel} has gained ${measured.length} measurement(s). That is good news, but this assertion is the ` +
      `reminder to re-derive its tiers under the corrected lifecycle rather than leaving them on predictions.`);
    for (const e of std.entries as Json[]) {
      expectClean(checkMeasuredDiscrimination(e, `${rel}#${String(e.id)}`), `${rel} ${String(e.id)}`);
    }
  }

  // And the one document that HAS been measured. It is grammar 1.1, so its ten
  // measurements are in the FIRST shape — a point estimate and a denominator.
  const shipped = loadJson<Json>("coffee/v1.1/standard.json");
  assert.equal(shipped.grammar_version, "1.1", "coffee/v1.1 grammar version");
  // ⚠️ AND IT IS NOT `published`, HOWEVER OFTEN IT GETS DESCRIBED THAT WAY.
  // `applied_by_author` says the authoring party has run it against real stores
  // and no second party has. A document that overstates its own status is the
  // failure this project treats as unrecoverable, so the status is pinned here
  // rather than left to prose that drifts.
  assert.equal(shipped.status, "applied_by_author", "coffee/v1.1 status");
  assert.equal((shipped.posture as Json).independently_applied, false,
    "and the posture must agree with the status — no second party has applied it");
  const measured = (shipped.entries as Json[]).filter((e) => e.measured_discrimination);
  assert.equal(measured.length, 10, "coffee/v1.1 carries ten measurements");
  for (const e of measured) {
    const m = e.measured_discrimination as Json;
    assert.ok(!("n_adjudicated" in m) && !("interval_95" in m) && !("sample" in m),
      `${String(e.id)} carries 1.2 measurement keys in a 1.1 document; the shape is resolved by grammar_version, ` +
      `and the 1.1 shape is the one this hash-frozen document was authored against`);
    assert.ok("asked" in m && "carries_information" in m,
      `${String(e.id)} must carry the FIRST shape's own keys`);
  }

  // ⚠️ AND THE 1.2 CROSS-FIELD RULES CANNOT ADJUDICATE IT — pinned here rather
  // than discovered later. `checkMeasuredDiscrimination` reads `n_adjudicated`
  // and `fail_count`, which the 1.1 shape does not have, so it answers
  // `counts_present` on all ten. That is the checker declining to speak about a
  // record it cannot read, which is correct; running it over a 1.1 document and
  // reporting ten defects would be an instrument reporting a catastrophe because
  // it was pointed at the wrong grammar.
  for (const e of measured) {
    assert.deepEqual(
      ruleNames(checkMeasuredDiscrimination(e, `coffee/v1.1#${String(e.id)}`)),
      ["counts_present"],
      `${String(e.id)}: the 1.2 rules must decline a 1.1 record, and decline it the same way every time`,
    );
  }
});

// ===========================================================================
// GROUP 10 — THE PUBLICATION GATE. A standard may not publish an error bound
// measured on any sample other than its own category.
// ===========================================================================

/**
 * A complete `category_fitness` record for the FICTIONAL `ALS-FIXTURE` category.
 *
 * ⚠️ THE NUMBERS HERE ARE FIXTURE NUMBERS, chosen so the record is internally
 * coherent (3 of 69 really is 4.3478%, and the bounds really do widen in the
 * right order) and NOT to restate any real measurement. The real, artifact-backed
 * bounds live in `standards/coffee/v1.0/fitness.json` and are quoted in the tests
 * below from there. A fixture that carried the real figures would be one grep
 * away from being read as the published record.
 */
const FITNESS = (): Json => ({
  sample: {
    sample_id: "FIXTURE-FITNESS-1",
    category_scope: "this_category",
    category_standard_id: "ALS-FIXTURE",
    stores: 42,
    products: 43,
    selection: "first_applicable_product",
    deduplicated_by_brand: true,
    applicability_gate_enforced: true,
    unclassifiable_refused: 3,
    excluded_out_of_category: 13,
    attrition_logged: true,
    captured_on: "2026-07-27",
  },
  pass_rows_audited: 69,
  audit: { row_by_row: true, untruncated_evidence: true, borderline_recorded: true, borderline_count: 2 },
  confirmed_false_positives: 3,
  bounds: {
    point_estimate_pct: 4.3478,
    naive_95_upper_pct: 11.23,
    cluster_adjusted_95_upper_pct: 13.68,
    icc: 0.2,
    per_store_pct: 7.1,
  },
  completion_state: "DEFECTS_FOUND",
  defects: [
    { entry_id: "ALS-FIXTURE-1.2-TEST-001", evidence: "a serving size rendered as the product's own weight", why_wrong: "a brewing serving size is not the net mass of the bag", category_specific: true, status: "open" },
    { entry_id: "ALS-FIXTURE-1.2-TEST-001", evidence: "a brewing recipe rendered as the bag's mass", why_wrong: "a ratio in grams is not a net quantity", category_specific: true, status: "pinned_known_gap" },
    { entry_id: "ALS-FIXTURE-1.2-TEST-001", evidence: "soil described as rich in organic matter", why_wrong: "a soil-science sentence is not a certification claim", category_specific: true, status: "open" },
  ],
  measured_on: "2026-07-27",
  limits: [
    "One product per store; nothing here measures within-store variation.",
    "The semantic tier was off, so claim-row fail rates are an upper bound.",
  ],
});

const published = (): Json => {
  const s = base();
  s.status = "published";
  s.category_fitness = FITNESS();
  return s;
};

test("[publish] a complete category-fitness record lets a standard publish", () => {
  // ⚠️ THE ANTI-VACUITY ANCHOR FOR EVERY `rejects()` BELOW. Each of those mutates
  // `published()` and asserts the result is refused. Until the reconciliation this
  // test FAILED while all of them passed — because `category_fitness` does not
  // exist at grammar 1.1, so the unmutated document was already being rejected
  // for carrying the field at all, and every mutation was matching that error
  // instead of the constraint it names. Six green tests proving nothing.
  accepts(published(), "the gate must be passable, or it is a ban rather than a gate");
  expectClean(checkCategoryFitness(published()), "and the record must be internally coherent");
});

test("[publish] A STANDARD MAY NOT PUBLISH WITHOUT A FITNESS MEASUREMENT AT ALL", () => {
  const s = base(); s.status = "published";
  rejects(s, "publishing with no measured error bound for this category");

  // And the gate is NOT retro-fitted to 1.0/1.1, which shipped with no
  // publication gate at all. Applying one now would change what an
  // already-published version means — the same reason the reconciled grammar is
  // 1.2 rather than a redefinition of 1.1.
  const old = shipped11(); old.status = "published";
  accepts(old, "a 1.0/1.1 document may still publish without a category_fitness record, because that is what it was authored under");
});

test("[publish] A BOUND MEASURED ON A GENERAL SAMPLE MAY NOT BACK A PUBLICATION", () => {
  // The measurement that forced this rule, from `coffee/v1.0/fitness.json` — same
  // engine, same audit discipline. GENERAL: 172 products over 169 stores, 509
  // audited pass rows, 18 confirmed, 7.80% cluster-adjusted — AND THAT IS A
  // FLOOR, because only one defect class has been re-checked mechanically.
  // COFFEE: 77 storefronts, 100 products, 162 audited pass rows, 10 confirmed,
  // 12.78% cluster-adjusted at ICC 0.2.
  //
  // ⚠️ THE TWO ARE NOT AUDITED TO THE SAME DEPTH, so the RATIO between them is
  // not itself a measurement and this comment does not state one. (It used to
  // say 0.83% against 13.68% — "an order of magnitude" — and both numbers have
  // since been corrected.) The DIRECTION is what the gate rests on: category
  // vocabulary produces category-specific false passes a broad sample
  // structurally cannot contain.
  const s = published();
  ((s.category_fitness as Json).sample as Json).category_scope = "general_mixed_category";
  rejects(s, "a general-sample bound estimates the error rate on copy no individual merchant writes");
});

test("[publish] A BOUND MEASURED ON ANOTHER CATEGORY'S SAMPLE IS CAUGHT BY THE CROSS-FIELD RULE", () => {
  const s = published();
  ((s.category_fitness as Json).sample as Json).category_standard_id = "ALS-COFFEE";
  // The schema cannot compare two fields; this is the rule that can.
  expectRule(checkCategoryFitness(s), "fitness_sample_is_this_category",
    "labelling someone else's sample `this_category` must not get past the gate");
});

test("[publish] the two sampling defects that produced wrong numbers are rejected at the gate", () => {
  // Roasters lead their catalogue with merchandise: first-handle selection
  // captured t-shirts, mugs, a tote bag and a cocktail shaker.
  const a = published();
  ((a.category_fitness as Json).sample as Json).selection = "first_handle";
  rejects(a, "first-handle selection is a known-defective sample and may not back a published bound");

  // `deathwishcoffee.com` and `www.deathwishcoffee.com` are one brand. They
  // produced the same false positive twice and inflated the denominator.
  const b = published();
  ((b.category_fitness as Json).sample as Json).deduplicated_by_brand = false;
  rejects(b, "an undeduplicated sample flatters a bound by inflating its denominator");
});

test("[publish] applicability is a precondition, and an unenforced gate blocks publication", () => {
  const s = published();
  ((s.category_fitness as Json).sample as Json).applicability_gate_enforced = false;
  rejects(s, "16 of 25 of run 1's products should never have been asked; a standard applied uniformly is the cruelty_free failure with a version number on it");
});

test("[publish] an audit that read truncated evidence may not back a published bound", () => {
  const s = published();
  ((s.category_fitness as Json).audit as Json).untruncated_evidence = false;
  rejects(s, "two separate audits nearly mis-classified a real row because the supporting text sat past the 180-character rendered quote");

  const b = published();
  ((b.category_fitness as Json).audit as Json).row_by_row = false;
  rejects(b, "audits of 37 and 18 rows reported zero false positives; an audit of 100 rows then found two");
});

test("[publish] an INCOMPLETE fitness run blocks publication rather than reading as clean", () => {
  const s = published();
  (s.category_fitness as Json).completion_state = "INCOMPLETE";
  rejects(s, "a measurement that did not complete is not a passing measurement");
});

test("[publish] all three bounds are required, and none may be omitted in favour of the flattering one", () => {
  for (const field of ["point_estimate_pct", "naive_95_upper_pct", "cluster_adjusted_95_upper_pct", "icc", "per_store_pct"]) {
    const s = published();
    delete ((s.category_fitness as Json).bounds as Json)[field];
    rejects(s, `publishing without \`${field}\` lets the reader see one bound and assume it is the bound`);
  }
  const s = published();
  (s.category_fitness as Json).limits = [];
  rejects(s, "a fitness record with no stated limits claims a completeness no sample of this size supports");
});

test("[rule] the bounds must be ordered, and a cluster adjustment cannot narrow an interval", () => {
  const a = published();
  ((a.category_fitness as Json).bounds as Json).naive_95_upper_pct = 1;
  expectRule(checkCategoryFitness(a), "bounds_ordered", "an upper bound below the point estimate");

  const b = published();
  ((b.category_fitness as Json).bounds as Json).cluster_adjusted_95_upper_pct = 5;
  expectRule(checkCategoryFitness(b), "cluster_bound_is_wider",
    "clustering can only widen; a narrower adjusted bound means the adjustment ran backwards, and it flatters the number");

  const c = published();
  ((c.category_fitness as Json).bounds as Json).point_estimate_pct = 1;
  expectRule(checkCategoryFitness(c), "point_estimate_matches_counts", "the point estimate must be the counts");
});

test("[rule] the defects behind a bound must be enumerated and must fit inside it", () => {
  const a = published();
  (a.category_fitness as Json).confirmed_false_positives = 999;
  expectRule(checkCategoryFitness(a), "defects_within_rows", "more false positives than audited rows");

  const b = published();
  ((b.category_fitness as Json).defects as Json[]).pop();
  expectRule(checkCategoryFitness(b), "defects_enumerated",
    "a bound whose defects are not all named cannot be checked or fixed");
});

// ===========================================================================
// GROUP 11 — THE NEVER-WEAKEN INTERACTION.
//
// Retiring an entry on a measured verdict REMOVES AN ASSERTION A MERCHANT MAY
// HAVE FAILED. Mechanically identical to `demoted`, so it costs the same
// attestation — the measurement justifies the removal without exempting it.
// ===========================================================================

/** The id `retiredEntry()` retires. Stated once, because two of the tests below
 *  attest against it in a changelog and an id typo would make the attestation
 *  silently fail to match — which reads exactly like the rule firing correctly. */
const RETIRED_ID = "ALS-FIXTURE-1.2-TEST-001";

function retiredEntry(): Json {
  const s = v12();
  assert.equal(entryOf(s).id, RETIRED_ID, "the fixture's entry id moved; the attestations below match on it");
  entryOf(s).tier = "not_discriminating";
  delete entryOf(s).binding; delete entryOf(s).adversarial; delete entryOf(s).pass_means;
  md(s).verdict = "not_discriminating";
  md(s).n_asked = 43; md(s).n_adjudicated = 43; md(s).fail_count = 42; md(s).fail_rate_pct = 97.6744;
  (md(s).sample as Json).stores = 43; (md(s).sample as Json).products = 43;
  md(s).interval_95 = { lower_pct: 87.941, upper_pct: 99.5883 };
  md(s).supersedes = [{
    verdict: "discriminating",
    n_adjudicated: 30,
    fail_rate_pct: 50,
    interval_95: { lower_pct: 33.1541, upper_pct: 66.8459 },
    measured_on: "2026-07-01",
    sample_id: "FIXTURE-SAMPLE-0",
    superseded_because: "engine_changed",
  }];
  return s;
}

test("[weaken] retiring a previously-discriminating entry without an attestation is caught", () => {
  expectRule(checkRetirementAttested(retiredEntry()), "retirement_is_a_demotion",
    "a merchant who failed it and then watches it disappear cannot tell a measurement from a complaint");
});

test("[weaken] the same retirement with an attested demotion is clean", () => {
  const s = retiredEntry();
  (s.changelog as Json[]).push({
    version: "1.3",
    date: "2026-08-01",
    summary: "Retired an entry on a measured verdict rather than on a prediction.",
    changes: [{
      entry_id: RETIRED_ID,
      change_type: "demoted",
      rationale: "Measured 42 of 43 failing; the whole 95% interval sits above the target band, so the row carries no information.",
      weakening_attestation: {
        prior_failures_exist: false,
        remediation: "not_applicable_no_failures",
        attested_by: "the standards fixture",
        attested_date: "2026-08-01",
      },
    }],
  });
  expectClean(checkRetirementAttested(s), "a measurement justifies a retirement; the attestation records it");
  accepts(s, "and the attested document still validates");
});

test("[weaken] MEASURE-ONCE-AND-RETIRE DOES NOT ESCAPE THE ATTESTATION", () => {
  // This test replaces one that asserted the opposite, and the reason is worth
  // keeping. The rule originally fired only when `supersedes` held a
  // `discriminating` verdict — so a FIRST AND ONLY measurement returning
  // `not_discriminating` needed no attestation, and the cheapest way to delete a
  // row from a standard was to measure it exactly once. An independent pass found
  // that by looking for the incentive rather than for the bug.
  const s = retiredEntry();
  delete md(s).supersedes;                       // no history at all
  expectRule(checkRetirementAttested(s), "retirement_is_a_demotion",
    "a measurement means the entry RAN, which means a merchant could have failed it");

  // Same for a supersession that never recorded an affirmative verdict.
  const t = retiredEntry();
  (md(t).supersedes as Json[])[0]!.verdict = "indeterminate";
  expectRule(checkRetirementAttested(t), "retirement_is_a_demotion",
    "an indeterminate history is not an absence of history");
});

test("[weaken] and the honest path stays cheap: retire before anyone has failed it", () => {
  const s = retiredEntry();
  delete md(s).supersedes;
  (s.changelog as Json[]).push({
    version: "1.3",
    date: "2026-08-01",
    summary: "Retired on a first measurement, before publication, with nothing outstanding.",
    changes: [{
      entry_id: RETIRED_ID,
      change_type: "demoted",
      rationale: "Measured 42 of 43 failing on its first and only run; the whole interval sits above the band.",
      weakening_attestation: {
        prior_failures_exist: false,
        remediation: "not_applicable_no_failures",
        attested_by: "the standards fixture",
        attested_date: "2026-08-01",
      },
    }],
  });
  expectClean(checkRetirementAttested(s),
    "the attestation is cheapest before publication, which is exactly where the method wants measurement to happen");
});

// ===========================================================================
// GROUP 12 — NO RULE GOES UNWATCHED.
//
// A cross-field rule with no negative fixture is indistinguishable from one that
// was never wired up. This asserts that every rule the module can emit was
// actually provoked by a fixture above.
// ===========================================================================

test("[meta] every cross-field rule has a negative fixture that provokes it", (t) => {
  // ⚠️ THE SET IS PRINTED, NOT JUST COMPARED. This test can go green two ways:
  // because every rule was provoked, or because the rule list shrank and a
  // fixture went vacuous. Those render identically as a pass, which is the
  // "zero is what a broken instrument returns and also what a healthy one
  // returns" failure. So the run states what it actually provoked, and the
  // count is asserted against ALL_RULES rather than against nothing.
  const sorted = [...provoked].sort();
  t.diagnostic(`provoked ${sorted.length} of ${ALL_RULES.length}: ${sorted.join(", ")}`);

  const missing = ALL_RULES.filter((r) => !provoked.has(r));
  assert.deepEqual([...missing], [],
    `these rules are never exercised by a negative fixture, so nothing proves they fire: ${missing.join(", ")}`);
  assert.equal(sorted.length, ALL_RULES.length,
    "the provoked set and the rule list must be the same size, so neither can be padded nor quietly trimmed");
});

test("[meta] the rule list is not padded with rules the module cannot emit", () => {
  const unknown = [...provoked].filter((r) => !(ALL_RULES as readonly string[]).includes(r));
  assert.deepEqual(unknown, [], `fixtures provoked rules missing from ALL_RULES: ${unknown.join(", ")}`);
});
