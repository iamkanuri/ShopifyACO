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
//
// ---------------------------------------------------------------------------
// TWO BASELINES, BECAUSE THERE ARE NOW TWO LIVE GRAMMARS.
//
// `MINIMAL_VALID` is grammar 1.1: the numeric `predicted_discrimination` band,
// and `measured_discrimination` in its FIRST shape. That is not a historical
// curiosity — it is the shape `standards/coffee/v1.1/standard.json` actually
// contains, and that document is published and hash-frozen, so the rules it was
// authored under have to keep working exactly as they did.
//
// `MINIMAL_VALID_V12` is grammar 1.2: no band, an optional numberless
// `discrimination_prediction`, `measured_discrimination` in the shape that
// carries an interval and a sample, and the `unbound` tier.
//
// Both are exercised. `MINIMAL_VALID` is the baseline schema.test.ts validates
// and mutates; the 1.2 constraints are proved by mutations that SUBSTITUTE the
// 1.2 document first (see `onV12`, which re-validates the substituted baseline
// so a mutation can never appear to fire because the document it was applied to
// was already broken).
// ===========================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate } from "../validate.js";

type Json = Record<string, unknown>;

const SCHEMA: Json = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "schema.json"), "utf8"),
) as Json;

/**
 * A minimal standard that MUST validate. Deliberately a fictional category
 * (`ALS-FIXTURE`) so it can never be mistaken for a real published standard, and
 * so a grep for `ALS-COFFEE` never picks it up.
 *
 * `standard_hash.value` is 64 `f`s: pattern-valid but not a real content hash.
 * The hash-integrity test runs against the REAL standard only, and asserts this
 * fixture's hash does NOT match — otherwise the hash check would be vacuous.
 *
 * GRAMMAR 1.1. Its entry carries the required numeric band AND a measurement in
 * the first shape, which is exactly what `ALS-COFFEE 1.1` does on ten entries.
 */
export const MINIMAL_VALID: Json = {
  grammar_version: "1.1",
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
        // `measured: true` is deliberate. It was `const: false` at grammar 1.0 and
        // is a plain boolean from 1.1, because ten entries of the shipped coffee
        // standard set it — so the fixture proves the LOOSENED constraint rather
        // than a constraint no live document could satisfy. The entry-level
        // `allOf` then requires the sibling measurement below, which is the rule
        // that stops `measured: true` from being a claim with no n behind it.
        measured: true,
      },
      // GRAMMAR 1.1's measurement shape: a point estimate and a denominator.
      // Kept as the baseline because it is what the published coffee document
      // contains. Its limits are the reason grammar 1.2 replaced it — no
      // interval, no minimum n, no sample provenance — and the replacement is
      // exercised on MINIMAL_VALID_V12 rather than here.
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

/**
 * THE GRAMMAR-1.2 BASELINE.
 *
 * Two entries, because 1.2 added a tier and a tier nobody instantiates is a tier
 * nobody has shown to be reachable:
 *   • entries[0] is `executable` and carries the reshaped prediction plus a
 *     measurement in the shape that has an interval, a derived minimum n and a
 *     recorded sample. 15 of 30 is exactly 50%, and the interval is the real
 *     Wilson score interval for that count, because the suite recomputes it.
 *   • entries[1] is `unbound` — the engine kind exists and public data can
 *     adjudicate it; this document has not written the binding or run the
 *     adversarial pass. It carries no binding and no measurement, both of which
 *     the schema enforces.
 */
export const MINIMAL_VALID_V12: Json = {
  grammar_version: "1.2",
  standard_id: "ALS-FIXTURE",
  version: "1.2",
  title: "Fixture standard for validator mutation testing, grammar 1.2",
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
    { subject: "registry lookups", why_not: "No register client exists in the engine at grammar version 1.2." },
  ],
  engine_contract: {
    engine_version: "v2.0.0",
    contract_document: "standards/ENGINE_CONTRACT.md",
    requirement_kinds_used: ["claim", "in_stock"],
    verified_against_commit: "96ceacd",
  },
  changelog: [
    {
      version: "1.2",
      date: "2026-07-27",
      summary: "Fixture reissued against grammar 1.2 for schema validator mutation testing.",
      changes: [
        {
          entry_id: "ALS-FIXTURE-1.2-TEST-001",
          change_type: "editorial",
          rationale: "Carried over from the 1.1 fixture with the band discarded and the reasoning kept.",
        },
        {
          entry_id: "ALS-FIXTURE-1.2-TEST-002",
          change_type: "added",
          rationale: "An `unbound` entry, so the tier grammar 1.2 added is instantiated and not merely defined.",
        },
      ],
    },
  ],
  standard_hash: {
    algorithm: "sha256",
    canonicalisation: "json-sorted-keys-no-hash-field",
    value: "e".repeat(64),
  },
  entries: [
    {
      id: "ALS-FIXTURE-1.2-TEST-001",
      supersedes: "ALS-FIXTURE-1.0-TEST-001",
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
      // The band is DISCARDED and the reasoning is PRESERVED, which is the
      // migration rule: a direction derived from the band inherits the band's
      // error, so `no_prediction` is the honest value when the band is all the
      // author ever had.
      discrimination_prediction: {
        direction: "no_prediction",
        confidence: "low",
        reasoning: "A fixture has no real prediction; this text exists to satisfy the minimum length rule.",
      },
      measured_discrimination: {
        verdict: "discriminating",
        n_asked: 32,
        n_adjudicated: 30,
        fail_count: 15,
        fail_rate_pct: 50,
        interval_95: { lower_pct: 33.1541, upper_pct: 66.8459 },
        target_band: { lower_pct: 15, upper_pct: 85 },
        decision_rule: "wilson95_vs_target_band",
        measured_on: "2026-07-27",
        sample: {
          sample_id: "FIXTURE-SAMPLE-0",
          category_scope: "this_category",
          category_standard_id: "ALS-FIXTURE",
          stores: 30,
          products: 30,
          selection: "first_applicable_product",
          deduplicated_by_brand: true,
          applicability_gate_enforced: true,
          captured_on: "2026-07-27",
        },
      },
      consumer_note: "A fixture note that is long enough to satisfy the forty-character minimum length.",
      merchant_remediation: "Nothing to remediate — this entry is never applied to a real store at all.",
      grounding: {
        demand_basis: ["consumer_buying_guide"],
        citations: [
          {
            source: "standards/validate.ts module header",
            kind: "internal_measurement",
            establishes: "that the validator needs a valid baseline to mutate away from",
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
    {
      id: "ALS-FIXTURE-1.2-TEST-002",
      question: "Can this fixture item be bought right now?",
      assertion: { subject: "purchasable_now", operator: "is_purchasable", expected: true },
      tier: "unbound",
      unbound_reason:
        "The engine kind `in_stock` exists and a storefront publishes availability, so neither the evidence " +
        "nor the engine is the obstacle: this fixture has simply not authored the binding or put the " +
        "assertion through the adversarial pass. Filing it `advisory` would say public data cannot " +
        "adjudicate availability, and `blocked` would say the engine has no kind for it. Both are false.",
      applicability: { applies_when: "never, in any real conformance run" },
      accepted_evidence: [
        { surface: "variant_availability", form: "a purchasable variant on the product page" },
      ],
      insufficient_evidence: [
        { form: "a back-in-stock signup form", why_not: "A waitlist establishes the opposite of availability." },
      ],
      conflict_rules: [
        { when: "the page says in stock and no variant is purchasable", resolution: "prefer the variant state" },
      ],
      public_inspectable: true,
      evidence_surfaces: ["variant_availability"],
      registry: { resolvable: false, engine_can_perform: false },
      consumer_note: "A fixture note that is long enough to satisfy the forty-character minimum length.",
      merchant_remediation: "Nothing to remediate — this entry is never applied to a real store at all.",
      grounding: {
        demand_basis: ["retailer_faq_pattern"],
        citations: [
          {
            source: "standards/ENGINE_CONTRACT.md",
            kind: "internal_measurement",
            establishes: "that the engine exposes an in_stock requirement kind",
          },
        ],
      },
    },
  ],
};

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
 * SUBSTITUTE THE GRAMMAR-1.2 BASELINE, THEN MUTATE IT.
 *
 * `schema.test.ts` always clones MINIMAL_VALID before calling `mutate`, so a
 * constraint that only exists at grammar 1.2 has to swap the document first.
 *
 * ⚠️ THE SWAP IS RE-VALIDATED, AND THAT IS NOT DEFENSIVENESS. The mutation proof
 * asserts "the mutated document is rejected, with this keyword, at this path". If
 * the substituted baseline were ALREADY invalid, a mutation could pass while
 * proving nothing — the error it matched would belong to a defect in the fixture
 * rather than to the constraint under test, and the suite would be green over a
 * document nothing had ever validated. Failing loudly here is the only way that
 * state is distinguishable from a working proof.
 */
const onV12 = (s: Json, mutate: (s: Json) => void): void => {
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, deepClone(MINIMAL_VALID_V12));
  const r = validate(s, SCHEMA);
  if (!r.ok) {
    throw new Error(
      "MINIMAL_VALID_V12 is INVALID before any mutation was applied, so every grammar-1.2 mutation " +
      "below would be vacuous:\n" +
      r.errors.map((e) => `  ${e.path || "<root>"} [${e.keyword}] ${e.message}`).join("\n"),
    );
  }
  mutate(s);
};

const v12entry = (s: Json, i: number): Json => (s.entries as Json[])[i]!;

/**
 * One mutation per keyword schema.json actually uses. `$defs`, `$schema`, `$id`,
 * `title` and `description` carry no validation behaviour and are covered instead
 * by the `unsupportedKeywords` tripwire.
 *
 * `allOf` is exercised by the if/then mutations, since the entry's conditional
 * rules live inside its `allOf` array — if `allOf` were unimplemented, none of
 * those would fire. The grammar-1.2 mutations additionally exercise the ROOT
 * `allOf`, which is where the per-version gates live.
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
  // ⚠️ THESE TWO USED TO PROVE `const`, AND THE GRAMMAR DELIBERATELY LOOSENED BOTH.
  // `grammar_version` went `const: "1.0"` → `enum: ["1.0","1.1","1.2"]` because there
  // are now three grammar versions; `predicted_discrimination.measured` went
  // `const: false` → `type: boolean` because a standard has now actually been run,
  // and ten entries of the published coffee document set it true. The mutations are
  // retargeted at the keyword that really guards each field rather than deleted — a
  // loosened constraint that keeps its old mutation passes for the wrong reason, and
  // one whose mutation is removed stops being proved at all. `const` keeps a mutation
  // of its own further down, on `standard_hash.canonicalisation`.
  {
    // Was a `const` mutation until the grammar gained a second version.
    name: "enum — grammar_version is a version the grammar does not define",
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
  {
    name: "minimum — a measured fail rate is computed over zero products asked",
    keyword: "minimum",
    pathContains: "measured_discrimination/asked",
    mutate: (s) => { (entry0(s).measured_discrimination as Json).asked = 0; },
  },
  // `const` is still load-bearing in this grammar, so it still needs a mutation of its
  // own or the keyword quietly stops being proved. `standard_hash.canonicalisation` is
  // the strongest place to prove it: the hash is only REPRODUCIBLE by a third party
  // because the canonicalisation is fixed, so a document declaring a different one is
  // a citation nobody else can verify.
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

  // =========================================================================
  // GRAMMAR 1.2. Each of these substitutes MINIMAL_VALID_V12 first (see `onV12`)
  // because the constraint under test does not exist at 1.1 — which is the point
  // of the version gate, and would otherwise be a rule nothing proves.
  // =========================================================================
  {
    // THE MINIMUM-n FLOOR. Below 22 adjudicated rows no observation whatsoever —
    // not 0 of n, not n of n — can put a 95% Wilson interval outside the 15-85%
    // band, so a verdict recorded there is arithmetically incapable of supporting
    // itself. 21 is one short, and one short is the whole test.
    name: "minimum — a discrimination verdict recorded below the derived minimum n",
    keyword: "minimum",
    pathContains: "measured_discrimination/n_adjudicated",
    mutate: (s) => onV12(s, (v) => { (v12entry(v, 0).measured_discrimination as Json).n_adjudicated = 21; }),
  },
  {
    name: "maximum — a measured fail rate above 100%",
    keyword: "maximum",
    pathContains: "measured_discrimination/fail_rate_pct",
    mutate: (s) => onV12(s, (v) => { (v12entry(v, 0).measured_discrimination as Json).fail_rate_pct = 150; }),
  },
  {
    // The two prediction shapes may never appear in the same document: a reader
    // who has to work out which one an entry meant is reading two grammars at once.
    name: "not (root allOf) — the removed numeric band reappears at grammar 1.2",
    keyword: "not",
    pathContains: "entries/0",
    mutate: (s) => onV12(s, (v) => {
      v12entry(v, 0).predicted_discrimination = {
        predicted_fail_rate_band: "40-60%",
        reasoning: "A band reintroduced into a grammar that removed it, which must not validate.",
        measured: false,
      };
    }),
  },
  {
    // CP1: the tier that deletes a row from a standard may only be reached
    // through a measurement that says so. Under 1.0 an author's guess reached it.
    name: "required (root allOf) — not_discriminating at 1.2 with no measurement behind it",
    keyword: "required",
    pathContains: "entries/1",
    mutate: (s) => onV12(s, (v) => {
      const e = v12entry(v, 1);
      e.tier = "not_discriminating";
      delete e.unbound_reason;
    }),
  },
  {
    // And the measurement has to AGREE. A `discriminating` verdict under a
    // `not_discriminating` tier is the old failure with a record stapled to it.
    name: "const (root allOf) — not_discriminating whose measurement says discriminating",
    keyword: "const",
    pathContains: "measured_discrimination/verdict",
    mutate: (s) => onV12(s, (v) => {
      const e = v12entry(v, 0);
      e.tier = "not_discriminating";
      delete e.binding; delete e.adversarial; delete e.pass_means;
    }),
  },
  {
    // `unbound` says the binding was never written. An entry that has one is
    // either executable or is lying about what gets run.
    name: "not — tier unbound but a binding is present anyway",
    keyword: "not",
    pathContains: "entries/1",
    mutate: (s) => onV12(s, (v) => {
      v12entry(v, 1).binding = {
        req_kind: "in_stock",
        label: "Fixture availability row",
        passing_states: ["pass_evidenced"],
      };
    }),
  },
  {
    name: "required — tier unbound with no unbound_reason naming the missing work",
    keyword: "required",
    pathContains: "entries/1",
    mutate: (s) => onV12(s, (v) => { delete v12entry(v, 1).unbound_reason; }),
  },
  {
    // A fail rate can only have been produced by RUNNING the entry, so a
    // measurement on an unbound entry is a record of a run the document says
    // never happened.
    name: "not — tier unbound carrying a measurement of a run that never happened",
    keyword: "not",
    pathContains: "entries/1",
    mutate: (s) => onV12(s, (v) => {
      v12entry(v, 1).measured_discrimination =
        deepClone(v12entry(v, 0).measured_discrimination as Json);
    }),
  },
  {
    // And the reason belongs to the tier. `unbound_reason` on an executable entry
    // is a sentence about work that is not outstanding.
    name: "const — unbound_reason on an entry that is not unbound",
    keyword: "const",
    pathContains: "entries/0/tier",
    mutate: (s) => onV12(s, (v) => {
      v12entry(v, 0).unbound_reason =
        "A reason attached to an entry that is already executable, which is a statement about " +
        "work that is not outstanding.";
    }),
  },
  {
    // The publication gate, which only exists at 1.2 and is the reason the
    // grammar has a `category_fitness` block at all.
    name: "required (root allOf) — publishing at 1.2 with no category fitness measurement",
    keyword: "required",
    pathContains: "",
    mutate: (s) => onV12(s, (v) => { v.status = "published"; }),
  },
  {
    name: "required (root allOf) — a 1.1 entry with no predicted_discrimination",
    keyword: "required",
    pathContains: "entries/0",
    mutate: (s) => { delete entry0(s).predicted_discrimination; },
  },
  {
    name: "not (root allOf) — the 1.2 prediction shape used in a 1.1 document",
    keyword: "not",
    pathContains: "entries/0",
    mutate: (s) => {
      entry0(s).discrimination_prediction = {
        direction: "no_prediction",
        confidence: "low",
        reasoning: "A 1.2 field in a 1.1 document: two prediction shapes in one standard is unreadable.",
      };
    },
  },
  {
    // The 1.2 tier vocabulary may not leak backwards: a 1.0 or 1.1 reader has no
    // definition for `unbound`, and a tier a reader cannot resolve is worse than
    // the wrong tier. Note the base `tier` enum ACCEPTS `unbound`, so this can
    // only be firing on the root version gate.
    name: "enum (root allOf) — the 1.2-only `unbound` tier used in a 1.1 document",
    keyword: "enum",
    pathContains: "entries/0/tier",
    mutate: (s) => {
      const e = entry0(s);
      e.tier = "unbound";
      delete e.binding; delete e.adversarial; delete e.pass_means;
      e.unbound_reason =
        "The engine kind `claim` exists and public copy can adjudicate it; this fixture has not " +
        "authored the binding or run the adversarial pass.";
    },
  },

  // =========================================================================
  // ONE FIELD NAME, TWO SHAPES. The shape is resolved by the document's declared
  // `grammar_version`, never by guessing from the keys present — so BOTH
  // directions of that gate need a mutation, or half of it is unproved.
  // =========================================================================
  {
    name: "additionalProperties (root allOf) — the 1.2 measurement shape inside a 1.1 document",
    keyword: "additionalProperties",
    pathContains: "entries/0/measured_discrimination",
    mutate: (s) => {
      entry0(s).measured_discrimination =
        deepClone((MINIMAL_VALID_V12.entries as Json[])[0]!.measured_discrimination as Json);
    },
  },
  {
    name: "enum (root allOf) — the 1.1 measurement shape inside a 1.2 document",
    keyword: "enum",
    pathContains: "measured_discrimination/verdict",
    mutate: (s) => onV12(s, (v) => {
      // `held` is a verdict against a PREDICTED band. The 1.2 vocabulary is
      // three-valued and measured against the TARGET band, so the old value has
      // no meaning here rather than a slightly different one.
      v12entry(v, 0).measured_discrimination =
        deepClone((MINIMAL_VALID.entries as Json[])[0]!.measured_discrimination as Json);
    }),
  },
  {
    // The fitness block is MIGRATED, not aliased: a document may not carry both
    // names for the same quantity and leave a reader to pick which one counts.
    name: "not (root allOf) — the retired `measured_fitness` name used at grammar 1.2",
    keyword: "not",
    pathContains: "",
    mutate: (s) => onV12(s, (v) => { v.measured_fitness = {}; }),
  },
  {
    name: "not (root allOf) — the 1.2 `category_fitness` name used at grammar 1.1",
    keyword: "not",
    pathContains: "",
    mutate: (s) => { s.category_fitness = {}; },
  },
];
