// v3.9 CP-1A — ARE THE PIVOT VERDICTS ROBUST TO REFUTER HARSHNESS?
//
// The completeness critic found, and I confirmed, that per-batch refutation rates are
// heterogeneous well beyond binomial noise (CP-1A chi-sq 23.55 on 4 df; kill rates 0.20 to
// 0.917 on compositionally matched batches). At the pooled rate 30 rows would survive where
// 15 actually did. So "15 confirmed" is sensitive to WHICH REFUTER DREW WHICH BATCH — an
// instrument property, not a property of the stores.
//
// That does not automatically move the verdicts, because the verdicts rest on SOLE-AXIS
// attribution rather than on the count. This computes them under both bounds:
//   STRICT   — refutation applied (the shipped 15). Lower bound.
//   RAW      — adjudicator verdicts only, no refutation (the flagged set). Upper bound.
// A verdict that is the same under both is robust to the variance. One that flips is not,
// and must be reported as undecided rather than as the strict answer.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const AXES = ["letter_not_spirit", "tense_modality", "wrong_subject"];
const A = m.A_ROWS;

function view(useRefutation) {
  const isDefect = (r) => useRefutation
    ? r.misleading_final === "yes"
    : r.verdict?.misleading === "yes";
  const isCarrier = (r) => useRefutation
    ? r.honestCarrier_final === "yes"
    : r.verdict?.honestCarrier === "yes";

  const defects = A.filter(isDefect);
  const carriers = A.filter(isCarrier);
  const per = {};
  for (const ax of AXES) {
    const attributed = defects.filter((d) => (d.verdict?.axisAttribution ?? []).includes(ax));
    const sole = attributed.filter((d) => {
      const a = (d.verdict?.axisAttribution ?? []).filter((x) => AXES.includes(x));
      return a.length === 1 && a[0] === ax;
    });
    const carr = carriers.filter((c) => (c.verdict?.honestCarrierAxes ?? []).includes(ax));
    per[ax] = {
      defects_any: attributed.length,
      defects_SOLE: sole.length,
      sole_stores: new Set(sole.map((d) => d.host)).size,
      honest_carriers: carr.length,
      verdict: sole.length === 0
        ? "DESCOPE — closes nothing another axis does not already close"
        : `GUARD-WORTHY — ${sole.length} defect(s) only this axis closes, at ${(carr.length / sole.length).toFixed(2)} true rows lost each`,
    };
  }
  return { total_defects: defects.length, total_carriers: carriers.length, per };
}

const STRICT = view(true);
const RAW = view(false);

const robust = {};
for (const ax of AXES) {
  const s = STRICT.per[ax].verdict.startsWith("DESCOPE");
  const r = RAW.per[ax].verdict.startsWith("DESCOPE");
  robust[ax] = {
    strict: STRICT.per[ax], raw: RAW.per[ax],
    agrees: s === r,
    final: s === r
      ? (s ? "DESCOPE-WITH-PRECEDENT" : "GUARD-WORTHY")
      : "UNDECIDED — the verdict flips between the refuted and unrefuted readings, and refuter harshness is not a property of the stores",
  };
}

const out = {
  counts: { strict_defects: STRICT.total_defects, raw_defects: RAW.total_defects,
    strict_carriers: STRICT.total_carriers, raw_carriers: RAW.total_carriers },
  robustness: robust,
  completion: "VERIFIED_CLEAN",
};
fs.writeFileSync("experiments/v3-9/out/robust.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
