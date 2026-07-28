// ===========================================================================
// PUBLISHING A STANDARD (v3.2 CP7).
//
// A published standard whose numbers are retyped into a web page is worse than an
// unpublished one: the page and the artifact drift, and the citation that resolves
// to the page says something the JSON does not. So EVERY published number in here
// is read from the artifact — `standard.json` for structure, `fitness.json` for
// measured error bounds — and `standards.test.ts` asserts the published content
// hash equals the artifact's.
//
// WHY THIS IS SERVER-RENDERED. The whole point of publishing is that a machine can
// read it. lens.thirdocular.com returns meta tags and an empty <div id="root"> to a
// non-JavaScript fetch, so the site whose headline is "AI buyers treat your store
// like an API" was unreadable by AI buyers. These pages render their full text into
// the document, ahead of the SPA catch-all; React mounts over it and takes the page
// for interaction, exactly as the Index SSR already does.
//
// WHAT IS DELIBERATELY PUBLISHED THAT NOBODY ELSE PUBLISHES:
//   • the INSUFFICIENT evidence for every entry — what does NOT count, and why;
//   • the BLOCKED, ADVISORY and NOT-DISCRIMINATING tiers, each naming why it is not
//     executable. Sixteen questions saying "here is exactly what would be required"
//     is a stronger artifact than ten presented as complete;
//   • what a pass does NOT license;
//   • the measured error bound, per sample, with its method and n — AND the fact
//     that the two samples are not audited to the same depth, which matters more
//     than the gap between them. Every comparative sentence is DERIVED from the
//     numbers; the hand-written one went false the moment they moved.
//
// `independently_applied: false` is stated on the front page. We wrote the standard
// and we run it; no third party has applied it. Saying so is cheap and not saying so
// would be the first false claim on a site about claim discipline.
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import { standardHash, hashMatches } from "../../standards/hash.js";

// ---- the artifacts ---------------------------------------------------------

export interface StandardEntry {
  id: string;
  question: string;
  assertion?: { subject?: string; operator?: string; expected?: unknown };
  /** ⚠️ `unbound` ARRIVED AT GRAMMAR 1.2 and it is a TIER, not a variant of `blocked`.
   *  Anywhere this renderer treats the tier list as closed, a new value renders NOTHING —
   *  see `orderedTiers`, which appends unknown tiers rather than filtering them away. */
  tier: "executable" | "unbound" | "not_discriminating" | "blocked" | "advisory" | string;
  /** An OBJECT ({applies_when, signal}) in the artifact, not a string. Rendering it
   *  directly produced "[object Object]" — the SECOND field in this file to do so
   *  after `posture`, which is why `renderScalarish` exists rather than a third
   *  bespoke branch, and why a test now forbids the string anywhere on any page. */
  applicability?: { applies_when?: string; signal?: string } | string;
  accepted_evidence?: Array<{ surface?: string; form?: string; example?: string }>;
  insufficient_evidence?: Array<{ form?: string; why_not?: string }>;
  conflict_rules?: Array<{ when?: string; resolution?: string; precedence?: string[] }>;
  public_inspectable?: unknown;
  /** GRAMMAR 1.0/1.1 ONLY. Deleted at 1.2: the numeric band held 1 of 10 against this
   *  category's own sample and every miss was HIGH, so it is not carried forward. */
  predicted_discrimination?: {
    predicted_fail_rate_band?: string;
    in_target_band?: boolean;
    reasoning?: string;
    measured?: boolean;
    measured_fail_rate_pct?: number;
    measured_n?: number;
    measured_verdict?: string;
  };
  /** GRAMMAR 1.2. The band's replacement: a direction, a confidence, and the ORIGINAL
   *  reasoning preserved verbatim — deliberately no number. `direction` is
   *  `no_prediction` on all 42 v1.2 entries, because translating a refuted band into a
   *  direction would inherit the error that condemned it. */
  discrimination_prediction?: {
    direction?: string;
    confidence?: string;
    reasoning?: string;
    notes?: string;
  };
  /** GRAMMAR 1.2. Why an entry the engine COULD run is not run: this standard has not
   *  authored a binding or put it through the adversarial pass. Distinct from `blocked`
   *  (the engine cannot) and from `advisory` (public data cannot adjudicate it). */
  unbound_reason?: string;
  consumer_note?: string;
  pass_means?: { establishes?: string; does_not_establish?: string } | string;
  known_gaps?: Array<{ corpus_case?: string; effect?: string; note?: string }> | string[];
  // ⚠️ THE ARTIFACT'S KEY IS `citations`. An earlier version of this file read
  // `grounding.sources`, which does not exist — so every grounding block rendered
  // EMPTY, on the entry pages and on the whole grounding page, and the tests passed
  // because they only asserted that the id and the insufficient-evidence forms were
  // present. A renderer reading a field that is not there produces nothing and looks
  // exactly like a section that legitimately has nothing. `sources` is kept as a
  // tolerated alias so a future schema rename does not silently blank the page again.
  grounding?: {
    citations?: Array<{ source?: string; url?: string; kind?: string; establishes?: string }>;
    sources?: Array<{ source?: string; url?: string; kind?: string; establishes?: string }>;
    demand_basis?: string[];
    refutation?: unknown;
  };
  merchant_remediation?: string;
  not_executable_because?: string;
  blocked_reason?: string;
  [k: string]: unknown;
}

export interface StandardDoc {
  standard_id: string;
  version: string;
  title: string;
  status?: string;
  /** An OBJECT in the artifact, not a string — it rendered as "[object Object]". */
  posture?: { independently_applied?: boolean; statement?: string } | string;
  grammar_version?: string;
  applicability_envelope?: unknown;
  out_of_scope?: unknown;
  engine_contract?: unknown;
  standard_hash?: string;
  entries: StandardEntry[];
  [k: string]: unknown;
}

export interface FitnessSample {
  name: string; label: string; description?: string;
  stores: number; products_evaluated?: number;
  pass_rows_audited: number; confirmed_false_positives: number; borderline_counted_as_passes?: number;
  point_estimate_pct: number; bound_95_naive_pct?: number; bound_95_cluster_icc02_pct: number;
  /** ⚠️ OPTIONAL SINCE GRAMMAR 1.2, which has no `method` string — it records the audit
   *  discipline as BOOLEANS (`audit.row_by_row`, `untruncated_evidence`, …) plus a
   *  `limits` array. `methodOf` composes the sentence from those rather than leaving the
   *  paragraph blank, because a blank paragraph looks exactly like a method nobody wrote. */
  rows_per_store?: number; deff_icc02?: number; method?: string; source?: string;
  /** GRAMMAR 1.2 additions, all read straight off `category_fitness`. `per_store_pct` in
   *  particular was DROPPED by v1.1's in-document block and restored at 1.2. */
  icc?: number; per_store_pct?: number;
  completion_state?: string;
  /** GRAMMAR 1.2 / v3.7. A Wilson 95% interval beside the Poisson-upper bound, because
   *  the Poisson/n form stops being a probability at small n and the per-kind cells are
   *  where small n arrives. Optional: v1.0's sidecar predates it and renders without. */
  interval_95?: { lower_pct: number; upper_pct: number };
  /** v3.7. The blended bound decomposed by requirement kind. Published as COUNTS with
   *  intervals, never as six rates: see `renderSeparation` for why. */
  per_kind?: Array<{
    kind: string; entries?: number; pass_rows: number; stores: number;
    confirmed_false_positives: number | null; borderline_counted_as_passes?: number | null;
    point_estimate_pct?: number; interval_95?: { lower_pct: number; upper_pct: number };
    bound_95_naive_pct?: number | null; bound_95_naive_refused?: string;
    deff_icc02?: number; bound_95_cluster_icc02_pct?: number | null; cluster_adjustment_refused?: string;
    per_store_pct?: number | null; underpowered?: boolean; completion_state?: string;
  }>;
  audit?: { row_by_row?: boolean; untruncated_evidence?: boolean; borderline_recorded?: boolean; borderline_count?: number };
  limits?: string[];
  defects?: CategoryFitnessDefect[];
  provenance?: CategoryFitnessProvenance;
  /** Grammar 1.1: the classes behind the confirmed errors, each with its count and an
   *  example, and whether ANY mechanism in the engine addresses it. `false` is the
   *  interesting value and the reason this is published at all. */
  defect_classes?: Array<{ klass: string; count: number; example: string; addressed_by_a_guard?: boolean } | string>;
  /** Only PART of this sample has been re-checked, so its rate is a lower bound. A
   *  floor and a complete audit must never be compared as peers. */
  is_floor?: boolean;
  supersedes?: string;
}
/** One confirmed false pass, from grammar 1.2's `category_fitness.defects`. Individual
 *  rows rather than 1.1's aggregated `defect_classes`: the counts are DERIVED from this
 *  list, so a class summary can no longer disagree with the rows behind it. */
export interface CategoryFitnessDefect {
  entry_id?: string; evidence?: string; why_wrong?: string;
  category_specific?: boolean; status?: string;
}
/** Grammar 1.2's sample provenance. `stores` here is the AUDIT's store count and is not
 *  the discrimination sample's — the coffee audit's 162 pass rows come from 77 of the
 *  run's 100 storefronts, because 23 produced no passing row at all. The artifact says
 *  so in its own `notes`, which this renderer publishes rather than paraphrases. */
export interface CategoryFitnessProvenance {
  sample_id?: string; category_scope?: string; category_standard_id?: string;
  stores: number; products?: number; selection?: string;
  deduplicated_by_brand?: boolean; applicability_gate_enforced?: boolean;
  unclassifiable_refused?: number; excluded_out_of_category?: number;
  captured_on?: string; notes?: string;
}
/** GRAMMAR 1.2's in-document fitness block. Same role as v1.1's `measured_fitness` and
 *  v1.0's sidecar, DIFFERENT internal shape: the five bounds live under `bounds` rather
 *  than flat, and the audit discipline is structured instead of prose. `fitnessOf`
 *  normalises all three into one shape so no renderer has to know which it is looking at. */
export interface CategoryFitness {
  sample: CategoryFitnessProvenance;
  pass_rows_audited: number;
  audit?: { row_by_row?: boolean; untruncated_evidence?: boolean; borderline_recorded?: boolean; borderline_count?: number };
  confirmed_false_positives: number;
  bounds: {
    point_estimate_pct: number; naive_95_upper_pct: number;
    cluster_adjusted_95_upper_pct: number; icc: number; per_store_pct: number;
  };
  completion_state: string;
  defects?: CategoryFitnessDefect[];
  measured_on: string;
  limits?: string[];
}

/**
 * One entry's measured discrimination, NORMALISED across three grammars.
 *
 * ⚠️ `kind` IS LOAD-BEARING AND IS NOT COSMETIC. At 1.0/1.1 the verdict answers
 * "did the authored BAND hold?" (`held` / `above_band` / `below_band`). At 1.2 it
 * answers "does this entry DISCRIMINATE?" (`discriminating` / `indeterminate` /
 * `not_discriminating`) and is decided by the 95% interval, not the point estimate.
 * Those are different questions with different verdict vocabularies, and rendering one
 * through the other's table produces a page that quietly reports "0 of 10 predictions
 * held" for a version that carries no predictions at all.
 */
export interface EntryDiscrimination {
  id: string;
  kind: "band_calibration" | "discrimination";
  /** Rows the entry produced. `adjudicated` is the DENOMINATOR — at 1.2 the two differ
   *  wherever the engine returned `requires_store_access`, which is neither pass nor
   *  fail. DELIV-001 is 45/74, not 45/100; publishing the second counts a row the engine
   *  could not decide as a pass. */
  asked: number;
  adjudicated?: number;
  fail_count?: number;
  fail_pct: number;
  interval?: { lower_pct: number; upper_pct: number };
  target_band?: { lower_pct: number; upper_pct: number };
  decision_rule?: string;
  predicted_band?: string;
  verdict?: string;
  note?: string;
  instrument_bias?: Array<{ source?: string; direction?: string; magnitude_pp?: number }>;
  /** What a LATER measurement displaced, DERIVED from the document — only `why` is
   *  authored, by the sidecar, since it is the only party that knows why it exists.
   *  Rendered beside the new figure rather than instead of it: a rate that moved is a
   *  fact about the engine, and the displaced record carries declared instrument biases
   *  that dropping it would delete from the page. */
  supersedes?: EntryDiscrimination & { why?: string };
}
export interface FitnessDoc {
  measured_at: string; engine_version?: string;
  samples: FitnessSample[];
  pending?: Record<string, string>;
  /** v3.7. The pairwise interval-overlap test over the per-kind cells, per sample. It is
   *  published because its ANSWER is the deliverable: the decomposition does not support a
   *  spread, and a table of cells with no separation statement invites the reader to make
   *  one up. `pairs_tested` is carried beside `pairs_separated` so a test that silently
   *  tested nothing cannot read as "nothing separates". */
  per_kind_separation?: Record<string, {
    pairs_tested: number; pairs_separated: number;
    widest_separation_pp?: number;
    separated?: Array<{ a: string; b: string; gap_pp: number }>;
  }>;
  /** Measured fail rate per entry. OVERRIDES the document's predicted band — the
   *  bands are hypotheses written before the standard had ever run, and rewriting
   *  them inside standard.json would change its hash and break every citation. */
  entry_discrimination?: { n_products?: number; bands_held?: number; entries?: EntryDiscrimination[] };
  /** DERIVED, never authored: set by `fitnessOf` when a sidecar re-measures a version
   *  that already carries a measurement INSIDE the document. Both exist and they
   *  disagree, so the page has to say which is later and why — showing the sidecar
   *  silently would be the "site disagrees with its own JSON" defect with the JSON
   *  one click away at `/standard.json`. */
  supersededInDocument?: {
    field: string; reason?: string;
    label: string; pass_rows_audited: number; confirmed_false_positives: number;
    bound_95_cluster_icc02_pct: number; measured_on?: string;
  };
}

/**
 * The fitness a document carries INSIDE itself (grammar 1.1), rather than beside it.
 *
 * The sidecar rule is not "measurements live outside the document" — it is that a
 * measurement taken AFTER a version is published must not change that version's bytes,
 * because a citation resolves through its hash. v1.0's measurement came after v1.0
 * shipped, so it is a sidecar; v1.1's came before v1.1 existed, so it is in the
 * document. `fitnessOf` below normalises the two into one shape so the renderer never
 * has to know which kind it is looking at.
 */
export interface EmbeddedFitness {
  measured_at: string; engine_version?: string;
  bands_held?: number; bands_total?: number;
  samples: Array<FitnessSample & { defect_classes?: Array<{ klass: string; count: number; example: string; addressed_by_a_guard?: boolean }> }>;
}

/**
 * The audit method sentence, COMPOSED from grammar 1.2's structured audit flags.
 *
 * 1.0 and 1.1 carry a prose `method`; 1.2 carries booleans and a `completion_state`.
 * Falling back to an empty paragraph would be the `grounding.sources` failure in its
 * mildest form — the section would render, look complete, and say nothing.
 */
/**
 * The completion state, spelled out — THREE states, never two.
 *
 * ⚠️ THE `else` BRANCH USED TO SAY "Every scheduled unit returned and every candidate was
 * adjudicated" FOR ANYTHING THAT WAS NOT `DEFECTS_FOUND`, which makes `INCOMPLETE` render
 * as a clean bill of health — the exact inversion `src/measure/completion.ts` exists to
 * prevent, in the one place a reader looks for it. It became reachable the moment a
 * sample declared itself INCOMPLETE: the general DTC floor, whose count is 0 only because
 * one class of many was ever adjudicated.
 */
function completionSentence(x: FitnessSample): string {
  const n = x.confirmed_false_positives;
  switch (x.completion_state) {
    case "DEFECTS_FOUND":
      return `${n} confirmed false passes. A measurement that did not finish resolves to INCOMPLETE and may never be summed into a defect total or read as a pass — zero is the most dangerous number a broken instrument returns, because it is also what a healthy one returns.`;
    case "INCOMPLETE":
      return `${n} confirmed false passes IN THE PART OF THIS SAMPLE THAT WAS ADJUDICATED, which is not the same statement as ${n} false passes. Rows nobody adjudicated force INCOMPLETE, and an incomplete measurement may never be summed into a defect total or read as a pass.`;
    default:
      return "Every scheduled unit returned and every candidate was adjudicated.";
  }
}

function methodOf(x: FitnessSample): string {
  if (x.method) return x.method;
  const a = x.audit;
  if (!a) return "";
  const parts: string[] = [];
  if (a.row_by_row) parts.push(`every one of the ${x.pass_rows_audited} passing rows was adjudicated individually`);
  if (a.untruncated_evidence) parts.push("against the FULL untruncated evidence rather than the rendered quote");
  if (a.borderline_recorded) {
    parts.push(`${a.borderline_count ?? 0} judgement calls were recorded and counted as PASSES, so they can be disputed rather than merely trusted`);
  }
  if (!parts.length) return "";
  const s = parts.join(", ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/**
 * The measurement to publish for a standard, WHEREVER THIS VERSION KEEPS IT.
 *
 * ⚠️ THREE SHAPES, THREE VERSIONS, AND THIS HELPER IS THE ONLY PLACE THAT KNOWS.
 *   v1.0 — a SIDECAR `fitness.json` (the measurement came after v1.0 shipped, so it
 *          could not go inside without changing the bytes a citation resolves through);
 *   v1.1 — in-document `measured_fitness`, flat bounds;
 *   v1.2 — in-document `category_fitness`, bounds nested under `bounds`, audit
 *          discipline as booleans, defects as individual rows, plus `limits`.
 *
 * Read the raw field anywhere else and the page renders NOTHING, which looks exactly
 * like a section that legitimately has nothing to show. That defect has now shipped
 * three times in this file's history (`grounding.sources`, `s.fitness` twice); a fourth
 * is prevented by there being one normaliser and a test that no page renders empty.
 * Never invents a measurement — an absent one stays absent.
 */
export function fitnessOf(s: PublishedStandard): FitnessDoc | null {
  if (s.fitness?.samples?.length) {
    // ⚠️ v1.3 IS THE FIRST VERSION WITH BOTH, and "sidecar wins" alone is not enough.
    // v1.0 had a sidecar because it had no in-document block to conflict with. v1.3
    // carries `category_fitness` (inherited from v1.2, measured before rule D) AND a
    // sidecar measured after rule D shipped. Returning only the sidecar would put a
    // number on the page that the artifact one click away contradicts, with nothing
    // saying which is later. So the displaced measurement is carried, derived from the
    // document rather than restated in the sidecar.
    const displaced = displacedInDocument(s);
    return displaced ? { ...s.fitness, supersededInDocument: displaced } : s.fitness;
  }

  const inDoc = (s.doc as { measured_fitness?: EmbeddedFitness }).measured_fitness;
  if (inDoc?.samples?.length) {
    return {
      measured_at: inDoc.measured_at,
      engine_version: inDoc.engine_version,
      samples: inDoc.samples,
      // Per-entry rates live on the entries themselves in grammar 1.1, so there is no
      // separate block to normalise — `measuredOf` reads them directly.
    };
  }

  const cf = (s.doc as { category_fitness?: CategoryFitness }).category_fitness;
  if (!cf?.bounds) return null;
  // The label is DERIVED from the artifact's own scope fields. `category_fitness` is by
  // rule the THIS-CATEGORY sample and nothing else — `fitness_sample_is_this_category`
  // rejects a general-mixed sample outright — so there is exactly one row here, and the
  // general figure lives in `limits`, labelled a floor, where the artifact put it.
  const scope = cf.sample?.category_scope === "this_category"
    ? `${cf.sample.category_standard_id ?? s.doc.standard_id} category sample`
    : `${String(cf.sample?.category_scope ?? "sample").replace(/_/g, " ")} sample`;
  return {
    measured_at: cf.measured_on,
    samples: [{
      name: "category",
      label: scope,
      description: cf.sample?.notes,
      stores: cf.sample?.stores ?? 0,
      products_evaluated: cf.sample?.products,
      pass_rows_audited: cf.pass_rows_audited,
      confirmed_false_positives: cf.confirmed_false_positives,
      borderline_counted_as_passes: cf.audit?.borderline_count,
      point_estimate_pct: cf.bounds.point_estimate_pct,
      bound_95_naive_pct: cf.bounds.naive_95_upper_pct,
      bound_95_cluster_icc02_pct: cf.bounds.cluster_adjusted_95_upper_pct,
      icc: cf.bounds.icc,
      per_store_pct: cf.bounds.per_store_pct,
      completion_state: cf.completion_state,
      audit: cf.audit,
      limits: cf.limits,
      defects: cf.defects,
      provenance: cf.sample,
      source: cf.sample?.sample_id,
    }],
  };
}

/**
 * The measurement a SIDECAR displaces, read off the document itself.
 *
 * Returns null when the document carries no measurement of its own — which is v1.0's
 * case and the reason "sidecar wins" was sufficient for two years of this file's life.
 * The `reason` comes from the sidecar (it is the only party that knows why it exists);
 * every FIGURE comes from the document, so the two can never drift apart.
 */
function displacedInDocument(s: PublishedStandard): FitnessDoc["supersededInDocument"] {
  const said = (s.fitness as { supersedes_in_document?: { field?: string; reason?: string } } | null)?.supersedes_in_document;
  const cf = (s.doc as { category_fitness?: CategoryFitness }).category_fitness;
  if (cf?.bounds) {
    return {
      field: said?.field ?? "category_fitness", reason: said?.reason,
      label: `${cf.sample?.category_standard_id ?? s.doc.standard_id} category sample`,
      pass_rows_audited: cf.pass_rows_audited,
      confirmed_false_positives: cf.confirmed_false_positives,
      bound_95_cluster_icc02_pct: cf.bounds.cluster_adjusted_95_upper_pct,
      measured_on: cf.measured_on,
    };
  }
  const mf = (s.doc as { measured_fitness?: EmbeddedFitness }).measured_fitness;
  const first = mf?.samples?.[0];
  if (!first) return undefined;
  return {
    field: said?.field ?? "measured_fitness", reason: said?.reason,
    label: first.label, pass_rows_audited: first.pass_rows_audited,
    confirmed_false_positives: first.confirmed_false_positives,
    bound_95_cluster_icc02_pct: first.bound_95_cluster_icc02_pct,
    measured_on: mf?.measured_at,
  };
}

/**
 * The measured discrimination for one entry, from wherever this version keeps it.
 *
 * Three sources, and the 1.1 and 1.2 blocks share a FIELD NAME while meaning different
 * things, which is why the discriminator is a field only 1.2 has (`n_adjudicated`)
 * rather than the document's version string:
 *   1.2 — `{verdict: discriminating|indeterminate|not_discriminating, n_asked,
 *          n_adjudicated, fail_count, interval_95, target_band, instrument_bias}`
 *   1.1 — `{verdict: held|above_band|…, asked, fail_rate_pct, carries_information}`
 *   1.0 — the sidecar's `entry_discrimination.entries[]`.
 */
export function measuredOf(s: PublishedStandard, e: StandardEntry): EntryDiscrimination | null {
  // ⚠️ THE SIDECAR IS CHECKED FIRST, AND ONLY BECAUSE IT IS LATER — not because sidecars
  // outrank documents. v1.3's IDENT-001 record says in its own words that its 94.7368%
  // is a FLOOR, measured against the v1.2 wording because "no run has been made against
  // the v1.3 wording, and no engine change ships with it". Rule D is that engine change
  // and the sidecar is that run. A renderer that kept preferring the document would keep
  // publishing a figure the document itself calls provisional, forever.
  //
  // The displaced record is CARRIED, not dropped. It holds the declared instrument
  // biases for that row, and a page that silently swaps one rate for another deletes
  // them — which would make the new figure look better supported than the old one.
  const later = s.fitness?.entry_discrimination?.entries?.find((x) => x.id === e.id);
  if (later) {
    const prior = inDocumentMeasurement(e);
    return {
      ...later,
      kind: later.interval ? "discrimination" : "band_calibration",
      supersedes: prior ? { ...prior, why: later.supersedes?.why } : later.supersedes,
    };
  }
  return inDocumentMeasurement(e);
}

/** The measurement the DOCUMENT carries for one entry, in whichever grammar wrote it. */
function inDocumentMeasurement(e: StandardEntry): EntryDiscrimination | null {
  const md = (e as { measured_discrimination?: Record<string, unknown> }).measured_discrimination;
  if (md && typeof md === "object") {
    if ("n_adjudicated" in md) {
      const m = md as unknown as {
        verdict: string; n_asked: number; n_adjudicated: number; fail_count: number; fail_rate_pct: number;
        interval_95: { lower_pct: number; upper_pct: number };
        target_band?: { lower_pct: number; upper_pct: number };
        decision_rule?: string; notes?: string;
        instrument_bias?: Array<{ source?: string; direction?: string; magnitude_pp?: number }>;
      };
      return {
        id: e.id, kind: "discrimination",
        asked: m.n_asked, adjudicated: m.n_adjudicated, fail_count: m.fail_count,
        fail_pct: m.fail_rate_pct, interval: m.interval_95, target_band: m.target_band,
        decision_rule: m.decision_rule, verdict: m.verdict, note: m.notes,
        instrument_bias: m.instrument_bias,
      };
    }
    const m = md as unknown as { fail_rate_pct: number; asked: number; verdict: string; note?: string };
    return {
      id: e.id, kind: "band_calibration",
      asked: m.asked, fail_pct: m.fail_rate_pct,
      predicted_band: e.predicted_discrimination?.predicted_fail_rate_band,
      verdict: m.verdict, note: m.note,
    };
  }
  return null;
}

/**
 * The entry's DISCRIMINATION EXPECTATION, whichever grammar wrote it.
 *
 * ⚠️ THE BAND IS GONE AT 1.2 AND MUST NOT BE RENDERED AS BLANK. `predicted_discrimination`
 * does not exist there, so a renderer reading it prints "Predicted fail rate: not stated
 * (predicted, not yet measured)" beside a measurement — a sentence that is false twice.
 * At 1.2 there is a direction, a confidence and the original reasoning verbatim, and
 * `band` is simply absent, so the caller can omit the row instead of emptying it.
 */
export function predictionOf(e: StandardEntry): {
  band?: string; reasoning?: string; direction?: string; confidence?: string; notes?: string;
} | null {
  const dp = e.discrimination_prediction;
  if (dp) return { reasoning: dp.reasoning, direction: dp.direction, confidence: dp.confidence, notes: dp.notes };
  const pd = e.predicted_discrimination;
  if (pd) return { band: pd.predicted_fail_rate_band, reasoning: pd.reasoning };
  return null;
}

export interface PublishedStandard {
  slug: string;            // "coffee"
  publicVersion: string;   // "1.0"
  dir: string;             // on-disk directory
  doc: StandardDoc;
  fitness: FitnessDoc | null;
  hash: string;
  hashOk: boolean;
  rawJson: string;
  /** The version that replaces this one, when there is one. Set HERE, in the registry —
   *  never inside the artifact, whose bytes are what a citation resolves through. */
  supersededBy?: string;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

/** Every standard that is PUBLISHED. A draft under `standards/` is not published by
 *  existing — it is published by appearing here, so `accessory/v0.1-draft` cannot
 *  leak onto the site because someone added a directory. */
const PUBLISHED: ReadonlyArray<{ slug: string; publicVersion: string; dir: string; supersededBy?: string }> = [
  // ORDER MATTERS: the LAST entry for a slug is the current one. v1.0 keeps serving,
  // byte-for-byte, forever — that is what a content hash promises — and gains only a
  // supersession notice, added by this RENDERER and never by editing the document.
  //
  // ⚠️ v1.3 SAT UNSERVED FOR A WHOLE RELEASE. It was reissued, hashed, tested and
  // committed, and this list stopped at v1.2 — so `/standards` went on calling v1.2
  // current, `llms.txt` told machine readers to cite it, and the tightened IDENT-001
  // clause the engine had already implemented was readable nowhere. A reissue nobody can
  // read is not a reissue. Publishing is this array; nothing else does it.
  { slug: "coffee", publicVersion: "1.0", dir: "standards/coffee/v1.0", supersededBy: "1.1" },
  { slug: "coffee", publicVersion: "1.1", dir: "standards/coffee/v1.1", supersededBy: "1.2" },
  { slug: "coffee", publicVersion: "1.2", dir: "standards/coffee/v1.2", supersededBy: "1.3" },
  { slug: "coffee", publicVersion: "1.3", dir: "standards/coffee/v1.3" },
];

/** The CURRENT version of a slug: the last registry entry for it. Every place that has
 *  to say "cite this one" derives it here rather than naming a version — llms.txt shipped
 *  that backwards once, advertising the SUPERSEDED version as measured and the current
 *  one as unmeasured, to exactly the machine readers the file exists for. */
export function currentOf(slug: string): PublishedStandard | null {
  const all = loadPublishedStandards().filter((s) => s.slug === slug);
  return all.length ? all[all.length - 1]! : null;
}
export const isCurrent = (s: PublishedStandard): boolean => currentOf(s.slug)?.publicVersion === s.publicVersion;

let cache: PublishedStandard[] | null = null;

export function loadPublishedStandards(): PublishedStandard[] {
  if (cache) return cache;
  const out: PublishedStandard[] = [];
  for (const p of PUBLISHED) {
    try {
      const raw = fs.readFileSync(path.join(repoRoot, p.dir, "standard.json"), "utf8");
      const doc = JSON.parse(raw) as StandardDoc;
      let fitness: FitnessDoc | null = null;
      try {
        fitness = JSON.parse(fs.readFileSync(path.join(repoRoot, p.dir, "fitness.json"), "utf8")) as FitnessDoc;
      } catch { fitness = null; }   // absent ⇒ the page says "not measured", never invents
      const check = hashMatches(doc as unknown);
      out.push({
        ...p, doc, fitness, rawJson: raw,
        hash: check.computed, hashOk: check.ok,
      });
    } catch { /* a standard that will not load is simply not published */ }
  }
  cache = out;
  return out;
}

/** Test seam — the module caches on first read, and a test that writes a fixture
 *  needs to invalidate it. */
export function __resetStandardsCache(): void { cache = null; }

export const findStandard = (slug: string, version: string): PublishedStandard | null =>
  loadPublishedStandards().find((s) => s.slug === slug && s.publicVersion === version) ?? null;

// ---- html helpers ----------------------------------------------------------

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const p = (s: unknown) => `<p>${esc(s)}</p>`;
const li = (s: unknown) => `<li>${esc(s)}</li>`;

const TIER_LABEL: Record<string, string> = {
  executable: "Executable",
  unbound: "Not yet bound",
  not_discriminating: "Not discriminating",
  blocked: "Blocked",
  advisory: "Advisory",
};
const TIER_WHY: Record<string, string> = {
  executable: "This question is asked as a test and produces a result for a real page.",
  // ⚠️ THE ONLY TIER WHOSE OBSTACLE IS OURS. `blocked` says the engine cannot; `advisory`
  // says public data cannot; `unbound` says BOTH CAN and this standard has not done the
  // work — no binding written, no adversarial pass run. Presenting it as either of the
  // other two would blame a limit that does not exist, which is the reason grammar 1.2
  // added a tier rather than reusing one.
  unbound: "The engine can run this kind of check and a public product page can settle it — but THIS standard has not yet written the binding or put the entry through its adversarial pass. The obstacle is unwritten work in this document, not the evidence and not the engine. Each one names the engine capability that fits.",
  // ⚠️ DO NOT REWRITE THIS TO SAY "MEASURED". It is version-dependent, and a draft of this
  // change did exactly that — which would have been FALSE on every page that renders it.
  // At grammar 1.2 `not_discriminating` IS a measured verdict, and the tier is consequently
  // EMPTY: its five occupants had never been run, which is why they became `unbound`. So
  // this string only ever renders at v1.0 and v1.1, where the tier was assigned from an
  // authored band and nothing had been measured at all. It is the frozen document's own
  // framing, published as it was written, and v1.2's changelog is where it is corrected.
  not_discriminating: "This question is executable, but nearly every page answers it the same way — so the answer carries almost no information, and it is published rather than run.",
  blocked: "This question matters to a buyer and CANNOT be answered from a public product page today. What would be required is stated in full.",
  advisory: "This question is worth asking but is not reducible to a check a page can settle. It is published as guidance, not as a test.",
};

/** THE THREE-VALUED VERDICT, spelled out. `indeterminate` is a first-class outcome and
 *  must not read as either decision — it is "this measurement ran and decided nothing",
 *  which is a different sentence from both "it discriminates" and "it does not". */
const VERDICT_LABEL: Record<string, string> = {
  discriminating: "Discriminating",
  indeterminate: "Undecided",
  not_discriminating: "Not discriminating",
  held: "Held",
  above_band: "Above band",
  below_band: "Below band",
};
const VERDICT_WHY: Record<string, string> = {
  discriminating: "the measured rate lies inside the target band, so the answer separates stores from one another",
  indeterminate: "the rate is outside the band but its 95% interval is not — this measurement RAN AND DECIDED NOTHING, which is neither of the other two answers and must never be read as either. The entry stays executable and keeps accruing n",
  not_discriminating: "the whole 95% interval lies outside the target band, so almost every store answers the same way. This is evidence for a retirement decision and is not the decision",
};

/**
 * Render a field that MIGHT be a string and might be a small object of strings.
 *
 * ⚠️ TWO FIELDS IN THIS ARTIFACT ARE OBJECTS THAT READ LIKE STRINGS — `posture` and
 * `applicability` — and both rendered as the literal text "[object Object]" on a
 * published page. Template interpolation converts silently, so nothing failed; the
 * page simply published a JavaScript diagnostic to a reader. A third such field is
 * a matter of time, so this handles the shape rather than the two known names, and
 * `standardsSite.test.ts` forbids "[object Object]" on EVERY page.
 */
function renderScalarish(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return p(v);
  if (Array.isArray(v)) return `<ul>${v.map((x) => li(typeof x === "string" ? x : JSON.stringify(x))).join("")}</ul>`;
  if (typeof v === "object") {
    const rows = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => typeof val === "string" && val.trim())
      .map(([k, val]) => `<div><dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(val)}</dd></div>`);
    return rows.length ? `<dl class="std-kv">${rows.join("")}</dl>` : "";
  }
  return p(String(v));
}

/**
 * The comparison between samples, DERIVED from them.
 *
 * Two things it must never say when they are not true: that the bounds differ by an
 * order of magnitude, and that the samples were audited to the same depth. `is_floor`
 * on a sample means only part of it has been re-checked, and comparing a complete
 * audit against a floor as if they were peers is a bigger error than either number.
 */
export function renderComparison(samples: FitnessSample[]): string {
  if (samples.length < 2) return "";
  const complete = samples.filter((s) => !s.is_floor);
  const floors = samples.filter((s) => s.is_floor);

  // ⚠️ A FLOOR WITH ZERO CONFIRMED IS NOT A NUMBER TO COMPARE AGAINST, and this branch
  // exists because the arithmetic quietly produced the very claim the paragraph below it
  // was written to retire. Once rule D closed every identifier defect in the general
  // sample, x went to 0 and the rule-of-three bound came out at 0.85% against a coffee
  // bound of 10.97% — a ratio of nearly 13, which this function would have rendered as
  // "by an order of magnitude": the exact sentence v3.2 corrected, revived by a fix.
  //
  // x=0 over an audit that examined ONE class is not an estimate of the error rate. It is
  // an estimate of what the audit thought to look for, which is precisely how a published
  // 0.83% survived eighteen false passes. So no ratio is drawn at all.
  const emptyFloors = floors.filter((s) => s.confirmed_false_positives === 0);
  if (emptyFloors.length) {
    return `<p class="std-limit"><strong>No comparison is drawn between these samples, and the reason is the more useful finding.</strong> The ${
      esc(emptyFloors.map((s) => s.label).join(" and the "))} now records ZERO confirmed false passes — in the one defect class that has ever been mechanically re-checked. Every other class in that sample is unexamined. That is not a low error rate; it is the same epistemic position that produced a 0.83% figure this project published for weeks and then found eighteen errors inside. A ratio between a complete row-by-row audit and an x=0 floor would be arithmetic, not a measurement, so none is stated.</p>`;
  }

  // ⚠️ AND THE SAME REFUSAL, GENERALISED — because closing one sample's audit gap put the
  // ratio right back in reach. The branch above only fires while a floor sits at x=0. At
  // v3.7 the general sample stopped being a floor: every one of its 488 pass rows was
  // adjudicated individually, 18 confirmed false passes were found where the floor recorded
  // 0, and its bound went from 0.85% to 7.53%. With no floor left, the arithmetic below
  // resumes and would have rendered "the coffee bound is higher by about 1.3×" plus "the
  // number that matters to a merchant is the one measured on their own category".
  //
  // Both sentences are unsupported. Audited to the same depth for the first time, the two
  // samples' 95% intervals OVERLAP — the general interval lies inside the coffee one — so
  // no difference is demonstrated at all. A ratio between two overlapping intervals is
  // arithmetic, not a measurement, and this is the fourth version of the same sentence this
  // project has had to retire (an order of magnitude at v3.1, about 1.6× at v3.2, revived
  // by a fix at v3.5). The refusal is now on the INTERVALS rather than on a flag, which is
  // the only form that survives a future sample of any shape.
  const withIv = samples.filter((s) => s.interval_95);
  if (withIv.length >= 2) {
    const overlapping: Array<[FitnessSample, FitnessSample]> = [];
    for (let i = 0; i < withIv.length; i++) {
      for (let j = i + 1; j < withIv.length; j++) {
        const A = withIv[i]!, B = withIv[j]!;
        const a = A.interval_95!, b = B.interval_95!;
        if (!(a.lower_pct > b.upper_pct || b.lower_pct > a.upper_pct)) overlapping.push([A, B]);
      }
    }
    if (overlapping.length) {
      const [A, B] = overlapping[0]!;
      return `<p class="std-limit"><strong>No difference is stated between these samples, because their intervals overlap.</strong> ${
        esc(A.label)} is ${A.point_estimate_pct.toFixed(2)}% (95% ${A.interval_95!.lower_pct.toFixed(2)}–${A.interval_95!.upper_pct.toFixed(2)}%) and ${
        esc(B.label)} is ${B.point_estimate_pct.toFixed(2)}% (95% ${B.interval_95!.lower_pct.toFixed(2)}–${B.interval_95!.upper_pct.toFixed(2)}%). ${
        A.audit?.row_by_row !== false && B.audit?.row_by_row !== false
          ? "Both have now had every passing row adjudicated individually, which is the first time the two have been audited to the same depth — and at equal depth they are statistically indistinguishable. "
          : ""}Every earlier version of the claim that a category sample and a general sample differ was measuring AUDIT DEPTH rather than category: a general figure of 0.83% became 7.80% when one defect class was checked mechanically, and the general sample's remaining rate was unmeasured until every row was read. A ratio between overlapping intervals would be arithmetic, so none is stated.</p>`;
    }
  }

  const hi = [...samples].sort((a, b) => b.bound_95_cluster_icc02_pct - a.bound_95_cluster_icc02_pct)[0]!;
  const lo = [...samples].sort((a, b) => a.bound_95_cluster_icc02_pct - b.bound_95_cluster_icc02_pct)[0]!;
  const ratio = lo.bound_95_cluster_icc02_pct > 0 ? hi.bound_95_cluster_icc02_pct / lo.bound_95_cluster_icc02_pct : 0;
  const size = ratio >= 8 ? "by an order of magnitude" : ratio >= 2 ? `by more than ${Math.floor(ratio)}×` : `by about ${ratio.toFixed(1)}×`;

  const out = [p(`The ${esc(hi.label)} bound is higher than the ${esc(lo.label)} bound ${size}. A general sample estimates the error rate on copy that looks like the average of every category at once, which is copy no individual merchant writes — so the number that matters to a merchant is the one measured on their own category.`)];

  if (floors.length && complete.length) {
    out.push(`<p class="std-limit"><strong>These two are not audited to the same depth, and the difference matters more than the gap between them.</strong> ${
      esc(complete.map((s) => s.label).join(" and "))} had every passing row read individually. ${
      esc(floors.map((s) => s.label).join(" and "))} is a FLOOR: one defect class was checked mechanically and found ${
      floors.reduce((n, s) => n + s.confirmed_false_positives, 0)} errors that a full read of the rendered rows had already missed. Its true rate is at least what is shown and probably higher, so the two columns are not a like-for-like comparison and the gap between them is not a measurement.</p>`);
  }
  return out.join("");
}

/** The scalar rendering of an assertion's `expected`, which is a boolean or a string
 *  on a direct assertion and an object on a DERIVED one. */
function expectedText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return Array.isArray(v) ? v.join(", ") : "(derived — see below)";
  return String(v);
}

/** The grounding citations for an entry. See the note on `StandardEntry.grounding`. */
export function groundingOf(e: StandardEntry): Array<{ source?: string; url?: string; kind?: string; establishes?: string }> {
  return e.grounding?.citations ?? e.grounding?.sources ?? [];
}

/**
 * The document's own posture, VERBATIM.
 *
 * ⚠️ THIS IS THE MOST IMPORTANT PARAGRAPH ON THE SITE AND IT IS NOT OURS TO SOFTEN.
 * The coffee standard's `status` is `draft`, and its posture statement says in as
 * many words that it "has never been applied to a real store by anyone" and is "a
 * rubric with a versioned changelog, not a standard". Publishing it under a heading
 * that calls it a finished standard would make the site's first claim about itself a
 * false one — on a site whose subject is claim discipline. So the artifact's own
 * words are rendered, unedited, above everything else.
 */
function postureHtml(doc: StandardDoc): string {
  const po = doc.posture;
  const statement = typeof po === "string" ? po : po?.statement;
  const status = doc.status ?? "unstated";
  return `<aside class="std-posture" role="note">
  <p class="std-status"><strong>Status: ${esc(status.replace(/_/g, " "))}</strong></p>
  ${statement ? p(statement) : ""}
</aside>`;
}

/**
 * The supersession notice, added AT RENDER TIME and never by editing the document.
 *
 * v1.0 keeps serving its original bytes forever — that is what a content hash promises,
 * and every citation already made against it resolves through those bytes. But a reader
 * who lands on it should not have to discover from the version list that a newer one
 * exists, so the notice lives here, in the registry-driven renderer, where it changes
 * nothing that is hashed.
 */
function supersessionHtml(s: PublishedStandard): string {
  if (!s.supersededBy) return "";
  const href = `/standards/${s.slug}/${s.supersededBy}`;
  return `<aside class="std-superseded" role="note">
  <p><strong>Superseded by v${esc(s.supersededBy)}.</strong> This version is served exactly as it was published, byte for byte, because a citation made against it resolves through its content hash. Nothing here has been edited — including the parts it gets wrong about itself, which is what v${esc(s.supersededBy)} corrects. <a href="${esc(href)}">Read v${esc(s.supersededBy)} →</a></p>
</aside>`;
}

/** The artifact's title is a full descriptive sentence ("… — buyer questions,
 *  assertions and evidence rules for roasted coffee product pages"), which makes an
 *  unusable <title> and a worse breadcrumb. The short name is the part before the
 *  em dash; the full title is still published on the page itself. */
export function shortName(doc: StandardDoc): string {
  return String(doc.title ?? "").split("—")[0]!.trim() || String(doc.standard_id ?? "standard");
}

function tierCounts(doc: StandardDoc): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const e of doc.entries) m.set(e.tier, (m.get(e.tier) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/** Reading order: what runs, then what we have not finished, then what was measured to
 *  carry no information, then what is not a test, then what the engine cannot do. */
const TIER_ORDER = ["executable", "unbound", "not_discriminating", "advisory", "blocked"] as const;

/**
 * Every tier in the document, in reading order — AND NEVER FEWER.
 *
 * ⚠️ THIS USED TO BE `TIER_ORDER.filter(t => present(t))`, WHICH SILENTLY DELETES A TIER
 * THE LIST HAS NOT HEARD OF. Grammar 1.2 added `unbound`, and under the old code its five
 * entries would have vanished from the table of contents AND from the body of the page —
 * rendering nothing, which looks exactly like a document that has no such entries. A
 * conformance list that drops rows without saying so is the failure G-10 exists to
 * prevent; the renderer must not commit it either. Unknown tiers are appended, so the
 * worst case is an unstyled section rather than a missing one.
 */
export function orderedTiers(doc: StandardDoc): Array<[string, number]> {
  const counts = tierCounts(doc);
  const known = TIER_ORDER
    .filter((t) => counts.some(([k]) => k === t))
    .map((t) => [t as string, counts.find(([k]) => k === t)![1]] as [string, number]);
  const unknown = counts.filter(([k]) => !(TIER_ORDER as readonly string[]).includes(k));
  return [...known, ...unknown];
}

// ---- the rendered fragments ------------------------------------------------

export interface SitePage {
  title: string;
  description: string;
  canonical: string;
  jsonLd: string;
  bodyHtml: string;
}

function frontMatter(s: PublishedStandard): string {
  const total = s.doc.entries.length;
  return `<section class="std-front" aria-label="Standard front matter">
  <dl class="std-meta">
    <div><dt>Standard</dt><dd>${esc(s.doc.standard_id)}</dd></div>
    <div><dt>Version</dt><dd>${esc(s.doc.version)}</dd></div>
    <div><dt>Status</dt><dd>${esc((s.doc.status ?? "published").replace(/_/g, " "))}</dd></div>
    <div><dt>Content hash</dt><dd><code>${esc(s.hash)}</code></dd></div>
    <div><dt>Entries</dt><dd>${total}</dd></div>
    <div><dt>Independently applied</dt><dd>No</dd></div>
  </dl>
  <p class="std-note"><strong>Independently applied: no.</strong> We wrote this standard and we run it; no third party has applied it to a store. That is a limit on what a pass here is worth, and it is stated because a site about claim discipline cannot make its first unchecked claim about itself.</p>
</section>`;
}

/**
 * THE TABLE OF CONTENTS — the thing whose absence made this document unusable.
 *
 * Before v3.3 a reader met a giant H1, four sentences of self-negation and a metadata
 * card, and then 42 entries with no way to navigate them. The document was legible in
 * the literal sense and unusable in every other. This is a jump table with the tier
 * split visible immediately, above the entries, and it doubles as the split itself —
 * one structure rather than a summary table AND a list that can disagree.
 *
 * No JavaScript: same-page fragment links, which work with the bundle absent and are
 * what a citation like `#ALS-COFFEE-1.1-CERT-002` needs anyway.
 */
function tableOfContents(s: PublishedStandard): string {
  const total = s.doc.entries.length;
  const ordered = orderedTiers(s.doc);

  const cards = ordered.map(([t, n]) => `<li class="std-toc-tier std-tier-${esc(t)}">
    <a href="#tier-${esc(t)}"><strong>${n}</strong> <span>${esc(TIER_LABEL[t] ?? t)}</span></a>
    <p>${esc(TIER_WHY[t] ?? "")}</p>
  </li>`).join("");

  const groups = ordered.map(([t]) => {
    const items = s.doc.entries.filter((e) => e.tier === t).map((e) =>
      `<li><a href="#${esc(e.id)}"><code>${esc(e.id.replace(/^ALS-[A-Z]+-[0-9.]+-/, ""))}</code> ${esc(e.question)}</a></li>`).join("");
    return `<div class="std-toc-group"><h3><a href="#tier-${esc(t)}">${esc(TIER_LABEL[t] ?? t)}</a></h3><ol>${items}</ol></div>`;
  }).join("");

  return `<nav class="std-toc" aria-label="Contents">
  <h2 id="contents">What is in here — ${total} entries</h2>
  <ul class="std-toc-tiers">${cards}</ul>
  <p class="std-note">${esc(`${ordered.find(([t]) => t === "executable")?.[1] ?? 0} of ${total} run against a public product page today. The rest are published with the reason each one does not, because the second number is the one you need in order to know what a passing result did not cover.`)}</p>
  <details class="std-toc-all"><summary>Every entry, by tier</summary>${groups}</details>
</nav>`;
}

/** The measured error bounds — the single most checkable thing on the site, and the
 *  one no competitor can copy without first measuring themselves. */
/**
 * MEASURED VERSUS PREDICTED, as a table rather than as prose.
 *
 * Three numbers this document must not run together, because they answer three
 * different questions and the brief that asked for this page ran two of them together:
 *
 *   bands held        — how often the PREDICTION was right (1 of 10)
 *   above band        — how many discriminate LESS than predicted (8 of 10)
 *   carries information — how many MEASURED rates sit inside the grammar's own 15-85%
 *                       target band (4 of 10)
 *
 * "Above its predicted band" and "carries no information" are not the same claim.
 * FORMAT-001 measured 73.7% against a predicted 30-60% — above its band, and still
 * squarely inside the band where an answer discriminates. Every figure below is derived
 * from the artifact; none is typed.
 */
const shortId = (id: string) => id.replace(/^ALS-[A-Z]+-[0-9.]+-/, "");

/**
 * GRAMMAR 1.2's discrimination table — a MEASURED VERDICT, decided by the interval.
 *
 * ⚠️ WHY THIS IS A SEPARATE TABLE AND NOT A COLUMN ADDED TO THE ONE BELOW. The 1.0/1.1
 * table answers "did the authored BAND hold?" and counts `held` / `above_band`. v1.2
 * carries no bands at all, so running its rows through that table publishes
 * "0 of 10 predictions held" — a derived-looking sentence about a field the document
 * does not have. It also renders a `Discriminates: yes/no` column computed from the
 * POINT ESTIMATE, which contradicts the artifact's own verdict on SOURCE-001: 89% is
 * outside the band, so the column says "no", while the interval says `indeterminate`,
 * which is not "no". A page disagreeing with its own JSON is the defect this whole file
 * is built against, so the verdict is published as the artifact recorded it and nothing
 * is recomputed here.
 */
function verdictTable(s: PublishedStandard, rows: Array<{ e: StandardEntry; m: EntryDiscrimination }>): string {
  const count = (v: string) => rows.filter((x) => x.m.verdict === v).length;
  const bands = new Set(rows.map((x) => x.m.target_band ? `${x.m.target_band.lower_pct}-${x.m.target_band.upper_pct}%` : ""));
  const band = bands.size === 1 ? [...bands][0]! : "";
  const undecided = rows.filter((x) => x.m.verdict === "indeterminate");
  const blocked = rows.filter((x) => (x.m.instrument_bias ?? []).length > 0 && x.m.verdict === "not_discriminating");

  const body = rows.map(({ e, m }) => `<tr>
    <th scope="row"><a href="#${esc(e.id)}"><code>${esc(shortId(e.id))}</code></a></th>
    <td>${m.fail_pct.toFixed(1)}%</td>
    <td>${m.interval ? `${m.interval.lower_pct.toFixed(1)} – ${m.interval.upper_pct.toFixed(1)}%` : "—"}</td>
    <td>${m.fail_count ?? "—"} / ${m.adjudicated ?? m.asked}${
    m.adjudicated !== undefined && m.adjudicated !== m.asked
      ? ` <span class="std-eg">(${m.asked - m.adjudicated} of ${m.asked} undecided by the engine, excluded)</span>` : ""}</td>
    <td class="std-verdict-${esc(String(m.verdict ?? ""))}">${esc(VERDICT_LABEL[String(m.verdict)] ?? String(m.verdict ?? "—"))}</td>
  </tr>`).join("");

  return `<section class="std-discrimination" id="discrimination">
  <h2>Measured discrimination, entry by entry</h2>
  ${p(`Each executable entry was run against the same recorded sample and its failure rate given a 95% interval${band ? `, then compared with the ${band} target band` : ""}. THE INTERVAL DECIDES, not the point estimate — a rate outside the band whose interval straddles the edge has established nothing, and saying so is the difference between a measurement and a number.`)}
  <table class="std-bounds"><caption>Fail rate, 95% interval and verdict per entry</caption>
    <thead><tr>
      <th scope="col">Entry</th><th scope="col">Fail rate</th><th scope="col">95% interval</th>
      <th scope="col">Failed / adjudicated</th><th scope="col">Verdict</th>
    </tr></thead>
    <tbody>${body}</tbody></table>
  <p><strong>${count("discriminating")} discriminating · ${count("indeterminate")} undecided · ${count("not_discriminating")} not discriminating</strong>, of ${rows.length} measured entries.</p>
  ${Object.entries(VERDICT_WHY).map(([v, why]) =>
    `<p class="std-note"><strong>${esc(VERDICT_LABEL[v] ?? v)}</strong> — ${esc(why)}.</p>`).join("")}
  ${undecided.length ? `<p class="std-limit"><strong>${undecided.length} of ${rows.length} decided nothing, and that is published rather than rounded to a decision.</strong> ${
    esc(`${undecided.map((x) => `${shortId(x.e.id)} at ${x.m.fail_pct.toFixed(1)}% (95% interval ${x.m.interval ? `${x.m.interval.lower_pct.toFixed(1)}–${x.m.interval.upper_pct.toFixed(1)}%` : "unstated"})`).join(", ")}. An undecided result is "no difference detectable at this n", which is not "no difference".`)
  }</p>` : ""}
  ${blocked.length ? `<p class="std-limit"><strong>${blocked.length} of the ${count("not_discriminating")} not-discriminating verdicts MAY NOT BE ACTED ON</strong>, and this document says so instead of working around it: ${
    esc(blocked.map((x) => shortId(x.e.id)).join(", "))}. A confidence interval bounds sampling error and nothing else, and each of these was measured with a known bias in the instrument pointing at the very band edge its interval cleared. None of the entries below has been retired. ${
    esc("A measured verdict is EVIDENCE for a retirement decision; it is not the decision.")}</p>` : ""}
</section>`;
}

function discriminationTable(s: PublishedStandard): string {
  const rows = s.doc.entries
    .map((e) => ({ e, m: measuredOf(s, e) }))
    .filter((x): x is { e: StandardEntry; m: EntryDiscrimination } => x.m !== null);
  if (!rows.length) return "";
  // Split rather than pick a winner: a document that somehow carried both would render
  // both tables, which is visibly odd, instead of silently dropping half its rows.
  const verdicts = rows.filter((x) => x.m.kind === "discrimination");
  const calibration = rows.filter((x) => x.m.kind === "band_calibration");
  if (!calibration.length) return verdictTable(s, verdicts);
  // A second `id="discrimination"` on one page is a broken anchor, not a duplicate
  // heading — the citation that lands on it picks whichever the browser finds first.
  return verdicts.length
    ? verdictTable(s, verdicts) + bandCalibrationTable(calibration, "discrimination-bands")
    : bandCalibrationTable(calibration, "discrimination");
}

function bandCalibrationTable(rows: Array<{ e: StandardEntry; m: EntryDiscrimination }>, anchor = "discrimination"): string {
  const inBand = (pct: number) => pct >= 15 && pct <= 85;
  const held = rows.filter((x) => x.m.verdict === "held").length;
  const above = rows.filter((x) => x.m.verdict === "above_band").length;
  const carries = rows.filter((x) => inBand(x.m.fail_pct));

  const body = rows.map(({ e, m }) => `<tr>
    <th scope="row"><a href="#${esc(e.id)}"><code>${esc(e.id.replace(/^ALS-[A-Z]+-[0-9.]+-/, ""))}</code></a></th>
    <td>${m.fail_pct.toFixed(1)}%</td>
    <td>${esc(m.predicted_band ?? "—")}</td>
    <td>${esc((m.verdict ?? "").replace(/_/g, " "))}</td>
    <td>${m.asked}</td>
    <td>${inBand(m.fail_pct) ? "yes" : "no"}</td>
  </tr>`).join("");

  return `<section class="std-discrimination" id="${esc(anchor)}">
  <h2>Measured against predicted, entry by entry</h2>
  ${p("The bands were written before this standard had ever run. They are kept exactly as authored and shown beside what actually happened, because a document that shows its own hypothesis failing is making a stronger case that its numbers are measured than one whose predictions all came true.")}
  <table class="std-bounds"><caption>Fail rate per entry, over the products each entry was asked</caption>
    <thead><tr>
      <th scope="col">Entry</th><th scope="col">Measured</th><th scope="col">Predicted</th>
      <th scope="col">Verdict</th><th scope="col">Asked</th><th scope="col">Discriminates</th>
    </tr></thead>
    <tbody>${body}</tbody></table>
  <p><strong>${held} of ${rows.length}</strong> predictions held. <strong>${above} of ${rows.length}</strong> came in above their band, which means those entries discriminate <em>less</em> than predicted, not more.</p>
  <p class="std-limit"><strong>Discrimination and conformance are different questions, and only one of them is about whether an entry belongs here.</strong> ${
    esc(`${carries.length} of ${rows.length} entries have a measured fail rate inside the 15-85% band where an answer carries information: ${carries.map((x) => `${x.e.id.replace(/^ALS-[A-Z]+-[0-9.]+-/, "")} at ${x.m.fail_pct.toFixed(1)}%`).join(", ")}.`)
  } The others are failed by almost every store, so they separate nobody from anybody — and they are still legitimate requirements, because whether the page states the thing is still what a buyer needs settled. Nothing is deleted for discriminating poorly.</p>
</section>`;
}

/**
 * The defect classes behind a sample's confirmed errors.
 *
 * ⚠️ TWO SHAPES, AND ASSUMING ONE OF THEM REPRODUCED THE `grounding.sources` DEFECT
 * VERBATIM. v1.0's sidecar stores these as prose STRINGS with the count written into
 * the sentence; grammar 1.1 stores them as objects with `klass`, `count`, `example` and
 * `addressed_by_a_guard`. A renderer written for the object shape read `c.klass` off a
 * string, got `undefined`, and published four table rows reading "undefined" on the
 * v1.0 page — the same failure this file's header already documents for `grounding`,
 * introduced again, one version later, by the same reflex. The blanket
 * "no page renders undefined" assertion is what caught it; nothing else would have.
 *
 * `addressed_by_a_guard: false` is the interesting value in the object shape and the
 * reason the list is published at all: it says out loud that the engine has no
 * mechanism for that class, instead of leaving a reader to assume every known error has
 * been fixed.
 */
/**
 * The blended bound, decomposed by requirement kind.
 *
 * ⚠️ PUBLISHED AS COUNTS WITH INTERVALS, NEVER AS SIX RATES, and that is the whole
 * decision. A merchant reading one blended number and getting a price row deserves to
 * know that price rows carry 14 of the 18 known errors in this sample — that is a COUNT,
 * and it is a fact. What the cells do not support is a spread: see `renderSeparation`.
 * A six-cell table of percentages read as six rates would be false precision, which is
 * worse than the blend it decomposes.
 *
 * Three refusals are rendered rather than smoothed over, because each marks a place the
 * published method stops working and a reader would otherwise assume it had not:
 *   • a Poisson-upper/n figure above 100 is not a rate and is refused, not clamped;
 *   • a cluster adjustment where rows-per-store is exactly 1 is not an adjustment;
 *   • an interval spanning more than 20 points cannot be read as a rate at all.
 */
function renderPerKind(x: FitnessSample): string {
  const ks = x.per_kind ?? [];
  if (!ks.length) return "";
  const iv = (i?: { lower_pct: number; upper_pct: number }) => (i ? `${i.lower_pct.toFixed(1)}–${i.upper_pct.toFixed(1)}%` : "—");
  const pct = (v?: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
  const rows = ks.map((c) => `<tr>
    <th scope="row"><code>${esc(c.kind)}</code></th>
    <td>${c.entries ?? "—"}</td><td>${c.pass_rows}</td><td>${c.stores}</td>
    <td>${c.confirmed_false_positives == null ? "<strong>null</strong>" : c.confirmed_false_positives}</td>
    <td>${c.borderline_counted_as_passes ?? "—"}</td>
    <td>${pct(c.point_estimate_pct)}</td>
    <td>${iv(c.interval_95)}${c.underpowered ? " <abbr title=\"the interval spans more than 20 points — this cell cannot be separated from its neighbours and must not be read as a rate\">⚠️</abbr>" : ""}</td>
    <td>${c.bound_95_naive_refused ? "<em>refused</em>" : pct(c.bound_95_naive_pct)}</td>
    <td>${c.cluster_adjustment_refused ? "<em>refused</em>" : pct(c.bound_95_cluster_icc02_pct)}</td>
    <td>${esc(String(c.completion_state ?? "—"))}</td>
  </tr>`).join("");
  const refusals = [
    ...new Set(ks.map((c) => c.bound_95_naive_refused).filter(Boolean) as string[]),
    ...new Set(ks.map((c) => c.cluster_adjustment_refused).filter(Boolean) as string[]),
  ];
  return `<table class="std-bounds"><caption>${esc(x.label)} — the bound decomposed by requirement kind</caption>
    <thead><tr><th scope="col">Kind</th><th scope="col">Entries</th><th scope="col">Pass rows</th><th scope="col">Stores</th><th scope="col">Confirmed</th><th scope="col">Borderline</th><th scope="col">Point</th><th scope="col">95% interval</th><th scope="col">Naive P95 upper</th><th scope="col">Cluster-adjusted</th><th scope="col">State</th></tr></thead>
    <tbody>${rows}</tbody></table>${refusals.map((r) => `<p class="std-note">Refused: ${esc(r)}</p>`).join("")}`;
}

/**
 * Whether the per-kind cells separate at all — the statement the table above needs, and
 * the reason it is published as counts.
 *
 * Two kinds count as separable only when their 95% intervals do not overlap, which is the
 * conservative test. `pairs_tested` is rendered beside `pairs_separated` on purpose: a
 * separation test that silently tested nothing returns "0 separated", which reads exactly
 * like "nothing separates", and this session's own first run of it did precisely that.
 */
function renderSeparation(f: FitnessDoc): string {
  const sep = f.per_kind_separation;
  if (!sep || !Object.keys(sep).length) return "";
  const parts = Object.entries(sep).map(([name, s]) => {
    if (!s.pairs_tested) return `<li><strong>${esc(name)}: the test did not run</strong> — 0 pairs tested, which is not the same answer as "nothing separates".</li>`;
    const detail = s.pairs_separated
      ? `${s.pairs_separated} of ${s.pairs_tested} pairs separate, the widest by <strong>${(s.widest_separation_pp ?? 0).toFixed(2)} percentage points</strong>${
          s.separated?.length ? ` (${s.separated.map((x) => `<code>${esc(x.a)}</code> vs <code>${esc(x.b)}</code>`).join(", ")})` : ""}.`
      : `none of the ${s.pairs_tested} pairs separates.`;
    return `<li>${esc(name)}: ${detail}</li>`;
  });
  return `<div class="std-classes"><h4>Do the kinds differ from each other?</h4>
  ${p("Two kinds are reported as different only when their 95% intervals do not overlap. That is the conservative test, and it is the one that matters: a spread stated on point estimates is a spread stated on nothing.")}
  <ul>${parts.join("")}</ul>
  ${p("So the decomposition does not support a spread at these sample sizes. It is published as counts — which kind the known errors are actually in — rather than as a set of rates, because a table of six percentages invites a comparison the intervals refuse.")}</div>`;
}

function defectClasses(x: FitnessSample): string {
  const cs = x.defect_classes ?? [];
  if (!cs.length) return "";
  const caption = `What the ${esc(x.label.toLowerCase())}'s ${x.confirmed_false_positives} wrong passes actually were`;
  // The prose shape (v1.0's sidecar): a list, because there are no fields to tabulate.
  if (cs.every((c) => typeof c === "string")) {
    return `<div class="std-classes"><h4>${caption}</h4><ul>${(cs as unknown as string[]).map(li).join("")}</ul></div>`;
  }
  type Klass = { klass: string; count: number; example: string; addressed_by_a_guard?: boolean };
  const rows = cs.filter((c): c is Klass => Boolean(c) && typeof c === "object").map((c) => `<tr>
    <th scope="row">${esc(c.klass)}</th><td>${c.count}</td>
    <td><q>${esc(c.example)}</q></td>
    <td>${c.addressed_by_a_guard === false ? "<strong>no</strong>" : c.addressed_by_a_guard === true ? "yes" : "—"}</td>
  </tr>`).join("");
  if (!rows) return "";
  return `<table class="std-bounds"><caption>${caption}</caption>
    <thead><tr><th scope="col">Class</th><th scope="col">n</th><th scope="col">Example</th><th scope="col">Addressed by a guard</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/**
 * GRAMMAR 1.2's defects, as INDIVIDUAL ROWS with the counts derived from them.
 *
 * 1.1 published aggregated `defect_classes` — a class name, a count and one example.
 * 1.2 publishes every confirmed false pass with the store it came from, the evidence the
 * engine matched, and why that was wrong. The per-entry counts below are counted from
 * the list rather than carried beside it, so a summary can no longer disagree with the
 * rows behind it, and the total is reconciled against `confirmed_false_positives` ON THE
 * PAGE: a class list accounting for fewer errors than the sample records is a partial
 * explanation presented as a complete one.
 */
function defectRows(x: FitnessSample): string {
  const ds = x.defects ?? [];
  if (!ds.length) return "";
  const byEntry = new Map<string, number>();
  for (const d of ds) byEntry.set(d.entry_id ?? "(unattributed)", (byEntry.get(d.entry_id ?? "(unattributed)") ?? 0) + 1);
  const perEntry = [...byEntry].sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${shortId(id)} ${n}`).join(" · ");
  const specific = ds.filter((d) => d.category_specific === true).length;
  const unaddressed = ds.filter((d) => d.status === "pinned_known_gap").length;

  const rows = ds.map((d) => `<tr>
    <th scope="row"><code>${esc(shortId(d.entry_id ?? ""))}</code></th>
    <td>${esc(d.evidence ?? "")}</td>
    <td>${esc(d.why_wrong ?? "")}</td>
    <td>${d.category_specific === true ? "category-specific" : d.category_specific === false ? "general" : "—"}</td>
    <td>${d.status === "pinned_known_gap" ? "<strong>no guard addresses it</strong>" : esc(String(d.status ?? "—").replace(/_/g, " "))}</td>
  </tr>`).join("");

  return `<div class="std-classes">
  <h4>Every one of the ${ds.length} wrong passes, individually</h4>
  ${p(`${ds.length} confirmed, against ${x.confirmed_false_positives} recorded on the sample${
    ds.length === x.confirmed_false_positives ? " — the list accounts for all of them" : " — THESE DO NOT RECONCILE, and the shorter list is the incomplete one"}. Per entry: ${perEntry}. ${specific} of ${ds.length} fire on vocabulary this category's pages contain and a general DTC page does not; ${unaddressed} are pinned known gaps that no mechanism in the engine currently addresses.`)}
  <details><summary>Read all ${ds.length}, with the store, the evidence the engine matched, and why it was wrong</summary>
  <table class="std-bounds"><caption>Confirmed false passes</caption>
    <thead><tr><th scope="col">Entry</th><th scope="col">Store and matched evidence</th><th scope="col">Why it is wrong</th><th scope="col">Scope</th><th scope="col">Status</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </details>
</div>`;
}

/** Grammar 1.2's `limits` — published verbatim, because they are the artifact's own
 *  statement of what its number does NOT cover, and paraphrasing a limit weakens it. */
function limitsHtml(x: FitnessSample): string {
  if (!x.limits?.length) return "";
  return `<div class="std-limit"><h4>What this bound does NOT cover</h4><ul>${x.limits.map(li).join("")}</ul></div>`;
}

/** The sample this bound was measured on. `stores` here is the AUDIT's count and the
 *  artifact's own `notes` explain why it is lower than the run's — published rather than
 *  paraphrased, because substituting one store count for the other is the exact mistake
 *  the note exists to prevent. */
function provenanceHtml(x: FitnessSample): string {
  const s = x.provenance;
  if (!s) return "";
  const bits: string[] = [];
  if (s.products !== undefined) bits.push(`${s.products} products evaluated across ${s.stores} storefronts`);
  if (s.selection) bits.push(`selected by ${s.selection.replace(/_/g, " ")}`);
  if (s.deduplicated_by_brand) bits.push("deduplicated by brand before capture");
  if (s.applicability_gate_enforced) bits.push("the applicability gate enforced");
  if (s.excluded_out_of_category !== undefined) bits.push(`${s.excluded_out_of_category} excluded as out of category`);
  if (s.unclassifiable_refused !== undefined) bits.push(`${s.unclassifiable_refused} refused as unclassifiable`);
  if (s.captured_on) bits.push(`captured ${s.captured_on}`);
  return `<div class="std-method"><h4>The sample</h4>${bits.length ? p(`${bits.join("; ")}.`) : ""}${s.notes ? p(s.notes) : ""}${
    s.sample_id ? p(`Record: ${s.sample_id}`) : ""}</div>`;
}

/**
 * THE IDENTIFIER WORKED EXAMPLE — the one defect class a rendered-evidence audit
 * cannot see, shown as three real rows from three real stores.
 *
 * Why it belongs on the BOUND page and nowhere else. The identifiers row renders no
 * quote: it says "Your structured data publishes MPN" and shows the merchant nothing to
 * be suspicious of, so the row looks identical whether the value is a GS1 barcode or a
 * number the store minted about itself. A general sample of 507 rows was read
 * individually and reported ZERO false positives; one mechanical check of this single
 * class found eighteen in the same sample, and correcting them moved a bound this
 * project had published for weeks from 0.83% to 7.80%. That is not a story about a term
 * list — it is a story about what an audit method can and cannot see, which is exactly
 * what a page publishing its own error rate owes a reader.
 *
 * Every value below is read from `fixtures/identifiers/worked-example.json`, extracted
 * from the captured bytes of the three stores. Nothing here is typed.
 */
interface IdentifierRow {
  host: string; url: string; capturedAt: string; value: string;
  fields: string[]; verdict: string; why: string; excerpt: string; byteOffset: number;
  alsoAppearsAs?: string[];
  /** WHAT THE ENGINE DOES TODAY, executed against these same captured bytes by
   *  `experiments/v3-5/publish/stamp_ident_fixture.ts` — never typed. Two of these three
   *  rows passed when the section was written and one no longer does, and the paragraph
   *  saying "all three passing" stayed true-sounding and false through every sweep the
   *  site runs, because nothing in it is a banned word. */
  engine_now?: { status: string; detail: string };
}
interface IdentifierExample {
  requirement: string; why_it_matters: string; source: string;
  honest: IdentifierRow; storeLocal: IdentifierRow[];
  engine_checked_at?: string; engine_commit?: string;
}
let identCache: IdentifierExample | null | undefined;
function identifierExample(): IdentifierExample | null {
  if (identCache !== undefined) return identCache;
  try {
    identCache = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "fixtures/identifiers/worked-example.json"), "utf8"),
    ) as IdentifierExample;
  } catch { identCache = null; }   // absent ⇒ the section is absent, never invented
  return identCache;
}

/** `pass_evidenced` today, or not. Unstamped rows are `null` — "we did not check" is a
 *  third answer and must not render as either of the other two. */
const stillPasses = (r: IdentifierRow): boolean | null =>
  r.engine_now ? r.engine_now.status === "pass_evidenced" : null;

function identifierRowHtml(r: IdentifierRow, honest: boolean): string {
  const now = stillPasses(r);
  // The verdict LABEL is about the value; the STATE is about the engine. They came apart
  // the moment rule D shipped — a value can still be store-local while the row that used
  // to accept it no longer does — so they are rendered as two facts, not one.
  const state = now === null
    ? ""
    : now
      ? `<p class="std-note"><strong>The engine passes this row today.</strong> ${esc(r.engine_now!.detail)}</p>`
      : `<p class="std-note"><strong>The engine no longer passes this row.</strong> ${esc(r.engine_now!.detail)}</p>`;
  return `<div class="std-ident-row ${honest ? "std-ident-ok" : now === false ? "std-ident-closed" : "std-ident-bad"}">
  <h4>${esc(r.host)} — <code>${esc(r.value)}</code></h4>
  <p><strong>${esc(honest ? "Honest pass" : now === false ? "Was a false pass; now refused" : "False pass, still live")}:</strong> ${esc(r.why)}</p>
  ${state}
  <pre class="std-ident-bytes"><code>${esc(r.excerpt)}</code></pre>
  <p class="std-note">From the page captured on ${esc(r.capturedAt.slice(0, 10))}, at byte ${r.byteOffset}. Published in: ${
    r.fields.map((f) => `<code>${esc(f)}</code>`).join(", ")}.</p>
</div>`;
}

function identifierSection(): string {
  const ex = identifierExample();
  if (!ex) return "";
  const rows = [ex.honest, ...ex.storeLocal];
  const stamped = rows.filter((r) => r.engine_now);
  const passing = rows.filter((r) => stillPasses(r) === true).length;
  const closed = ex.storeLocal.filter((r) => stillPasses(r) === false).length;
  const live = ex.storeLocal.filter((r) => stillPasses(r) === true).length;
  // ⚠️ EVERY COUNT IN THE PROSE IS COUNTED. The sentence this replaced said "all three
  // passing that row", which was measured once and then went false when the engine
  // changed under it. A hand-written count beside generated rows is the same defect as a
  // hand-written comparison beside generated bounds.
  const lede = stamped.length !== rows.length
    ? p(`${rows.length} real stores, from the captured bytes of their own pages. What the engine currently answers for them has not been checked, so it is not stated.`)
    : p(`${rows.length} real stores, from the captured bytes of their own pages. All ${rows.length} passed this row when the example was built; ${passing} still ${passing === 1 ? "does" : "do"}. One of them always deserved to.`);
  const closing = closed && live
    ? `<p class="std-limit"><strong>${closed} of these ${ex.storeLocal.length} is closed and ${live} is still live, and the difference is the honest part.</strong> The engine now refuses an MPN that is byte-identical to the storefront's own product object id. It does NOT refuse one that is a copy of the store's own SKU: the rule that would (“an MPN equal to the SKU”) was scored over every MPN-publishing product in the corpus at 0 true positives and 7 false, and the seven are the compliant case — a brand that manufactures what it sells legitimately uses one string for both. Closing three sentences is not closing a class.</p>`
    : closed
      ? `<p class="std-limit"><strong>The engine now refuses every value shown here as a false pass.</strong> That closes the class this example was built to demonstrate; it does not close the audit method problem behind it.</p>`
      : `<p class="std-limit"><strong>This is why the general figure moved.</strong> An audit that reads rendered evidence — however many rows it reads — is structurally unable to see this class, because there is no rendered evidence to read.</p>`;
  return `<section class="std-ident" id="identifier-example">
  <h2>Worked example: the row that shows you nothing</h2>
  ${p(`“${ex.requirement}” is the one requirement in this standard whose result renders NO QUOTE. It reports that your structured data publishes an identifier; it cannot show you the identifier, so the row reads the same whether the value is a real barcode or a number the store made up about itself.`)}
  ${p(ex.why_it_matters)}
  ${lede}
  ${identifierRowHtml(ex.honest, true)}
  ${ex.storeLocal.map((r) => identifierRowHtml(r, false)).join("")}
  <p class="std-limit"><strong>This is the class an audit cannot see.</strong> There is no rendered evidence to be suspicious of, so a reader checking every row learns nothing from any of them. The store-local values above sat inside a sample of 507 rows that had been read individually and reported zero errors; one mechanical check against the captured bytes found eighteen, and the published bound moved from 0.83% to 7.80%.</p>
  ${closing}
  <p class="std-note">Record: ${esc(ex.source)}${ex.engine_checked_at ? ` · engine behaviour re-executed ${esc(ex.engine_checked_at)}${ex.engine_commit ? ` at ${esc(ex.engine_commit)}` : ""}` : ""}</p>
</section>`;
}

export function renderFitness(s: PublishedStandard): string {
  const f = fitnessOf(s);
  if (!f || !f.samples?.length) {
    return `<section class="std-fitness"><h2>Measured error</h2>${p("This standard has not yet been fitness-measured on a published sample. No bound is stated, because an unmeasured bound would be a guess presented as a number.")}</section>`;
  }
  const rows = f.samples.map((x) => `<tr>
    <th scope="row">${esc(x.label)}</th>
    <td>${x.stores}</td><td>${x.pass_rows_audited}</td><td>${x.confirmed_false_positives}</td>
    <td>${x.point_estimate_pct.toFixed(2)}%</td><td><strong>${x.bound_95_cluster_icc02_pct.toFixed(2)}%</strong></td>
  </tr>`).join("");
  // ⚠️ `methodOf`, NOT `x.method`. Grammar 1.2 has no method STRING — it records the audit
  // discipline as booleans — so reading the field directly renders an empty paragraph under
  // a "method" heading, which is the same "nothing looks like nothing to show" failure as
  // `grounding.sources`, merely quieter.
  const methods = f.samples.map((x) => {
    const completion = x.completion_state
      ? `<p class="std-limit"><strong>Completion state: ${esc(x.completion_state)}.</strong> ${esc(completionSentence(x))}</p>`
      : "";
    const spread = x.per_store_pct !== undefined
      ? p(`Per-store rate: ${x.per_store_pct.toFixed(2)}%${x.icc !== undefined ? `, clustered at ICC ${x.icc}` : ""} — pass rows are not independent, because rows from one store share that store's copy conventions.`)
      : "";
    return `<div class="std-method"><h3>${esc(x.label)} — method</h3>${p(methodOf(x))}${completion}${spread}${
      provenanceHtml(x)}${renderPerKind(x)}${defectClasses(x)}${defectRows(x)}${limitsHtml(x)}${
      x.source && !x.provenance ? p(`Record: ${x.source}`) : ""}</div>`;
  }).join("");
  const pending = f.pending && Object.keys(f.pending).length
    ? `<div class="std-pending">${Object.entries(f.pending).map(([k, v]) => p(`${k}: ${v}`)).join("")}</div>`
    : "";
  // ⚠️ THIS PARAGRAPH USED TO BE HAND-WRITTEN, AND IT WENT FALSE THE MOMENT THE
  // NUMBERS MOVED. It asserted the two bounds "differ by an order of magnitude" and
  // were produced "under the same audit discipline". After the v3.2 audit neither was
  // true: the ratio is under 2×, and one sample is a complete row-by-row audit while
  // the other is a floor from ONE mechanically-checked defect class. A sentence of
  // interpretation sitting next to generated numbers is the same "site disagrees with
  // its own JSON" defect one level up, so the comparison is now derived too.
  const shape = renderComparison(f.samples);
  // ⚠️ DERIVED, NOT ASSERTED. "Every row was audited individually" is a claim about the
  // audit, and grammar 1.2 records whether that is true as a field. A hand-written
  // sentence beside generated numbers is the "site disagrees with its own JSON" defect
  // one level up — it went false once already, on the paragraph below this one.
  const rowByRow = f.samples.every((x) => x.audit?.row_by_row !== false);
  // ⚠️ THE DOCUMENT'S OWN NUMBER IS NAMED, NOT QUIETLY REPLACED. `standard.json` is one
  // click away and carries a different figure; a page that shows only the later one and
  // says nothing is the "site disagrees with its own JSON" defect with the JSON linked
  // from the paragraph above.
  const d = f.supersededInDocument;
  const displaced = d
    ? `<p class="std-limit"><strong>This supersedes the measurement inside the document, and the document is not edited.</strong> <code>${esc(d.field)}</code> in <code>standard.json</code> records ${d.confirmed_false_positives} confirmed false passes over ${d.pass_rows_audited} audited rows — a ${d.bound_95_cluster_icc02_pct.toFixed(2)}% bound${d.measured_on ? `, measured ${esc(d.measured_on)}` : ""}. Its bytes are what a citation resolves through, so a measurement taken after publication goes beside the document rather than into it. ${d.reason ? esc(d.reason) : ""}</p>`
    : "";
  return `<section class="std-fitness" id="measured-error">
  <h2>Measured error</h2>
  ${p(`${rowByRow ? "Every row this standard passed was audited individually against its full evidence. " : ""}The bound is a 95% upper bound, cluster-adjusted at ICC 0.2 because pass rows are not independent — rows from one store share that store's copy conventions, and the bare rule of three would overstate the precision.`)}
  ${displaced}
  <table class="std-bounds"><caption>False-positive rate by sample</caption>
    <thead><tr><th scope="col">Sample</th><th scope="col">Stores</th><th scope="col">Pass rows audited</th><th scope="col">Confirmed false positives</th><th scope="col">Point estimate</th><th scope="col">95% upper bound</th></tr></thead>
    <tbody>${rows}</tbody></table>
  ${shape}${renderSeparation(f)}${methods}${pending}${renderCapabilityBlock()}
  <p class="std-note">Measured ${esc(f.measured_at)}${f.engine_version ? ` against engine ${esc(f.engine_version)}` : ""}.</p>
</section>`;
}

/**
 * THE CAPABILITY × FREQUENCY BLOCK — WIRED DARK ON PURPOSE (v3.9 CP-5).
 *
 * The content is measured, complete and pinned (`experiments/v3-9/CP5_STAGED_BLOCK.md`);
 * only the decision to publish is outstanding. It renders NOTHING unless
 * `STANDARDS_SHOW_CAPABILITY_BLOCK=1`, so shipping it later is a flag flip rather than a
 * rebuild, and the flag is not set anywhere.
 *
 * ⚠️ WHY IT IS DARK, and the second reason is the operative one:
 *   1. a v4.0 guard session is opening on the third row's shape, so the block would go
 *      stale on contact;
 *   2. **the third row is a bypass recipe for an unguarded weakness.** It names an attack
 *      that succeeds against the live matcher 40% of the time on chosen input, with
 *      confirmed false passes on real stores today. Published before the patch, that is a
 *      working recipe for making this engine certify a claim a product does not hold.
 *      Publication follows the patch or the pin, security-disclosure style.
 *
 * ⚠️ AND IT SHIPS WHOLE OR NOT AT ALL. Publishing the two DESCOPED rows while withholding
 * the open one was considered and REJECTED as selective disclosure: a table showing two
 * axes at "attacks well, occurs never" and silently omitting the third reads as a clean
 * bill of health, which is the pattern this site exists to oppose.
 *
 * The numbers are NOT inlined here. When the flag is flipped this must read them from a
 * generated artifact, for the reason the file's own header documents four times over: a
 * hand-written figure beside generated ones is how this page has gone false before.
 */
export function renderCapabilityBlock(): string {
  if (process.env.STANDARDS_SHOW_CAPABILITY_BLOCK !== "1") return "";
  // Deliberately not implemented. Reaching here means someone set the flag without
  // building the generated source, and an empty section reads exactly like a section with
  // nothing to show — the defect this file has shipped three times.
  throw new Error(
    "STANDARDS_SHOW_CAPABILITY_BLOCK is set, but the capability block has no generated " +
    "source yet. See experiments/v3-9/CP5_STAGED_BLOCK.md — the content is pinned; the " +
    "renderer must read it from an artifact rather than inline the figures.",
  );
}

function entryHref(s: PublishedStandard, id: string): string {
  return `/standards/${s.slug}/${s.publicVersion}/${encodeURIComponent(id)}`;
}

export function renderEntry(s: PublishedStandard, e: StandardEntry, base: string): SitePage {
  // ⚠️ `measuredOf`, NOT `s.fitness.entry_discrimination`. THIS LINE WAS THE FOURTH LIVE
  // INSTANCE of the defect this file's header documents, and it was shipped: `s.fitness`
  // is v1.0's SIDECAR, and v1.1 carries its measurement inside the document — so every
  // v1.1 entry page rendered "Predicted fail rate: 30-60% (predicted, not yet measured)"
  // for an entry the same document records as measured at 73.7%. Nothing threw and the
  // page looked complete. The normaliser existed the whole time and was not called here.
  const measured = measuredOf(s, e);
  const canonical = `${base}${entryHref(s, e.id)}`;
  const a = e.assertion;
  const pd = predictionOf(e);

  const accepted = (e.accepted_evidence ?? []).map((x) =>
    `<li><strong>${esc(x.surface ?? "any product surface")}</strong> — ${esc(x.form ?? "")}${x.example ? ` <span class="std-eg">e.g. ${esc(x.example)}</span>` : ""}</li>`).join("");
  // Given deliberate visual weight: nobody else publishes what does NOT count.
  const insufficient = (e.insufficient_evidence ?? []).map((x) =>
    `<li><strong>${esc(x.form ?? "")}</strong><br /><span class="std-why">${esc(x.why_not ?? "")}</span></li>`).join("");
  const conflicts = (e.conflict_rules ?? []).map((x) =>
    `<li><strong>When</strong> ${esc(x.when ?? "")} — <strong>then</strong> ${esc(x.resolution ?? "")}${x.precedence?.length ? ` <span class="std-eg">precedence: ${esc(x.precedence.join(" > "))}</span>` : ""}</li>`).join("");
  const grounding = groundingOf(e).map((x) =>
    `<li>${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.source ?? x.url)}</a>` : `<strong>${esc(x.source ?? "")}</strong>`}${x.kind ? ` <span class="std-eg">(${esc(x.kind)})</span>` : ""}${x.establishes ? `<br /><span class="std-why">${esc(x.establishes)}</span>` : ""}</li>`).join("");
  const gaps = Array.isArray(e.known_gaps)
    ? (e.known_gaps as Array<Record<string, unknown> | string>).map((g) =>
      typeof g === "string" ? li(g)
        : `<li>${esc((g as { corpus_case?: string }).corpus_case ?? "")}${(g as { effect?: string }).effect ? ` — <strong>${esc((g as { effect?: string }).effect)}</strong>` : ""}${(g as { note?: string }).note ? `<br /><span class="std-why">${esc((g as { note?: string }).note)}</span>` : ""}</li>`).join("")
    : "";

  const passMeans = typeof e.pass_means === "string"
    ? p(e.pass_means)
    : `${e.pass_means?.establishes ? `<p><strong>A pass establishes:</strong> ${esc(e.pass_means.establishes)}</p>` : ""}${e.pass_means?.does_not_establish ? `<p class="std-limit"><strong>A pass does NOT establish:</strong> ${esc(e.pass_means.does_not_establish)}</p>` : ""}`;

  // MEASURED beats predicted, and both are shown where both exist: a reader should be able
  // to see how far the hypothesis was off, which is most of what this standard has learned.
  //
  // ⚠️ AT GRAMMAR 1.2 THERE IS NO BAND, AND AN ABSENT BAND MUST NOT BE RENDERED AS AN
  // EMPTY ONE. The old code printed "Predicted fail rate: not stated (predicted, not yet
  // measured)" whenever the field was missing — on a version that carries measurements and
  // deliberately carries no prediction, that single line is false twice over. `predictionOf`
  // returns `band: undefined` at 1.2, so the row is omitted rather than emptied.
  const bias = measured?.instrument_bias ?? [];
  // THE DISPLACED MEASUREMENT, in full, including the biases declared on it. A later run
  // does not make the earlier record wrong about its own conditions, and folding the two
  // into one number would hide that the rate moved because the ENGINE changed rather than
  // because more stores were read.
  const prior = measured?.supersedes;
  const supersededHtml = prior
    ? `<details class="std-superseded-measure"><summary>This rate replaces an earlier one: ${prior.fail_pct.toFixed(1)}% (${
      prior.fail_count ?? "?"} of ${prior.adjudicated ?? prior.asked})</summary>
    ${prior.why ? p(prior.why) : ""}
    ${prior.verdict ? p(`Its verdict was ${VERDICT_LABEL[prior.verdict] ?? prior.verdict}${measured!.verdict === prior.verdict ? ", which is unchanged" : `, and the current verdict is ${VERDICT_LABEL[measured!.verdict ?? ""] ?? measured!.verdict}`}.`) : ""}
    ${(prior.instrument_bias ?? []).length
      ? `<p>The biases declared on that record, published unedited:</p><ul>${(prior.instrument_bias ?? []).map((b) => `<li><strong>${esc(String(b.direction ?? "").replace(/_/g, " "))}${b.magnitude_pp !== undefined ? `, ${b.magnitude_pp}pp` : ", UNQUANTIFIED"}</strong><br /><span class="std-why">${esc(b.source ?? "")}</span></li>`).join("")}</ul>`
      : ""}
    ${prior.note ? p(prior.note) : ""}
  </details>`
    : "";
  const measuredHtml = measured
    ? `<p><strong>Measured fail rate:</strong> ${measured.fail_pct.toFixed(1)}%${
      measured.fail_count !== undefined && measured.adjudicated !== undefined
        ? ` <span class="std-eg">(${measured.fail_count} of ${measured.adjudicated} adjudicated${
          measured.adjudicated !== measured.asked
            ? `; ${measured.asked - measured.adjudicated} of the ${measured.asked} rows it was asked returned "requires store access" and are excluded from the denominator, because counting an undecided row as a pass is a different measurement`
            : ""})</span>`
        : ` <span class="std-eg">(n=${measured.asked} products asked)</span>`}</p>`
      + (measured.interval ? `<p><strong>95% interval:</strong> ${measured.interval.lower_pct.toFixed(1)}% – ${measured.interval.upper_pct.toFixed(1)}%${
        measured.target_band ? `, against a ${measured.target_band.lower_pct}-${measured.target_band.upper_pct}% target band` : ""}${
        measured.decision_rule ? ` <span class="std-eg">(${esc(measured.decision_rule.replace(/_/g, " "))})</span>` : ""}</p>` : "")
      + (measured.kind === "discrimination" && measured.verdict
        ? `<p class="std-verdict-${esc(measured.verdict)}"><strong>Verdict: ${esc(VERDICT_LABEL[measured.verdict] ?? measured.verdict)}</strong> — ${esc(VERDICT_WHY[measured.verdict] ?? "")}.</p>`
        : "")
      + (measured.predicted_band ? `<p class="std-note">Predicted before this standard had ever run: ${esc(measured.predicted_band)}${measured.verdict === "held" ? " — held." : measured.verdict === "above_band" ? " — the real rate is higher, so the entry discriminates less than predicted." : " — the real rate is lower, so more stores pass than predicted."}</p>` : "")
      + (bias.length
        ? `<div class="std-limit"><h3>Declared bias in the instrument</h3><p>A 95% interval bounds SAMPLING error and nothing else. These are the known biases in the measuring instrument for this row, declared rather than netted — where two point in opposite directions and neither is quantified, combining them into one signed number would be a guess wearing a direction.</p><ul>${
          bias.map((b) => `<li><strong>${esc(String(b.direction ?? "").replace(/_/g, " "))}${
            b.magnitude_pp !== undefined ? `, ${b.magnitude_pp}pp` : ", UNQUANTIFIED"}</strong><br /><span class="std-why">${esc(b.source ?? "")}</span></li>`).join("")
        }</ul></div>`
        : "")
      + (measured.note ? p(measured.note) : "")
      + supersededHtml
    : "";
  const predictedHtml = !measured && pd?.band
    ? `<p><strong>Predicted fail rate:</strong> ${esc(pd.band)} <span class="std-eg">(predicted, not yet measured)</span></p>`
    : "";
  // At 1.2 the band is replaced by a direction and a confidence, both of which are
  // deliberately non-numeric. `no_prediction` is the honest first-class value, so it is
  // rendered as words rather than hidden.
  const directionHtml = pd?.direction
    ? `<p class="std-note"><strong>Authored expectation:</strong> ${esc(pd.direction.replace(/_/g, " "))}${
      pd.confidence ? `, confidence ${esc(pd.confidence)}` : ""}. The numeric band this standard used to carry is not published at this grammar version.</p>`
    : "";
  const discrimination = (pd || measured)
    ? `<section><h2>Discrimination</h2>
       ${measuredHtml}${predictedHtml}${directionHtml}
       ${pd?.reasoning ? p(pd.reasoning) : ""}${pd?.notes ? p(pd.notes) : ""}</section>`
    : "";

  // WHY THIS ENTRY IS NOT RUN, from whichever field this tier uses. `unbound_reason` is
  // grammar 1.2's and it says something the other two cannot: the obstacle is OURS.
  const notRun = e.unbound_reason ?? e.blocked_reason ?? e.not_executable_because;
  const notRunHtml = notRun
    ? `<section class="std-insufficient"><h2>${e.unbound_reason ? "Why this is not yet bound" : "Why this cannot be run"}</h2>${p(notRun)}${
      Array.isArray(e.blocked_by) && (e.blocked_by as string[]).length
        ? p(`Blocked by ${(e.blocked_by as string[]).join(", ")}.`) : ""}</section>`
    : (Array.isArray(e.blocked_by) && (e.blocked_by as string[]).length
      ? `<section class="std-insufficient"><h2>Why this cannot be run</h2>${p(`Blocked by ${(e.blocked_by as string[]).join(", ")}.`)}</section>`
      : "");

  const bodyHtml = `<article class="std-entry">
  <nav class="std-crumb"><a href="/standards">Standards</a> / <a href="/standards/${esc(s.slug)}/${esc(s.publicVersion)}">${esc(shortName(s.doc))}</a></nav>
  <p class="std-tier std-tier-${esc(e.tier)}">${esc(TIER_LABEL[e.tier] ?? e.tier)}</p>
  <h1>${esc(e.question)}</h1>
  <p class="std-id"><code>${esc(e.id)}</code></p>
  ${p(TIER_WHY[e.tier] ?? "")}
  ${notRunHtml}
  ${a ? `<section><h2>Assertion</h2><p><code>${esc(a.subject ?? "")} ${esc(a.operator ?? "")} ${esc(expectedText(a.expected))}</code></p>${
    // A DERIVED assertion's `expected` is itself an object — its inputs and the rule
    // that combines them. That is the most interesting part of the entry and it was
    // rendering as "[object Object]": the THIRD field in this artifact to do so.
    a.expected && typeof a.expected === "object" ? renderScalarish(a.expected) : ""
  }</section>` : ""}
  ${e.applicability ? `<section><h2>Applicability</h2>${renderScalarish(e.applicability)}</section>` : ""}
  ${accepted ? `<section><h2>Accepted evidence</h2><ul class="std-accept">${accepted}</ul></section>` : ""}
  ${insufficient ? `<section class="std-insufficient"><h2>Explicitly insufficient evidence</h2><p class="std-note">What does <em>not</em> count, and why. Published because the omission is where a check quietly becomes a claim.</p><ul>${insufficient}</ul></section>` : ""}
  ${conflicts ? `<section><h2>Conflict rules</h2><ul>${conflicts}</ul></section>` : ""}
  ${passMeans ? `<section><h2>What a pass licenses</h2>${passMeans}</section>` : ""}
  ${discrimination}
  ${gaps ? `<section><h2>Known gaps</h2><ul>${gaps}</ul></section>` : ""}
  ${e.consumer_note ? `<section><h2>For a shopper</h2>${p(e.consumer_note)}</section>` : ""}
  ${e.merchant_remediation ? `<section><h2>For a merchant</h2>${p(e.merchant_remediation)}</section>` : ""}
  ${grounding ? `<section><h2>Grounding</h2><ul class="std-grounding">${grounding}</ul></section>` : ""}
</article>`;

  return {
    title: `${e.question} — ${e.id}`,
    description: `${e.id}: ${e.question} Tier: ${TIER_LABEL[e.tier] ?? e.tier}. Accepted evidence, explicitly insufficient evidence, and what a pass does and does not license.`,
    canonical,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "TechArticle",
      identifier: e.id, headline: e.question, url: canonical, isPartOf: { "@type": "CreativeWork", name: s.doc.title, version: s.doc.version },
    })}</script>`,
    bodyHtml,
  };
}

export function renderStandard(s: PublishedStandard, base: string): SitePage {
  const canonical = `${base}/standards/${s.slug}/${s.publicVersion}`;
  const byTier = new Map<string, StandardEntry[]>();
  for (const e of s.doc.entries) {
    if (!byTier.has(e.tier)) byTier.set(e.tier, []);
    byTier.get(e.tier)!.push(e);
  }
  const sections = orderedTiers(s.doc).map(([t]) => {
    const items = byTier.get(t)!.map((e) => {
      const m = measuredOf(s, e);
      // ⚠️ PER-ENTRY ANCHORS. A citation is written as "your product pages fail
      // CERT-002", and a reader following it needs to land ON that line, not at the top
      // of a 42-entry page. `id` here is what makes `#ALS-COFFEE-1.1-CERT-002` work.
      const blocked = t === "blocked" && Array.isArray(e.blocked_by) && (e.blocked_by as string[]).length
        ? `<span class="std-eg">blocked by ${esc((e.blocked_by as string[]).join(", "))}${e.blocked_reason ? ` — ${esc(String(e.blocked_reason))}` : ""}</span>`
        : "";
      // The unbound reason is the ONLY thing that distinguishes this tier from `blocked`
      // at a glance, so it belongs in the list and not only on the entry page.
      const unbound = t === "unbound" && e.unbound_reason
        ? `<span class="std-why">${esc(e.unbound_reason)}</span>` : "";
      const rate = m
        ? `<span class="std-eg">${m.fail_pct.toFixed(1)}% of ${m.adjudicated ?? m.asked} adjudicated products did not state it${
          m.kind === "discrimination" && m.verdict ? ` — ${esc(VERDICT_LABEL[m.verdict] ?? m.verdict).toLowerCase()}` : ""}</span>`
        : "";
      return `<li id="${esc(e.id)}">
        <a href="${esc(entryHref(s, e.id))}"><code>${esc(e.id)}</code> — ${esc(e.question)}</a>
        ${rate}${blocked}${unbound}
      </li>`;
    }).join("");
    return `<section class="std-tier-group" id="tier-${esc(t)}">
      <h2>${esc(TIER_LABEL[t] ?? t)} <span class="std-eg">(${byTier.get(t)!.length})</span></h2>
      ${p(TIER_WHY[t] ?? "")}
      <ul class="std-entry-list">${items}</ul>
      <p class="std-note"><a href="#contents">Back to contents ↑</a></p>
    </section>`;
  }).join("");

  return {
    title: `${shortName(s.doc)} — ${s.doc.standard_id} v${s.doc.version}`,
    description: `${s.doc.title}. ${s.doc.entries.length} entries: the questions a competent buyer asks in this category, with accepted evidence, explicitly insufficient evidence, and what a pass does and does not license.`,
    canonical,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "Dataset",
      name: s.doc.title, identifier: s.doc.standard_id, version: s.doc.version, url: canonical,
      distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${canonical}/standard.json` }],
    })}</script>`,
    // ⚠️ THE H1 IS THE SHORT NAME, AND THE ARTIFACT'S FULL TITLE IS A SUBTITLE.
    // The artifact's `title` is a whole descriptive sentence — "… — buyer questions,
    // assertions and evidence rules for roasted coffee product pages" — which at 30px
    // wrapped to four tight lines and made the top of the page a wall. `shortName`
    // already existed for exactly this reason and was not being used here. The full
    // title is still published, immediately below, so nothing is hidden.
    bodyHtml: `<div class="std-doc">
  <nav class="std-crumb"><a href="/standards">Standards</a></nav>
  <h1>${esc(shortName(s.doc))}</h1>
  <p class="std-subtitle">${esc(s.doc.title)}</p>
  ${supersessionHtml(s)}
  ${postureHtml(s.doc)}
  ${frontMatter(s)}
  <p class="std-note"><a href="${esc(canonical)}/standard.json">The full standard as JSON</a> · <a href="${esc(canonical)}/grounding">Every source this standard is grounded in</a> · <a href="/demo">A real result on a real store</a> · <a href="/methodology">How these are built and measured</a></p>
  ${tableOfContents(s)}
  ${renderFitness(s)}
  ${identifierSection()}
  ${discriminationTable(s)}
  ${sections}
</div>`,
  };
}

/**
 * The list of standards, GROUPED BY SLUG WITH THE CURRENT VERSION LEADING.
 *
 * ⚠️ A FLAT LIST OF EVERY VERSION IS THE llms.txt INVERSION IN HTML. With three versions
 * of one standard published and nothing marking which to cite, the first item a reader
 * meets is the OLDEST — the one whose posture is wrong about itself and whose failure
 * rates are predictions. An agency writing "your pages fail ALS-COFFEE-…" from this page
 * would pin a citation to a superseded document by simply reading top to bottom.
 *
 * The tier counts use `orderedTiers`, not the count-descending order: leading with
 * "16 Blocked" describes the document by its largest tier rather than by what it does.
 */
export function renderStandardsIndex(list: PublishedStandard[], base: string): SitePage {
  const slugs = [...new Set(list.map((s) => s.slug))];
  const items = slugs.map((slug) => {
    const versions = list.filter((s) => s.slug === slug);
    const s = versions[versions.length - 1]!;                 // the registry's last = current
    const older = versions.slice(0, -1).reverse();
    const c = orderedTiers(s.doc).map(([t, n]) => `${n} ${TIER_LABEL[t] ?? t}`).join(" · ");
    const bound = fitnessOf(s)?.samples?.[0];
    return `<li><h2><a href="/standards/${esc(slug)}/${esc(s.publicVersion)}">${esc(shortName(s.doc))}</a></h2>
      <p><code>${esc(s.doc.standard_id)}</code> v${esc(s.doc.version)} — ${s.doc.entries.length} entries (${esc(c)})</p>
      ${bound ? p(`Measured false-positive rate on its own category: ${bound.point_estimate_pct.toFixed(2)}% point estimate, ${bound.bound_95_cluster_icc02_pct.toFixed(2)}% 95% upper bound over ${bound.pass_rows_audited} individually audited pass rows.`) : ""}
      <p class="std-note"><strong>Current version — cite this one.</strong></p>
      ${older.length ? `<details><summary>${older.length} earlier version${older.length === 1 ? "" : "s"}, still served</summary><ul>${
      older.map((o) => `<li><a href="/standards/${esc(slug)}/${esc(o.publicVersion)}">v${esc(o.publicVersion)}</a> — superseded by v${esc(o.supersededBy ?? "")}, served byte for byte so existing citations resolve. Do not cite it for new work.</li>`).join("")
    }</ul></details>` : ""}</li>`;
  }).join("");
  return {
    title: "Buying standards",
    description: "Versioned buying standards — the questions a competent buyer asks in a category, written as executable tests, with the evidence that counts, the evidence that does not, and the measured error bound.",
    canonical: `${base}/standards`,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "CollectionPage", name: "Buying standards", url: `${base}/standards`,
    })}</script>`,
    bodyHtml: `<div class="std-doc">
  <h1>Buying standards</h1>
  ${p("A buying standard is the set of questions a competent buyer asks in a category, written down, versioned, and executable against a real product page.")}
  ${p("We publish what we cannot test, and why. Every standard states its blocked and advisory entries in full — the questions that matter and that a public product page cannot settle today — alongside the ones that run.")}
  <ul class="std-list">${items || "<li>No standards are published yet.</li>"}</ul>
</div>`,
  };
}

export function renderGrounding(s: PublishedStandard, base: string): SitePage {
  const canonical = `${base}/standards/${s.slug}/${s.publicVersion}/grounding`;
  const rows: string[] = [];
  for (const e of s.doc.entries) {
    const srcs = groundingOf(e);
    if (!srcs.length) continue;
    rows.push(`<section><h2><a href="${esc(entryHref(s, e.id))}"><code>${esc(e.id)}</code></a> — ${esc(e.question)}</h2><ul>${
      srcs.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.source ?? x.url)}</a>` : esc(x.source ?? "")}${x.kind ? ` <span class="std-eg">(${esc(x.kind)})</span>` : ""}${x.establishes ? `<br /><span class="std-why">${esc(x.establishes)}</span>` : ""}</li>`).join("")
    }</ul></section>`);
  }
  return {
    title: `Grounding — ${shortName(s.doc)}`,
    description: `Every external source this standard is grounded in: regulations, certification bodies, and published guidance, with what each establishes.`,
    canonical,
    jsonLd: "",
    bodyHtml: `<div class="std-doc">
  <nav class="std-crumb"><a href="/standards">Standards</a> / <a href="/standards/${esc(s.slug)}/${esc(s.publicVersion)}">${esc(shortName(s.doc))}</a></nav>
  <h1>Grounding</h1>
  ${p("Each entry's requirement is grounded in something outside our own opinion. This page lists every source, and what each one establishes.")}
  ${rows.join("") || p("No grounding sources are recorded.")}
</div>`,
  };
}

// ---- routing ---------------------------------------------------------------

const ENTRY_RE = /^\/standards\/([a-z0-9-]+)\/([0-9.]+)\/([A-Za-z0-9._-]+)\/?$/;
const STD_RE = /^\/standards\/([a-z0-9-]+)\/([0-9.]+)\/?$/;

/**
 * An entry id asked of a version, RESOLVED ACROSS THE WHOLE SUPERSESSION CHAIN.
 *
 * ⚠️ THIS USED TO FOLLOW EXACTLY ONE HOP, AND PUBLISHING A THIRD VERSION BROKE IT.
 * The id carries the version, so every reissue renames all 42 entries and each new entry
 * names only its IMMEDIATE predecessor in `supersedes`. With v1.0 → v1.1 that is the same
 * thing as the chain, so the single `find` was indistinguishable from correct. The moment
 * v1.2 shipped, `/standards/coffee/1.2/ALS-COFFEE-1.0-FORMAT-001` 404ed — measured: 0 of
 * 42 v1.0 ids resolved at v1.2, while all 42 still resolved at v1.1. Nothing in the
 * artifacts was wrong; the renderer simply stopped walking after one step, and the failure
 * grows with every version published, which is the opposite of what a stable citation is.
 *
 * The walk is FORWARD from the requested id, so it can only ever resolve an OLD id to a
 * NEWER entry. Asking v1.0 for a v1.2 id still 404s, which is right: that question did not
 * exist in that version, and answering it would make the version in a citation cosmetic.
 */
export function resolveEntryId(s: PublishedStandard, tail: string): StandardEntry | null {
  const direct = s.doc.entries.find((x) => x.id === tail);
  if (direct) return direct;

  const successor = new Map<string, string>();
  for (const v of loadPublishedStandards()) {
    if (v.slug !== s.slug) continue;
    for (const e of v.doc.entries) {
      const from = (e as { supersedes?: string }).supersedes;
      if (from) successor.set(from, e.id);
    }
  }
  let cur = tail;
  const seen = new Set([cur]);           // a mis-authored `supersedes` cycle must not hang
  for (let hop = 0; hop < 64; hop++) {
    const next = successor.get(cur);
    if (!next || seen.has(next)) return null;
    seen.add(next);
    cur = next;
    const hit = s.doc.entries.find((x) => x.id === cur);
    if (hit) return hit;
  }
  return null;
}

/** The rendered page for a `/standards*` path, or null when the path is not one. */
export function standardsPageFor(pathname: string, base: string): SitePage | null {
  const list = loadPublishedStandards();
  if (pathname === "/standards" || pathname === "/standards/") return renderStandardsIndex(list, base);

  const std = STD_RE.exec(pathname);
  if (std) {
    const s = findStandard(std[1]!, std[2]!);
    return s ? renderStandard(s, base) : null;
  }
  const ent = ENTRY_RE.exec(pathname);
  if (ent) {
    const s = findStandard(ent[1]!, ent[2]!);
    if (!s) return null;
    const tail = ent[3]!;
    if (tail === "grounding") return renderGrounding(s, base);
    if (tail === "standard.json") return null;   // served as JSON, not HTML
    const e = resolveEntryId(s, tail);
    return e ? renderEntry(s, e, base) : null;
  }
  return null;
}

/** The raw artifact for `/standards/:slug/:version/standard.json`, or null. */
export function standardJsonFor(pathname: string): { json: string; hash: string } | null {
  const m = ENTRY_RE.exec(pathname);
  if (!m || m[3] !== "standard.json") return null;
  const s = findStandard(m[1]!, m[2]!);
  return s ? { json: s.rawJson, hash: s.hash } : null;
}

// ---- the standalone document shell ----------------------------------------
//
// ⚠️ THESE PAGES ARE NOT SPA ROUTES, AND THE FIRST VERSION SHIPPED THEM AS IF THEY
// WERE. Injecting the rendered body into the SPA's `<div id="root">` — the mechanism
// the Index SSR uses — produced the exact inverse of the goal: a crawler saw the full
// standard and a HUMAN saw "Page not found", because `/standards` matches no route in
// App.tsx and React wipes #root the moment it mounts. The document even kept the
// standard's <title> while its body said 404, so the page contradicted itself.
//
// A standard is a DOCUMENT. It does not need the app, so it does not load the app:
// this is a complete HTML file that links the built stylesheet and nothing else. No
// bundle, no hydration, nothing to wipe it, and it stays readable with JavaScript off
// by construction rather than by luck.
const NAV = [
  ["/", "Home"],
  ["/standards", "Standards"],
  ["/demo", "Example test"],
  ["/methodology", "Methodology"],
] as const;

/**
 * ⚠️ THE FONTS ARE LOADED BY THE HTML, NOT BY THE STYLESHEET, AND THIS DOCUMENT WAS
 * COPYING ONLY THE STYLESHEET.
 *
 * `viewer/index.html` loads Inter and Space Grotesk with a `<link>`; there is no
 * `@import` or `@font-face` anywhere in `viewer/src/theme.css`. `renderStandaloneDocument`
 * copied the stylesheet href and nothing else — so every published standard page has
 * been rendering `--font-display` all the way down to `-apple-system`/Segoe UI. The
 * pages looked plausible, which is why nobody noticed: a missing webfont degrades to a
 * system font rather than to an error, and the typography was being tuned against a
 * face that was never on the page.
 *
 * Byte-identical to viewer/index.html:13-18. `test/standardsSite.test.ts` asserts the
 * pair, because two copies of a font URL is exactly the shape that drifts.
 */
export const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />`;

export function renderStandaloneDocument(
  page: SitePage,
  opts: { cssHref: string | null; brand: string; base: string; ogImage?: string | null },
): string {
  const nav = NAV.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${esc(page.canonical)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${esc(opts.brand)}" />
<meta property="og:title" content="${esc(page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${esc(page.canonical)}" />
${opts.ogImage ? `<meta property="og:image" content="${esc(opts.ogImage)}" />` : ""}
<meta name="twitter:card" content="${opts.ogImage ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${esc(page.title)}" />
<meta name="twitter:description" content="${esc(page.description)}" />
${opts.ogImage ? `<meta name="twitter:image" content="${esc(opts.ogImage)}" />` : ""}
${FONT_LINKS}
${opts.cssHref ? `<link rel="stylesheet" href="${esc(opts.cssHref)}" />` : ""}
${page.jsonLd}
</head>
<body>
<div class="std-page">
<nav class="std-crumb">${nav}</nav>
${page.bodyHtml}
<footer class="std-note" style="margin-top:56px;border-top:1px solid var(--border);padding-top:18px">
${esc(opts.brand)} · <a href="${esc(opts.base)}/standards">All standards</a> · <a href="${esc(opts.base)}/llms.txt">llms.txt</a>
</footer>
</div>
</body>
</html>
`;
}

/** Paths a sitemap should carry — every published standard, every entry. */
export function standardsSitemapPaths(): string[] {
  const out = ["/standards"];
  for (const s of loadPublishedStandards()) {
    const b = `/standards/${s.slug}/${s.publicVersion}`;
    out.push(b, `${b}/standard.json`, `${b}/grounding`);
    for (const e of s.doc.entries) out.push(`${b}/${encodeURIComponent(e.id)}`);
  }
  return out;
}

/** `/llms.txt` — a plain-text map for a machine reader that arrives without a crawler. */
export function llmsTxt(base: string): string {
  const lines = [
    `# ${base}`,
    ``,
    `> Versioned buying standards: the questions a competent buyer asks in a category,`,
    // `proven`, not `pass` — the product's own result vocabulary, and the exact word
    // the two sites had drifted apart on. See PRODUCT_DESCRIPTION in viewer/src/copy.ts.
    `> written as executable tests and run against a store's real product pages.`,
    `> Each requirement reports proven, not proven, or requires store access, with the`,
    `> evidence that decided it. We publish what we cannot test, and why.`,
    ``,
    `## Standards`,
  ];
  for (const s of loadPublishedStandards()) {
    const b = `${base}/standards/${s.slug}/${s.publicVersion}`;
    const counts = orderedTiers(s.doc).map(([t, n]) => `${n} ${t}`).join(", ");
    lines.push(`- [${s.doc.title}](${b}): ${s.doc.entries.length} entries (${counts}). Grammar ${s.doc.grammar_version ?? "unstated"}. Content hash ${s.hash}.`);
    // A machine reader has to be told which version is current, or it cites the first
    // one it finds. This is the same fact the HTML page states in a notice — and it is
    // now stated in BOTH directions, because "not superseded" is an inference a reader
    // should not have to make about a file whose whole job is to be unambiguous.
    if (s.supersededBy) {
      lines.push(`  - SUPERSEDED by v${s.supersededBy} (${base}/standards/${s.slug}/${s.supersededBy}). Served unchanged so existing citations resolve; do not cite it for new work.`);
    } else {
      lines.push(`  - CURRENT version of ${s.slug}. Cite this one.`);
    }
    lines.push(`  - [JSON](${b}/standard.json) — the artifact a citation resolves against.`);
    lines.push(`  - [Grounding](${b}/grounding) — every external source, and what it establishes.`);
    // ⚠️ `fitnessOf`, NOT `s.fitness` AND NOT `measured_fitness`. THREE grammars keep this
    // measurement in three different places, and the THIRD time this file read one of them
    // directly the failure was INVERTED: llms.txt advertised the SUPERSEDED version as
    // measured and the CURRENT one as having no published error rate at all, to exactly the
    // machine readers this file exists for. `fitnessOf` is the only reader.
    const f = fitnessOf(s);
    if (!f?.samples?.length) {
      lines.push(`  - No fitness measurement is published for this version. That is stated rather than omitted: an absent bound and an unstated one are not the same thing.`);
    }
    for (const x of f?.samples ?? []) {
      lines.push(`  - Measured false-positive rate, ${x.label}: ${x.point_estimate_pct.toFixed(2)}% point estimate, ${x.bound_95_cluster_icc02_pct.toFixed(2)}% 95% upper bound (n=${x.pass_rows_audited} pass rows across ${x.stores} stores, cluster-adjusted)${x.is_floor ? " — a FLOOR: only one defect class was re-checked, so the true rate is at least this" : ""}.`);
      if (x.completion_state) lines.push(`    - Completion state: ${x.completion_state}. ${completionSentence(x)}`);
      // The limits are the artifact's own statement of what the number does NOT cover —
      // including, at grammar 1.2, the general-sample comparison and the word FLOOR that
      // keeps it from being read as a peer of a complete audit. Verbatim, never summarised.
      for (const lim of x.limits ?? []) lines.push(`    - Limit: ${lim}`);
    }
    // The three-valued discrimination verdicts, counted from the entries themselves.
    const verdicts = s.doc.entries.map((e) => measuredOf(s, e)).filter((m): m is EntryDiscrimination => m?.kind === "discrimination");
    if (verdicts.length) {
      const n = (v: string) => verdicts.filter((m) => m.verdict === v).length;
      lines.push(`  - Measured discrimination over ${verdicts.length} executable entries: ${n("discriminating")} discriminating, ${n("indeterminate")} indeterminate, ${n("not_discriminating")} not discriminating. \`indeterminate\` means the measurement ran and decided nothing; it is not either of the other two. None has been retired.`);
    }
  }
  lines.push(``, `## A worked result`, `- [An Example test on a real store](${base}/demo) — a published standard executed against a real coffee product page, every requirement with the evidence sentence and the surface it was read from.`);
  lines.push(``, `## Method`, `- [Methodology](${base}/methodology)`);
  return lines.join("\n") + "\n";
}

export { standardHash };
