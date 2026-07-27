import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validate, unsupportedKeywords, renderResult, SUPPORTED_KEYWORDS } from "../validate.js";
import { MINIMAL_VALID, MUTATIONS, deepClone } from "./fixtures.js";
import { loadJson, STANDARDS_DIR } from "./support.js";

// ===========================================================================
// GROUP 1 — THE VALIDATOR IS REAL.
//
// `standards/validate.ts` is hand-written, so before it can certify anything it
// has to be shown to reject things. "0 errors" and "the validator did nothing"
// render identically otherwise — the failure `src/measure/completion.ts` exists
// to prevent.
// ===========================================================================

const schema = loadJson<Record<string, unknown>>("schema.json");

test("[validator] schema.json uses no keyword the validator silently ignores", () => {
  const unsupported = unsupportedKeywords(schema);
  assert.deepEqual(
    unsupported, [],
    `schema.json uses ${unsupported.length} keyword(s) validate.ts does not implement: ${unsupported.join(", ")}.\n` +
    `An unimplemented keyword is a silent no-op — the schema would look stricter than it is.\n` +
    `Either implement it in validate.ts or remove it from schema.json.\n` +
    `Implemented: ${[...SUPPORTED_KEYWORDS].sort().join(", ")}`,
  );
});

test("[validator] the minimal fixture standard validates", () => {
  const r = validate(MINIMAL_VALID, schema);
  assert.ok(r.ok, `the baseline fixture must be valid, else every mutation is vacuous.\n${renderResult(r)}`);
  // A validator that ran two checks has not validated a document of this shape.
  assert.ok(r.checksRun > 100, `only ${r.checksRun} subschema checks ran — too few to have inspected the document`);
});

test("[validator] every keyword schema.json uses actually rejects something", () => {
  // The mutation proof. One mutation per keyword with validation behaviour; each
  // MUST produce an error with the right keyword at the right path. A mutation
  // that still validates means the keyword is not implemented, and the schema is
  // weaker than it reads.
  const failures: string[] = [];
  for (const m of MUTATIONS) {
    const mutated = deepClone(MINIMAL_VALID);
    m.mutate(mutated);
    const r = validate(mutated, schema);
    if (r.ok) {
      failures.push(`${m.name} — STILL VALID. Keyword \`${m.keyword}\` is not enforced.`);
      continue;
    }
    const hit = r.errors.find(
      (e) => e.keyword === m.keyword && (m.pathContains === "" || e.path.includes(m.pathContains)),
    );
    if (!hit) {
      failures.push(
        `${m.name} — rejected, but not for the expected reason. ` +
        `Expected keyword=${m.keyword} path~=${m.pathContains || "<any>"}; got: ` +
        r.errors.map((e) => `${e.keyword}@${e.path || "<root>"}`).join(", "),
      );
    }
  }
  assert.deepEqual(failures, [], `${failures.length} of ${MUTATIONS.length} mutations did not fire:\n${failures.join("\n")}`);
});

test("[validator] the mutation set is not vacuous", () => {
  // Guards the guard: if MUTATIONS were emptied, the test above would pass
  // trivially. Every keyword with validation behaviour that appears in
  // schema.json must be covered by at least one mutation.
  const annotationOnly = new Set(["$schema", "$id", "title", "description", "$defs", "examples", "default"]);
  const used = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!annotationOnly.has(k)) used.add(k);
      if (k === "properties" || k === "$defs") {
        for (const sub of Object.values(v as Record<string, unknown>)) walk(sub);
      } else walk(v);
    }
  };
  walk(schema);
  // `$ref`, `allOf`, `if`, `then`, `properties`, `items` are exercised indirectly:
  // a mutation deep inside a $ref'd subschema proves $ref; the entry conditionals
  // live in `allOf` so the tier mutations prove allOf/if/then; `properties` and
  // `items` are how every nested mutation is reached at all.
  const indirect = new Set(["$ref", "allOf", "if", "then", "properties", "items"]);
  const covered = new Set(MUTATIONS.map((m) => m.keyword));
  const uncovered = [...used].filter((k) => !covered.has(k) && !indirect.has(k)).sort();
  assert.deepEqual(
    uncovered, [],
    `these keywords appear in schema.json with no mutation proving they fire: ${uncovered.join(", ")}`,
  );
  assert.ok(MUTATIONS.length >= 15, `only ${MUTATIONS.length} mutations — too few to cover the grammar`);
});

// ===========================================================================
// GROUP 2 — THE PUBLISHED STANDARDS VALIDATE.
// ===========================================================================

// Every standard artifact in the repo must validate. Explicit rather than
// globbed: a glob that matches nothing would silently validate nothing.
const STANDARD_FILES = [
  "coffee/v1.0/standard.json",
  // v1.1 is authored against grammar 1.1 and must validate against the SAME schema as
  // v1.0. Every grammar-1.1 addition is optional and the status enum is a superset, so
  // a grammar-1.0 document is untouched — which is the whole reason v1.0's bytes, and
  // therefore its hash, and therefore every citation made against it, still hold.
  "coffee/v1.1/standard.json",
  // v1.2 is grammar 1.2 — the reconciliation (SCHEMA.md §9). It is the version that
  // proves the version GATING works: it carries `discrimination_prediction`,
  // `category_fitness`, the rich measurement shape and an `unbound` tier, every one of
  // which the same schema FORBIDS at 1.0/1.1, while v1.0 and v1.1 above still pass.
  "coffee/v1.2/standard.json",
  "accessory/v0.1-draft/standard.json",
];

for (const rel of STANDARD_FILES) {
  test(`[schema] ${rel} validates against the grammar`, () => {
    const std = loadJson<Record<string, unknown>>(rel);
    const r = validate(std, schema);
    assert.ok(r.ok, renderResult(r));
    assert.ok(r.checksRun > 500, `only ${r.checksRun} checks ran over ${rel} — suspiciously few for a real standard`);
  });
}

// ⚠️ THE LIST IS EXPLICIT SO A GLOB CANNOT SILENTLY MATCH NOTHING — but an explicit
// list has the mirror-image hole, and it is the more likely one: a NEW standard is
// added and nobody edits this file, so it is never validated and the suite stays
// green. That is "not being asked" reading as "passing", which is the failure this
// repo has now recorded at four different layers. The list stays hand-written; this
// test makes forgetting it loud.
test("[schema] every standard.json on disk is IN the explicit list", () => {
  const root = path.join(STANDARDS_DIR);
  const found: string[] = [];
  for (const cat of fs.readdirSync(root, { withFileTypes: true })) {
    if (!cat.isDirectory() || cat.name.startsWith("_") || cat.name === "__tests__") continue;
    for (const ver of fs.readdirSync(path.join(root, cat.name), { withFileTypes: true })) {
      if (!ver.isDirectory()) continue;
      const rel = `${cat.name}/${ver.name}/standard.json`;
      if (fs.existsSync(path.join(root, rel))) found.push(rel);
    }
  }
  assert.ok(found.length > 0, "walked the standards tree and found NO standard.json at all — the walker is broken, which is not the same as there being nothing to check");
  const missing = found.filter((f) => !STANDARD_FILES.includes(f));
  assert.deepEqual(missing, [], `standard.json files exist on disk but are not in STANDARD_FILES, so nothing validates them:\n  ${missing.join("\n  ")}`);
  const phantom = STANDARD_FILES.filter((f) => !found.includes(f));
  assert.deepEqual(phantom, [], `STANDARD_FILES names files that do not exist:\n  ${phantom.join("\n  ")}`);
});
