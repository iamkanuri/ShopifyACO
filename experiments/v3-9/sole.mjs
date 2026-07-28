// v3.9 CP-1A — SOLE-AXIS ATTRIBUTION, and the occurrence-vs-consequence gap.
//
// Two questions the headline table cannot answer, and both change the verdict:
//   1. Does an axis own any defect ALONE? A co-attribution on someone else's defect is
//      not evidence that a guard for THIS axis would close anything — the other axis's
//      guard would already have closed it. G-15 makes exactly this distinction with its
//      "REF the SOLE hostile dimension — 14/17" row.
//   2. How far does OCCURRENCE undercount CONSEQUENCE? v3.6 labelled every occurrence a
//      floor with unmeasured recall. This measures the gap.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const AXES = ["letter_not_spirit", "tense_modality", "wrong_subject"];
const A = m.A_ROWS;
const defects = A.filter((r) => r.misleading_final === "yes");
const carriers = A.filter((r) => r.honestCarrier_final === "yes");

const out = { axes: {}, defect_attribution_shape: {}, occurrence_gap: {} };

for (const ax of AXES) {
  const attributed = defects.filter((d) => (d.verdict?.axisAttribution ?? []).includes(ax));
  const sole = attributed.filter((d) => {
    const a = (d.verdict?.axisAttribution ?? []).filter((x) => AXES.includes(x));
    return a.length === 1 && a[0] === ax;
  });
  const occ = A.filter((r) => (r.axisMarkers?.[ax]?.hostile ?? []).length > 0);
  const occAndDefect = occ.filter((r) => r.misleading_final === "yes");
  const carriersFor = carriers.filter((c) => (c.verdict?.honestCarrierAxes ?? []).includes(ax));
  const soleCarrier = carriersFor.filter((c) => {
    const a = (c.verdict?.honestCarrierAxes ?? []).filter((x) => AXES.includes(x));
    return a.length === 1 && a[0] === ax;
  });

  out.axes[ax] = {
    occurrence: occ.length,
    consequence_any_attribution: attributed.length,
    consequence_SOLE: sole.length,
    sole_hosts: sole.map((d) => `${d.host} [${d.claim}] ${d.verdict?.misleadingClass ?? ""}`),
    honest_carriers_any: carriersFor.length,
    honest_carriers_SOLE: soleCarrier.length,
    // the decision ratio, computed on SOLE attribution in both directions
    sole_cost_benefit: sole.length === 0
      ? (soleCarrier.length > 0
          ? `${soleCarrier.length} true rows lost, ZERO defects this axis alone would close`
          : "nothing gained, nothing lost")
      : `${(carriersFor.length / sole.length).toFixed(2)} true rows lost per defect only this axis closes`,
    detector_caught_of_its_own_defects: `${occAndDefect.length}/${attributed.length}`,
  };
}

// how the 15 defects distribute over axis-count
const shape = {};
for (const d of defects) {
  const a = (d.verdict?.axisAttribution ?? []).filter((x) => AXES.includes(x));
  const k = a.length === 0 ? "unattributed" : a.length === 1 ? `sole:${a[0]}` : `multi:${a.slice().sort().join("+")}`;
  shape[k] = (shape[k] || 0) + 1;
}
out.defect_attribution_shape = shape;

// occurrence vs consequence, overall
const detectorFired = defects.filter((d) => AXES.some((ax) => (d.axisMarkers?.[ax]?.hostile ?? []).length > 0));
out.occurrence_gap = {
  confirmed_defects: defects.length,
  of_which_a_v36_hostile_detector_fired_on: detectorFired.length,
  invisible_to_every_detector: defects.length - detectorFired.length,
  note:
    "v3.6 labelled every occurrence a FLOOR with unmeasured recall. This is the size of " +
    "that gap on the population that matters. A descope argued from occurrence alone would " +
    "be arguing from the smaller number.",
};

fs.writeFileSync("experiments/v3-9/out/sole.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
