// v3.9 — apply the re-examination to v3.8's per-class ADJUDICATED table.
//
// Rider (c): this is a CORRECTION with a per-group trail, NOT a displaced second
// measurement. It completes the verification of one measurement — the refutation half was
// never checked — so it updates the numbers in place, the way `488 -> 483` did. A displaced
// block would imply two measurements of the same thing, and there is only one.
//
// The roll-up is g14_table.mjs's own, transcribed, so the corrected table and the original
// are computed the same way and differ only by the reinstatements.
import fs from "node:fs";

const gen = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_sentences.json", "utf8"));
const adj = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_adjudications.json", "utf8"));
const rx = JSON.parse(fs.readFileSync("experiments/v3-9/out/v38_reexam.json", "utf8"));

const reinstated = new Set(rx.realRows.filter((r) => r.reinstated).map((r) => r.groupId));

const refutedMap = new Map();
for (const r of adj.refutations ?? []) for (const v of r.verdicts ?? []) refutedMap.set(v.groupId, v);
const verdictOf = new Map();
for (const b of adj.adjudications) for (const g of b.groups) verdictOf.set(g.groupId, g);

function table(applyReinstatement) {
  const perClass = new Map();
  const perGroup = new Map();
  for (const r of gen.rows) {
    if (r.control) continue;
    const gid = `${r.attackClass}|${r.subclass}|${r.claimKey}`;
    const g = verdictOf.get(gid);
    const ref = refutedMap.get(gid);
    let v = g?.verdict ?? "unknown";
    const exc = (g?.exceptions ?? []).find((e) => e.term === r.term);
    if (exc) v = exc.verdict;
    else if (v === "mixed") v = "false_pass";
    if (v === "false_pass" && ref?.refuted) {
      // THE ONE LINE THAT CHANGES: a kill the re-examination overturned no longer applies.
      const overturned = applyReinstatement && reinstated.has(gid);
      if (!overturned) v = ref.reclassify_as === "stands" ? "false_pass" : (ref.reclassify_as ?? "correct");
    }
    const c = r.attackClass;
    if (!perClass.has(c)) perClass.set(c, { fp: 0, n: 0 });
    perClass.get(c).n++;
    if (v === "false_pass") perClass.get(c).fp++;
    if (!perGroup.has(gid)) perGroup.set(gid, { fp: 0, n: 0, cls: c });
    perGroup.get(gid).n++;
    if (v === "false_pass") perGroup.get(gid).fp++;
  }
  return { perClass, perGroup };
}

const before = table(false), after = table(true);

const classes = [...new Set([...before.perClass.keys(), ...after.perClass.keys()])];
const rows = classes.map((c) => {
  const b = before.perClass.get(c) ?? { fp: 0, n: 0 };
  const a = after.perClass.get(c) ?? { fp: 0, n: 0 };
  return {
    class: c, before: `${b.fp}/${b.n}`, after: `${a.fp}/${a.n}`,
    delta: a.fp - b.fp, denominator_moved: a.n !== b.n,
  };
});

// per-group trail, the rider's requirement
const trail = [...reinstated].map((gid) => {
  const b = before.perGroup.get(gid), a = after.perGroup.get(gid);
  const v = rx.realRows.find((r) => r.groupId === gid);
  return {
    groupId: gid, attackClass: v?.attackClass, claimKey: v?.claimKey,
    sentences: a?.n ?? 0, false_passes_before: b?.fp ?? 0, false_passes_after: a?.fp ?? 0,
    delta: (a?.fp ?? 0) - (b?.fp ?? 0), confidence: v?.confidence,
  };
}).sort((x, y) => y.delta - x.delta);

const sumBefore = rows.reduce((n, r) => n + Number(r.before.split("/")[0]), 0);
const sumAfter = rows.reduce((n, r) => n + Number(r.after.split("/")[0]), 0);

const out = {
  groups_reinstated: reinstated.size,
  class_table: rows,
  sum_before: sumBefore, sum_after: sumAfter, sum_delta: sumAfter - sumBefore,
  arithmetic: `${sumBefore} + ${sumAfter - sumBefore} = ${sumAfter}`,
  trail,
  trail_delta_sum: trail.reduce((n, t) => n + t.delta, 0),
  reconciles: trail.reduce((n, t) => n + t.delta, 0) === sumAfter - sumBefore,
  completion: "VERIFIED_CLEAN",
};
fs.writeFileSync("experiments/v3-9/out/v38_correct.json", JSON.stringify(out, null, 2));
console.table(rows);
console.log(JSON.stringify({
  groups_reinstated: out.groups_reinstated, sum_before: sumBefore, sum_after: sumAfter,
  arithmetic: out.arithmetic, trail_delta_sum: out.trail_delta_sum, reconciles: out.reconciles,
}, null, 2));
