// adv2 — WHAT EXACTLY WAS DROPPED, and does the new refusal sentence ever render?
import fs from "node:fs";
import path from "node:path";
const OUT = path.resolve("experiments/v4-5/adv2/out");
const read = (f) => fs.readFileSync(path.join(OUT, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const base = read("adv2_base.jsonl"), fix = read("adv2_fix.jsonl");
const key = (r) => `${r.corpus}::${r.file}`;
const F = new Map(fix.map((r) => [key(r), r]));

const isPrice = (l) => /^Price under \$/i.test(l);
const rows = (r) => [...(r.assertions ?? []), ...(r.deferredRows ?? [])];

console.log("=== the 11 dropped price rows (base status/detail) ===");
let n = 0, byStatus = {};
for (const b of base) {
  const f = F.get(key(b)); if (!f) continue;
  const fl = new Set(rows(f).map((r) => r.label));
  const dropped = rows(b).filter((r) => isPrice(r.label) && !fl.has(r.label));
  const appearedPrice = rows(f).filter((r) => isPrice(r.label) && !new Set(rows(b).map((x) => x.label)).has(r.label));
  if (!dropped.length || appearedPrice.length) continue; // skip cap moves
  n++;
  byStatus[dropped[0].status] = (byStatus[dropped[0].status] ?? 0) + 1;
  console.log(`${String(n).padStart(2)} ${b.host.padEnd(28)} kept=${b.kept} ${dropped[0].status.padEnd(15)} minBase=${b.minPriceUsd} minFix=${f.minPriceUsd} zeroFlag=${f.publishedZeroPrice} | ${dropped[0].detail}`);
}
console.log("dropped-row status histogram:", JSON.stringify(byStatus), "total:", n);

// ---- Does the new zero refusal sentence EVER render on the public path? ----
const NEEDLE = "Every price readable on this product is zero";
let hits = 0, zeroFlagged = 0;
for (const f of fix) {
  if (f.publishedZeroPrice === true) zeroFlagged++;
  for (const r of rows(f)) if (String(r.detail ?? "").includes(NEEDLE)) hits++;
}
console.log(`\n=== the new refusal sentence, across all ${fix.length} snapshots ===`);
console.log(`products flagged publishedZeroPrice=true : ${zeroFlagged}`);
console.log(`rows RENDERING the new sentence          : ${hits}`);
// CANARY: the needle must be findable at all — assert it against a string we control.
const canaryPos = `x ${NEEDLE} y`.includes(NEEDLE), canaryNeg = "unrelated".includes(NEEDLE);
console.log(`CANARY needle-matcher works (true,false) : ${canaryPos},${canaryNeg}`);
console.log(canaryPos && !canaryNeg ? "CANARY LIVE" : "INCOMPLETE — matcher dead");

// ---- Do any $0.00 sentences survive at fix? ----
const survivors = [];
for (const f of fix) for (const r of rows(f)) if (/Lowest readable price is \$0(\.00)?\./.test(String(r.detail ?? ""))) survivors.push({ host: f.host, label: r.label, detail: r.detail });
console.log(`\n"$0.00" rows surviving at fix: ${survivors.length}`, JSON.stringify(survivors.slice(0, 5)));
const baseZero = [];
for (const b of base) for (const r of rows(b)) if (/Lowest readable price is \$0(\.00)?\./.test(String(r.detail ?? ""))) baseZero.push(b.host);
console.log(`"$0.00" rows at base        : ${baseZero.length} -> ${baseZero.join(", ")}`);
console.log(baseZero.length > 0 && survivors.length === 0 ? "TWO-SIDED: base has them, fix has none" : "CHECK");
