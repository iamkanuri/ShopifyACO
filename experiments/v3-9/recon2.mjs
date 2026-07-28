// v3.9 recon 2: the claim-row population, the merge arithmetic, and the collisions.
import fs from "node:fs";

const out = {};
const rows = fs.readFileSync("experiments/v3-8/out/ab_after_3b.jsonl", "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// --- label taxonomy: what do the labels look like?
const labelShapes = {};
for (const r of rows) {
  // normalise: strip trailing values so shapes collapse
  const shape = r.label
    .replace(/\$[\d,.]+/g, "$N")
    .replace(/\d+/g, "N");
  labelShapes[shape] = (labelShapes[shape] || 0) + 1;
}
out.distinctLabelShapes = Object.keys(labelShapes).length;
out.topLabelShapes = Object.entries(labelShapes).sort((a, b) => b[1] - a[1]).slice(0, 60);

// --- surfaces
const surfaces = {};
for (const r of rows) surfaces[r.surface ?? "(null)"] = (surfaces[r.surface ?? "(null)"] || 0) + 1;
out.surfaces = surfaces;

// --- pass_evidenced rows that carry a QUOTE (claim rows quote; price rows do not)
const withQuote = rows.filter((r) => r.status === "pass_evidenced" && r.quote);
out.passEvidencedWithQuote = withQuote.length;
const wqSurf = {};
for (const r of withQuote) wqSurf[r.surface ?? "(null)"] = (wqSurf[r.surface ?? "(null)"] || 0) + 1;
out.passEvidencedWithQuoteBySurface = wqSurf;
const wqShape = {};
for (const r of withQuote) {
  const s = r.label.replace(/\$[\d,.]+/g, "$N").replace(/\d+/g, "N");
  wqShape[s] = (wqShape[s] || 0) + 1;
}
out.passEvidencedWithQuoteByLabelShape = Object.entries(wqShape).sort((a, b) => b[1] - a[1]);

// --- the merge arithmetic
const g = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_merged.json", "utf8"));
out.merge = {
  groups_expected: g.groups_expected,
  groups_adjudicated: g.groups_adjudicated,
  confirmedCount: g.confirmedCount,
  confirmedArrayLength: Array.isArray(g.confirmed) ? g.confirmed.length : null,
  tally: g.tally,
  tallySum: Object.values(g.tally).reduce((a, b) => a + b, 0),
  state: g.state,
  refutations_seen: g.refutations_seen,
  tableKeys: g.table ? Object.keys(g.table) : null,
};
// verdict distribution over the confirmed array
if (Array.isArray(g.confirmed)) {
  const v = {};
  for (const c of g.confirmed) v[c.verdict] = (v[c.verdict] || 0) + 1;
  out.merge.confirmedVerdicts = v;
  const byClass = {};
  for (const c of g.confirmed) {
    const cls = String(c.groupId).split("|")[0];
    byClass[cls] = (byClass[cls] || 0) + 1;
  }
  out.merge.confirmedByClass = byClass;
}
if (g.table) out.merge.tableSample = JSON.stringify(g.table).slice(0, 2500);

fs.writeFileSync("experiments/v3-9/out/recon2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 9000));
