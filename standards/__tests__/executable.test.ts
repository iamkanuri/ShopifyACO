import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, contractVersion, type Requirement } from "../../src/server/productTest.js";
import {
  compileStandard, bindingToRequirement, duplicateLabels, renderCompileReport,
  CompileError, ENGINE_CLAIM_KEYS, ENGINE_ATTRIBUTE_KEYS,
  type Standard, type StandardBinding,
} from "../compile.js";
import { loadJson, probeSatisfying, probeEmpty } from "./support.js";

// ===========================================================================
// EXECUTABILITY — proven by EXECUTING, not by asserting.
//
// "A standard that has not been compiled is a wish." Compiling is necessary and
// not sufficient: an unknown claim key type-checks fine and then throws inside
// `evaluate` (src/server/productTest.ts:1088 uses a non-null assertion), so the
// only real proof is running the engine's own evaluator against every compiled
// Requirement.
//
// Two probes per requirement, because either one alone is uninformative:
//   • SATISFIABILITY — copy from the entry's own `accepted_evidence.example`
//     must produce a state the entry lists in `passing_states`. An assertion
//     nothing can satisfy is not a test, it is a permanent failure.
//   • REFUTABILITY — a product with nothing relevant must NOT pass. An assertion
//     nothing can fail carries zero information, which is the measured lesson of
//     the `price_under` row (0/13 fails) as much as of `cruelty_free` (13/13).
//
// Pure: no network, no DB, no model calls. `evaluate` is a pure function and the
// semantic tier is never invoked here.
// ===========================================================================

interface Entry {
  id: string; tier: string;
  accepted_evidence: Array<{ surface: string; form: string; example?: string }>;
  binding?: StandardBinding;
}

const TEXT_KINDS = new Set(["claim", "attribute", "delivery"]);

const STANDARDS = [
  { rel: "coffee/v1.0/standard.json", std: loadJson<Standard>("coffee/v1.0/standard.json") },
  // The generalisation-test draft. Held to the SAME compile and execute gates as the
  // finished standard: a partial draft may be incomplete, never unexecutable.
  { rel: "accessory/v0.1-draft/standard.json", std: loadJson<Standard>("accessory/v0.1-draft/standard.json") },
];

for (const { rel, std } of STANDARDS) {
  const label = rel.split("/")[0]!;
  const report = compileStandard(std);
  const entries = std.entries as unknown as Entry[];
  const byId = new Map(entries.map((e) => [e.id, e]));

  test(`[${label}] the standard compiles to engine Requirements with no errors`, () => {
    assert.deepEqual(
      report.errors.map((e) => e.message), [],
      `compile failed:\n${renderCompileReport(report)}`,
    );
    // An incomplete compile must never read as a clean one.
    assert.ok(report.expectedExecutable > 0, "the standard declares zero executable entries — compiling it proves nothing");
    assert.equal(
      report.requirements.length, report.expectedExecutable,
      `compiled ${report.requirements.length} of ${report.expectedExecutable} executable entries — an incomplete compile is not a pass`,
    );
    console.log(`  ${renderCompileReport(report)}`);
  });

  test(`[${label}] every engine label is unique`, () => {
    // The engine keys every lookup off `label`, never `id`
    // (productTest.ts:1478 kindOf, :1323 applySemanticTier; authenticatedTest.ts:175
    // diffAssertions). Duplicates silently update the wrong row.
    assert.deepEqual(duplicateLabels(report.requirements), [], "duplicate engine labels");
  });

  test(`[${label}] every compiled Requirement is accepted by the REAL evaluate()`, () => {
    for (const req of report.requirements) {
      const product = probeEmpty(req);
      let a;
      try {
        a = evaluate(product, req);
      } catch (e) {
        assert.fail(
          `${req.id} (${req.kind}${req.claim ? `:${req.claim}` : ""}${req.attribute ? `:${req.attribute}` : ""}) ` +
          `THREW inside evaluate: ${(e as Error).message}. This is what an invalid dictionary key looks like — ` +
          `not a failed row, a crashed test.`,
        );
      }
      assert.ok(
        ["pass_evidenced", "pass_no_blocking", "not_proven", "requires_store_access"].includes(a!.status),
        `${req.id} returned an unknown status ${a!.status}`,
      );
      assert.equal(a!.label, req.label, `${req.id}: evaluate returned label "${a!.label}" for requirement label "${req.label}"`);
    }
  });

  test(`[${label}] every text-based executable entry supplies an evidence EXAMPLE`, () => {
    // The satisfiability probe uses the entry's own published example. Without one
    // the probe would need a hand-picked string, and the test would stop measuring
    // the document.
    for (const req of report.requirements) {
      if (!TEXT_KINDS.has(req.kind)) continue;
      const e = byId.get(req.id)!;
      const examples = e.accepted_evidence.map((a) => a.example).filter((x): x is string => Boolean(x && x.trim()));
      assert.ok(
        examples.length >= 1,
        `${req.id} is a ${req.kind} entry with no accepted_evidence[].example — its accepted evidence is untested prose`,
      );
    }
  });

  test(`[${label}] SATISFIABILITY — the entry's own example produces a passing state`, () => {
    const failures: string[] = [];
    for (const req of report.requirements) {
      const e = byId.get(req.id)!;
      const passing = new Set<string>(e.binding!.passing_states);
      const examples = TEXT_KINDS.has(req.kind)
        ? e.accepted_evidence.map((a) => a.example).filter((x): x is string => Boolean(x && x.trim()))
        : [null];
      // ANY published example must satisfy it. A form listed as accepted evidence
      // that the engine does not accept is a false promise in the standard.
      for (const ex of examples) {
        const got = evaluate(probeSatisfying(req, ex), req).status;
        if (!passing.has(got)) {
          failures.push(
            `${req.id}: example ${JSON.stringify(ex ?? "<structural probe>")} produced ${got}, ` +
            `not one of ${[...passing].join("/")}`,
          );
        }
      }
    }
    assert.deepEqual(
      failures, [],
      `${failures.length} entr(ies) list accepted evidence the engine does not actually accept:\n${failures.join("\n")}`,
    );
  });

  test(`[${label}] REFUTABILITY — a product with nothing relevant does NOT pass`, () => {
    const failures: string[] = [];
    for (const req of report.requirements) {
      const e = byId.get(req.id)!;
      const passing = new Set<string>(e.binding!.passing_states);
      const got = evaluate(probeEmpty(req), req).status;
      if (passing.has(got)) {
        failures.push(`${req.id} (${req.kind}) PASSED on a product with no relevant evidence — status ${got}`);
      }
    }
    assert.deepEqual(
      failures, [],
      `${failures.length} assertion(s) cannot fail, and an assertion that cannot fail carries no information:\n${failures.join("\n")}`,
    );
  });

  test(`[${label}] the compiled contract has a stable fingerprint`, () => {
    // Same discipline as the engine's own contractVersion: a before/after comparison
    // is only evidence if both runs asked the same question of the same evaluator.
    const a = contractVersion(report.requirements);
    const b = contractVersion([...report.requirements].reverse());
    assert.match(a, /^c1-[0-9a-f]{8}$/);
    assert.equal(a, b, "contractVersion is order-dependent, so a reordered standard would refuse its own comparisons");
    console.log(`  ${label} engine contract fingerprint: ${a}`);
  });
}

// ===========================================================================
// THE COMPILER ITSELF — every guard proven to fire.
//
// Mutation discipline: a compiler check that has never been seen to reject
// anything is a check nobody has tested.
// ===========================================================================

const ok: StandardBinding = {
  req_kind: "claim", claim: "organic", label: "Organic row", passing_states: ["pass_evidenced"],
};

const rejects = (name: string, b: Partial<StandardBinding>, needle: RegExp): void => {
  test(`[compiler] rejects ${name}`, () => {
    assert.throws(
      () => bindingToRequirement("ALS-TEST-1.0-X-001", { ...ok, ...b } as StandardBinding),
      (e: unknown) => e instanceof CompileError && needle.test((e as Error).message),
      `expected a CompileError matching ${needle}`,
    );
  });
};

rejects("an unknown claim key (evaluate would THROW, not fail the row)",
  { req_kind: "claim", claim: "decaf_method" }, /unknown engine claim key/);
rejects("a claim binding with no claim key",
  { req_kind: "claim", claim: undefined }, /requires binding\.claim/);
rejects("the removed `origin` attribute",
  { req_kind: "attribute", attribute: "origin", claim: undefined }, /unknown engine attribute key.*was removed in v2\.8/s);
rejects("the never-shipped `warranty` attribute",
  { req_kind: "attribute", attribute: "warranty", claim: undefined }, /unknown engine attribute key/);
rejects("an attribute binding with no attribute key",
  { req_kind: "attribute", claim: undefined }, /requires binding\.attribute/);
rejects("a variant_option binding with no option value",
  { req_kind: "variant_option", claim: undefined }, /requires binding\.option_value/);
rejects("a price_under binding with no cap",
  { req_kind: "price_under", claim: undefined }, /requires a positive numeric binding\.cap_usd/);
rejects("an empty label", { label: "" }, /label is empty/);
rejects("empty passing_states", { passing_states: [] }, /passing_states is empty/);
rejects("no_subscription claiming pass_evidenced",
  { req_kind: "no_subscription", claim: undefined, passing_states: ["pass_evidenced"] },
  /can never return pass_evidenced/);
rejects("a claim row claiming pass_no_blocking",
  { passing_states: ["pass_no_blocking"] }, /never returns pass_no_blocking/);

test("[compiler] accepts every engine kind it claims to support", () => {
  const good: StandardBinding[] = [
    { req_kind: "claim", claim: "single_origin", label: "a", passing_states: ["pass_evidenced"] },
    { req_kind: "attribute", attribute: "dimensions", label: "b", passing_states: ["pass_evidenced"] },
    { req_kind: "variant_option", option_value: "Whole Bean", label: "c", passing_states: ["pass_evidenced"] },
    { req_kind: "price_under", cap_usd: 25, label: "d", passing_states: ["pass_evidenced"] },
    { req_kind: "in_stock", label: "e", passing_states: ["pass_evidenced"] },
    { req_kind: "no_subscription", label: "f", passing_states: ["pass_no_blocking"] },
    { req_kind: "delivery", label: "g", passing_states: ["pass_evidenced"] },
    { req_kind: "identifiers", label: "h", passing_states: ["pass_evidenced"] },
  ];
  const reqs: Requirement[] = good.map((b, i) => bindingToRequirement(`ALS-TEST-1.0-X-${String(i).padStart(3, "0")}`, b));
  assert.equal(reqs.length, 8, "the engine has eight requirement kinds and all eight must compile");
  // And every one of them must survive the real evaluator.
  for (const r of reqs) assert.doesNotThrow(() => evaluate(probeEmpty(r), r), `${r.kind} threw`);
});

test("[compiler] the mirrored engine dictionaries match reality", () => {
  // ENGINE_CLAIM_KEYS and ENGINE_ATTRIBUTE_KEYS mirror non-exported engine
  // constants and can drift. This executes the real evaluator against every
  // mirrored key: a key the engine no longer has throws, and a key the engine
  // has that we omitted is caught by the standard failing to compile.
  for (const k of ENGINE_CLAIM_KEYS) {
    const req: Requirement = { id: "t", kind: "claim", claim: k, label: `claim:${k}` };
    assert.doesNotThrow(
      () => evaluate(probeEmpty(req), req),
      `ENGINE_CLAIM_KEYS lists '${k}' but the engine's CLAIM_TERMS no longer has it — compile.ts has drifted`,
    );
  }
  for (const k of ENGINE_ATTRIBUTE_KEYS) {
    const req: Requirement = { id: "t", kind: "attribute", attribute: k, label: `attr:${k}` };
    assert.doesNotThrow(
      () => evaluate(probeEmpty(req), req),
      `ENGINE_ATTRIBUTE_KEYS lists '${k}' but the engine's ATTRIBUTE_SPECS no longer has it — compile.ts has drifted`,
    );
  }
  // The inverse direction, for the two keys whose removal is load-bearing history.
  for (const gone of ["origin", "warranty"]) {
    const req: Requirement = { id: "t", kind: "attribute", attribute: gone, label: `attr:${gone}` };
    assert.throws(
      () => evaluate(probeEmpty(req), req),
      `'${gone}' evaluates without throwing — it has come BACK into ATTRIBUTE_SPECS, and this standard's ` +
      `reasoning about provenance (ENGINE_GAPS G-01) needs revisiting`,
    );
  }
});
