// ===========================================================================
// VOCABULARY MUTATION FIXTURES — the proof that each structural rule is real.
//
// One minimal VALID vocabulary, plus one mutation per rule. Each mutation MUST
// produce an error carrying the expected rule id. A mutation that still validates
// means the rule is not enforced and the format reads stricter than it is — the
// same containment `standards/__tests__/fixtures.ts` provides for schema.json and
// `experiments/v2-4/mutate.mjs` provides for the engine's guards.
//
// The fixture claim is deliberately FICTIONAL (`fixture_kiln_fired`) so it can
// never be mistaken for a shipped vocabulary, and its behaviour was designed BY
// EXECUTION against the real engine matcher rather than by choosing sentences
// that looked right.
//
// Pure: no network, no database, no clock.
// ===========================================================================

import { vocabularyHash, type Vocabulary } from "../vocabulary.js";

export const deepClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const CITE = [{
  source: "Fixture — not a real citation",
  kind: "internal_measurement",
  establishes: "that this vocabulary is a test fixture and grounds nothing",
}];

/** Built without a hash, then sealed, so the fixture is always self-consistent. */
function seal(v: Omit<Vocabulary, "vocabulary_hash">): Vocabulary {
  const withHash = { ...v, vocabulary_hash: { algorithm: "sha256", canonicalisation: "json-sorted-keys-no-hash-field", value: "" } } as Vocabulary;
  withHash.vocabulary_hash.value = vocabularyHash(withHash);
  return withHash;
}

export const MINIMAL_VALID_VOCAB: Vocabulary = seal({
  vocabulary_grammar_version: "1.0",
  standard_id: "ALS-FIXTURE",
  standard_version: "1.0",
  claim_key: "fixture_kiln_fired",
  version: "1.0",
  title: "Fixture vocabulary — kiln firing",
  status: "draft",
  scope: {
    establishes: "that the page states the piece was kiln-fired, on a surface we can quote",
    does_not_establish: "that the piece was in fact kiln-fired, or at what temperature, or by whom",
  },
  serves: [{
    entry_id: "ALS-FIXTURE-1.0-KILN-001",
    effect: "unblocks",
    note: "a fixture entry that does not exist; this vocabulary is a test artifact only",
  }],
  accepted_surfaces: ["product_description", "structured_data"],
  matching: { whole_word: true, case_sensitive: false, engine_call_site: "src/server/productTest.ts claim branch, findSupport({ wholeWord: true })" },
  supporting_terms: [
    {
      term: "kiln-fired",
      orthography: "canonical",
      grounding: CITE,
      positive_examples: ["Each mug is kiln-fired at 1240C in our studio."],
    },
    {
      term: "kiln fired",
      orthography: "spelling_variant",
      grounding: CITE,
      positive_examples: ["This stoneware is kiln fired twice for durability."],
    },
  ],
  violating_terms: [
    {
      term: "air-dried",
      grounding: CITE,
      contradicting_examples: ["Air-dried clay, so keep it away from water."],
      must_not_contradict_examples: [
        "Never air-dried — every piece is kiln-fired at 1240C.",
        "This piece is not air-dried; it is fired in our own kiln.",
      ],
    },
  ],
  insufficient_evidence: [
    {
      form: "\"high-fired\"",
      example: "High-fired stoneware in a classic glaze.",
      hazard_class: "misleading_synonym",
      why_not: "High-firing is a temperature range, not a statement that a kiln was used for this piece.",
    },
    {
      form: "kiln drying, which is a timber process",
      example: "Our studio runs a kiln drying cycle for the timber handles.",
      hazard_class: "adjacent_vocabulary",
      why_not: "Kiln drying is a woodworking process and says nothing about how the ceramic was fired.",
    },
    {
      form: "the claim applied to packaging",
      example: "Our packaging is kiln-fired card stock.",
      hazard_class: "wrong_subject",
      why_not: "A statement about the packaging is not a statement about the product inside it.",
    },
    {
      form: "a denial",
      example: "We do not offer a kiln-fired version of this mug.",
      hazard_class: "negation",
      why_not: "A denial that the option exists is the opposite of a statement that this piece is kiln-fired.",
    },
    {
      form: "the phrase in the merchant's own product title",
      example: "Kiln-Fired Stoneware Mug 12oz",
      hazard_class: "merchant_controlled_string",
      why_not: "A title is a name the merchant chose, not a statement of fact about the piece, and naming is not evidence.",
      expected_outcome: "passes_known_gap",
      gap_note: "product_title is a quotable evidence surface and a claim requirement cannot restrict its surfaces, so the engine cannot refuse this today. Closing it needs the accepted-surface enforcement asked for in ENGINE_GAPS.md G-06.",
    },
  ],
  limits: [
    {
      limit: "a merchant-chosen product title carrying the term passes",
      direction: "false_pass",
      cause: "product_title is a quotable surface and accepted_surfaces is declared, not enforced",
      example: "Kiln-Fired Stoneware Mug 12oz",
    },
  ],
  review: {
    state: "defects_found_and_resolved",
    attacker: "fixture",
    refuter: "fixture",
    adversarial_findings: [{
      attack: "Put the term in the product title, where the merchant controls the string entirely.",
      outcome: "limit_recorded",
      resolution: "Pinned as a known gap and declared in limits; the engine cannot refuse a title today.",
      residual_risk: "Any store that names the product after the claim passes without stating anything.",
    }],
  },
  changelog: [{
    version: "1.0",
    date: "2026-07-26",
    summary: "Fixture vocabulary created to prove the structural rules reject malformed input.",
    changes: [{ change_type: "vocabulary_added", detail: "fixture_kiln_fired", rationale: "A mutation baseline; a rule with no failing fixture is a rule nobody has watched fail." }],
  }],
} as Omit<Vocabulary, "vocabulary_hash">);

export interface VocabMutation {
  name: string;
  /** The rule id expected among the findings. */
  rule: string;
  /** Skip the automatic re-hash — only the V12 mutation wants a stale hash. */
  keepStaleHash?: boolean;
  mutate: (v: Vocabulary) => void;
}

export const VOCAB_MUTATIONS: VocabMutation[] = [
  {
    name: "V1 — a violating term suffix-aligned inside a supporting term, prefix not a negator",
    rule: "V1",
    mutate: (v) => {
      v.supporting_terms.push({
        term: "free of solvents", orthography: "canonical", grounding: CITE,
        positive_examples: ["This glaze is free of solvents."],
      });
      v.violating_terms.push({
        term: "solvents", grounding: CITE,
        contradicting_examples: ["Our glaze contains solvents from the supplier."],
        must_not_contradict_examples: ["We never use solvents in any glaze."],
      });
    },
  },
  {
    name: "V3 — a supporting term defeated by its own list (the fail-closed-across-terms loss)",
    rule: "V3",
    mutate: (v) => {
      // "no kiln" + "kiln" — the shorter term matches inside the longer one and reads
      // as negated there, so findSupport discards the whole sentence.
      v.supporting_terms.push({ term: "kiln", orthography: "canonical", grounding: CITE, positive_examples: ["Fired in a kiln."] });
      v.supporting_terms.push({ term: "no kiln", orthography: "canonical", grounding: CITE, positive_examples: ["There is no kiln involved."] });
    },
  },
  {
    name: "V4 — an insufficient example that passes",
    rule: "V4",
    mutate: (v) => { v.insufficient_evidence[0]!.example = "Each piece is kiln-fired in our own studio."; },
  },
  {
    name: "V4 — a stale known-gap pin whose example no longer passes",
    rule: "V4",
    mutate: (v) => { v.insufficient_evidence[4]!.example = "Our packaging is kiln-fired card stock."; },
  },
  {
    name: "V4n — a negative suite of distant straw men",
    rule: "V4n",
    mutate: (v) => {
      for (const p of v.insufficient_evidence) p.example = `Unrelated copy about glaze colour number ${p.form.length}.`;
      v.insufficient_evidence[4]!.expected_outcome = "not_proven";
      delete v.insufficient_evidence[4]!.gap_note;
    },
  },
  {
    // The class the second vocabulary exposed: an insufficient example reported as
    // CONTRADICTING. Worse than a missed pass, and invisible to a rule that only
    // asks "did it pass?".
    name: "V4 — an insufficient example reported as contradicting, undeclared",
    rule: "V4",
    mutate: (v) => { v.insufficient_evidence[0]!.example = "Air-dried clay, so keep it away from water."; },
  },
  {
    name: "V4g — a pinned known gap with no declared false_pass limit",
    rule: "V4g",
    mutate: (v) => { v.limits[0]!.direction = "false_fail"; },
  },
  {
    name: "V5a — a supporting term matched by none of its own examples",
    rule: "V5a",
    mutate: (v) => { v.supporting_terms[0]!.term = "kiln-glazed"; },
  },
  {
    name: "V5b — a positive example that the whole vocabulary does not pass",
    rule: "V5b",
    mutate: (v) => { v.supporting_terms[0]!.positive_examples = ["Our gift boxes are kiln-fired card stock."]; },
  },
  {
    name: "V5c — a contradicting example that does not contradict",
    rule: "V5c",
    mutate: (v) => { v.violating_terms[0]!.contradicting_examples = ["This mug is lovely and well made."]; },
  },
  {
    // The bare-substance defect: `free of X` is not a negator the engine knows, so
    // the compliant sentence is flagged as stating the opposite.
    name: "V13 — a violating term that flags a compliant free-from sentence",
    rule: "V13",
    mutate: (v) => {
      v.violating_terms[0]!.must_not_contradict_examples = ["Our stoneware is free of air-dried components entirely."];
    },
  },
  {
    name: "V6 — a term not in engine-normalised form",
    rule: "V6",
    mutate: (v) => { v.supporting_terms[0]!.term = "Kiln-Fired"; },
  },
  {
    name: "V6 — a term containing \". \", which splitSentences breaks",
    rule: "V6",
    mutate: (v) => { v.supporting_terms[0]!.term = "fired in a k. f. kiln"; },
  },
  {
    name: "V7 — the same term in both lists",
    rule: "V7",
    mutate: (v) => { v.violating_terms[0]!.term = "kiln-fired"; },
  },
  {
    name: "V8 — a claim key that shadows a reviewed built-in",
    rule: "V8",
    mutate: (v) => { v.claim_key = "organic"; },
  },
  {
    name: "V9 — no merchant_controlled_string hazard covered",
    rule: "V9",
    mutate: (v) => { v.insufficient_evidence[4]!.hazard_class = "misleading_synonym"; },
  },
  {
    name: "V10 — an empty violating list with no rationale",
    rule: "V10",
    mutate: (v) => { v.violating_terms = []; },
  },
  {
    name: "V11 — a weakening change attesting failures AND no-failures remediation",
    rule: "V11",
    mutate: (v) => {
      v.changelog.push({
        version: "1.1", date: "2026-08-01", summary: "Added a supporting term after a merchant complained about failing.",
        changes: [{
          change_type: "supporting_term_added", detail: "high-fired",
          rationale: "A merchant asked for it, which is exactly the circumstance the rule forbids.",
          weakening_attestation: {
            prior_failures_exist: true, remediation: "not_applicable_no_failures",
            attested_by: "fixture", attested_date: "2026-08-01",
          },
        }],
      });
    },
  },
  {
    // The two never-weaken failures are caught at DIFFERENT layers, and that
    // layering is worth pinning: the schema's conditional catches a MISSING
    // attestation, and vocabulary.ts V11 catches a CONTRADICTORY one, which JSON
    // Schema cannot express cleanly. Same division as SCHEMA.md section 5.
    name: "schema — a weakening change with no attestation at all",
    rule: "schema",
    mutate: (v) => {
      v.changelog.push({
        version: "1.1", date: "2026-08-01", summary: "Silently removed a violating term after a complaint.",
        changes: [{ change_type: "violating_term_removed", detail: "air-dried", rationale: "No attestation supplied, which must fail the build." }],
      });
    },
  },
  {
    name: "V12 — a hash that does not cover the content",
    rule: "V12",
    keepStaleHash: true,
    mutate: (v) => { v.title = "Fixture vocabulary — kiln firing, quietly edited"; },
  },
  {
    name: "review — published while the review is incomplete",
    rule: "review",
    mutate: (v) => { v.status = "published"; v.review.state = "incomplete"; },
  },
  {
    name: "review — a review that found nothing",
    rule: "review",
    mutate: (v) => { v.review.adversarial_findings = []; },
  },
  {
    name: "schema — an unknown property",
    rule: "schema",
    mutate: (v) => { (v as unknown as Record<string, unknown>).confidence_weighting = 0.8; },
  },
  {
    name: "schema — whole_word turned off, which the engine cannot express",
    rule: "schema",
    mutate: (v) => { (v.matching as unknown as Record<string, unknown>).whole_word = false; },
  },
  {
    name: "schema — an empty insufficient set",
    rule: "schema",
    mutate: (v) => { v.insufficient_evidence = []; },
  },
  {
    name: "schema — a supporting term with no positive example",
    rule: "schema",
    mutate: (v) => { v.supporting_terms[0]!.positive_examples = []; },
  },
  {
    name: "schema — a supporting term with no grounding",
    rule: "schema",
    mutate: (v) => { v.supporting_terms[0]!.grounding = []; },
  },
];

/** Apply a mutation and re-seal the hash unless the mutation is about the hash. */
export function applyMutation(m: VocabMutation): Vocabulary {
  const v = deepClone(MINIMAL_VALID_VOCAB);
  m.mutate(v);
  if (!m.keepStaleHash) {
    v.vocabulary_hash.value = "";
    v.vocabulary_hash.value = vocabularyHash(v);
  }
  return v;
}
