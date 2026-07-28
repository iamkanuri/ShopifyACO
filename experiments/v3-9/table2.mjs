// v3.9 CP-2 — TWO TABLES, AND THEY ARE NOT THE SAME QUANTITY.
//
// I first compared the brief's cited figures against the RAW engine-answer table and got
// 0/4 matches. That comparison was wrong, not the brief: `g14_table.mjs` renders
// CONFIRMED FALSE PASSES / HOSTILE SENTENCES — an adjudicated count — while I had computed
// `pass_evidenced` / HOSTILE. Both are legitimate; they answer different questions, and
// conflating them is exactly the "a paraphrase of a rule is not the rule" failure.
//
//   RAW        = what the engine answers. Deterministic, recomputable in 0.5s, no humans.
//   ADJUDICATED = what a reader confirmed to be a defect. Not recomputable.
//
// The standing gate must assert the RAW table, because that is the one a matcher change
// moves and the one `npm test` can reproduce. The ADJUDICATED counts are recorded beside
// it as frozen constants with their provenance.
import fs from "node:fs";

const gen = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_sentences.json", "utf8"));
const adj = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_adjudications.json", "utf8"));
const m = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_merged.json", "utf8"));

const refuted = new Map();
for (const r of adj.refutations ?? []) for (const v of r.verdicts ?? []) refuted.set(v.groupId, v);
const verdictOf = new Map();
for (const b of adj.adjudications) for (const g of b.groups) verdictOf.set(g.groupId, g);

// transcribed from g14_table.mjs's own roll-up, so the two agree by construction
const hostile = gen.rows.filter((r) => !r.control);
const perClass = new Map();
for (const r of hostile) {
  const gid = `${r.attackClass}|${r.subclass}|${r.claimKey}`;
  const g = verdictOf.get(gid);
  const ref = refuted.get(gid);
  let v = g?.verdict ?? "unknown";
  const exc = (g?.exceptions ?? []).find((e) => e.term === r.term);
  if (exc) v = exc.verdict;
  else if (v === "mixed") v = "false_pass";
  if (v === "false_pass" && ref?.refuted) v = ref.reclassify_as === "stands" ? "false_pass" : (ref.reclassify_as ?? "correct");
  const c = r.attackClass;
  if (!perClass.has(c)) perClass.set(c, { fp: 0, n: 0 });
  const cell = perClass.get(c);
  cell.n++; if (v === "false_pass") cell.fp++;
}

const BRIEF = {
  letter_not_spirit: [260, 280],
  tense_modality: [439, 621],
  wrong_subject: [368, 914],
  merchant_controlled_string: [0, 414],
};
const check = {};
for (const [cls, [p, n]] of Object.entries(BRIEF)) {
  const c = perClass.get(cls);
  check[cls] = {
    brief: `${p}/${n}`,
    adjudicated_measured: c ? `${c.fp}/${c.n}` : "ABSENT",
    matches: c ? c.fp === p && c.n === n : false,
  };
}
const matched = Object.values(check).filter((c) => c.matches).length;

const out = {
  adjudicated_table: Object.fromEntries([...perClass].map(([k, v]) => [k, `${v.fp}/${v.n}`])),
  brief_check: check,
  matched,
  of: Object.keys(BRIEF).length,
  confirmedCount_from_merge: m.confirmedCount,
  completion: matched === Object.keys(BRIEF).length ? "VERIFIED_CLEAN" : "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/table2.json", JSON.stringify(out, null, 2));
console.log("=== ADJUDICATED table (confirmed false passes / hostile) ===");
console.table(out.adjudicated_table);
console.log("=== the brief's figures, against the ADJUDICATED table ===");
console.table(check);
console.log(`matched ${matched}/${Object.keys(BRIEF).length} — completion ${out.completion}`);
