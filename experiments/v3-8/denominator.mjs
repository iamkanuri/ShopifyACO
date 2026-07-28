// The 488 -> 483 denominator change, ROW BY ROW. No silent shrink.
//
// A published denominator that moves without an itemised reason is exactly the
// shape this repo keeps catching: a number that looks measured and is actually a
// side effect. Every row that entered or left the pass set is named here, and the
// arithmetic is asserted rather than asserted-about.
//
// (Written as a FILE, not `node -e`. The first attempt inline had its `\$` eaten
//  by PowerShell quoting, collapsing every price label onto one key and reporting
//  29 pass rows where there are 488. Same rule the repo already records twice.)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(HERE, "out");

const GEN_DIR = join(REPO, "experiments", "v2-9", "snaps");
const genUrls = new Set(
  readdirSync(GEN_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(GEN_DIR, f), "utf8")).url),
);

const load = (p) => readFileSync(join(OUT, p), "utf8").split("\n")
  .filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => genUrls.has(r.url));

const before = load("ab_before.jsonl");
const after = load("ab_after_3b.jsonl");

const norm = (label) => String(label).replace(/\$\s*[\d,]+(?:\.\d+)?/g, "$<n>");
const keyOf = (r) => `${r.url}|${norm(r.label)}`;

const index = (rows) => {
  const m = new Map();
  for (const r of rows) {
    let k = keyOf(r), i = 1;
    while (m.has(k)) k = `${keyOf(r)}#${i++}`;
    m.set(k, r);
  }
  return m;
};
const B = index(before), A = index(after);

const PASS = (r) => r.status === "pass_evidenced";
const passB = [...B.values()].filter(PASS);
const passA = [...A.values()].filter(PASS);

const lost = [], gained = [], onlyB = [], onlyA = [];
for (const [k, b] of B) {
  const a = A.get(k);
  if (!a) { onlyB.push(b); continue; }
  if (PASS(b) && !PASS(a)) lost.push({ b, a });
  if (!PASS(b) && PASS(a)) gained.push({ b, a });
}
for (const [k, a] of A) if (!B.has(k)) onlyA.push(a);

const L = [];
L.push("v3.8 — THE GENERAL DENOMINATOR, ROW BY ROW");
L.push(`  rows compared        : ${B.size} before / ${A.size} after`);
L.push(`  rows only in BEFORE  : ${onlyB.length}`);
L.push(`  rows only in AFTER   : ${onlyA.length}`);
L.push("");
L.push(`  PASS ROWS BEFORE     : ${passB.length}    [v3.7 published 488]`);
L.push(`  left the pass set    : -${lost.length}`);
L.push(`  entered the pass set : +${gained.length}`);
L.push(`  PASS ROWS AFTER      : ${passA.length}`);
L.push("");
L.push("  arithmetic check     : " +
  `${passB.length} - ${lost.length} + ${gained.length} = ${passB.length - lost.length + gained.length}` +
  (passB.length - lost.length + gained.length === passA.length ? "  ✓ reconciles" : "  ✗ DOES NOT RECONCILE"));
L.push("");
L.push("EVERY ROW THAT LEFT THE PASS SET:");
for (const { b, a } of lost) {
  L.push(`  ${b.host.padEnd(24)} ${String(b.label).slice(0, 22).padEnd(24)} ${b.status} -> ${a.status}`);
  L.push(`      was: ${JSON.stringify(String(b.detail).slice(0, 80))}`);
  L.push(`      now: ${JSON.stringify(String(a.detail).slice(0, 96))}`);
}
L.push("");
L.push(`EVERY ROW THAT ENTERED THE PASS SET: ${gained.length}`);
for (const { b, a } of gained) L.push(`  ${b.host.padEnd(24)} ${String(b.label).slice(0, 22).padEnd(24)} ${b.status} -> ${a.status}`);
console.log(L.join("\n"));

const ok = passB.length - lost.length + gained.length === passA.length && onlyB.length === 0 && onlyA.length === 0;
process.exitCode = ok ? 0 : 2;
