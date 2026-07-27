// ===========================================================================
// MUTATION FIXTURES FOR THE SCHEMA VALIDATOR.
//
// `standards/validate.ts` is hand-written, and a hand-written validator that
// silently accepts everything is indistinguishable from a strict one when the
// input happens to be valid. "0 errors" and "the validator did nothing" render
// the same — the exact failure `src/measure/completion.ts` exists to prevent.
//
// So: one minimal VALID standard, plus one MUTATION per keyword that schema.json
// actually uses. Each mutation must produce an error with the expected keyword.
// A mutation that still validates means that keyword is not implemented.
//
// Same discipline as the engine's `experiments/v2-4/mutate.mjs`: a guard whose
// removal breaks nothing is not a guard.
// ===========================================================================

type Json = Record<string, unknown>;

/**
 * A minimal standard that MUST validate. Deliberately a fictional category
 * (`ALS-FIXTURE`) so it can never be mistaken for a real published standard, and
 * so a grep for `ALS-COFFEE` never picks it up.
 *
 * `standard_hash.value` is 64 `f`s: pattern-valid but not a real content hash.
 * The hash-integrity test runs against the REAL standard only, and asserts this
 * fixture's hash does NOT match — otherwise the hash check would be vacuous.
 */
export const MINIMAL_VALID: Json = {
  grammar_version: "1.0",
  standard_id: "ALS-FIXTURE",
  version: "1.0",
  title: "Fixture standard for validator mutation testing",
  status: "draft",
  posture: {
    independently_applied: false,
    statement:
      "This is a test fixture, not a standard. It exists only so the schema validator can be " +
      "proven to reject malformed input, and it has never been applied to any store.",
  },
  applicability_envelope: {
    covers: "Nothing. This fixture exists solely to exercise the schema validator's keyword coverage.",
    excludes: ["every real product"],
    category_signals: { authoritative: ["product_type"], fallback: ["title"], never: ["tags"] },
  },
  out_of_scope: [
    { subject: "everything", why_not: "This is a fixture and adjudicates no real product claim at all." },
    { subject: "product truth", why_not: "The engine tests evidence availability, never what a product is." },
    { subject: "registry lookups", why_not: "No register client exists in the engine at grammar version 1.0." },
  ],
  engine_contract: {
    engine_version: "v2.0.0",
    contract_document: "standards/ENGINE_CONTRACT.md",
    requirement_kinds_used: ["claim"],
    verified_against_commit: "96ceacd",
  },
  changelog: [
    {
      version: "1.0",
      date: "2026-07-26",
      summary: "Fixture created for schema validator mutation testing.",
      changes: [
        {
          entry_id: "ALS-FIXTURE-1.0-TEST-001",
          change_type: "added",
          rationale: "The validator needs at least one valid entry to mutate away from.",
        },
      ],
    },
  ],
  standard_hash: {
    algorithm: "sha256",
    canonicalisation: "json-sorted-keys-no-hash-field",
    value: "f".repeat(64),
  },
  entries: [
    {
      id: "ALS-FIXTURE-1.0-TEST-001",
      question: "Is this a fixture entry?",
      assertion: { subject: "fixture_flag", operator: "is_stated", expected: true },
      tier: "executable",
      applicability: { applies_when: "never, in any real conformance run" },
      accepted_evidence: [
        { surface: "product_description", form: "an explicit statement in the product copy" },
      ],
      insufficient_evidence: [
        { form: "a vague synonym", why_not: "A synonym does not establish the specific stated property." },
      ],
      conflict_rules: [
        { when: "two surfaces disagree", resolution: "prefer the product description over page chrome" },
      ],
      public_inspectable: true,
      evidence_surfaces: ["product_description"],
      registry: { resolvable: false, engine_can_perform: false },
      predicted_discrimination: {
        predicted_fail_rate_band: "40-60%",
        in_target_band: true,
        reasoning: "A fixture has no real prediction; this text exists to satisfy the minimum length rule.",
        measured: true,
      },
      // Grammar 1.1. Present in the baseline so the numeric bounds on a measurement
      // have something to be mutated against: `fail_rate_pct` must stay a percentage
      // and `asked` must be a real denominator. A rate over 100% or a denominator of
      // zero is the shape a broken counter produces, and this grammar's whole posture
      // is that a broken instrument must not read as a clean one.
      measured_discrimination: {
        fail_rate_pct: 50,
        asked: 40,
        verdict: "held",
        carries_information: true,
        source: "a fixture, measured against nothing",
      },
      consumer_note: "A fixture note that is long enough to satisfy the forty-character minimum length.",
      merchant_remediation: "Nothing to remediate — this entry is never applied to a real store at all.",
      grounding: {
        demand_basis: ["internal_measurement"],
        citations: [
          {
            source: "standards/validate.ts",
            kind: "internal_measurement",
            establishes: "that the validator needs a valid baseline to mutate",
          },
        ],
      },
      binding: {
        req_kind: "claim",
        claim: "organic",
        label: "Fixture claim row",
        passing_states: ["pass_evidenced"],
      },
      adversarial: {
        attack: "There is no real attack on a fixture entry; this text satisfies the minimum length.",
        outcome: "survived_unchanged",
      },
      pass_means: {
        establishes: "Nothing at all — this is a validator fixture, not a conformance assertion.",
        does_not_establish: "Anything whatsoever about any real product, store, or claim anywhere.",
      },
    },
  ],
};

/** `demand_basis` on the fixture uses `internal_measurement`, which is a CITATION
 *  kind rather than a demand_basis value — deliberately corrected below so the
 *  baseline really is valid. */
(MINIMAL_VALID.entries as Json[])[0]!.grounding = {
  demand_basis: ["trade_convention_only"],
  citations: [
    {
      source: "standards/validate.ts module header",
      kind: "internal_measurement",
      establishes: "that the validator needs a valid baseline to mutate away from",
    },
  ],
};

export const deepClone = (v: Json): Json => JSON.parse(JSON.stringify(v)) as Json;

export interface Mutation {
  /** What the mutation does, in words. */
  name: string;
  /** The schema keyword that MUST reject it. */
  keyword: string;
  /** A substring the offending error path must contain. `""` matches any path. */
  pathContains: string;
  /** Mutate a deep clone of MINIMAL_VALID in place. */
  mutate: (s: Json) => void;
}

const entry0 = (s: Json): Json => (s.entries as Json[])[0]!;

/**
 * One mutation per keyword schema.json actually uses. `$defs`, `$schema`, `$id`,
 * `title` and `description` carry no validation behaviour and are covered instead
 * by the `unsupportedKeywords` tripwire.
 *
 * `allOf` is exercised by the three if/then mutations, since the entry's
 * conditional rules live inside its `allOf` array — if `allOf` were unimplemented,
 * none of those three would fire.
 */
export const MUTATIONS: Mutation[] = [
  {
    name: "type — version is a number instead of a string",
    keyword: "type",
    pathContains: "version",
    mutate: (s) => { s.version = 1.0; },
  },
  {
    name: "required — the entries array is removed entirely",
    keyword: "required",
    pathContains: "",
    mutate: (s) => { delete s.entries; },
  },
  {
    name: "required (nested) — an entry loses insufficient_evidence",
    keyword: "required",
    pathContains: "entries/0",
    mutate: (s) => { delete entry0(s).insufficient_evidence; },
  },
  {
    name: "additionalProperties — an unknown field is added to an entry",
    keyword: "additionalProperties",
    pathContains: "entries/0",
    mutate: (s) => { entry0(s).severity = "high"; },
  },
  // ⚠️ THESE TWO USED TO PROVE `const`, AND GRAMMAR 1.1 DELIBERATELY LOOSENED BOTH.
  // `grammar_version` went `const: "1.0"` → `enum: ["1.0","1.1"]` because there are now
  // two grammar versions; `predicted_discrimination.measured` went `const: false` →
  // `type: boolean` because a standard has now actually been measured, which is the
  // whole point of grammar 1.1. The mutations are retargeted at the keyword that really
  // guards each field rather than deleted — a loosened constraint that keeps its old
  // mutation passes for the wrong reason, and one whose mutation is removed stops being
  // proved at all.
  {
    name: "enum — grammar_version names a grammar that does not exist",
    keyword: "enum",
    pathContains: "grammar_version",
    mutate: (s) => { s.grammar_version = "2.0"; },
  },
  {
    name: "type — predicted_discrimination.measured is not a boolean",
    keyword: "type",
    pathContains: "measured",
    mutate: (s) => { (entry0(s).predicted_discrimination as Json).measured = "yes"; },
  },
  // `const` is still load-bearing in this grammar, so it still needs a mutation of its
  // own or the keyword quietly stops being proved. `standard_hash.canonicalisation` is
  // the strongest place to prove it: the hash is only REPRODUCIBLE by a third party
  // because the canonicalisation is fixed, so a document declaring a different one is
  // a citation nobody else can verify.
  {
    name: "maximum — a measured fail rate exceeds 100%",
    keyword: "maximum",
    pathContains: "measured_discrimination/fail_rate_pct",
    mutate: (s) => { (entry0(s).measured_discrimination as Json).fail_rate_pct = 150; },
  },
  {
    name: "minimum — a measured fail rate is computed over zero products asked",
    keyword: "minimum",
    pathContains: "measured_discrimination/asked",
    mutate: (s) => { (entry0(s).measured_discrimination as Json).asked = 0; },
  },
  {
    name: "const — standard_hash declares a canonicalisation nobody else implements",
    keyword: "const",
    pathContains: "standard_hash/canonicalisation",
    mutate: (s) => { (s.standard_hash as Json).canonicalisation = "whatever-we-felt-like"; },
  },
  {
    name: "pattern — an entry id does not match the citable id format",
    keyword: "pattern",
    pathContains: "entries/0/id",
    mutate: (s) => { entry0(s).id = "coffee-decaf-2"; },
  },
  {
    name: "pattern — standard_hash.value is not 64 hex chars",
    keyword: "pattern",
    pathContains: "standard_hash/value",
    mutate: (s) => { (s.standard_hash as Json).value = "not-a-hash"; },
  },
  {
    name: "minLength — consumer_note is too short to be a note",
    keyword: "minLength",
    pathContains: "consumer_note",
    mutate: (s) => { entry0(s).consumer_note = "short"; },
  },
  {
    name: "enum — tier is a value the grammar does not define",
    keyword: "enum",
    pathContains: "entries/0/tier",
    mutate: (s) => { entry0(s).tier = "maybe"; },
  },
  {
    name: "enum — an evidence surface the engine does not have",
    keyword: "enum",
    pathContains: "evidence_surfaces",
    mutate: (s) => { entry0(s).evidence_surfaces = ["raw_page_text"]; },
  },
  {
    name: "minItems — insufficient_evidence is present but EMPTY",
    keyword: "minItems",
    pathContains: "insufficient_evidence",
    mutate: (s) => { entry0(s).insufficient_evidence = []; },
  },
  {
    name: "items — an insufficient_evidence entry has a stub why_not",
    keyword: "minLength",
    pathContains: "insufficient_evidence/0/why_not",
    mutate: (s) => {
      (entry0(s).insufficient_evidence as Json[])[0] = { form: "vague", why_not: "no" };
    },
  },
  {
    name: "$ref — a violation INSIDE a $ref'd subschema ($defs/grounding)",
    keyword: "minLength",
    pathContains: "grounding/citations/0/establishes",
    mutate: (s) => {
      ((entry0(s).grounding as Json).citations as Json[])[0]! = {
        source: "src", kind: "regulator", establishes: "x",
      };
    },
  },
  {
    name: "anyOf — assertion.expected is null, which no alternative allows",
    keyword: "anyOf",
    pathContains: "assertion/expected",
    mutate: (s) => { (entry0(s).assertion as Json).expected = null; },
  },
  {
    name: "if/then — tier executable with no binding",
    keyword: "required",
    pathContains: "entries/0",
    mutate: (s) => { delete entry0(s).binding; },
  },
  {
    name: "if/then — tier blocked with no blocked_by",
    keyword: "required",
    pathContains: "entries/0",
    mutate: (s) => {
      const e = entry0(s);
      e.tier = "blocked";
      delete e.binding; delete e.adversarial; delete e.pass_means;
    },
  },
  {
    name: "not — tier advisory but a binding is present anyway",
    keyword: "not",
    pathContains: "entries/0",
    mutate: (s) => {
      const e = entry0(s);
      e.tier = "advisory";
      delete e.adversarial; delete e.pass_means;
      // binding deliberately LEFT IN PLACE — this is the violation.
    },
  },
  {
    name: "if/then (changelog) — a weakening with no attestation",
    keyword: "required",
    pathContains: "changelog/0/changes/0",
    mutate: (s) => {
      const change = ((s.changelog as Json[])[0]!.changes as Json[])[0]!;
      change.change_type = "weakened";
      change.rationale = "Loosened the accepted evidence after a merchant complained about failing it.";
    },
  },
];
