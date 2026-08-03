// v4.5 — WRITE THE NEW GENERAL BLOCK INTO THE SIDECAR, FREEZING THE OLD ONE.
//
//   node experiments/v4-5/write_sidecar.mjs
//
// THE RULES, all of them load-bearing and all of them written down before this session:
//   • A MEASUREMENT TAKEN AFTER A VERSION SHIPS GOES IN THE SIDECAR, NEVER THE DOCUMENT.
//     `standard_hash` covers `standard.json`'s bytes and a citation resolves through it,
//     so editing the document to carry a newer number would silently break every citation
//     ever made against v1.3.
//   • A NEW BLOCK; THE PRIOR ONE IS FROZEN, NEVER EDITED. v3.7's 7.53% is already frozen
//     inside `supersedes_measurement`; v3.8's 5.17% now joins it, nested, so the chain is
//     readable end to end rather than overwritten.
//   • THE DISPLACED FIGURE IS NOT WITHDRAWN. 5.17% is a correct measurement OF THE ENGINE
//     AT f5cf74f. The engine changed. Both facts go in the record.
//   • COFFEE IS NOT TOUCHED, and `remeasure.mjs` verifies the premise from the artifact
//     rather than asserting it: 10 bound entries, 0 with `req_kind: price_under`.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");
const FIT = path.join(repo, "standards", "coffee", "v1.3", "fitness.json");

const rm = JSON.parse(fs.readFileSync(path.join(here, "out", "remeasure.json"), "utf8"));
if (rm.state !== "VERIFIED_CLEAN") { console.error(`REFUSING: remeasure is ${rm.state}`); process.exit(2); }
const s = rm.stats;

const fit = JSON.parse(fs.readFileSync(FIT, "utf8"));
const g = fit.samples.find((x) => x.name === "general");
if (!g) { console.error("REFUSING: no general sample"); process.exit(2); }

// Guard against a double-run rewriting its own output as the "prior" measurement.
if (g.measured_at === "2026-08-03") { console.error("REFUSING: the v4.5 block is already written."); process.exit(2); }
if (g.pass_rows_audited !== rm.pass_rows_before || g.confirmed_false_positives !== rm.confirmed_before) {
  console.error(`REFUSING: the sidecar says ${g.pass_rows_audited} rows / ${g.confirmed_false_positives} defects but the re-measurement started from ${rm.pass_rows_before} / ${rm.confirmed_before}. They must agree or the chain is broken.`);
  process.exit(2);
}

// ---- freeze the outgoing block, preserving the whole chain --------------------
const frozen = {
  measured_at: g.measured_at,
  engine_commit: g.engine_commit,
  engine_version_tag: g.engine_version_tag,
  engine_description: "v3.8's tier-aware cents conversion and non-USD price refusal; unchanged through v4.4 (semantic-tier pin, no matcher movement)",
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
    "Not withdrawn and not an error. It is a correct measurement OF THE ENGINE AT f5cf74f, and the engine changed: v4.5 closed ENGINE_GAPS P-19's first half, so a published $0.00 is no longer read as a price. Six of this block's eleven confirmed false passes were that class and are gone; the ten rows they lived among left the pass set with them.",
  surviving_defects: g.surviving_defects,
  defect_classes: g.defect_classes,
  supersedes_measurement: g.supersedes_measurement ?? null,
};

// ---- the new block -----------------------------------------------------------
Object.assign(g, {
  pass_rows_audited: s.pass_rows_audited,
  confirmed_false_positives: s.confirmed_false_positives,
  point_estimate_pct: s.point_estimate_pct,
  interval_95: s.interval_95,
  bound_95_naive_pct: s.bound_95_naive_pct,
  bound_95_cluster_icc02_pct: s.bound_95_cluster_icc02_pct,
  rows_per_store: s.rows_per_store,
  deff_icc02: s.deff_icc02,
  is_floor: false,
  completion_state: "DEFECTS_FOUND",
  measured_at: "2026-08-03",
  engine_commit: "21b9ba7",
  engine_version_tag: "v2.6.0",
  supersedes_measurement: frozen,
  surviving_defects: rm.survived.map((d) => `${d.host} — ${d.label} (${d.kind})`),
  denominator_change: {
    statement: rm.denominator_change.statement,
    pass_rows_before: rm.pass_rows_before,
    left_the_pass_set: rm.denominator_change.rows_that_left_the_pass_set,
    entered_the_pass_set: rm.denominator_change.rows_that_entered_the_pass_set,
    note:
      "Ten rows left the pass set and only SIX of them were adjudicated defects. The other four — dedcool.com, puracy.com, supergoop.com, voluspa.com — publish a deliberate free gift their own product title names, and the row-by-row audit had counted them as TRUE passes. So the honest accounting of this change is six false statements removed AND four true ones no longer stated, not six defects closed. Public bytes do not separate a giveaway from a withheld price, and this test now declines to guess which it is looking at.",
  },
  defects_closed_by_v4_5: {
    count: rm.closed.length,
    klass: "$0.00 treated as a price",
    rows: rm.closed.map((d) => `${d.host} — ${d.label}`),
    mechanism:
      "zeroAwareMin refuses when every readable price on the product is zero, and evaluate re-tests the zero at the branch that renders. The row is no longer generated at all on the public path, because buildBuyerTask skips a price candidate whose minPriceUsd is null and no published standard binds price_under.",
  },
  method_v4_5:
    "Replay of experiments/v2-9/snaps through runProductTest with only the transport swapped, at 21b9ba7 and at the pre-change parent, from separate git WORKTREES rather than a file swap. Method carried verbatim from experiments/v3-8/remeasure.mjs: pass rows keyed by PRODUCT URL (not host — keyed on host, v3.8 recovered 491 general rows where 488 was published, pooling three rows of a coffee set), labels money-normalised because the price row's label embeds its cap, and three outcomes rather than two so that a row which is still a pass with a CHANGED rendered detail is re-adjudicated explicitly instead of assumed either way. Zero rows landed in that third bucket here. experiments/v4-5/remeasure.mjs.",
});

fs.writeFileSync(FIT, `${JSON.stringify(fit, null, 2)}\n`);
console.log(JSON.stringify({
  wrote: FIT,
  general: { rows: s.pass_rows_audited, confirmed: s.confirmed_false_positives, cluster_95: s.bound_95_cluster_icc02_pct, interval: s.interval_95 },
  froze: { rows: frozen.pass_rows_audited, confirmed: frozen.confirmed_false_positives, cluster_95: frozen.bound_95_cluster_icc02_pct },
  chain_depth: (function d(x) { return x?.supersedes_measurement ? 1 + d(x.supersedes_measurement) : 0; })(g),
}, null, 2));
