// v3.8 — the general sample's bound at the fixed SHA.
//
//   node experiments/v3-8/bound.mjs
//
// ⚠️ THE ESTIMATOR IS IMPORTED, NOT REIMPLEMENTED. `poissonUpper95` comes from
// `experiments/v3-7/perkind.mjs` — the exact CDF inversion that replaced the
// hand-typed table in `experiments/v3-2/general_bound.mjs`. That table carries
// exact limits for x = 0..10 and falls through to `x + 1.96*sqrt(x) + 2` beyond,
// a DIFFERENT estimator wearing the same name. **x = 11 is past the end of the
// table**, so running the old instrument here would silently take that branch.
// v3.7 measured the gap at x = 18 as 28.31 against an exact 26.74.
//
// The anti-drift anchor is asserted below: the imported function must reproduce
// the published table wherever the table was used, or no comparison between this
// bound and any earlier published bound means anything.
import { poissonUpper95 } from "../v3-7/perkind.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const rm = JSON.parse(readFileSync(join(HERE, "out", "remeasure.json"), "utf8"));
if (rm.state !== "VERIFIED_CLEAN") { console.error("REFUSING: the re-measurement is not VERIFIED_CLEAN."); process.exit(2); }

// ---- anti-drift anchor ----
const PUBLISHED_TABLE = [3.0, 4.744, 6.296, 7.754, 9.154, 10.513, 11.842, 13.148, 14.435, 15.705, 16.962];
const drift = PUBLISHED_TABLE.map((v, i) => ({ x: i, table: v, exact: poissonUpper95(i) }))
  .filter((r) => Math.abs(r.table - r.exact) > 0.01);
if (drift.length) {
  console.error(`REFUSING: the imported estimator does not reproduce the published table at x = ${drift.map((d) => d.x).join(",")}. ` +
    `Every earlier published bound came out of that table; if this disagrees, no comparison is valid.`);
  process.exit(2);
}

const ICC = Number(process.env.ICC ?? 0.2);
const pct = (v) => `${v.toFixed(2)}%`;

// Wilson, for the interval — the estimator v3.7 publishes beside the bound.
const wilson = (x, n) => {
  const z = 1.959963985, p = x / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d) * 100, Math.min(1, (c + s) / d) * 100];
};

// ⚠️ THE STORE DENOMINATOR IS STORES WITH AT LEAST ONE PASS ROW, not all 172
// snapshots — because `rowsPerStore` is what DEFF is computed from, and a store
// contributing no rows contributes no clustering. v3.7 published 169 and using
// 172 reproduced its bound as 7.48% against a published 7.53%. A 0.05pp gap is
// small enough to shrug at and is exactly the size of gap that means the two
// numbers came out of different instruments.
const rows = [
  { label: "v3.7 PUBLISHED (shipped engine)", n: rm.pass_rows_before, x: rm.confirmed_before, stores: rm.stores_with_pass_rows_before },
  { label: "v3.8 at the fixed SHA", n: rm.pass_rows_after, x: rm.confirmed_after, stores: rm.stores_with_pass_rows_after },
];

const L = [];
L.push("v3.8 — THE GENERAL SAMPLE'S BOUND");
L.push("  GENERAL ONLY. Coffee holds zero price rows (PRICE-001 is `unbound`, no v1.3");
L.push("  entry binds price_under), so no coffee figure moves and none is recomputed.");
L.push("");
L.push(`  anti-drift anchor: the exact inversion reproduces the published table for x = 0..10 ✓`);
L.push(`  x = 11 is PAST the end of that table — the old instrument would have taken its`);
L.push(`  approximation branch and returned ${(11 + 1.96 * Math.sqrt(11) + 2).toFixed(3)} where the exact limit is ${poissonUpper95(11).toFixed(3)}.`);
L.push("");
for (const r of rows) {
  const rowsPerStore = r.n / r.stores;
  const deff = 1 + (rowsPerStore - 1) * ICC;
  const naive = (poissonUpper95(r.x) / r.n) * 100;
  const clustered = naive * deff;
  const [lo, hi] = wilson(r.x, r.n);
  L.push(`  ${r.label}`);
  L.push(`    pass rows n          : ${r.n}`);
  L.push(`    confirmed x          : ${r.x}`);
  L.push(`    point estimate       : ${pct((r.x / r.n) * 100)}`);
  L.push(`    Wilson 95%           : ${pct(lo)} – ${pct(hi)}`);
  L.push(`    Poisson upper on x   : ${poissonUpper95(r.x).toFixed(3)}`);
  L.push(`    naive 95% upper      : ${pct(naive)}`);
  L.push(`    rows/store ${rowsPerStore.toFixed(2)}, DEFF ${deff.toFixed(2)} (ICC ${ICC})`);
  L.push(`    cluster-adjusted 95% : ${pct(clustered)}`);
  L.push("");
}
L.push("  ⚠️ The v3.7 line is RECOMPUTED here only to show the two under one estimator.");
L.push("     v3.7's published figures stay frozen in their own sidecar block, unedited.");
console.log(L.join("\n"));
