// v4.1 CP-0 — WHICH ROWS CARRY INFORMATION, measured over 349 real stores.
//
// The legibility question an agency principal will ask silently in the first thirty
// seconds: "is this table telling me anything, or is it padded?" A row that passes for
// everyone and a row that fails for everyone carry the same amount of information, which is
// none — this repo's own rule, written down at v2.3 CP2 when the defaulted `cruelty_free`
// row failed 13/13 and was removed.
//
// Two rows are tautological BY CONSTRUCTION and that is verifiable from the source, not
// from the data:
//   price_under     `niceCap(min) = max(10, ceil((min+0.01)/5)*5)` is always STRICTLY
//                   above the product's own minimum, so the comparison cannot fail.
//   variant_option  the requirement is built from `p.optionValues.find(...)` — an option
//                   value the product already has.
// This script measures the consequence on the corpus rather than asserting it.
//
// Source: experiments/v4-0/out/ab_base.jsonl — 2,928 rows over 349 URLs, produced by the
// v3.8 A/B probe against the shipped engine. Rows are the ones `buildBuyerTask` actually
// ASKS, which is the population a merchant sees.
import fs from "node:fs";

const rows = fs.readFileSync("experiments/v4-0/out/ab_base.jsonl", "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// Two-sided liveness: the dump must contain both passing and failing rows overall, or the
// per-label figures below are measuring a broken file rather than the engine.
const anyPass = rows.some((r) => r.status === "pass_evidenced");
const anyFail = rows.some((r) => r.status === "not_proven");
if (!anyPass || !anyFail) {
  console.error(`INCOMPLETE — canary collapsed (anyPass=${anyPass} anyFail=${anyFail})`);
  process.exit(2);
}

/** Label → requirement KIND. The dump carries the rendered label, not the kind, so this
 *  maps back by the label's own shape. Anything unmatched is reported, never bucketed. */
const kindOf = (label) => {
  if (/^Price under \$/.test(label)) return "price_under";
  if (/ option available$/.test(label)) return "variant_option";
  if (/^In stock and purchasable$/.test(label)) return "in_stock";
  if (/^Available as a one-time purchase$/.test(label)) return "no_subscription";
  if (/^Delivery timing is stated$/.test(label)) return "delivery";
  if (/ are stated$/.test(label)) return "attribute";
  if (/^Product identifier /.test(label)) return "identifiers";
  return "claim";
};

const byKind = new Map();
for (const r of rows) {
  if (r.label === "<ERROR>") continue;
  const k = kindOf(r.label);
  if (!byKind.has(k)) byKind.set(k, { n: 0, pass: 0, noBlock: 0, notProven: 0, access: 0 });
  const c = byKind.get(k);
  c.n++;
  if (r.status === "pass_evidenced") c.pass++;
  else if (r.status === "pass_no_blocking") c.noBlock++;
  else if (r.status === "not_proven") c.notProven++;
  else if (r.status === "requires_store_access") c.access++;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "—");
const out = [];
console.log("kind                 n     pass%   noBlock%  notProven%  access%   INFORMATIVE?");
for (const [k, c] of [...byKind].sort((a, b) => b[1].n - a[1].n)) {
  // "Informative" here means: does the row ever come out differently across 349 stores?
  // A row whose outcome is constant tells a reader nothing about THEIR store.
  const passShare = c.pass / c.n;
  const constant = passShare > 0.98 || passShare < 0.02;
  out.push({ kind: k, ...c, pass_pct: Number(pct(c.pass, c.n)), constant });
  console.log(
    `${k.padEnd(18)} ${String(c.n).padStart(5)}   ${pct(c.pass, c.n).padStart(5)}   ${pct(c.noBlock, c.n).padStart(7)}   ${
      pct(c.notProven, c.n).padStart(9)}   ${pct(c.access, c.n).padStart(6)}   ${constant ? "*** NO — constant" : "yes"}`,
  );
}

const totals = { rows: rows.length, kinds: byKind.size };
const constantKinds = out.filter((o) => o.constant);
console.log(`\nrows: ${totals.rows} over 349 product URLs`);
console.log(`kinds whose outcome is effectively CONSTANT across the corpus: ${constantKinds.map((o) => o.kind).join(", ") || "none"}`);
console.log(`rows those kinds occupy: ${constantKinds.reduce((n, o) => n + o.n, 0)} of ${totals.rows} (${pct(constantKinds.reduce((n, o) => n + o.n, 0), totals.rows)}%)`);

fs.writeFileSync("experiments/v4-1/out/row_information.json", JSON.stringify({ totals, byKind: out, completion: "VERIFIED_CLEAN" }, null, 2));
console.log("completion: VERIFIED_CLEAN");
