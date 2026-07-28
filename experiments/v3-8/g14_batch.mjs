// ===========================================================================
// G-14 STEP 1 — batching for adjudication.
//
//   node experiments/v3-8/g14_batch.mjs [nBatches]
//
// GROUPING. A row is grouped by (attackClass, subclass, claimKey). Within a
// group the sentences differ only by TERM, so an adjudicator sees the whole
// family at once and can give one verdict with named per-term exceptions —
// which is both cheaper and more accurate than judging 3,500 sentences blind.
//
// ⚠️ THE GROUP IS NOT THE UNIT OF TRUTH. Term-sensitivity is real: "Our carton
// is BPA-free." is nonsense for `organic` and arguably a genuine statement for
// `bpa_free` on a bottled product. So the schema REQUIRES a per-term exception
// list and the merge refuses a group whose sentence count and verdict count
// disagree.
//
// ⚠️ ASSIGNMENT IS EXACTLY-ONCE, asserted in both directions. Every row lands in
// exactly one batch, and the batch sizes must sum to the row count. v3.7's
// merge caught a missing row by this property; it is cheap and it has paid.
//
// Batches are split by CLASS-major round-robin so no single adjudicator owns a
// whole attack class — v3.7 batched by kind and recorded the cost (errors inside
// a batch are correlated by construction). Spreading each class across batches
// bounds that.
// ===========================================================================

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const BATCHES = join(HERE, "batches");
mkdirSync(BATCHES, { recursive: true });

const N = Number(process.argv[2] ?? 10);

const data = JSON.parse(readFileSync(join(OUT, "g14_sentences.json"), "utf8"));
if (data.state === "incomplete") {
  console.error("REFUSING TO BATCH: the generation run is INCOMPLETE. Batching it would launder an incomplete measurement into a table of verdicts.");
  process.exit(2);
}

const hostile = data.rows.filter((r) => !r.control);
const controls = data.rows.filter((r) => r.control);

// ---- group ----------------------------------------------------------------
const groups = new Map();
for (const r of hostile) {
  const k = `${r.attackClass}|${r.subclass}|${r.claimKey}`;
  if (!groups.has(k)) {
    groups.set(k, {
      groupId: k,
      attackClass: r.attackClass,
      subclass: r.subclass,
      claimKey: r.claimKey,
      intent: r.intent,
      surface: r.surface,
      termRole: r.termRole,
      sentences: [],
    });
  }
  groups.get(k).sentences.push({
    id: r.id,
    term: r.term,
    termRole: r.termRole,
    text: r.text,
    engine_outcome: r.engineOutcome,
    engine_detail: r.engineDetail,
    engine_quote: r.engineQuote,
    engine_surface: r.engineSurface,
  });
}

const all = [...groups.values()].sort((a, b) => (a.groupId < b.groupId ? -1 : 1));

// ---- split, class-major round-robin ---------------------------------------
const batches = Array.from({ length: N }, (_, i) => ({ batch: i + 1, groups: [] }));
const byClass = new Map();
for (const g of all) {
  if (!byClass.has(g.attackClass)) byClass.set(g.attackClass, []);
  byClass.get(g.attackClass).push(g);
}
let cursor = 0;
for (const [, gs] of byClass) {
  for (const g of gs) { batches[cursor % N].groups.push(g); cursor++; }
}

// ---- assert exactly-once, both directions ---------------------------------
const assigned = batches.flatMap((b) => b.groups.map((g) => g.groupId));
const uniq = new Set(assigned);
const problems = [];
if (assigned.length !== uniq.size) problems.push(`a group was assigned more than once (${assigned.length} assignments, ${uniq.size} distinct)`);
if (uniq.size !== all.length) problems.push(`${all.length} groups exist but ${uniq.size} were assigned`);
const sentencesAssigned = batches.reduce((n, b) => n + b.groups.reduce((m, g) => m + g.sentences.length, 0), 0);
if (sentencesAssigned !== hostile.length) problems.push(`${hostile.length} hostile sentences exist but ${sentencesAssigned} were placed in batches`);
if (problems.length) {
  console.error(`REFUSING TO WRITE BATCHES:\n  ${problems.join("\n  ")}`);
  process.exit(2);
}

for (const b of batches) {
  writeFileSync(join(BATCHES, `g14_b${b.batch}.json`), `${JSON.stringify(b, null, 2)}\n`);
}
writeFileSync(join(BATCHES, "g14_manifest.json"), `${JSON.stringify({
  generated_from: "out/g14_sentences.json",
  generation_state: data.state,
  hostile_sentences: hostile.length,
  controls: controls.length,
  groups: all.length,
  batches: N,
  per_batch: batches.map((b) => ({ batch: b.batch, groups: b.groups.length, sentences: b.groups.reduce((m, g) => m + g.sentences.length, 0) })),
  classes: [...byClass.keys()].map((c) => ({ attackClass: c, groups: byClass.get(c).length })),
}, null, 2)}\n`);

console.log(`groups            : ${all.length}`);
console.log(`hostile sentences : ${hostile.length}`);
console.log(`controls          : ${controls.length}`);
console.log(`batches           : ${N}`);
for (const b of batches) {
  console.log(`  b${String(b.batch).padStart(2)}  groups ${String(b.groups.length).padStart(3)}  sentences ${String(b.groups.reduce((m, g) => m + g.sentences.length, 0)).padStart(4)}`);
}
console.log("\nby class:");
for (const [c, gs] of byClass) console.log(`  ${c.padEnd(28)} ${String(gs.length).padStart(3)} groups`);
console.log("\nexactly-once: VERIFIED (both directions)");
