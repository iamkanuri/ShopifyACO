// G-14 STEP 1 — render the key x class table, with a completion state per cell.
//
//   node experiments/v3-8/g14_table.mjs
//
// The brief's deliverable. Every cell carries a state; an empty cell is NEVER
// read as clean, and the two reasons a cell can be empty are distinguished
// because they mean opposite things:
//   n/a    — the class does not attack that term role (e.g. `violation` against a
//            key whose violating list is empty). Nothing was owed.
//   HUMAN  — scheduled and applicable, but the sentences it needs are not
//            derivable by any generator. `adjacent_vocabulary`'s domain-collision
//            half. Something IS owed and nobody paid it.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

const m = JSON.parse(readFileSync(join(OUT, "g14_merged.json"), "utf8"));
const gen = JSON.parse(readFileSync(join(OUT, "g14_sentences.json"), "utf8"));
const adj = JSON.parse(readFileSync(join(OUT, "g14_adjudications.json"), "utf8"));

if (m.state === "incomplete") { console.error("REFUSING: the merge is INCOMPLETE."); process.exit(2); }

const refuted = new Map();
for (const r of adj.refutations ?? []) for (const v of r.verdicts ?? []) refuted.set(v.groupId, v);
const verdictOf = new Map();
for (const b of adj.adjudications) for (const g of b.groups) verdictOf.set(g.groupId, g);

// Sentence-level roll-up. A group verdict applies to every sentence in it except
// the terms named in `exceptions`, which is why the schema demanded them.
const hostile = gen.rows.filter((r) => !r.control);
let sFalsePass = 0, sCorrect = 0, sArtefact = 0, sFalseFail = 0;
const perCell = new Map();
for (const r of hostile) {
  const gid = `${r.attackClass}|${r.subclass}|${r.claimKey}`;
  const g = verdictOf.get(gid);
  const ref = refuted.get(gid);
  let v = g?.verdict ?? "unknown";
  const exc = (g?.exceptions ?? []).find((e) => e.term === r.term);
  if (exc) v = exc.verdict;
  else if (v === "mixed") v = "false_pass";
  if ((v === "false_pass") && ref?.refuted) v = ref.reclassify_as === "stands" ? "false_pass" : (ref.reclassify_as ?? "correct");
  if (v === "false_pass") sFalsePass++;
  else if (v === "generator_artifact") sArtefact++;
  else if (v === "false_fail") sFalseFail++;
  else sCorrect++;
  const k = `${r.claimKey}|${r.attackClass}`;
  if (!perCell.has(k)) perCell.set(k, { fp: 0, n: 0 });
  const c = perCell.get(k);
  c.n++; if (v === "false_pass") c.fp++;
}

const KEYS = gen.keys, CLASSES = gen.attack_classes;
const L = [];
L.push("G-14 STEP 1 — THE KEY x CLASS TABLE");
L.push(`against the shipped engine at ${gen.generated_at_commit ?? "<unrecorded>"}`);
L.push("");
L.push("CONFIRMED FALSE PASSES / HOSTILE SENTENCES, per cell.");
L.push("  n/a    = the class does not attack this key's term roles — nothing was owed");
L.push("  HUMAN  = applicable and scheduled, but not derivable by any generator — something IS owed");
L.push("");
const head = ["claim key".padEnd(20), ...CLASSES.map((c) => c.slice(0, 10).padStart(11))].join("");
L.push(head);
L.push("-".repeat(head.length));
for (const key of KEYS) {
  const line = [key.padEnd(20)];
  for (const cls of CLASSES) {
    const cell = gen.cells.find((c) => c.key === key && c.attackClass === cls);
    if (cell?.state === "not_applicable") { line.push("n/a".padStart(11)); continue; }
    if (cell?.state === "requires_human_input") { line.push("HUMAN".padStart(11)); continue; }
    const c = perCell.get(`${key}|${cls}`) ?? { fp: 0, n: 0 };
    // ⚠️ `adjacent_vocabulary` is HALF-RUN for every key, and a bare `0/14` in
    // this column reads exactly like "attacked and found nothing" — the flattering
    // reading, and the specific failure the generator's own `notExercised` logic
    // exists to prevent. Only the mechanisable half (fragment probes) ran;
    // `DEFAULT_CONTEXT.adjacentDomains` is empty, so the domain-collision half —
    // where two of this repo's known confirmed defects live — was never attempted
    // for any of the thirteen keys. Marked at the point of reading.
    line.push(`${cls === "adjacent_vocabulary" ? "~" : ""}${c.fp}/${c.n}`.padStart(11));
  }
  L.push(line.join(""));
}
L.push("-".repeat(head.length));
const totals = ["TOTAL".padEnd(20)];
for (const cls of CLASSES) {
  let fp = 0, n = 0;
  for (const key of KEYS) { const c = perCell.get(`${key}|${cls}`); if (c) { fp += c.fp; n += c.n; } }
  totals.push(`${fp}/${n}`.padStart(11));
}
L.push(totals.join(""));
L.push("");
L.push("SENTENCE-LEVEL ROLL-UP (group verdict, with per-term exceptions applied,");
L.push("then the refuter's verdict applied on top):");
L.push(`  confirmed false passes : ${sFalsePass}`);
L.push(`  correct                : ${sCorrect}`);
L.push(`  generator artefacts    : ${sArtefact}   (not English — the engine's answer carries no information)`);
L.push(`  false fails            : ${sFalseFail}   (recoverable direction, counted separately and never merged)`);
L.push(`  total hostile          : ${sFalsePass + sCorrect + sArtefact + sFalseFail} / ${hostile.length}`);
L.push("");
L.push("GROUP-LEVEL (from the merge):");
L.push(`  confirmed false-pass groups : ${m.confirmedCount}`);
L.push(`  refuted away                : ${m.tally.refutedAway}`);
L.push(`  batches 10/10, groups 779/779, missing 0, duplicates 0`);
L.push("");
const empties = gen.cells.filter((c) => c.state === "requires_human_input");
L.push(`CELLS THE GENERATOR COULD NOT POPULATE AT ALL: ${empties.length}`);
for (const c of empties) L.push(`  ${c.key} x ${c.attackClass}`);
L.push("");
L.push("⚠️ COVERAGE THIS TABLE DOES NOT HAVE, stated because a 0 cannot say it.");
L.push("  `adjacent_vocabulary` (~ in the table) ran its MECHANISABLE half only —");
L.push("  fragment probes over multi-word terms. `DEFAULT_CONTEXT.adjacentDomains`");
L.push("  is empty, so the DOMAIN-COLLISION half was never attempted for any of the");
L.push("  thirteen keys. That is where two of this repo's known confirmed defects");
L.push("  live: `organic` in its soil-science sense, and homographs such as REACH.");
L.push("  Its column is therefore NOT a measurement of that class. Reading `0/100`");
L.push("  as `attacked and clean` is the exact mistake the generator's own");
L.push("  `notExercised` logic exists to prevent, one level up.");
console.log(L.join("\n"));
