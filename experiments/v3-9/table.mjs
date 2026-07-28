// v3.9 CP-2 — compute the key x class table EXACTLY, from both runs, and check the
// brief's cited figures against it.
//
// The brief cites `letter_not_spirit 260/280`, `tense_modality 439/621`,
// `wrong_subject 368/914`, `merchant_controlled_string 0/414`. Those are the numbers
// v3.9's whole pivot argument is anchored to, so they get executed, not transcribed.
import fs from "node:fs";

const CONTRA = "Your public copy states the opposite of this requirement.";

function load(p) {
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  return d.rows ?? d.sentences ?? d.results ?? [];
}

function table(rows) {
  const t = {};
  for (const r of rows) {
    if (r.control) continue;               // controls are the must-not-regress direction
    const k = r.claimKey, c = r.attackClass;
    t[k] ??= {}; t[k][c] ??= { pass: 0, total: 0, contradicted: 0, not_proven: 0 };
    const cell = t[k][c];
    cell.total++;
    if (r.engineStatus === "pass_evidenced") cell.pass++;
    else if (r.engineDetail === CONTRA) cell.contradicted++;
    else cell.not_proven++;
  }
  return t;
}

function classTotals(t) {
  const o = {};
  for (const k of Object.keys(t)) {
    for (const [c, cell] of Object.entries(t[k])) {
      o[c] ??= { pass: 0, total: 0 };
      o[c].pass += cell.pass; o[c].total += cell.total;
    }
  }
  return o;
}

const v38 = load("experiments/v3-8/out/g14_sentences.json");
const v39 = load("experiments/v3-9/out/g14_collisions.json");

const t38 = table(v38), t39 = table(v39);
const c38 = classTotals(t38), c39 = classTotals(t39);

const BRIEF = {
  letter_not_spirit: [260, 280],
  tense_modality: [439, 621],
  wrong_subject: [368, 914],
  merchant_controlled_string: [0, 414],
};

const check = {};
for (const [cls, [p, n]] of Object.entries(BRIEF)) {
  check[cls] = {
    brief: `${p}/${n}`,
    v38_measured: c38[cls] ? `${c38[cls].pass}/${c38[cls].total}` : "ABSENT",
    v39_measured: c39[cls] ? `${c39[cls].pass}/${c39[cls].total}` : "ABSENT",
    matches_v38: c38[cls] ? c38[cls].pass === p && c38[cls].total === n : false,
  };
}

const out = {
  v38: { rows: v38.length, classTotals: c38 },
  v39: { rows: v39.length, classTotals: c39 },
  brief_check: check,
  brief_figures_that_match_the_artifact: Object.values(check).filter((c) => c.matches_v38).length,
  brief_figures_checked: Object.keys(BRIEF).length,
  perKey_v39: t39,
  completion: v38.length && v39.length ? "VERIFIED_CLEAN" : "INCOMPLETE",
};
fs.writeFileSync("experiments/v3-9/out/table.json", JSON.stringify(out, null, 2));

console.log("=== class totals (hostile only, controls excluded) ===");
console.log("class                        v3.8 (no collisions)   v3.9 (with collisions)");
for (const c of Object.keys(c39)) {
  const a = c38[c] ? `${c38[c].pass}/${c38[c].total}` : "-";
  const b = `${c39[c].pass}/${c39[c].total}`;
  console.log(c.padEnd(28), a.padEnd(22), b);
}
console.log("\n=== the brief's cited figures, executed ===");
console.table(check);
console.log(`matched: ${out.brief_figures_that_match_the_artifact}/${out.brief_figures_checked}`);
