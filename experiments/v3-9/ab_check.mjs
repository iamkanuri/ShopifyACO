// v3.9 — compare two A/B dumps.
//
// ⚠️ THE KEY IS THE URL, NOT THE HOST. P-16: a host can appear in more than one capture
// set with a DIFFERENT product. Keyed on `host|label`, a Map silently keeps whichever row
// came last, and two dumps that list the sets in a different order then "disagree" on
// every multi-product host. That is exactly what my first attempt reported — 11 status
// and 15 detail differences on six hosts, every one of them an artefact of the key.
//
// The probe records `url` for this reason ("THE URL IS NOT DECORATION"). Use it.
import fs from "node:fs";

const [A, B] = process.argv.slice(2);
if (!A || !B) { console.error("usage: ab_check.mjs <before.jsonl> <after.jsonl>"); process.exit(2); }

const load = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const a = load(A), b = load(B);

const hasUrl = a.every((r) => r.url) && b.every((r) => r.url);
if (!hasUrl) {
  console.error("INCOMPLETE — one dump has no `url` field, so rows cannot be keyed unambiguously.");
  process.exit(2);
}
const key = (r) => `${r.url}|${r.label}`;

// duplicate-key check FIRST: if a key is not unique, the comparison below is meaningless
function dupes(rows) {
  const c = new Map();
  for (const r of rows) c.set(key(r), (c.get(key(r)) || 0) + 1);
  return [...c].filter(([, n]) => n > 1).map(([k]) => k);
}
const dA = dupes(a), dB = dupes(b);
if (dA.length || dB.length) {
  console.error(`INCOMPLETE — duplicate keys: A=${dA.length} B=${dB.length}`, dA.slice(0, 5), dB.slice(0, 5));
  process.exit(2);
}

const ma = new Map(a.map((r) => [key(r), r])), mb = new Map(b.map((r) => [key(r), r]));
const statusChanges = [], detailChanges = [], quoteChanges = [];
let same = 0;
for (const [k, ra] of ma) {
  const rb = mb.get(k);
  if (!rb) continue;
  const s = ra.status !== rb.status;
  const d = (ra.detail || "") !== (rb.detail || "");
  const q = (ra.quote || "") !== (rb.quote || "");
  if (s) statusChanges.push({ k, from: ra.status, to: rb.status, detailFrom: ra.detail, detailTo: rb.detail });
  else if (d) detailChanges.push({ k, from: ra.detail, to: rb.detail });
  else if (q) quoteChanges.push({ k, from: ra.quote, to: rb.quote });
  else same++;
}
const onlyA = [...ma.keys()].filter((k) => !mb.has(k));
const onlyB = [...mb.keys()].filter((k) => !ma.has(k));

const out = {
  A, B, rowsA: a.length, rowsB: b.length, same,
  statusChanges: statusChanges.length, detailChanges: detailChanges.length, quoteChanges: quoteChanges.length,
  onlyA: onlyA.length, onlyB: onlyB.length,
  identical: !statusChanges.length && !detailChanges.length && !quoteChanges.length && !onlyA.length && !onlyB.length,
  samples: { status: statusChanges.slice(0, 30), detail: detailChanges.slice(0, 20), quote: quoteChanges.slice(0, 20) },
  // hosts touched, so a fix's blast radius is stated in stores as well as rows
  hostsTouched: [...new Set([...statusChanges, ...detailChanges, ...quoteChanges].map((c) => c.k.split("/")[2]))],
  completion: a.length && b.length ? "VERIFIED_CLEAN" : "INCOMPLETE",
};
fs.writeFileSync("experiments/v3-9/out/ab_check.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, samples: undefined }, null, 2));
if (out.samples.status.length) {
  console.log("\n--- status changes ---");
  for (const c of out.samples.status) console.log(`${c.k}\n   ${c.from} -> ${c.to}`);
}
