// v3.9 CP-1A recon: locate the population and the artifacts, by EXECUTION not by reading.
import fs from "node:fs";
import path from "node:path";

const R = "experiments/v3-8/out";
const out = {};

function readJsonl(p) {
  const t = fs.readFileSync(p, "utf8");
  return t.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ---- 1. the A/B dumps: what shape, how many rows, how many pass_evidenced claim rows
for (const f of ["ab_before.jsonl", "ab_after_3a.jsonl", "ab_after_3b.jsonl"]) {
  const p = path.join(R, f);
  if (!fs.existsSync(p)) { out[f] = "MISSING"; continue; }
  const rows = readJsonl(p);
  const keys = new Set();
  for (const r of rows.slice(0, 5)) for (const k of Object.keys(r)) keys.add(k);
  const kinds = {};
  const statuses = {};
  let claimPass = 0;
  for (const r of rows) {
    kinds[r.kind ?? r.req_kind ?? "?"] = (kinds[r.kind ?? r.req_kind ?? "?"] || 0) + 1;
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if ((r.kind ?? r.req_kind) === "claim" && r.status === "pass_evidenced") claimPass++;
  }
  out[f] = {
    rows: rows.length,
    sampleKeys: [...keys],
    kinds,
    statuses,
    claimPassEvidenced: claimPass,
    firstRow: rows[0],
    firstClaimPass: rows.find((r) => (r.kind ?? r.req_kind) === "claim" && r.status === "pass_evidenced"),
  };
}

// ---- 2. g14_merged.json shape
const gm = path.join(R, "g14_merged.json");
if (fs.existsSync(gm)) {
  const g = JSON.parse(fs.readFileSync(gm, "utf8"));
  out.g14_merged = {
    topKeys: Object.keys(g),
    sample: Array.isArray(g) ? g[0] : JSON.stringify(g).slice(0, 1500),
  };
}

fs.writeFileSync("experiments/v3-9/out/recon.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
