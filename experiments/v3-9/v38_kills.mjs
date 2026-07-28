// v3.9 follow-up — extract v3.8's 55 refutedAway groups, and build the re-examination set
// under the NEW P-21 PROTOCOL (its first use):
//   • blind GOLD cases seeded into every batch, so each re-examiner's accuracy is MEASURED
//     rather than assumed;
//   • per-re-examiner rates emitted as standard output;
//   • axis triage FIRST, because what v4.0's target set becomes depends on which axis a
//     reversal lands in.
import fs from "node:fs";

const adj = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_adjudications.json", "utf8"));
const gen = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_sentences.json", "utf8"));

// every refutation v3.8 recorded
const refutations = [];
for (const r of adj.refutations ?? []) for (const v of r.verdicts ?? []) refutations.push(v);
const killed = refutations.filter((v) => v.refuted);

// the adjudicator verdict each kill overturned
const verdictOf = new Map();
for (const b of adj.adjudications) for (const g of b.groups) verdictOf.set(g.groupId, g);

// example sentences per group, from the executed corpus
const byGroup = new Map();
for (const row of gen.rows) {
  if (row.control) continue;
  const gid = `${row.attackClass}|${row.subclass}|${row.claimKey}`;
  if (!byGroup.has(gid)) byGroup.set(gid, []);
  byGroup.get(gid).push(row);
}

const units = [];
for (const k of killed) {
  const gid = k.groupId;
  const orig = verdictOf.get(gid);
  const rows = byGroup.get(gid) ?? [];
  const passing = rows.filter((r) => r.engineStatus === "pass_evidenced");
  const [attackClass, subclass, claimKey] = gid.split("|");
  units.push({
    groupId: gid, attackClass, subclass, claimKey,
    original_verdict: orig?.verdict ?? null,
    original_reason: orig?.reason ?? null,
    original_confidence: orig?.confidence ?? null,
    sentences_in_group: rows.length,
    engine_passed: passing.length,
    examples: passing.slice(0, 4).map((r) => ({ term: r.term, termRole: r.termRole, text: r.text, intent: r.intent })),
  });
}

// ---- axis triage, the user's rider (a) ----
const AXIS_OF = {
  wrong_subject: "wrong_subject",
  letter_not_spirit: "letter_not_spirit",
  tense_modality: "tense_modality",
};
const triage = {};
for (const u of units) {
  const a = AXIS_OF[u.attackClass] ?? `other:${u.attackClass}`;
  triage[a] = (triage[a] || 0) + 1;
}

fs.mkdirSync("experiments/v3-9/v38reexam", { recursive: true });
fs.writeFileSync("experiments/v3-9/v38reexam/units.json", JSON.stringify({ units }, null, 2));
console.log(JSON.stringify({
  refutations_recorded: refutations.length,
  killed: killed.length,
  units_built: units.length,
  axis_triage: triage,
  groups_with_no_passing_sentence: units.filter((u) => u.engine_passed === 0).length,
  original_verdicts: units.reduce((o, u) => ((o[u.original_verdict ?? "none"] = (o[u.original_verdict ?? "none"] || 0) + 1), o), {}),
}, null, 2));
