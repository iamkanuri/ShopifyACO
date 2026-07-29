// ===========================================================================
// v4.0 CP-1a — RE-DERIVE the FROZEN adjudicated table under a narrowed dictionary.
//
// THE OBJECTION THIS ANSWERS. The Phase-A adjudication's strongest dissent — raised by
// one refuter and tested by nobody — was that removing a supporting term is BLOCKED,
// because `g14.table.test.ts` requires the frozen `ADJUDICATED_V38` denominator to equal
// the live raw denominator per class, and the adjudicated numerator is a human-read count
// over 779 groups whose ids are `class|subclass|key` and therefore "not derivable per
// term". Its conclusion: the only exits are to destroy the record, re-run the campaign,
// or not remove the term.
//
// THAT PREMISE IS FALSIFIABLE, AND IT IS FALSE. `g14_table.mjs`'s own roll-up is
// SENTENCE-level, and `g14_sentences.json` records `term` on every row — the group verdict
// is applied per sentence, with per-term `exceptions` overriding it, which is precisely
// why the schema demanded exceptions. So dropping the sentences generated from a removed
// term is an exact operation on the recorded trail. **No human verdict is edited, and no
// group changes its verdict.** The corpus loses sentences; the adjudication still
// describes every sentence that remains.
//
// ⚠️ TWO ANCHORS, BOTH REQUIRED BEFORE THE ANSWER IS USED. A re-implementation of someone
// else's roll-up is a second engine that drifts — the mistake this repo already records.
// So this script does not trust itself:
//   ANCHOR 1  the roll-up over the UNMODIFIED trail must reproduce v3.8's recorded
//             per-class table EXACTLY (letter_not_spirit 260/280, wrong_subject 368/914,
//             …, sum 1137).
//   ANCHOR 2  applying v3.9's 42 overturns must reproduce v3.9's recorded corrected table
//             EXACTLY (wrong_subject 441/914, denial 134/461, violation 8/104, sum 1282).
// Only if BOTH reproduce is the term filter applied. Either failing resolves INCOMPLETE
// and prints nothing usable — a filtered number from an unfaithful roll-up is worse than
// no number, because it looks like a measurement.
//
// Usage:  node experiments/v4-0/rederive_adjudicated.mjs "plant-based" "plant based"
// ===========================================================================
import fs from "node:fs";

const DROP = new Set(process.argv.slice(2));
if (!DROP.size) { console.error("usage: rederive_adjudicated.mjs <term> [term…]"); process.exit(2); }

const gen = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_sentences.json", "utf8"));
const adj = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_adjudications.json", "utf8"));
const cor = JSON.parse(fs.readFileSync("experiments/v3-9/out/v38_correct.json", "utf8"));

// ---- v3.8's roll-up, transcribed from experiments/v3-8/g14_table.mjs ------------------
const refuted = new Map();
for (const r of adj.refutations ?? []) for (const v of r.verdicts ?? []) refuted.set(v.groupId, v);
const verdictOf = new Map();
for (const b of adj.adjudications) for (const g of b.groups) verdictOf.set(g.groupId, g);

/** @param {(r:any)=>boolean} keep  @param {Set<string>|null} reinstate group ids v3.9 overturned */
function rollup(keep, reinstate) {
  const perClass = new Map();
  for (const r of gen.rows) {
    if (r.control) continue;
    if (!keep(r)) continue;
    const gid = `${r.attackClass}|${r.subclass}|${r.claimKey}`;
    const g = verdictOf.get(gid);
    const ref = refuted.get(gid);
    let v = g?.verdict ?? "unknown";
    const exc = (g?.exceptions ?? []).find((e) => e.term === r.term);
    if (exc) v = exc.verdict;
    else if (v === "mixed") v = "false_pass";
    // v3.9 CP-6: the blind re-examination OVERTURNED the REFUTATION for these groups —
    // and that is ALL it overturned. So reinstatement is expressed as *skipping the
    // refuter's downgrade*, not as forcing `false_pass`.
    //
    // ⚠️ TWO WRONG FORMULATIONS WERE TRIED FIRST AND ANCHOR 2 KILLED BOTH, which is the
    // whole reason it exists. Blanket-forcing every sentence in a reinstated group gave
    // 1,310 against the recorded 1,282 — the +28 is exactly the sentences the ORIGINAL
    // adjudicator had carved out by term, which were never in dispute. Forcing only the
    // non-excepted sentences then gave 1,281: one short, because
    // `violation|x_free_compound|gluten_free` carries an exception whose OWN verdict is
    // `false_pass`, and the refuter had downgraded it. Only "skip the downgrade" reproduces
    // the record. A roll-up that had been believed at either intermediate number would have
    // shipped a corrupted frozen table.
    const refuterOverturned = reinstate?.has(gid) === true;
    if (v === "false_pass" && ref?.refuted && !refuterOverturned) {
      v = ref.reclassify_as === "stands" ? "false_pass" : (ref.reclassify_as ?? "correct");
    }
    if (!perClass.has(r.attackClass)) perClass.set(r.attackClass, { fp: 0, n: 0 });
    const c = perClass.get(r.attackClass);
    c.n++;
    if (v === "false_pass") c.fp++;
  }
  return perClass;
}

const fmt = (m) => Object.fromEntries([...m].map(([k, v]) => [k, [v.fp, v.n]]));
const sum = (m) => [...m.values()].reduce((n, c) => n + c.fp, 0);

// ---- ANCHOR 1 — reproduce v3.8's recorded table ---------------------------------------
const a1 = rollup(() => true, null);
const problems = [];
const recordedBefore = Object.fromEntries(cor.class_table.map((r) => [r.class, r.before]));
for (const [cls, [fp, n]] of Object.entries(fmt(a1))) {
  const want = recordedBefore[cls];
  const got = `${fp}/${n}`;
  if (want && want !== got) problems.push(`ANCHOR1 ${cls}: recorded ${want}, roll-up ${got}`);
}
if (sum(a1) !== cor.sum_before) problems.push(`ANCHOR1 sum: recorded ${cor.sum_before}, roll-up ${sum(a1)}`);

// ---- ANCHOR 2 — apply v3.9's overturns and reproduce the corrected table ---------------
const reinstate = new Set(cor.trail.map((t) => t.groupId));
const a2 = rollup(() => true, reinstate);
const recordedAfter = Object.fromEntries(cor.class_table.map((r) => [r.class, r.after]));
for (const [cls, [fp, n]] of Object.entries(fmt(a2))) {
  const want = recordedAfter[cls];
  const got = `${fp}/${n}`;
  if (want && want !== got) problems.push(`ANCHOR2 ${cls}: recorded ${want}, roll-up ${got}`);
}
if (sum(a2) !== cor.sum_after) problems.push(`ANCHOR2 sum: recorded ${cor.sum_after}, roll-up ${sum(a2)}`);

if (problems.length) {
  console.error("INCOMPLETE — the roll-up does not reproduce the recorded tables, so its filtered\n" +
    "answer would be a second engine's opinion rather than this one's record:\n  " + problems.join("\n  "));
  console.error("\nanchor1:", JSON.stringify(fmt(a1)), "sum", sum(a1));
  console.error("anchor2:", JSON.stringify(fmt(a2)), "sum", sum(a2));
  process.exit(2);
}

// ---- the answer ------------------------------------------------------------------------
const after = rollup((r) => !DROP.has(r.term), reinstate);
const out = {
  dropped_terms: [...DROP],
  anchor1_reproduces_v38: true,
  anchor2_reproduces_v39_correction: true,
  before: fmt(a2),
  after: fmt(after),
  delta: Object.fromEntries(
    [...a2].map(([cls, b]) => {
      const a = after.get(cls) ?? { fp: 0, n: 0 };
      return [cls, { fp: a.fp - b.fp, n: a.n - b.n }];
    }),
  ),
  sum_before: sum(a2),
  sum_after: sum(after),
  sum_delta: sum(after) - sum(a2),
  // Every dropped sentence, by class, so the delta is auditable rather than asserted.
  dropped_sentences_by_class: (() => {
    const m = {};
    for (const r of gen.rows) {
      if (r.control || !DROP.has(r.term)) continue;
      m[r.attackClass] = (m[r.attackClass] ?? 0) + 1;
    }
    return m;
  })(),
  completion: "VERIFIED_CLEAN",
};

// arithmetic check: the denominator delta must equal the dropped-sentence count, per class
for (const [cls, d] of Object.entries(out.delta)) {
  const dropped = out.dropped_sentences_by_class[cls] ?? 0;
  if (-d.n !== dropped) {
    console.error(`ARITHMETIC FAILURE ${cls}: denominator moved ${d.n} but ${dropped} sentences were dropped`);
    out.completion = "INCOMPLETE";
  }
}

fs.writeFileSync("experiments/v4-0/out/rederive_adjudicated.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log("\n--- ADJUDICATED_V38 literal, for standards/__tests__/g14.table.test.ts ---");
for (const [cls, [fp, n]] of Object.entries(out.after)) console.log(`  ${cls}: [${fp}, ${n}],`);
console.log(`  // sum of numerators: ${out.sum_after}`);
if (out.completion !== "VERIFIED_CLEAN") process.exit(2);
