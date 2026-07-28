// v3.9 — TEST THE COMPLETENESS CRITIC'S SURVIVING FINDINGS, MECHANICALLY.
//
// Its headline ("no verdicts exist on disk") was true when it ran and is now stale —
// merged.json exists and audits 71/71 + 178/178, 0 missing, 0 duplicates. Three of its
// findings do NOT depend on that and must be executed rather than accepted or dismissed:
//
//  (1) A029 / A036 carry `sentence: null` — an adjudicator was asked whether a proof
//      sentence misleads and handed no sentence.
//  (2) Refuter coverage is 193/249 with no recorded scoping rule.
//  (3) Refutation rates are heterogeneous across batches at chi-sq p < 0.0001, i.e. the
//      kill rate is a property of the adjudicator/refuter PAIR, not of the units.
//
// (3) is the one that can move the headline: if the 15 survivors are concentrated in the
// batches whose refuters were lenient, "15 confirmed" is partly an instrument artifact.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("experiments/v3-9/batches/manifest.json", "utf8"));
const A = m.A_ROWS, B = m.B_ROWS;

const batchOf = new Map();
manifest.A.batches.forEach((b, i) => b.ids.forEach((id) => batchOf.set(id, `A${i + 1}`)));
manifest.B.batches.forEach((b, i) => b.ids.forEach((id) => batchOf.set(id, `B${i + 1}`)));

// ---------- (1) quoteless units ----------
const quoteless = A.filter((r) => !r.sentence);
const quotelessDetail = quoteless.map((r) => ({
  unitId: r.unitId, batch: batchOf.get(r.unitId), host: r.host, claim: r.claim,
  engineDetail: r.engineDetail,
  verdict_misleading: r.verdict?.misleading ?? null,
  verdict_honestCarrier: r.verdict?.honestCarrier ?? null,
  confidence: r.verdict?.confidence ?? null,
  counted_in_confirmed: r.misleading_final === "yes",
  // a substantive verdict on a null sentence is not adjudicable evidence
  substantive_verdict_on_no_sentence:
    r.verdict != null && r.verdict.misleading !== "indeterminate",
}));

// ---------- (2) refuter coverage, and the ACTUAL scoping rule ----------
const flagged = (r, kind) => kind === "A"
  ? (r.verdict?.misleading === "yes" || r.verdict?.honestCarrier === "yes")
  : r.verdict?.verdict === "false_pass";
const coverage = [];
for (const [kind, rows] of [["A", A], ["B", B]]) {
  const byB = new Map();
  for (const r of rows) {
    const b = batchOf.get(r.unitId);
    if (!byB.has(b)) byB.set(b, []);
    byB.get(b).push(r);
  }
  for (const [b, rs] of [...byB].sort()) {
    const f = rs.filter((r) => flagged(r, kind)).length;
    const seen = rs.filter((r) => r.refuterSeen).length;
    const killed = rs.filter((r) => r.refutedAway).length;
    coverage.push({
      batch: b, n: rs.length, adjudicator_flagged: f, refuter_seen: seen,
      refuted_away: killed,
      seen_equals_flagged: seen === f,
      kill_rate: seen ? +(killed / seen).toFixed(3) : null,
    });
  }
}
const seenTotal = [...A, ...B].filter((r) => r.refuterSeen).length;
const flaggedTotal = A.filter((r) => flagged(r, "A")).length + B.filter((r) => flagged(r, "B")).length;

// ---------- (3) heterogeneity, and whether it moved the answer ----------
function chi2(rows) {
  const N = rows.reduce((a, r) => a + r.refuter_seen, 0);
  const K = rows.reduce((a, r) => a + r.refuted_away, 0);
  const p = K / N;
  let x2 = 0, df = 0;
  for (const r of rows) {
    if (!r.refuter_seen) continue;
    const e1 = r.refuter_seen * p, e0 = r.refuter_seen * (1 - p);
    if (e1 > 0) x2 += ((r.refuted_away - e1) ** 2) / e1;
    if (e0 > 0) x2 += (((r.refuter_seen - r.refuted_away) - e0) ** 2) / e0;
    df++;
  }
  return { x2: +x2.toFixed(2), df: df - 1, pooled_rate: +p.toFixed(3) };
}
const covA = coverage.filter((c) => c.batch.startsWith("A"));
const covB = coverage.filter((c) => c.batch.startsWith("B"));

// THE QUESTION THAT MATTERS: are the survivors concentrated in lenient batches?
const survivorsByBatch = {};
for (const r of A) {
  if (r.misleading_final !== "yes") continue;
  const b = batchOf.get(r.unitId);
  survivorsByBatch[b] = (survivorsByBatch[b] || 0) + 1;
}
// counterfactual: if EVERY batch's refuter had killed at the pooled rate, how many survive?
const pooledA = chi2(covA).pooled_rate;
const counterfactual = covA.map((c) => ({
  batch: c.batch,
  actual_survivors: survivorsByBatch[c.batch] ?? 0,
  flagged: c.adjudicator_flagged,
  actual_kill_rate: c.kill_rate,
  pooled_kill_rate: pooledA,
  expected_survivors_at_pooled_rate: +(c.adjudicator_flagged * (1 - pooledA)).toFixed(1),
}));

const out = {
  finding_1_quoteless: {
    count: quoteless.length,
    rows: quotelessDetail,
    substantive_verdicts_on_no_sentence: quotelessDetail.filter((q) => q.substantive_verdict_on_no_sentence).length,
    any_counted_as_confirmed: quotelessDetail.filter((q) => q.counted_in_confirmed).length,
    note: "G-15 records the same shape: '2 not adjudicable because the row renders no quote'.",
  },
  finding_2_refuter_coverage: {
    refuter_seen_total: seenTotal, of: A.length + B.length,
    adjudicator_flagged_total: flaggedTotal,
    scoping_rule_holds_everywhere: coverage.every((c) => c.seen_equals_flagged),
    per_batch: coverage,
  },
  finding_3_heterogeneity: {
    A: chi2(covA), B: chi2(covB),
    survivors_by_batch: survivorsByBatch,
    counterfactual_at_pooled_rate: counterfactual,
    total_actual_survivors: Object.values(survivorsByBatch).reduce((a, b) => a + b, 0),
    total_expected_at_pooled: +counterfactual.reduce((a, c) => a + c.expected_survivors_at_pooled_rate, 0).toFixed(1),
  },
};
fs.writeFileSync("experiments/v3-9/out/critic_check.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
