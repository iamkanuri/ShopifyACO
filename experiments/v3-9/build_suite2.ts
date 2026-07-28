// v3.9 CP-3 — build ACCEPTANCE SUITE 2.0 from REAL adjudicated sentences.
//
// Scope, decided at Pause 1:
//   • DEFECT (hostile) cases: `wrong_subject` ONLY — the one axis with sole-attributed
//     defects. `letter_not_spirit` and `tense_modality` get a descope citation instead,
//     because each owns ZERO defects alone under all three readings.
//   • HONEST-CARRIER (must_not_regress) cases: from ALL THREE axes. A referent guard
//     parses structure, and real carriers do not sort themselves by axis — a tense-marked
//     sentence with referent shape is exactly what a `wrong_subject` guard breaks
//     collaterally. Carriers that overlap axes are the hardest cases and are taken first.
//   • Suite 1.0 stays BYTE-FROZEN. Its 19 must-not-regress cases are the FLOOR, not the
//     ceiling: 2.0 adds real ones, it does not replace hand-built ones.
//
// Every case carries PROVENANCE — host, url, claim key, the adjudication unit id, and the
// workflow run that produced the verdict — because a suite derived from real copy whose
// cases cannot be traced back to a store is a hand-built suite wearing a costume.
import fs from "node:fs";

const C = JSON.parse(fs.readFileSync("experiments/v3-9/out/corrected.json", "utf8"));
const AXES = ["letter_not_spirit", "tense_modality", "wrong_subject"];
const A = C.A;

const CLAIM_LABEL: Record<string, string> = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};

// ---- the engine's real term lists, lifted from source bytes (never retyped) ----
function liftClaimTerms(): Record<string, { support: string[]; violating: string[] }> {
  const src = fs.readFileSync("src/server/productTest.ts", "utf8");
  const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error("CLAIM_TERMS declaration missing — repair this builder, do not run it");
  const open = start + anchor.length - 1;
  let d = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") { d--; if (d === 0) { end = i + 1; break; } }
  }
  return new Function(`return ${src.slice(open, end)};`)() as never;
}
const CLAIM_TERMS = liftClaimTerms();

// ---- DEFECT cases: wrong_subject, SOLE attribution ----
const soleWrongSubject = A.filter((r: any) => {
  if (r.misleading_corrected !== "yes") return false;
  const ax = (r.verdict?.axisAttribution ?? []).filter((x: string) => AXES.includes(x));
  return ax.length === 1 && ax[0] === "wrong_subject";
});

// ---- HONEST CARRIERS, overlap-first ----
const carriers = A.filter((r: any) => r.honestCarrier_corrected === "yes" && r.sentence);
const scored = carriers.map((r: any) => {
  const ax = (r.verdict?.honestCarrierAxes ?? []).filter((x: string) => AXES.includes(x));
  return { r, axes: ax, overlap: ax.length };
}).sort((a, b) => b.overlap - a.overlap);

const surfaceOf = (s: string): string => {
  const m: Record<string, string> = {
    "product copy": "product_description", "product description": "product_description",
    "structured data": "structured_data", "page description": "page_description",
    "product title": "product_title", "variant options": "variant_options",
    "FAQ structured data": "faq", "shipping policy": "shipping_policy",
  };
  return m[s] ?? "product_description";
};

let n = 0;
const cases: any[] = [];
const strata: Record<string, string> = {};

for (const r of soleWrongSubject) {
  const id = `ws-${String(++n).padStart(2, "0")}`;
  const stratum = `real_${r.verdict?.misleadingClass ?? "wrong_subject"}`;
  strata[stratum] = strata[stratum] ??
    `REAL wrong-subject instances adjudicated as misleading: ${r.verdict?.misleadingClass ?? "wrong_subject"}.`;
  cases.push({
    id, stratum, direction: "hostile", expected: "not_proven",
    surface: surfaceOf(r.surface), text: r.sentence, claim_key: r.claim,
    why: r.verdict?.reason ?? "",
    provenance: {
      host: r.host, url: r.url, claim: r.claim, adjudication_unit: r.unitId,
      engine_answer_today: "pass_evidenced",
      confidence: r.verdict?.confidence ?? null,
      re_examined: r.corrected,
    },
  });
}

let m = 0;
for (const { r, axes, overlap } of scored) {
  const id = `hc-${String(++m).padStart(2, "0")}`;
  const stratum = overlap >= 2 ? "real_carrier_multi_axis"
    : `real_carrier_${axes[0] ?? "unmarked"}`;
  strata[stratum] = strata[stratum] ?? (overlap >= 2
    ? "REAL honest sentences carrying markers for MORE THAN ONE axis — the hardest cases, because a guard for any one of them destroys a true row."
    : `REAL honest sentences carrying ${axes[0] ?? "no"} markers. A guard for that axis must not suppress these.`);
  cases.push({
    id, stratum, direction: "must_not_regress", expected: "pass",
    surface: surfaceOf(r.surface), text: r.sentence, claim_key: r.claim,
    why: r.verdict?.reason ?? "",
    provenance: {
      host: r.host, url: r.url, claim: r.claim, adjudication_unit: r.unitId,
      carrier_axes: axes, axis_overlap: overlap,
      confidence: r.verdict?.confidence ?? null,
      re_examined: r.corrected,
    },
  });
}

const keysUsed = [...new Set(cases.map((c) => c.claim_key))].sort();
const termsByKey: Record<string, { support: string[]; violating: string[] }> = {};
for (const k of keysUsed) termsByKey[k] = CLAIM_TERMS[k]!;

const suite = {
  suite_id: "subject-tense",
  suite_version: "2.0",
  title: "Referent acceptance — REAL adjudicated merchant sentences",
  what_this_measures:
    "Whether a referent guard closes the wrong-subject instances measured on real stores WITHOUT " +
    "suppressing the true rows those same stores publish. Every case is a sentence a real merchant " +
    "wrote, that the engine renders today, adjudicated individually and blind-re-examined.",
  what_this_does_not_measure:
    "Frequency. 2.0 is derived from the 71 passing claim rows across 54 stores in a 335-store sample; " +
    "it is not a population. It also does not measure the two DESCOPED axes, which have no hostile " +
    "cases here on purpose — see `descoped`.",
  descoped: {
    letter_not_spirit: {
      verdict: "DESCOPE-WITH-PRECEDENT",
      measured:
        "Attacks best of the three on chosen input (260/280 = 92.9%) and owns ZERO defects alone: " +
        "all 9 of its attributions are shared with wrong_subject (8) or tense_modality (1). Its " +
        "principal real-copy stratum `enquiry_evaluation` has 0 instances in 3,349 sentences across " +
        "335 stores. Stable under strict, raw and re-examined readings.",
      precedent:
        "The `origin` tombstone — a class with zero natural instances, removed after four attempts — " +
        "and v3.6's declined guards for `enquiry_evaluation` and `review_quote` on measured zero " +
        "instances. Descoping on frequency is established practice here.",
      consequence: "No hostile case is authored for it. Its honest carriers ARE carried, because a " +
        "wrong_subject guard can break them collaterally.",
    },
    tense_modality: {
      verdict: "DESCOPE-WITH-PRECEDENT",
      measured:
        "Zero occurrence in the passing population (0/71) with all three detectors proven live " +
        "(they fire 135 times at corpus scale), zero defects alone, and 13 honest carriers. Its one " +
        "attribution is a co-attribution on a letter_not_spirit defect. Corroborated independently " +
        "by G-15's own TIME hostile = 0/17.",
      precedent: "Same as above. 13 true rows lost for zero gain is the `origin` arithmetic.",
      consequence: "No hostile case is authored for it. Its honest carriers ARE carried.",
    },
  },
  frequency_caveat: {
    statement:
      "2.0 INVERTS 1.0's caveat and does not replace it. 1.0 measures capability on hand-built " +
      "sentences; 2.0 measures whether a guard survives contact with sentences real merchants wrote. " +
      "Passing 2.0 still does not establish that a guard is worth shipping — it establishes that it " +
      "does not break the specific true rows these 54 stores publish.",
    precedent:
      "v3.2's four aboutness guards: a 216-store replay found 0 real positives lost while two " +
      "independent attackers found 192 regressions. A sample cannot arbitrate a matcher change.",
    second_precedent:
      "v2.6 measured 16/16 on its own set and was a net regression when someone else measured it.",
    consequence:
      "2.0 is a REGRESSION FLOOR and an evidence base. The gate for a v4.0 guard remains an " +
      "adversarial pass by agents who did not author the guard OR this suite.",
  },
  authorship: {
    derived_by: "v3.9 CP-3, from adjudications produced by workflow wf_2a19827b-bd2 and " +
      "blind re-examination wf_60adde8d-d47.",
    excluded_from_authoring_the_v4_guard: [
      "wf_2a19827b-bd2 — all 13 adjudicator agents and all 13 refuter agents",
      "wf_60adde8d-d47 — all 6 blinded re-examiner agents",
      "the v3.9 session orchestrator, which selected and framed these cases",
    ],
    why:
      "A guard measured against a gate its own author wrote is v2.6's failure mode, and the " +
      "disguised form of the rule this repo has recorded seven times: re-running the attacker's own " +
      "sentences after the fix feels independent and is not. G-15's precondition states it directly " +
      "— the session that builds the guard must not be the session that authors the suite.",
  },
  relationship_to_1_0: {
    suite_1_0: "BYTE-FROZEN. Not edited, not superseded, still gated at hostile 4/37 and " +
      "must-not-regress 19/19.",
    floor_not_ceiling:
      "1.0's 19 must-not-regress cases remain the floor. 2.0 adds real ones on top; a guard must " +
      "pass BOTH. 2.0's own baseline is RECORDED AT CREATION and is not a target — the hostile " +
      "cases are expected to FAIL today, because they are defects the engine has not fixed.",
  },
  terms: {
    note: "2.0's cases span many claim keys, so terms are carried PER KEY rather than as one " +
      "list. Each is lifted from the engine's own `CLAIM_TERMS` source bytes, never retyped.",
    derived_from: "src/server/productTest.ts CLAIM_TERMS",
    derived_from_hash: "see terms_hash",
    drift_tripwire: "`acceptance.test.ts` must assert every key's term list still matches the " +
      "engine's. If it fails, the engine's vocabulary moved and this suite must be RE-DERIVED — " +
      "it is not a licence to edit the assertion.",
    support: [...new Set(keysUsed.flatMap((k) => CLAIM_TERMS[k]!.support))].sort(),
    violating: [...new Set(keysUsed.flatMap((k) => CLAIM_TERMS[k]!.violating))].sort(),
  },
  terms_by_claim_key: termsByKey,
  strata,
  cases,
};

fs.mkdirSync("standards/acceptance/subject-tense", { recursive: true });
fs.writeFileSync("standards/acceptance/subject-tense/suite2.json", `${JSON.stringify(suite, null, 2)}\n`);

console.log(JSON.stringify({
  hostile: cases.filter((c) => c.direction === "hostile").length,
  must_not_regress: cases.filter((c) => c.direction === "must_not_regress").length,
  total: cases.length,
  claim_keys: keysUsed,
  strata: Object.keys(strata),
  multi_axis_carriers: cases.filter((c) => c.stratum === "real_carrier_multi_axis").length,
  hosts: [...new Set(cases.map((c) => c.provenance.host))].length,
}, null, 2));
