// v3.9 CP-2 — emit the per-cell RAW table as a TS literal for the standing gate.
import fs from "node:fs";

const gen = JSON.parse(fs.readFileSync("experiments/v3-9/out/g14_collisions.json", "utf8"));
const CONTRA = "Your public copy states the opposite of this requirement.";

const cells = new Map();
for (const r of gen.rows) {
  if (r.control) continue;
  const k = `${r.claimKey}|${r.attackClass}`;
  if (!cells.has(k)) cells.set(k, { pass: 0, total: 0 });
  const c = cells.get(k);
  c.total++;
  if (r.engineStatus === "pass_evidenced") c.pass++;
}
// controls, per key — the must-not-regress direction
const controls = new Map();
for (const r of gen.rows) {
  if (!r.control) continue;
  const k = r.claimKey;
  if (!controls.has(k)) controls.set(k, 0);
  controls.set(k, controls.get(k) + 1);
}

const KEYS = gen.keys, CLASSES = gen.attack_classes;
const lines = [];
for (const key of KEYS) {
  const parts = [];
  for (const cls of CLASSES) {
    const c = cells.get(`${key}|${cls}`);
    parts.push(c ? `${cls}: [${c.pass}, ${c.total}]` : `${cls}: null`);
  }
  lines.push(`  ${key}: { ${parts.join(", ")} },`);
}
const literal = `{\n${lines.join("\n")}\n}`;
fs.writeFileSync("experiments/v3-9/out/cells.ts.txt", literal);

const totals = {};
for (const cls of CLASSES) {
  let p = 0, n = 0;
  for (const key of KEYS) { const c = cells.get(`${key}|${cls}`); if (c) { p += c.pass; n += c.total; } }
  totals[cls] = [p, n];
}
console.log("CLASSES:", JSON.stringify(CLASSES));
console.log("KEYS:", KEYS.length);
console.log("class totals:", JSON.stringify(totals));
console.log("controls total:", [...controls.values()].reduce((a, b) => a + b, 0));
console.log("hostile total:", gen.rows.filter((r) => !r.control).length);
console.log("\n--- literal written to experiments/v3-9/out/cells.ts.txt ---");
console.log(literal.slice(0, 1200));
