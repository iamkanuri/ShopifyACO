// v3.9 CP-1A — THE PIVOT TABLE. frequency x consequence x honest-carrier, per axis,
// with the verdict each axis's own numbers decide.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const A = m.A_ROWS, B = m.B_ROWS;
const AXES = ["letter_not_spirit", "tense_modality", "wrong_subject"];

const CAPABILITY = { letter_not_spirit: [260, 280], tense_modality: [439, 621], wrong_subject: [368, 914] };

const forced = A;
const asked = A.filter((r) => r.asked);

function axisTable(pop, label) {
  const out = { population: label, rows: pop.length, stores: new Set(pop.map((r) => r.host)).size, axes: {} };
  for (const ax of AXES) {
    // OCCURRENCE — the axis's markers fired on the sentence
    const occ = pop.filter((r) => (r.axisMarkers?.[ax]?.hostile ?? []).length > 0);
    // CONSEQUENCE — adjudicated misleading AND attributed to this axis
    const conseq = pop.filter(
      (r) => r.misleading_final === "yes" &&
        (r.verdict?.axisAttribution ?? []).includes(ax),
    );
    // HONEST CARRIERS — a true sentence a naive guard for this axis would break
    const honest = pop.filter(
      (r) => r.honestCarrier_final === "yes" &&
        (r.verdict?.honestCarrierAxes ?? []).includes(ax),
    );
    const [cp, cn] = CAPABILITY[ax];
    out.axes[ax] = {
      capability: `${cp}/${cn} = ${((cp / cn) * 100).toFixed(1)}%`,
      occurrence_rows: occ.length,
      occurrence_stores: new Set(occ.map((r) => r.host)).size,
      occurrence_pct: ((occ.length / pop.length) * 100).toFixed(2),
      consequence_rows: conseq.length,
      consequence_stores: new Set(conseq.map((r) => r.host)).size,
      honest_carrier_rows: honest.length,
      honest_carrier_stores: new Set(honest.map((r) => r.host)).size,
      // the ratio that killed `origin`: true statements lost per false pass closed
      cost_benefit: conseq.length === 0
        ? (honest.length > 0 ? `${honest.length} true statements lost for ZERO gain` : "no gain, no cost — nothing to guard")
        : `${(honest.length / conseq.length).toFixed(2)} true statements lost per false pass closed`,
      verdict: null,
    };
  }
  return out;
}

const F = axisTable(forced, "FORCED (71)");
const K = axisTable(asked, "ASKED (34)");

// ---- verdicts, decided by the numbers rather than by preference ----
for (const ax of AXES) {
  const f = F.axes[ax];
  const c = f.consequence_rows, h = f.honest_carrier_rows, o = f.occurrence_rows;
  if (o === 0 && c === 0) {
    f.verdict = "DESCOPE-WITH-PRECEDENT";
    f.why = "the shape does not occur in the population a guard would touch, and no adjudicated defect is attributed to it. " +
      "Precedent: the `origin` tombstone (a class with zero natural instances, removed) and v3.6's declined guards for " +
      "`enquiry_evaluation` and `review_quote` on measured zero instances.";
  } else if (c === 0 && h > 0) {
    f.verdict = "DESCOPE-WITH-PRECEDENT";
    f.why = `${h} true statements would be lost for zero measured gain — the exact arithmetic that removed \`origin\` (17 lost, 0 gained).`;
  } else if (c > 0 && h / Math.max(c, 1) > 3) {
    f.verdict = "UNDERPOWERED";
    f.why = `${c} defect(s) against ${h} honest carriers is a cost/benefit ratio of ${(h / c).toFixed(1)}:1 on a sample this size; ` +
      "the confidence interval on both is wide and a guard cannot be justified on it.";
  } else if (c > 0) {
    f.verdict = "GUARD-WORTHY";
    f.why = `${c} adjudicated defect(s) over ${f.consequence_stores} store(s), against ${h} honest carrier(s).`;
  } else {
    f.verdict = "UNDERPOWERED";
    f.why = "no adjudicated defect and no honest carrier — the population is too small to decide.";
  }
  K.axes[ax].verdict = f.verdict;
}

// ---- the calibration check the brief demands ----
// the known coffee defects must fall out of this read naturally
const known = {
  organic_soil_science: A.filter((r) => r.claim === "organic" && r.misleading_final === "yes"),
  single_origin_in_blend: A.filter((r) => r.claim === "single_origin" && r.misleading_final === "yes"),
};
const calibration = {
  organic_confirmed: known.organic_soil_science.length,
  organic_hosts: known.organic_soil_science.map((r) => r.host),
  single_origin_confirmed: known.single_origin_in_blend.length,
  single_origin_hosts: known.single_origin_in_blend.map((r) => r.host),
};

// ---- CP-1B ----
const bByKey = {};
for (const r of B) {
  bByKey[r.claimKey] ??= { total: 0, false_pass: 0, correct: 0, refuted: 0, indeterminate: 0 };
  bByKey[r.claimKey].total++;
  const v = r.verdict_final;
  if (v === "false_pass") bByKey[r.claimKey].false_pass++;
  else if (v === "correct_pass") bByKey[r.claimKey].correct++;
  else if (v === "refuted_away") bByKey[r.claimKey].refuted++;
  else bByKey[r.claimKey].indeterminate++;
}

const out = {
  denominators: { forced: forced.length, forced_stores: F.stores, asked: asked.length, asked_stores: K.stores },
  FORCED: F, ASKED: K,
  totals: {
    confirmed_misleading: A.filter((r) => r.misleading_final === "yes").length,
    confirmed_honest_carriers: A.filter((r) => r.honestCarrier_final === "yes").length,
    indeterminate: A.filter((r) => r.misleading_final === "indeterminate").length,
    unattributed_misleading: A.filter(
      (r) => r.misleading_final === "yes" && !(r.verdict?.axisAttribution ?? []).some((x) => AXES.includes(x)),
    ).length,
  },
  calibration,
  cp1b: { total: B.length, byKey: bByKey, confirmed_false_pass: B.filter((r) => r.verdict_final === "false_pass").length },
  completion: "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/pivot.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
