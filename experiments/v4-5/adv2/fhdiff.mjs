// adv2 — INDEPENDENT DIFF of the author's own fetch-corpus outputs.
// Claim under test: "10 cases closed, 0 newly opened" (fh_base_repaired.txt vs fh_fix.txt).
import fs from "node:fs";
import path from "node:path";
const OUT = path.resolve("experiments/v4-5/out");
const ids = (f) => {
  const t = fs.readFileSync(path.join(OUT, f), "utf8");
  const s = new Set();
  for (const m of t.matchAll(/^ {2}\[([a-z0-9-]+)\]/gim)) s.add(m[1]);
  return s;
};
const flaggedCount = (f) => Number(/flagged \(candidates\)\s+:\s+(\d+)/.exec(fs.readFileSync(path.join(OUT, f), "utf8"))?.[1] ?? -1);

const B = ids("fh_base_repaired.txt"), Braw = ids("fh_base.txt"), F = ids("fh_fix.txt");
console.log("fh_base.txt          flagged header:", flaggedCount("fh_base.txt"), " parsed ids:", Braw.size);
console.log("fh_base_repaired.txt flagged header:", flaggedCount("fh_base_repaired.txt"), " parsed ids:", B.size);
console.log("fh_fix.txt           flagged header:", flaggedCount("fh_fix.txt"), " parsed ids:", F.size);
// CANARY: the parser must recover exactly as many ids as the header claims, or the diff
// below is over a set the parser invented.
const parseOk = flaggedCount("fh_base_repaired.txt") === B.size && flaggedCount("fh_fix.txt") === F.size && flaggedCount("fh_base.txt") === Braw.size;
console.log("CANARY parser agrees with headers:", parseOk, parseOk ? "LIVE" : "INCOMPLETE — do not read the diff below");

const closed = [...B].filter((x) => !F.has(x)).sort();
const opened = [...F].filter((x) => !B.has(x)).sort();
console.log(`\nCLOSED by the fix (flagged at base_repaired, clean at fix): ${closed.length}`);
console.log("  " + closed.join(", "));
console.log(`NEWLY OPENED (clean at base_repaired, flagged at fix): ${opened.length}`);
console.log("  " + (opened.join(", ") || "(none)"));
console.log(`\nharness-repair-only delta (base_repaired minus base): ${[...B].filter((x) => !Braw.has(x)).sort().join(", ") || "(none)"}`);
console.log(`  and base minus base_repaired: ${[...Braw].filter((x) => !B.has(x)).sort().join(", ") || "(none)"}`);
// did cur-14 / mm-01 / mm-02 move?
for (const id of ["cur-14", "mm-01", "mm-02", "mm-13", "znn-16", "znn-02"]) {
  console.log(`  ${id.padEnd(8)} base_repaired=${B.has(id) ? "FLAGGED" : "clean  "}  fix=${F.has(id) ? "FLAGGED" : "clean"}`);
}
