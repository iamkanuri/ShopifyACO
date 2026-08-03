// adv2 — what is actually IN the two jsonl files? Reported, not assumed.
import fs from "node:fs";
import path from "node:path";
const OUT = path.resolve("experiments/v4-5/out");
const read = (f) => fs.readFileSync(path.join(OUT, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const base = read("p19_base.jsonl");
const fix = read("p19_fix.jsonl");
console.log("base records", base.length, "fix records", fix.length);
console.log("base keys", Object.keys(base[0]).join(","));
console.log("row keys", Object.keys(base[0].rows[0]).join(","));
// duplicate labels within a host?
const dupes = (rows, tag) => {
  let n = 0; const ex = [];
  for (const r of rows) {
    const seen = new Set();
    for (const x of r.rows ?? []) { if (seen.has(x.label)) { n++; if (ex.length < 5) ex.push([r.host, x.label]); } seen.add(x.label); }
  }
  console.log(`${tag}: duplicate labels within a host = ${n}`, JSON.stringify(ex));
};
dupes(base, "base"); dupes(fix, "fix");
// row-count distribution
const counts = (rows) => rows.reduce((m, r) => ((m[(r.rows ?? []).length] = (m[(r.rows ?? []).length] ?? 0) + 1), m), {});
console.log("base row-count histogram", JSON.stringify(counts(base)));
console.log("fix  row-count histogram", JSON.stringify(counts(fix)));
// hosts present in one but not the other
const bk = new Set(base.map((r) => r.key)), fk = new Set(fix.map((r) => r.key));
console.log("in base not fix", [...bk].filter((k) => !fk.has(k)).length, "in fix not base", [...fk].filter((k) => !bk.has(k)).length);
// errors
console.log("base errors", base.filter((r) => r.error).length, "fix errors", fix.filter((r) => r.error).length);
// LIVENESS: the two files must not be the same run twice
const sameJson = JSON.stringify(base) === JSON.stringify(fix);
console.log("CANARY files-identical (must be false):", sameJson);
// LIVENESS: base must contain zero minPriceUsd, fix must not (proves the engines differ)
console.log("CANARY base minPriceUsd===0 count (expect >0):", base.filter((r) => r.minPriceUsd === 0).length);
console.log("CANARY fix  minPriceUsd===0 count (expect 0):", fix.filter((r) => r.minPriceUsd === 0).length);
