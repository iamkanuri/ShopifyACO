import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateVocabulary, renderVocabularyValidation, requireDecisive,
  vocabularyHashMatches, type Vocabulary,
} from "../vocabulary.js";
import { MINIMAL_VALID_VOCAB, VOCAB_MUTATIONS, applyMutation } from "./vocabularyFixtures.js";
import { loadJson } from "./support.js";

// ===========================================================================
// PURE. No database, no network, no server, no model calls. Term MATCHING is the
// real engine's (`findSupport`/`findViolation`/`lintStrings` imported from src/);
// only the seven-line claim-branch DISPATCH is mirrored, and
// `vocabulary.engine.test.ts` proves the mirror equals the real `evaluate`.
// ===========================================================================

const schema = loadJson<Record<string, unknown>>("schema.json");

// ---- GROUP 1 — the validator is real ---------------------------------------

test("[vocab] the baseline fixture validates clean, and actually ran probes", () => {
  const r = validateVocabulary(MINIMAL_VALID_VOCAB, schema);
  assert.equal(r.state, "VERIFIED_CLEAN", `the baseline must be valid, else every mutation is vacuous.\n${renderVocabularyValidation(r)}`);
  assert.equal(r.defectCount, 0);
  // "0 defects" and "the validator did nothing" must never render the same.
  assert.ok(r.probesRun > 15, `only ${r.probesRun} probes ran — too few to have proven anything`);
  requireDecisive(r, "baseline fixture");
});

test("[vocab] a permissive schema reads as INCOMPLETE, not as a pass", () => {
  // `{ vocabulary: true }` is a JSON Schema that accepts everything. The validator
  // runs zero checks against it — and zero checks must never render the same as
  // zero errors. This is the instrument-fails-flatteringly failure that
  // src/measure/completion.ts exists to prevent, applied to the validator itself.
  const r = validateVocabulary(MINIMAL_VALID_VOCAB, { $defs: { vocabulary: true } });
  assert.equal(r.state, "INCOMPLETE", `a schema that checks nothing must not certify anything.\n${renderVocabularyValidation(r)}`);
  assert.equal(r.defectCount, null, "defectCount must be null on INCOMPLETE — a caller that sums it must not see 0");
  assert.throws(() => requireDecisive(r, "permissive schema"), /INCOMPLETE/);
});

test("[vocab] a malformed vocabulary is rejected without being probed", () => {
  // A document that is not the right shape cannot be probed, and probing it anyway
  // would produce confident nonsense about terms that may not exist.
  const r = validateVocabulary({ vocabulary_grammar_version: "1.0" }, schema);
  assert.equal(r.state, "DEFECTS_FOUND");
  assert.equal(r.probesRun, 0);
  assert.ok(r.schemaErrors.length > 0);
});

// ---- GROUP 2 — THE MUTATION PROOF ------------------------------------------
// A rule whose deliberately-malformed fixture still validates is a rule that is
// not enforced, and the format would read stricter than it is.

test("[vocab] every structural rule rejects a deliberately malformed vocabulary", () => {
  const failures: string[] = [];
  for (const m of VOCAB_MUTATIONS) {
    const mutated = applyMutation(m);
    const r = validateVocabulary(mutated, schema);
    if (r.state === "VERIFIED_CLEAN") {
      failures.push(`${m.name} — STILL VALID. Rule \`${m.rule}\` is not enforced.`);
      continue;
    }
    const hit = m.rule === "schema"
      ? r.schemaErrors.length > 0 || r.findings.some((f) => f.rule === "schema")
      : r.findings.some((f) => f.rule === m.rule && f.severity === "error");
    if (!hit) {
      failures.push(
        `${m.name} — rejected, but not for the expected reason. Expected rule=${m.rule}; got: ` +
        (r.findings.filter((f) => f.severity === "error").map((f) => f.rule).join(", ") || "<no error findings>") +
        (r.schemaErrors.length ? ` | schema: ${r.schemaErrors.map((e) => e.keyword).join(",")}` : ""),
      );
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join("\n")}`);
});

test("[vocab] every rule id in vocabulary.ts has at least one mutation covering it", () => {
  // Guards against adding a rule and forgetting to prove it fires.
  const covered = new Set(VOCAB_MUTATIONS.map((m) => m.rule));
  const RULES = ["V1", "V3", "V4", "V4n", "V4g", "V5a", "V5b", "V5c", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "review", "schema"];
  const missing = RULES.filter((r) => !covered.has(r));
  assert.deepEqual(missing, [], `rules with no mutation fixture: ${missing.join(", ")}`);
});

// ---- GROUP 3 — the shipped vocabularies -------------------------------------

const SHIPPED = [
  "coffee/v1.0/vocabulary/decaf-method.json",
  "coffee/v1.0/vocabulary/decaf-solvent-disclosure.json",
];

for (const rel of SHIPPED) {
  test(`[vocab] ${rel} has zero STRUCTURAL defects`, () => {
    const v = loadJson<Vocabulary>(rel);
    const r = validateVocabulary(v, schema);
    // Separated from the review gate on purpose. The terms can be structurally
    // perfect while nobody has yet attacked them, and conflating the two would let
    // "the schema is happy" stand in for "someone tried to break it".
    const structural = r.findings.filter((f) => f.severity === "error" && f.rule !== "review");
    assert.deepEqual(
      structural.map((f) => `[${f.rule}] ${f.message}`), [],
      `\n${renderVocabularyValidation(r)}`,
    );
    assert.equal(r.schemaErrors.length, 0, `\n${renderVocabularyValidation(r)}`);
    assert.ok(r.probesRun > 20, `only ${r.probesRun} probes ran for ${rel}`);
  });

  test(`[vocab] ${rel} — the review gate is enforced, and an unreviewed vocabulary is INCOMPLETE not clean`, () => {
    const v = loadJson<Vocabulary>(rel);
    const r = validateVocabulary(v, schema);
    if (v.review.state === "incomplete") {
      // The whole point of the completion-state rule: not zero defects, an UNKNOWN
      // number of them. And an incomplete review must block publication.
      assert.equal(r.state, "INCOMPLETE", `\n${renderVocabularyValidation(r)}`);
      assert.equal(r.defectCount, null, "an unreviewed vocabulary must not report a defect COUNT");
      assert.notEqual(v.status, "published", "a vocabulary may not be published while its review is incomplete");
      assert.throws(() => requireDecisive(r, rel), /INCOMPLETE/);
    } else {
      requireDecisive(r, rel);
      assert.equal(r.state, "VERIFIED_CLEAN", `\n${renderVocabularyValidation(r)}`);
      assert.ok(
        v.review.adversarial_findings.length > 0,
        "a completed review with no findings had an attacker who was not trying",
      );
    }
  });

  test(`[vocab] ${rel} hash covers its content`, () => {
    const v = loadJson<Vocabulary>(rel);
    const h = vocabularyHashMatches(v);
    assert.ok(h.ok, `stored ${h.stored} but content hashes to ${h.computed} — run standards/rehash.ts`);
  });

  test(`[vocab] ${rel} declares honestly what it does NOT unblock`, () => {
    const v = loadJson<Vocabulary>(rel);
    for (const s of v.serves) {
      if (s.effect === "unblocks") continue;
      assert.ok(
        (s.still_blocked_by?.length ?? 0) > 0,
        `${s.entry_id} is served as \`${s.effect}\` but names no remaining gap — "narrows" without naming what still blocks it reads as "unblocks"`,
      );
    }
  });
}

test("[vocab] no shipped vocabulary claims an entry that is not in its standard", () => {
  const seen = new Map<string, string[]>();
  for (const rel of SHIPPED) {
    const v = loadJson<Vocabulary>(rel);
    const std = loadJson<{ entries: Array<{ id: string }> }>(`${v.standard_id.replace("ALS-", "").toLowerCase()}/v${v.standard_version}/standard.json`);
    const ids = new Set(std.entries.map((e) => e.id));
    for (const s of v.serves) {
      assert.ok(ids.has(s.entry_id), `${rel} serves ${s.entry_id}, which is not an entry in ${v.standard_id} ${v.standard_version}`);
    }
    seen.set(v.claim_key, [...(seen.get(v.claim_key) ?? []), rel]);
  }
  for (const [key, files] of seen) {
    assert.equal(files.length, 1, `claim key ${key} is defined by ${files.length} vocabularies (${files.join(", ")}) — the registry would have no way to choose`);
  }
});
