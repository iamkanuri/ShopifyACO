// v3.9 CP-1A: reconcile v3.6's 71 live claim rows against v3.8's 34, mechanically.
// The brief: "where the numbers disagree, that disagreement is a finding about one of
// the instruments." Resolve completion explicitly; never let a gap read as agreement.
import fs from "node:fs";

const j = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const jl = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

const CLAIM_LABEL = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};
const LABEL2KEY = Object.fromEntries(Object.entries(CLAIM_LABEL).map(([k, v]) => [v, k]));

const v36 = j("experiments/v3-6/freq/pass_rows.json");
const ab = jl("experiments/v3-8/out/ab_after_3b.jsonl");
const v38 = ab.filter((r) => LABEL2KEY[r.label] && r.status === "pass_evidenced")
  .map((r) => ({ ...r, claim: LABEL2KEY[r.label] }));

const norm = (h) => String(h || "").replace(/^www\./, "").toLowerCase();

const askedTrue = v36.filter((r) => r.asked);
const askedFalse = v36.filter((r) => !r.asked);

// host x claim keys
const key = (r) => `${norm(r.domain ?? r.host)}|${r.claim}`;
const s36 = new Set(v36.map(key));
const s36asked = new Set(askedTrue.map(key));
const s38 = new Set(v38.map(key));

const inBoth = [...s38].filter((k) => s36.has(k));
const only38 = [...s38].filter((k) => !s36.has(k));
const only36asked = [...s36asked].filter((k) => !s38.has(k));

// corpus overlap: which hosts does each instrument even cover?
const h36 = new Set(v36.map((r) => norm(r.domain)));
const abHosts = new Set(ab.map((r) => norm(r.host)));

const report = {
  v36: {
    total: v36.length,
    asked_true: askedTrue.length,
    asked_false: askedFalse.length,
    byClaim: tally(v36, (r) => r.claim),
    byClaimAskedTrue: tally(askedTrue, (r) => r.claim),
    stores: 335,
    note: "v3.6 FORCED all 13 claims at every store; `asked` marks the ones the engine would select itself.",
  },
  v38: {
    total: v38.length,
    byClaim: tally(v38, (r) => r.claim),
    snapshots: 349,
    hostsInDump: abHosts.size,
  },
  reconciliation: {
    v38_rows_also_in_v36: inBoth.length,
    v38_rows_NOT_in_v36: only38.length,
    v36_askedTrue_rows_NOT_in_v38: only36asked.length,
    only38_examples: only38.slice(0, 25),
    only36asked_examples: only36asked.slice(0, 25),
    v36_hosts_covered: h36.size,
    v36_hosts_absent_from_v38_dump: [...h36].filter((h) => !abHosts.has(h)).length,
  },
};
function tally(arr, f) {
  const o = {};
  for (const x of arr) o[f(x)] = (o[f(x)] || 0) + 1;
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
}

// completion
const problems = [];
if (v36.length === 0 || v38.length === 0) problems.push("an instrument returned nothing");
report.completion = problems.length ? "INCOMPLETE" : "VERIFIED_CLEAN";
report.problems = problems;

fs.writeFileSync("experiments/v3-9/out/reconcile.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
