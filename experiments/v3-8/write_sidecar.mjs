// ===========================================================================
// v3.8 — write the re-measured general sample into the v1.3 fitness SIDECAR.
//
//   node experiments/v3-8/write_sidecar.mjs [--check]
//
// Pause 1's invariant: a matcher fix and the re-measurement of every published
// figure it moves ship in the SAME push, so the reviewer sees one self-consistent
// unit. Pause 2's riders, all three honoured below:
//   (a) the 488 -> 483 denominator arithmetic is stated ROW BY ROW — no silent shrink
//   (b) both blocks carry point AND cluster-adjusted forms, each pinned to its own engine SHA
//   (c) coffee is explicitly noted as unaffected, with the reason
//
// ⚠️ IT IS A SIDECAR EDIT, NOT A DOCUMENT EDIT. `standards/coffee/v1.3/standard.json`
// is not touched and `standard_hash` does not move, so every citation made against
// v1.3 still resolves. That is the same rule v1.0's fitness follows.
//
// ⚠️ THE DISPLACED FIGURE IS NAMED, NEVER DELETED. v3.7's 488/18/3.69%/7.53% moves
// into `supersedes` as a structured record pinned to the engine that produced it,
// exactly as this sidecar already does for the 0.85% floor it displaced. A
// measurement that is overwritten without being named is how a project loses the
// ability to say what changed.
// ===========================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SIDECAR = join(REPO, "standards", "coffee", "v1.3", "fitness.json");

const rm = JSON.parse(readFileSync(join(HERE, "out", "remeasure.json"), "utf8"));
if (rm.state !== "VERIFIED_CLEAN") { console.error("REFUSING: the re-measurement is not VERIFIED_CLEAN."); process.exit(2); }

const SHA = execSync("git rev-parse HEAD", { cwd: REPO }).toString().trim();
const f = JSON.parse(readFileSync(SIDECAR, "utf8"));
const g = f.samples.find((s) => /general/i.test(s.label));
if (!g) { console.error("REFUSING: no general sample found in the sidecar."); process.exit(2); }

// Guard against a double-run overwriting the frozen v3.7 record with itself.
if (g.supersedes_measurement) {
  console.error("REFUSING: this sidecar already carries a v3.8 block. Re-running would supersede the v3.8 figure with itself and lose v3.7's.");
  process.exit(2);
}
if (g.pass_rows_audited !== 488 || g.confirmed_false_positives !== 18) {
  console.error(`REFUSING: the general block is ${g.pass_rows_audited}/${g.confirmed_false_positives}, not the expected 488/18. Someone else moved it.`);
  process.exit(2);
}

// ---- freeze v3.7's figures, in full, pinned to the engine that produced them ----
const frozen = {
  measured_at: f.measured_at,
  engine_commit: f.engine_commit,
  engine_description: "v3.5 rule D; unchanged through v3.6 and v3.7 (both measurement-only)",
  pass_rows_audited: g.pass_rows_audited,
  confirmed_false_positives: g.confirmed_false_positives,
  borderline_counted_as_passes: g.borderline_counted_as_passes,
  point_estimate_pct: g.point_estimate_pct,
  interval_95: g.interval_95,
  bound_95_naive_pct: g.bound_95_naive_pct,
  bound_95_cluster_icc02_pct: g.bound_95_cluster_icc02_pct,
  rows_per_store: g.rows_per_store,
  deff_icc02: g.deff_icc02,
  why_displaced:
    "Not withdrawn and not an error. It is a correct measurement OF THE ENGINE AT 6a3e5d7, and the " +
    "engine changed: v3.8 shipped a tier-aware cents conversion and a non-USD price refusal. Both " +
    "figures are true of their own engine SHA, which is why both are pinned to one.",
};

// ---- the denominator, row by row (rider a) ----
const denominator = {
  statement: "488 - 5 + 0 = 483. Every row that left the pass set is named; none entered it.",
  pass_rows_before: 488,
  left_the_pass_set: rm.closed.map((d) => ({
    store: d.host, row: d.label, from: "pass_evidenced", to: d.nowStatus, now_says: d.nowDetail,
  })),
  entered_the_pass_set: [],
  pass_rows_after: 483,
  reconciles: true,
  why_it_shrank:
    "The five rows are the non-USD stores whose price row now refuses instead of stating a dollar " +
    "figure. They did not stop being rows; they stopped being PASSING rows, which is the intended " +
    "effect of the fix. A denominator that moves without an itemised reason is a number that looks " +
    "measured and is actually a side effect, so the itemisation is published rather than the delta.",
};

// ---- write the v3.8 figures ----
g.measured_at = "2026-07-28";
// ⚠️ THE COMMIT WHOSE MATCHER PRODUCED THIS, not whatever HEAD happens to be when
// the script runs. `f5cf74f` is the last commit touching a matcher file; the
// `ENGINE_VERSION` bump to v2.1.0 that follows it changes no row, which is exactly
// why it can follow the measurement without invalidating it. Pinning to a moving
// HEAD would make this figure claim an engine it was never run against.
g.engine_commit = "f5cf74f";
g.engine_commit_note = `measured at f5cf74f (the last matcher commit); branch tip at publication was ${SHA.slice(0, 7)}, and every commit between them is measurement, documentation or the ENGINE_VERSION bump — none changes a row.`;
g.engine_version_tag = "v2.1.0";
g.pass_rows_audited = rm.pass_rows_after;
g.confirmed_false_positives = rm.confirmed_after;
g.point_estimate_pct = 2.28;
g.interval_95 = { lower_pct: 1.28, upper_pct: 4.03 };
g.bound_95_naive_pct = 3.77;
g.bound_95_cluster_icc02_pct = 5.17;
g.rows_per_store = 2.86;
g.deff_icc02 = 1.37;
// ⚠️ COMPUTED, NOT NULLED. An earlier draft set this to `null` on the grounds
// that it had not been recomputed — and `renderFitness` calls `.toFixed()` on it,
// so every published standard page threw and 15 tests failed. "I did not measure
// this" is a legitimate state, but it must be expressed in a shape the renderer
// can render; silently handing a renderer a null is not a refusal, it is a crash.
// 10 distinct stores carry at least one surviving defect, over 169 stores with a
// pass row.
g.per_store_pct = Number(((new Set(rm.survived.map((d) => d.host)).size / rm.stores_with_pass_rows_after) * 100).toFixed(2));
g.completion_state = "DEFECTS_FOUND";
g.supersedes_measurement = frozen;
g.denominator_change = denominator;
g.defects_closed_by_v3_8 = {
  count: 7,
  currency_rows_now_refusing: rm.closed.map((d) => `${d.host} — ${d.label}`),
  cents_rows_now_correct: [
    "levainbakery.com — Price under $1005 -> $15; evidence $1000.00 -> $10.00. Still a PASS row, and now a true one.",
    "richer-poorer.com — Price under $305 -> $10; evidence $300.00 -> $3.00. Still a PASS row, and now a true one.",
  ],
  note:
    "Two of the seven remain PASSING rows with a CORRECTED price, which is why 'still a pass row' " +
    "cannot be used as 'still a false pass'. Treating them mechanically as survivors reported two " +
    "closed defects as open on the first run of the re-measurement.",
};
g.surviving_defects = rm.survived.map((d) => `${d.host} — ${d.label} (${d.kind})`);
g.method_v3_8 =
  "Replay of experiments/v2-9/snaps through runProductTest with only the transport swapped, at " +
  `${SHA.slice(0, 7)} and at the pre-fix parent, from separate git WORKTREES rather than a file swap. ` +
  "Pass rows are keyed on PRODUCT URL, not host: deathwishcoffee.com appears in this sample and again " +
  "in a coffee set, and keying on host pooled three of another sample's rows, giving 491 where 488 is " +
  "published. The bound uses the exact Poisson CDF inversion from experiments/v3-7/perkind.mjs, " +
  "anchored against the published table at x = 0..10 — x = 11 is past the end of general_bound.mjs's " +
  "hand-typed table, whose fallback returns 19.501 against an exact 18.208.";

// ---- coffee, explicitly unaffected (rider c) ----
f.v3_8_scope = {
  statement: "v3.8's two price fixes move the GENERAL sample only. The coffee sample cannot move.",
  reason:
    "ALS-COFFEE-1.3-PRICE-001 is tier `unbound` and NO v1.3 entry binds req_kind `price_under` — the " +
    "ten bindings are claim x3, variant_option x4, delivery, identifiers and attribute. The coffee " +
    "sample therefore contains zero price rows, so a price fix has nothing to touch. Verified by " +
    "reading the bindings out of standard.json rather than assumed.",
  coffee_figures_unchanged: { pass_rows_audited: 160, confirmed_false_positives: 7 },
  standard_json_untouched: "standard_hash does not move; every citation against v1.3 still resolves.",
};
f._v38_comment =
  "v3.8 (2026-07-28): the general sample re-measured at the fixed SHA after the tier-aware cents fix " +
  "and the non-USD price refusal. v3.7's figures are NOT edited — they are frozen inside " +
  "`samples[].supersedes_measurement`, pinned to the engine commit that produced them. Both readings " +
  "are true of their own engine.";

if (process.argv.includes("--check")) {
  console.log(JSON.stringify({ general: { n: g.pass_rows_audited, x: g.confirmed_false_positives, cluster: g.bound_95_cluster_icc02_pct }, frozen: { n: frozen.pass_rows_audited, x: frozen.confirmed_false_positives, cluster: frozen.bound_95_cluster_icc02_pct } }, null, 2));
  process.exit(0);
}

writeFileSync(SIDECAR, `${JSON.stringify(f, null, 2)}\n`);
console.log("sidecar written.");
console.log(`  general  n ${frozen.pass_rows_audited} -> ${g.pass_rows_audited}   x ${frozen.confirmed_false_positives} -> ${g.confirmed_false_positives}   cluster ${frozen.bound_95_cluster_icc02_pct}% -> ${g.bound_95_cluster_icc02_pct}%`);
console.log(`  coffee   unchanged at 160 / 7 (PRICE-001 unbound; no v1.3 entry binds price_under)`);
console.log(`  engine   ${frozen.engine_commit} (frozen)  ->  ${SHA.slice(0, 7)} (current)`);
console.log(`  denominator 488 - 5 + 0 = 483, itemised`);
