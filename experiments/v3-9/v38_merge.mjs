// v3.9 follow-up — merge the v3.8 re-examination and SCORE THE GOLD.
//
// P-21's protocol in its first use. The gold cases are the whole point: a re-examiner's
// accuracy is MEASURED here, not assumed, which is precisely what was never done to the
// refuters whose 85% error rate started all this.
import fs from "node:fs";

const JOURNAL = process.argv[2];
const events = fs.readFileSync(JOURNAL, "utf8").split("\n").filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const returns = [];
(function harvest(v) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) harvest(x); return; }
  if (Array.isArray(v.verdicts) && v.verdicts.some((x) => x.vid)) returns.push(v);
  for (const x of Object.values(v)) harvest(x);
})(events);

const seen = new Set(), R = [];
for (const r of returns) {
  const k = JSON.stringify(r.verdicts.map((v) => v.vid).sort());
  if (seen.has(k)) continue; seen.add(k); R.push(r);
}

const { key } = JSON.parse(fs.readFileSync("experiments/v3-9/v38reexam/KEY.json", "utf8"));
const meta = new Map(key.map((k) => [k.vid, k]));
const verdicts = new Map();
const batchOf = new Map();
for (const b of R) for (const v of b.verdicts) {
  if (!verdicts.has(v.vid)) { verdicts.set(v.vid, v); batchOf.set(v.vid, b.batch); }
}

// ---------- GOLD SCORING ----------
const goldRows = key.filter((k) => k.kind === "gold").map((k) => {
  const v = verdicts.get(k.vid);
  return {
    vid: k.vid, batch: batchOf.get(k.vid) ?? null, subclass: k.subclass,
    expected: k.expected, got: v?.refutationWasCorrect ?? null,
    correct: v?.refutationWasCorrect === k.expected,
    confidence: v?.confidence ?? null,
  };
});
const goldCorrect = goldRows.filter((g) => g.correct).length;
const goldPerBatch = {};
for (const g of goldRows) goldPerBatch[g.batch] = g.correct;

// ---------- REAL UNITS ----------
const realRows = key.filter((k) => k.kind === "real").map((k) => {
  const v = verdicts.get(k.vid);
  return {
    vid: k.vid, batch: batchOf.get(k.vid) ?? null,
    groupId: k.groupId, attackClass: k.attackClass, claimKey: k.claimKey,
    verdict: v?.refutationWasCorrect ?? null,
    confidence: v?.confidence ?? null,
    reason: v?.reason ?? null,
    reinstated: v?.refutationWasCorrect === "no",
    // a verdict from a batch whose gold was missed is DISCOUNTED, not discarded —
    // discarding would silently shrink the denominator, which is the flattering direction
    goldPassed: goldPerBatch[batchOf.get(k.vid)] ?? null,
  };
});

const missing = realRows.filter((r) => r.verdict === null);
const reinstated = realRows.filter((r) => r.reinstated);

// ---------- AXIS TRIAGE, the user's rider (a) ----------
const axisTally = (rows) => rows.reduce((o, r) => ((o[r.attackClass] = (o[r.attackClass] || 0) + 1), o), {});

// ---------- per-re-examiner rates, the P-21 standard output ----------
const perBatch = {};
for (const r of realRows) {
  perBatch[r.batch] ??= { n: 0, reinstated: 0, gold: goldPerBatch[r.batch] ?? null };
  perBatch[r.batch].n++;
  if (r.reinstated) perBatch[r.batch].reinstated++;
}
for (const b of Object.keys(perBatch)) {
  perBatch[b].rate = +(perBatch[b].reinstated / perBatch[b].n).toFixed(3);
}

const out = {
  protocol: "P-21, first use",
  gold: {
    seeded: goldRows.length, correct: goldCorrect,
    accuracy: +(goldCorrect / goldRows.length).toFixed(3),
    rows: goldRows,
    batches_that_missed_gold: goldRows.filter((g) => !g.correct).map((g) => g.batch),
  },
  real: {
    n: realRows.length, adjudicated: realRows.length - missing.length,
    missing: missing.map((r) => r.vid),
    reinstated: reinstated.length,
    upheld: realRows.filter((r) => r.verdict === "yes").length,
    indeterminate: realRows.filter((r) => r.verdict === "indeterminate").length,
    rate: +(reinstated.length / realRows.length).toFixed(3),
  },
  per_reexaminer: perBatch,
  axis_triage: {
    all_55: axisTally(realRows),
    reinstated: axisTally(reinstated),
    // rider (a): wrong_subject reversals flow into suite 2.0 and v4.0's target set
    wrong_subject_reinstated: reinstated.filter((r) => r.attackClass === "wrong_subject").length,
    // rider (b): letter/tense reversals move capability counts only — and there are NONE
    letter_not_spirit_in_set: realRows.filter((r) => r.attackClass === "letter_not_spirit").length,
    tense_modality_in_set: realRows.filter((r) => r.attackClass === "tense_modality").length,
  },
  reinstated_detail: reinstated.map((r) => ({
    vid: r.vid, groupId: r.groupId, attackClass: r.attackClass, claimKey: r.claimKey,
    confidence: r.confidence, goldPassed: r.goldPassed,
  })),
  completion: missing.length ? "INCOMPLETE" : goldCorrect < goldRows.length ? "DEFECTS_FOUND_WITH_DISCOUNT" : "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/v38_reexam.json", JSON.stringify({ ...out, realRows }, null, 2));
console.log(JSON.stringify({ ...out, reinstated_detail: `${out.reinstated_detail.length} groups` }, null, 2));
