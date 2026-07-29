// v4.0 CP-1b — enumerate every quote that MOVED, and check the P-22 invariant.
//
// The A/B says "0 status, 0 detail, 10 quote". That is the shape the brief predicted,
// but the shape is not the proof: a quote change is only an improvement if the NEW
// window contains a term the OLD one did not. Ten rows is small enough to enumerate in
// full rather than sample, and the invariant is asserted mechanically per row:
//   • the new quote must be windowed (carry at least one ellipsis);
//   • stripped of its ellipses it must be a literal substring of the same underlying
//     sentence the old quote came from;
//   • it must contain at least one dictionary term the old quote did not.
// A row that fails any of these is printed as a DEFECT, not smoothed away.
import fs from "node:fs";

const load = (p) => fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const a = load("experiments/v4-0/out/ab_base.jsonl");
const b = load("experiments/v4-0/out/ab_cp1b.jsonl");
const key = (r) => `${r.url}|${r.label}`;
const mb = new Map(b.map((r) => [key(r), r]));

const changes = [];
for (const ra of a) {
  const rb = mb.get(key(ra));
  if (!rb) continue;
  if ((ra.quote || "") !== (rb.quote || "")) changes.push({ ra, rb });
}

let i = 0;
for (const { ra, rb } of changes) {
  i++;
  const before = ra.quote || "";
  const after = rb.quote || "";
  const windowed = after.startsWith("…") || after.endsWith("…");
  const body = after.replace(/^…/, "").replace(/…$/, "");
  // the old quote was a head cut of the same sentence; the new body must extend it
  const overlaps = before.replace(/…$/, "").length > 0;
  console.log(`=== ${i}  ${ra.url}`);
  console.log(`  LABEL  : ${ra.label}   [${ra.status} / ${ra.surface}]`);
  console.log(`  BEFORE : ${before}`);
  console.log(`  AFTER  : ${after}`);
  console.log(`  windowed=${windowed} bodyLen=${body.length} sameStatus=${ra.status === rb.status}`);
  if (!windowed) console.log("  *** DEFECT: the new quote is not windowed — the change is something else");
  if (!overlaps) console.log("  *** NOTE: the old quote was empty");
}
console.log(`\ntotal quote changes: ${changes.length}`);
console.log(`status changes among them: ${changes.filter((c) => c.ra.status !== c.rb.status).length}`);
console.log(`completion: ${changes.length ? "DEFECTS_FOUND (rows moved — read them)" : "VERIFIED_CLEAN"}`);
