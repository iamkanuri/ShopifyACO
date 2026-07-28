// v3.9 CP-1A — THE FREQUENCY × CONSEQUENCE × HONEST-CARRIER READ ON THE THREE OPEN AXES.
//
// ⚠️ WHAT THIS IS AND IS NOT. G-14 measured CAPABILITY on chosen input: letter_not_spirit
// 260/280, tense_modality 439/621, wrong_subject 368/914. That licenses measuring, never
// shipping (the acceptance runner's own caveat). This file measures the other half — how
// often each axis's shape occurs in the sentences the engine ACTUALLY CITES AS PROOF on
// real stores, and what a guard aimed at it would cost.
//
// Nothing here is a proposed guard. Nothing here may be lifted into `src/`. These are
// measurement instruments whose precision is ADJUDICATED by reading the hits.
//
// The population is NOT re-derived — it is v3.6's `freq/pass_rows.json`, cross-checked
// row-for-row against v3.8's A/B dump at the fixed tree (`reconcile.mjs`: 34 == 34, 0
// either side). Two denominators are reported and never conflated:
//   ASKED   (34) — claim rows the engine selects itself via CATEGORY_CLAIMS
//   FORCED  (71) — all 13 claims forced at every store; the blast radius a guard would
//                  have if any future category selects those claims
//
// Detectors are v3.6's own 21, imported not rebuilt, plus the three AXIS roll-ups. Every
// occurrence is a FLOOR: detector recall is unmeasured (v3.6's caveat, carried forward).

import fs from "node:fs";
import { DETECTORS } from "../v3-6/freq/strata.js";

interface PassRow {
  domain: string; url: string; isCoffee: boolean; claim: string; asked: boolean;
  status: string; quote: string; surface: string; detail: string;
  strata: string[]; quoteless: boolean;
}

const rows: PassRow[] = JSON.parse(fs.readFileSync("experiments/v3-6/freq/pass_rows.json", "utf8"));

// ---------------------------------------------------------------------------
// THE MAPPING: G-14's attack classes onto v3.6's 21 strata.
//
// This is the brief's item 3. It is authored here, in one place, so a reader can see
// exactly which real-copy shape each capability number is supposed to correspond to —
// and, critically, where a capability number has NO real-copy counterpart at all.
// ---------------------------------------------------------------------------
export const AXIS_MAP: Record<string, {
  g14Capability: string;
  hostile: string[];
  honestCarriers: string[];
  note: string;
}> = {
  letter_not_spirit: {
    g14Capability: "260/280 (92.9%)",
    hostile: ["enquiry_evaluation", "comparative", "subscription", "cross_sell"],
    honestCarriers: ["already_refused", "plain_present", "spec_block"],
    note:
      "The engine reads a term that is present but not ASSERTED of this unit — an invitation " +
      "to enquire, a comparison, an option offered. v3.6's nearest stratum is " +
      "`enquiry_evaluation`, which measured ZERO stores and ZERO sentences.",
  },
  tense_modality: {
    g14Capability: "439/621 (70.7%)",
    hostile: ["past_tense", "future_conditional", "modal"],
    honestCarriers: ["temporal_but_current", "plain_present", "trade_form"],
    note:
      "The term is asserted, but not of the present product state — a past practice, a " +
      "future intention, a conditional. The honest carriers are the killer: 'has always " +
      "used', 'since 2019', 'we have been certified since…' are TRUE present-state claims " +
      "wearing a past-tense verb.",
  },
  wrong_subject: {
    g14Capability: "368/914 (40.3%)",
    hostile: [
      "sibling_product", "packaging", "shipment", "bundled_item", "competitor",
      "review_quote", "site_wide", "industry_generic",
    ],
    honestCarriers: ["first_person", "plain_present", "spec_block", "trade_form"],
    note:
      "The term is asserted of something that is not this product. This is the axis " +
      "`nonProductSubject` (v2.5) already partially addresses, and the one G-15 is filed " +
      "against. 17 false passes in the 71 forced rows, per the G-15 filing.",
  },
};

// ---------------------------------------------------------------------------
// Run v3.6's detectors over the population's QUOTES.
// v3.6 ran them over all 3,349 extracted sentences; here they run over the 71 sentences
// the engine actually rendered as proof. Different denominators, different questions.
// ---------------------------------------------------------------------------
function detectorsFor(s: string): { id: string; direction: string; pats: string[] }[] {
  const hits: { id: string; direction: string; pats: string[] }[] = [];
  for (const d of DETECTORS) {
    const fired: string[] = [];
    for (const [name, re] of d.pats) if (re.test(s)) fired.push(name);
    if (!fired.length) continue;
    if (d.also && !d.also(s)) continue;
    hits.push({ id: d.id, direction: d.direction, pats: fired });
  }
  return hits;
}

// two-sided liveness canary — a detector set that fires on nothing, or on everything,
// is a broken instrument that reads exactly like a clean or a catastrophic result.
const CANARY_POS = "Unlike other roasters, our packaging ships in a recycled mailer.";
const CANARY_NEG = "Organic.";
const canaryPos = detectorsFor(CANARY_POS).length;
const canaryNeg = detectorsFor(CANARY_NEG).length;

const enriched = rows.map((r) => {
  const hits = detectorsFor(r.quote);
  const ids = new Set(hits.map((h) => h.id));
  const axes: Record<string, { hostileHit: string[]; honestHit: string[] }> = {};
  for (const [axis, spec] of Object.entries(AXIS_MAP)) {
    axes[axis] = {
      hostileHit: spec.hostile.filter((s) => ids.has(s)),
      honestHit: spec.honestCarriers.filter((s) => ids.has(s)),
    };
  }
  return { ...r, detectorHits: hits, axes };
});

// ---------------------------------------------------------------------------
// Tables. Per-cell completion, per-store beside per-row (the brief's item 5).
// ---------------------------------------------------------------------------
function table(pop: typeof enriched, popName: string) {
  const stores = new Set(pop.map((r) => r.domain)).size;
  const out: any = { population: popName, rows: pop.length, stores, axes: {} };
  for (const [axis, spec] of Object.entries(AXIS_MAP)) {
    const occ = pop.filter((r) => r.axes[axis].hostileHit.length > 0);
    const honest = pop.filter((r) => r.axes[axis].honestHit.length > 0);
    const both = pop.filter(
      (r) => r.axes[axis].hostileHit.length > 0 && r.axes[axis].honestHit.length > 0,
    );
    out.axes[axis] = {
      g14Capability: spec.g14Capability,
      occurrence_rows: occ.length,
      occurrence_stores: new Set(occ.map((r) => r.domain)).size,
      occurrence_pct: pop.length ? ((occ.length / pop.length) * 100).toFixed(2) : null,
      honest_carrier_rows: honest.length,
      honest_carrier_stores: new Set(honest.map((r) => r.domain)).size,
      hostile_and_honest_rows: both.length,
      perStratum: Object.fromEntries(
        spec.hostile.map((s) => [s, pop.filter((r) => r.detectorHits.some((h) => h.id === s)).length]),
      ),
      perHonestStratum: Object.fromEntries(
        spec.honestCarriers.map((s) => [s, pop.filter((r) => r.detectorHits.some((h) => h.id === s)).length]),
      ),
      // consequence is NOT computable here — it requires adjudication. Never 0.
      consequence_rows: null,
      consequence_state: "PENDING_ADJUDICATION",
    };
  }
  return out;
}

const asked = enriched.filter((r) => r.asked);
const result = {
  canary: { positive: canaryPos, negative: canaryNeg, live: canaryPos > 0 && canaryNeg === 0 },
  denominators: {
    forced_rows: enriched.length,
    forced_stores: new Set(enriched.map((r) => r.domain)).size,
    asked_rows: asked.length,
    asked_stores: new Set(asked.map((r) => r.domain)).size,
    corpus_stores: 335,
    corpus_sentences: 3349,
    note:
      "ASKED is the population the engine renders today. FORCED is every claim run at " +
      "every store — a guard's blast radius if a future category selects those claims.",
  },
  strataCount: { total: DETECTORS.length, hostile: DETECTORS.filter((d) => d.direction === "hostile").length },
  forced: table(enriched, "FORCED (all 13 claims)"),
  askedOnly: table(asked, "ASKED (CATEGORY_CLAIMS-selected)"),
  rows: enriched,
};

const completion = !result.canary.live
  ? "INCOMPLETE"
  : enriched.length === 0
    ? "INCOMPLETE"
    : "VERIFIED_CLEAN_OCCURRENCE_ONLY";
(result as any).completion = completion;
(result as any).completion_note =
  "OCCURRENCE is measured. CONSEQUENCE and HONEST-CARRIER-truth are NOT — both require " +
  "individual adjudication, which is a separate pass. consequence_rows is null, never 0.";

fs.mkdirSync("experiments/v3-9/out", { recursive: true });
fs.writeFileSync("experiments/v3-9/out/axes.json", JSON.stringify(result, null, 2));

console.log("canary:", JSON.stringify(result.canary));
console.log("denominators:", JSON.stringify(result.denominators, null, 2));
console.log("strata:", JSON.stringify(result.strataCount));
console.log("\n=== FORCED (71) ===");
console.log(JSON.stringify(result.forced.axes, null, 2));
console.log("\n=== ASKED (34) ===");
console.log(JSON.stringify(result.askedOnly.axes, null, 2));
console.log("\ncompletion:", completion);
