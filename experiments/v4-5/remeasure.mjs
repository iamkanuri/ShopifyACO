// ===========================================================================
// v4.5 — RE-MEASURE THE GENERAL SAMPLE AT THE P-19 SHA.
//
//   node experiments/v4-5/remeasure.mjs
//
// The binding rule this repo ships under: a matcher fix and the re-measurement of every
// published figure it moves go in the SAME push, as one self-consistent unit, and the new
// figure is a NEW block — v3.8's 5.17% stays frozen beside it, never edited.
//
// METHOD IS v3.8's, DELIBERATELY UNCHANGED (experiments/v3-8/remeasure.mjs). Its eleven
// adjudicated survivors are re-applied ROW BY ROW against the post-fix replay: a defect
// survives only if its row is still a PASS row. Nothing is re-adjudicated by arithmetic.
// Four of its hard-won rules are carried verbatim because each was paid for:
//
//   • KEY BY PRODUCT URL, NOT HOST. `deathwishcoffee.com` is in the general sample AND in
//     a coffee set with a different product; keyed on host, v3.8 recovered 491 general
//     pass rows where 488 was published — three rows of another sample, silently pooled.
//   • MONEY-NORMALISE THE LABEL. The price row's label embeds its cap and this fix moves
//     caps, so the raw label cannot be the row key.
//   • THREE OUTCOMES, NOT TWO. closed / changed / survived. "Still a pass row" is not
//     "still a false pass": a corrected price can leave a row correctly passing, and
//     counting those as survivors reports closed defects as open. A `changed` row is
//     listed for explicit re-adjudication, never assumed either way.
//   • TWO-SIDED CANARY. A run reporting "all closed" or "none closed" is likelier a
//     broken match than a real result.
//
// ⚠️ COFFEE CANNOT MOVE, and it is CHECKED here rather than asserted. Coffee's PRICE-001
// is `unbound` at v1.2/v1.3 and none of the ten bound entries has `req_kind: price_under`,
// so the coffee sample holds zero price rows. This script verifies that from the artifact
// and refuses to publish a general figure if the premise turns out to be false.
// ===========================================================================
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(HERE, "out");

// ---- the general sample, BY PRODUCT URL --------------------------------------
const GEN_DIR = join(REPO, "experiments", "v2-9", "snaps");
const generalUrls = new Set(
  readdirSync(GEN_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(GEN_DIR, f), "utf8")).url),
);

// ---- COFFEE PREMISE CHECK ----------------------------------------------------
const coffee = JSON.parse(readFileSync(join(REPO, "standards", "coffee", "v1.3", "standard.json"), "utf8"));
const entries = coffee.entries ?? [];
const bound = entries.filter((e) => e.binding);
const priceBound = bound.filter((e) => String(e.binding?.req_kind ?? "") === "price_under");
const coffeePremiseOk = bound.length > 0 && priceBound.length === 0;

// ---- load the two replays ----------------------------------------------------
const load = (p) => readFileSync(join(OUT, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
// p19_probe writes ONE record per store with a `rows` array; flatten to one record per row.
const flatten = (recs) => recs.flatMap((r) => (r.rows ?? []).map((row) => ({ url: r.url, host: r.host, ...row })));
const before = flatten(load("p19_base.jsonl")).filter((r) => generalUrls.has(r.url));
const after = flatten(load("p19_fix.jsonl")).filter((r) => generalUrls.has(r.url));

const PASSING = new Set(["pass_evidenced"]);
const passBefore = before.filter((r) => PASSING.has(r.status));
const passAfter = after.filter((r) => PASSING.has(r.status));

// ---- v3.8's eleven adjudicated survivors -------------------------------------
const prior = JSON.parse(readFileSync(join(REPO, "experiments", "v3-8", "out", "remeasure.json"), "utf8"));
const defects = prior.survived;
if (!Array.isArray(defects) || defects.length !== prior.confirmed_after) {
  console.error(`REFUSING: v3.8's survivor list is ${Array.isArray(defects) ? defects.length : typeof defects} entries but its own count says ${prior.confirmed_after}.`);
  process.exit(2);
}

const norm = (label) => String(label).replace(/\$\s*[\d,]+(?:\.\d+)?/g, "$<n>");
// v3.8's survivor records carry `host` but not `url`; resolve host -> url from the replay.
const urlOfHost = new Map(before.map((r) => [r.host, r.url]));
const afterByKey = new Map();
for (const r of after) {
  const k = `${r.url}|${norm(r.label)}`;
  if (!afterByKey.has(k)) afterByKey.set(k, []);
  afterByKey.get(k).push(r);
}
const beforeByKey = new Map();
for (const r of before) beforeByKey.set(`${r.url}|${norm(r.label)}`, r);

const survived = [], closed = [], changed = [], unmatched = [];
for (const d of defects) {
  const url = urlOfHost.get(d.host);
  if (!url) { unmatched.push({ ...d, why: "host not present in the general replay" }); continue; }
  const rows = afterByKey.get(`${url}|${norm(d.label)}`);
  const was = beforeByKey.get(`${url}|${norm(d.label)}`);
  if (!rows || !rows.length) { closed.push({ ...d, nowStatus: "(row not generated)", nowDetail: null, wasDetail: was?.detail ?? null }); continue; }
  const passRow = rows.find((r) => PASSING.has(r.status));
  if (!passRow) { closed.push({ ...d, nowStatus: rows[0].status, nowDetail: rows[0].detail, wasDetail: was?.detail ?? null }); continue; }
  if (was && passRow.detail !== was.detail) changed.push({ ...d, wasDetail: was.detail, nowDetail: passRow.detail });
  else survived.push({ ...d, nowStatus: passRow.status, nowDetail: passRow.detail });
}

const problems = [];
if (!coffeePremiseOk) problems.push(`coffee premise FAILED: ${bound.length} bound entries, ${priceBound.length} of them price_under. The coffee sample may hold price rows and cannot be declared unmoved.`);
if (unmatched.length) problems.push(`${unmatched.length} survivor(s) could not be located after the fix (${unmatched.map((d) => `${d.host}/${d.label}`).join("; ")}). A defect that cannot be located is NOT a defect that was closed.`);
if (!closed.length) problems.push("0 defects closed — implausible: the A/B shows 10 zero-price pass rows removed, 6 of them adjudicated survivors.");
if (!survived.length) problems.push("0 defects survived — implausible: 5 of the 11 are attribute/availability/aggregation defects this fix does not address.");
if (changed.length) problems.push(`${changed.length} survivor row(s) still pass but with a CHANGED rendered detail; each needs explicit re-adjudication before a rate is published.`);

const state = problems.length ? "INCOMPLETE" : "VERIFIED_CLEAN";
const n = state === "INCOMPLETE" ? null : passAfter.length;
const x = state === "INCOMPLETE" ? null : survived.length;

// ---- statistics: v3-2's method, unmodified -----------------------------------
// (experiments/v3-5/bound.mjs has a syntax error and has never executed; the v3-2 pair
// is the instrument every published bound in this repo actually came out of.)
function wilson(k, nn) {
  if (!nn) return null;
  const z = 1.959963984540054, p = k / nn, d = 1 + (z * z) / nn;
  const c = p + (z * z) / (2 * nn), m = z * Math.sqrt((p * (1 - p)) / nn + (z * z) / (4 * nn * nn));
  return { lower_pct: +(((c - m) / d) * 100).toFixed(2), upper_pct: +(((c + m) / d) * 100).toFixed(2) };
}
/** Exact Poisson upper limit by CDF inversion (v3.7 replaced a hand-typed table whose
 *  fallback returned 28.31 at x=18 where the exact limit is 26.74). */
function poissonUpper(k, alpha = 0.05) {
  let lo = 0, hi = Math.max(20, k * 4 + 20);
  const cdf = (mu) => { let s = 0, t = Math.exp(-mu); for (let i = 0; i <= k; i++) { s += t; t *= mu / (i + 1); } return s; };
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cdf(mid) > alpha) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

let stats = null;
if (state === "VERIFIED_CLEAN") {
  const storesAfter = new Set(passAfter.map((r) => r.url)).size;
  const rowsPerStore = passAfter.length / storesAfter;
  const icc = 0.2;
  const deff = 1 + (rowsPerStore - 1) * icc;
  const naive = (poissonUpper(x) / n) * 100;
  stats = {
    pass_rows_audited: n,
    confirmed_false_positives: x,
    point_estimate_pct: +((x / n) * 100).toFixed(2),
    interval_95: wilson(x, n),
    bound_95_naive_pct: +naive.toFixed(2),
    rows_per_store: +rowsPerStore.toFixed(2),
    deff_icc02: +deff.toFixed(2),
    bound_95_cluster_icc02_pct: +(naive * deff).toFixed(2),
    stores_with_pass_rows: storesAfter,
  };
}

const out = {
  sample: "general DTC",
  state, problems,
  scope_note: "GENERAL ONLY. Verified from standards/coffee/v1.3/standard.json: " +
    `${bound.length} bound entries, ${priceBound.length} of them price_under. The coffee sample holds no price rows, so no coffee figure moves.`,
  pass_rows_before: passBefore.length,
  pass_rows_after: n,
  confirmed_before: defects.length,
  confirmed_after: x,
  closed: closed.map((d) => ({ host: d.host, label: d.label, kind: d.kind, wasDetail: d.wasDetail, nowStatus: d.nowStatus, nowDetail: d.nowDetail })),
  survived: survived.map((d) => ({ host: d.host, label: d.label, kind: d.kind })),
  changed, unmatched,
  denominator_change: {
    statement: `${passBefore.length} - ${passBefore.length - (n ?? 0)} + 0 = ${n}`,
    rows_that_left_the_pass_set: before.filter((r) => PASSING.has(r.status))
      .filter((b) => { const rows = afterByKey.get(`${b.url}|${norm(b.label)}`); return !rows || !rows.some((r) => PASSING.has(r.status)); })
      .map((b) => ({ host: b.host, label: b.label, was: b.detail })),
    rows_that_entered_the_pass_set: after.filter((r) => PASSING.has(r.status))
      .filter((a) => { const b = beforeByKey.get(`${a.url}|${norm(a.label)}`); return !b || !PASSING.has(b.status); })
      .map((a) => ({ host: a.host, label: a.label, now: a.detail })),
  },
  stats,
};
writeFileSync(join(OUT, "remeasure.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ ...out, closed: out.closed.length, survived: out.survived.length, denominator_change: { ...out.denominator_change, rows_that_left_the_pass_set: out.denominator_change.rows_that_left_the_pass_set.length, rows_that_entered_the_pass_set: out.denominator_change.rows_that_entered_the_pass_set.length } }, null, 2));
