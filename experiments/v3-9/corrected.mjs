// v3.9 — THE CORRECTED COUNTS, after the blinded re-examination.
//
// The refutation step was instructed to "default to refuted=true when uncertain". Blinded
// re-examination of every kill says that instruction was catastrophic ON DEFECT CLAIMS:
// 41 of 48 kills (85.4%) were wrong. And the split is the finding — control refuters
// (kill rate 0.20-0.29) were wrong 90.9% of the time, suspect refuters (0.85-0.92) 80.8%.
// The error rate is uniform and high; only the VOLUME of kills varied. So this is not
// "the harsh refuters over-killed", it is "the refutation step as instructed was wrong",
// and the heterogeneity was a symptom that led to the diagnosis rather than the disease.
//
// On HONEST-CARRIER-only flags the same refuters were fine (13% reinstated), which is
// what rules out "the re-examiner is simply more permissive than everyone".
import fs from "node:fs";

const RX = JSON.parse(fs.readFileSync("experiments/v3-9/out/reexam_merge.json", "utf8"));
const M = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const AXES = ["letter_not_spirit", "tense_modality", "wrong_subject"];

const reexamOf = new Map(RX.rows.map((r) => [r.unitId, r]));

// A row's CORRECTED state: a kill that the re-examination overturned is reinstated.
// A kill it upheld stays dead. A kill it could not reach stays dead and is COUNTED as
// unresolved — never silently folded into either side.
function corrected(row, kind) {
  const rx = reexamOf.get(row.unitId);
  const wasKilled = row.refutedAway;
  if (!wasKilled) return { state: "unrefuted", unresolved: false };
  if (!rx || rx.reexam === null) return { state: "killed", unresolved: true };
  if (rx.reexam === "no") return { state: "reinstated", unresolved: false };
  if (rx.reexam === "indeterminate") return { state: "killed", unresolved: true };
  return { state: "killed", unresolved: false };
}

const A = M.A_ROWS.map((r) => {
  const c = corrected(r, "A");
  const alive = c.state !== "killed";
  return {
    ...r, corrected: c.state, unresolved: c.unresolved,
    misleading_corrected: alive ? r.verdict?.misleading ?? null : "no",
    honestCarrier_corrected: alive ? r.verdict?.honestCarrier ?? null : "no",
  };
});
const B = M.B_ROWS.map((r) => {
  const c = corrected(r, "B");
  const alive = c.state !== "killed";
  return { ...r, corrected: c.state, unresolved: c.unresolved,
    verdict_corrected: alive ? r.verdict?.verdict ?? null : "refuted_away" };
});

const aDef = A.filter((r) => r.misleading_corrected === "yes");
const aCar = A.filter((r) => r.honestCarrier_corrected === "yes");
const bFP = B.filter((r) => r.verdict_corrected === "false_pass");

function axisTable(pop, carriers) {
  const t = {};
  for (const ax of AXES) {
    const attributed = pop.filter((d) => (d.verdict?.axisAttribution ?? []).includes(ax));
    const sole = attributed.filter((d) => {
      const a = (d.verdict?.axisAttribution ?? []).filter((x) => AXES.includes(x));
      return a.length === 1 && a[0] === ax;
    });
    const carr = carriers.filter((c) => (c.verdict?.honestCarrierAxes ?? []).includes(ax));
    t[ax] = {
      defects_any: attributed.length,
      defects_SOLE: sole.length,
      sole_stores: new Set(sole.map((d) => d.host)).size,
      honest_carriers: carr.length,
      cost_per_sole: sole.length ? +(carr.length / sole.length).toFixed(2) : null,
      verdict: sole.length === 0 ? "DESCOPE" : "GUARD-WORTHY",
    };
  }
  return t;
}

const before = {
  cp1a_defects: M.A_ROWS.filter((r) => r.misleading_final === "yes").length,
  cp1a_carriers: M.A_ROWS.filter((r) => r.honestCarrier_final === "yes").length,
  cp1b_false_pass: M.B_ROWS.filter((r) => r.verdict_final === "false_pass").length,
};
const after = { cp1a_defects: aDef.length, cp1a_carriers: aCar.length, cp1b_false_pass: bFP.length };

const out = {
  refutation_error_rate: RX.by_claim_kind.defect_claims,
  counts: {
    before, after,
    delta: {
      cp1a_defects: after.cp1a_defects - before.cp1a_defects,
      cp1a_carriers: after.cp1a_carriers - before.cp1a_carriers,
      cp1b_false_pass: after.cp1b_false_pass - before.cp1b_false_pass,
    },
  },
  unresolved: {
    cp1a: A.filter((r) => r.unresolved).length,
    cp1b: B.filter((r) => r.unresolved).length,
    ids: [...A, ...B].filter((r) => r.unresolved).map((r) => r.unitId),
    note: "kills the re-examination could not reach or answered `indeterminate`. They stay " +
      "DEAD in the corrected count, so every figure here is a FLOOR, and they are counted " +
      "rather than folded in.",
  },
  axes_before: axisTable(
    M.A_ROWS.filter((r) => r.misleading_final === "yes"),
    M.A_ROWS.filter((r) => r.honestCarrier_final === "yes"),
  ),
  axes_after: axisTable(aDef, aCar),
  cp1b_by_key_after: bFP.reduce((o, r) => ((o[r.claimKey] = (o[r.claimKey] || 0) + 1), o), {}),
  completion: RX.missing_verdicts ? "INCOMPLETE" : "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/corrected.json", JSON.stringify({ ...out, A, B }, null, 2));
console.log(JSON.stringify(out, null, 2));
