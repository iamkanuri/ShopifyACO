// ===========================================================================
// G-14 STEP 1 — MERGE the adjudications, apply the refutations, render the
// key x class table.
//
//   node experiments/v3-8/g14_merge.mjs <adjudications.json>
//
// ⚠️ IT REFUSES A NUMBER ON A MISSING GROUP. `confirmedCount` is `number | null`
// and is null on INCOMPLETE, never 0 — so a merge that lost a batch cannot be
// summed into a defect total by a caller that only reads the number. v3.7 proved
// the equivalent merge by MUTATION (feed it one extra unadjudicated row, require
// exit 1), and the unmutated run must be accepted first or the mutation proves
// nothing. Both are wired below.
//
// ⚠️ A REFUTED CLAIM IS REMOVED, NOT DISCOUNTED. The refuters were told to default
// to `refuted: true` under uncertainty, so survival means something. Adjudicator
// prose is a candidate; the refuter's verdict decides; and every survivor is
// re-executed by me afterwards (`g14_reexec.ts`), because this project has been
// wrong about its own fix measurements six sessions running.
//
// ⚠️ `generator_artifact` IS NOT A DEFECT AND IS NOT A PASS. It is a third state:
// the sentence is not English, so the engine's answer to it carries no
// information either way. Counting artefacts as defects inflates the campaign;
// counting them as correct hides real coverage loss. They get their own column.
// ===========================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

const src = JSON.parse(readFileSync(process.argv[2] ?? join(OUT, "g14_adjudications.json"), "utf8"));
const gen = JSON.parse(readFileSync(join(OUT, "g14_sentences.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(HERE, "batches", "g14_manifest.json"), "utf8"));

const MUTATE = process.env.MUTATE === "1";

// ---- collect ---------------------------------------------------------------
const adjudications = new Map();
const dupes = [];
for (const batch of src.adjudications ?? []) {
  for (const g of batch.groups ?? []) {
    if (adjudications.has(g.groupId)) { dupes.push(g.groupId); continue; }
    adjudications.set(g.groupId, g);
  }
}

// Every group that EXISTS, from the generation run — not from the adjudications,
// which is the direction that can silently lose one.
const hostile = gen.rows.filter((r) => !r.control);
const allGroups = new Set(hostile.map((r) => `${r.attackClass}|${r.subclass}|${r.claimKey}`));
if (MUTATE) allGroups.add("MUTATION|injected|nobody_adjudicated_this");

const missing = [...allGroups].filter((g) => !adjudications.has(g));
const extra = [...adjudications.keys()].filter((g) => !allGroups.has(g));

// ---- apply refutations -----------------------------------------------------
const refuted = new Map();
for (const r of src.refutations ?? []) {
  for (const v of r.verdicts ?? []) refuted.set(v.groupId, v);
}

let confirmedFalsePass = 0, refutedAway = 0, artefacts = 0, correct = 0, falseFail = 0;
const confirmed = [];
for (const [gid, g] of adjudications) {
  if (gid.startsWith("MUTATION|")) continue;
  const isFP = g.verdict === "false_pass" || g.verdict === "mixed";
  const ref = refuted.get(gid);
  if (isFP) {
    if (ref && ref.refuted) {
      refutedAway++;
      if (ref.reclassify_as === "generator_artifact") artefacts++;
      else if (ref.reclassify_as === "false_fail") falseFail++;
      else correct++;
    } else {
      confirmedFalsePass++;
      confirmed.push({ ...g, refuterSeen: Boolean(ref) });
    }
  } else if (g.verdict === "generator_artifact") artefacts++;
  else if (g.verdict === "false_fail") falseFail++;
  else correct++;
}

// ---- completion ------------------------------------------------------------
const problems = [];
if (missing.length) problems.push(`${missing.length} group(s) exist but were NEVER ADJUDICATED — e.g. ${missing.slice(0, 4).join(", ")}`);
if (extra.length) problems.push(`${extra.length} adjudicated group(s) do not exist in the generation run — e.g. ${extra.slice(0, 4).join(", ")}`);
if (dupes.length) problems.push(`${dupes.length} group(s) adjudicated more than once`);
if (gen.state === "incomplete") problems.push("the GENERATION run was INCOMPLETE; nothing downstream of it may be summed");

const state = problems.length ? "incomplete" : (confirmedFalsePass ? "defects_found" : "verified_clean");
const confirmedCount = state === "incomplete" ? null : confirmedFalsePass;

// ---- the key x class table -------------------------------------------------
const KEYS = gen.keys;
const CLASSES = gen.attack_classes;
const table = [];
for (const key of KEYS) {
  for (const cls of CLASSES) {
    const cell = gen.cells.find((c) => c.key === key && c.attackClass === cls);
    const gids = [...adjudications.keys()].filter((g) => { const [c, , k] = g.split("|"); return c === cls && k === key; });
    const adj = gids.map((g) => adjudications.get(g));
    const fps = adj.filter((a) => (a.verdict === "false_pass" || a.verdict === "mixed") && !(refuted.get(`${cls}|${a.groupId.split("|")[1]}|${key}`)?.refuted));
    table.push({
      key, attackClass: cls,
      completion: cell?.state ?? "unknown",
      hostileSentences: cell?.hostile ?? 0,
      enginePassed: cell?.hostilePassing ?? 0,
      groups: gids.length,
      groupsAdjudicated: adj.length,
      confirmedFalsePassGroups: state === "incomplete" ? null : fps.length,
    });
  }
}

const out = {
  generation_state: gen.state,
  groups_expected: allGroups.size,
  groups_adjudicated: adjudications.size,
  missing, extra, duplicates: dupes,
  batches_returned: (src.adjudications ?? []).length,
  batches_expected: manifest.batches,
  refutations_seen: refuted.size,
  tally: { confirmedFalsePass, refutedAway, generatorArtefacts: artefacts, correct, falseFail },
  confirmedCount,
  state,
  problems,
  confirmed,
  table,
};
writeFileSync(join(OUT, "g14_merged.json"), `${JSON.stringify(out, null, 2)}\n`);

const L = [];
L.push("G-14 STEP 1 — MERGE");
L.push(`  batches returned          : ${out.batches_returned}/${out.batches_expected}`);
L.push(`  groups expected           : ${out.groups_expected}`);
L.push(`  groups adjudicated        : ${out.groups_adjudicated}`);
L.push(`  missing                   : ${missing.length}`);
L.push(`  not in the generation run : ${extra.length}`);
L.push(`  duplicates                : ${dupes.length}`);
L.push(`  refuter verdicts seen     : ${refuted.size}`);
L.push("");
L.push(`  confirmed false-pass groups (post-refutation) : ${confirmedCount === null ? "null (INCOMPLETE)" : confirmedCount}`);
L.push(`  refuted away                                  : ${refutedAway}`);
L.push(`  generator artefacts                           : ${artefacts}`);
L.push(`  correct                                       : ${correct}`);
L.push(`  false fails                                   : ${falseFail}`);
L.push("");
if (problems.length) { L.push("PROBLEMS:"); for (const p of problems) L.push(`  ${p}`); L.push(""); }
L.push(`completion: ${state.toUpperCase()}`);
console.log(L.join("\n"));
process.exitCode = state === "incomplete" ? 2 : 0;
