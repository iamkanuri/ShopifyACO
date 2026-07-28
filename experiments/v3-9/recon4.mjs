// v3.9 recon 4: reconcile the v3.6 frequency artifacts with the v3.8 A/B population.
// The brief: "CP-1A extends v3.6's frequency read; it must not rebuild it."
import fs from "node:fs";

const out = {};
const j = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const jl = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// ---------- v3.6 freq artifacts ----------
const F = "experiments/v3-6/freq";
for (const f of ["occurrence.json", "final_table.json", "pass_rows.json", "coverage.json"]) {
  const p = f === "coverage.json" ? "experiments/v3-6/extract/coverage.json" : `${F}/${f}`;
  if (!fs.existsSync(p)) { out[f] = "MISSING"; continue; }
  const d = j(p);
  out[f] = { topKeys: Array.isArray(d) ? `ARRAY(${d.length})` : Object.keys(d), preview: JSON.stringify(d).slice(0, 1800) };
}

// claimrows.jsonl + sentences.jsonl shapes
for (const f of ["claimrows.jsonl", "sentences.jsonl"]) {
  const p = `${F}/${f}`;
  if (!fs.existsSync(p)) { out[f] = "MISSING"; continue; }
  const rows = jl(p);
  out[f] = { count: rows.length, keys: Object.keys(rows[0]), first: rows[0] };
  if (f === "claimrows.jsonl") {
    const st = {}, byKey = {};
    for (const r of rows) {
      st[r.status ?? "?"] = (st[r.status ?? "?"] || 0) + 1;
      const k = r.claim ?? r.key ?? r.label ?? "?";
      byKey[k] = (byKey[k] || 0) + 1;
    }
    out[f].statuses = st;
    out[f].byClaim = byKey;
  }
}

// ---------- v3.8 claim population, exact via CLAIM_LABEL ----------
const CLAIM_LABEL = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};
const LABEL2KEY = Object.fromEntries(Object.entries(CLAIM_LABEL).map(([k, v]) => [v, k]));

const ab = jl("experiments/v3-8/out/ab_after_3b.jsonl");
const claimRows = ab.filter((r) => LABEL2KEY[r.label]);
const st = {}, passByKey = {}, askedByKey = {};
let passNoQuote = 0;
for (const r of claimRows) {
  st[r.status] = (st[r.status] || 0) + 1;
  const k = LABEL2KEY[r.label];
  askedByKey[k] = (askedByKey[k] || 0) + 1;
  if (r.status === "pass_evidenced") {
    passByKey[k] = (passByKey[k] || 0) + 1;
    if (!r.quote) passNoQuote++;
  }
}
out.v38_claim_population = {
  claimRowsAsked: claimRows.length,
  statuses: st,
  askedByKey,
  passByKey,
  passTotal: st.pass_evidenced ?? 0,
  passEvidencedWithNoQuote: passNoQuote,
  distinctHostsWithAPass: new Set(claimRows.filter((r) => r.status === "pass_evidenced").map((r) => r.host)).size,
  distinctHostsAsked: new Set(claimRows.map((r) => r.host)).size,
};
// the actual sentences
out.v38_pass_sentences = claimRows
  .filter((r) => r.status === "pass_evidenced")
  .map((r) => ({ host: r.host, key: LABEL2KEY[r.label], surface: r.surface, quote: r.quote, detail: r.detail }));

fs.writeFileSync("experiments/v3-9/out/recon4.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.v38_claim_population, null, 2));
console.log("\n--- v3.6 artifact keys ---");
for (const k of ["occurrence.json", "final_table.json", "pass_rows.json", "claimrows.jsonl", "sentences.jsonl"]) {
  console.log(k, "=>", JSON.stringify(out[k]?.topKeys ?? out[k]?.count ?? out[k]));
}
