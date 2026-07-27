import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lintStrings } from "../../src/server/claimLinter.js";
import { hashMatches, standardHash } from "../hash.js";
import { loadJson, STANDARDS_DIR } from "./support.js";
import { MINIMAL_VALID, deepClone } from "./fixtures.js";

// ===========================================================================
// GRAMMAR + GOVERNANCE INVARIANTS.
//
// Everything here is a rule the JSON Schema cannot express: cross-field
// consistency, the never-weaken attestation's window semantics, hash integrity,
// and the honesty vocabulary. Pure — no network, no DB, no model calls.
// ===========================================================================

interface Entry {
  id: string; question: string; tier: string;
  assertion: { subject: string; operator: string; expected: unknown };
  applicability: { applies_when: string; signal?: string };
  accepted_evidence: Array<{ surface: string; form: string; example?: string }>;
  insufficient_evidence: Array<{ form: string; why_not: string }>;
  conflict_rules: Array<{ when: string; resolution: string }>;
  public_inspectable: boolean;
  evidence_surfaces: string[];
  registry: { resolvable: boolean; engine_can_perform?: boolean; resolves_to_level?: string | null };
  predicted_discrimination: { predicted_fail_rate_band: string; in_target_band?: boolean; reasoning: string; measured: boolean };
  consumer_note: string; merchant_remediation: string;
  grounding: { demand_basis: string[]; citations: Array<{ source: string; url?: string; kind: string; establishes: string }>; refutation?: { challenged: string; verdict: string } };
  binding?: { req_kind: string; label: string; passing_states: string[]; claim?: string; attribute?: string; option_value?: string; cap_usd?: number };
  blocked_by?: string[];
  adversarial?: { attack: string; outcome: string; resolution?: string; residual_risk?: string };
  pass_means?: { establishes: string; does_not_establish: string };
  known_gaps?: Array<{ corpus_case: string; effect: string }>;
}
interface Standard {
  grammar_version: string; standard_id: string; version: string; title: string; status: string;
  posture: { independently_applied: boolean; statement: string };
  out_of_scope: Array<{ subject: string; why_not: string }>;
  engine_contract: { engine_version: string; requirement_kinds_used: string[]; verified_against_commit: string };
  changelog: Array<{ version: string; date: string; summary: string; changes: Array<{ entry_id: string; change_type: string; rationale: string; weakening_attestation?: { prior_failures_exist: boolean; remediation: string; attested_by: string; attested_date: string } }> }>;
  standard_hash: { algorithm: string; canonicalisation: string; value: string };
  entries: Entry[];
}

const STANDARDS: Array<{ rel: string; std: Standard }> = [
  { rel: "coffee/v1.0/standard.json", std: loadJson<Standard>("coffee/v1.0/standard.json") },
  // ⚠️ EVERY PUBLISHED VERSION IS LISTED HERE, and this list is why. v3.2's own lesson
  // was that "merging standards/ protected nothing until it was wired": an artifact the
  // governance suite does not load is an artifact with no governance. A new version that
  // is not in this array can violate every invariant below with the suite green.
  { rel: "coffee/v1.1/standard.json", std: loadJson<Standard>("coffee/v1.1/standard.json") },
];

/** The engine's non-public surfaces (src/server/productTest.ts:771-778 populates
 *  six surfaces publicly; metafields and the SEO field are authenticated-only),
 *  plus `external_register`, which the engine cannot read at all. */
const NON_PUBLIC_SURFACES = new Set(["product_metafield", "seo_description", "external_register"]);

// ---- gap ids, parsed from the actual document -------------------------------
const gapIds = (() => {
  const md = readFileSync(join(STANDARDS_DIR, "ENGINE_GAPS.md"), "utf8");
  const ids = [...md.matchAll(/^#+\s*(G-\d{2})\b/gm)].map((m) => m[1]!);
  return new Set(ids);
})();

test("[gaps] ENGINE_GAPS.md defines at least one gap, so cross-references can resolve", () => {
  assert.ok(gapIds.size > 0, "no `G-NN` headings found in ENGINE_GAPS.md — every blocked entry would dangle");
});

for (const { rel, std } of STANDARDS) {
  const label = rel.split("/")[0]!;
  const exec = std.entries.filter((e) => e.tier === "executable");
  const advisory = std.entries.filter((e) => e.tier === "advisory");
  const blocked = std.entries.filter((e) => e.tier === "blocked");
  const notDiscriminating = std.entries.filter((e) => e.tier === "not_discriminating");

  // ---- 1. ids -------------------------------------------------------------
  test(`[${label}] every id is unique and well-formed for its standard and version`, () => {
    const seen = new Set<string>();
    const expectedPrefix = `${std.standard_id}-${std.version}-`;
    for (const e of std.entries) {
      assert.ok(!seen.has(e.id), `duplicate entry id ${e.id}`);
      seen.add(e.id);
      assert.ok(
        e.id.startsWith(expectedPrefix),
        `${e.id} does not start with ${expectedPrefix} — a citation would not resolve to this standard`,
      );
      assert.match(e.id, /-[0-9]{3}$/, `${e.id} must end in a three-digit sequence`);
    }
    assert.ok(std.entries.length >= 1, "a standard with no entries adjudicates nothing");
  });

  // ---- 2. insufficient_evidence is the differentiator field ---------------
  test(`[${label}] insufficient_evidence is non-empty and substantive on EVERY entry`, () => {
    for (const e of std.entries) {
      assert.ok(
        e.insufficient_evidence.length >= 1,
        `${e.id} has an empty insufficient_evidence — that turns the assertion into a keyword match`,
      );
      for (const i of e.insufficient_evidence) {
        assert.ok(i.why_not.length >= 20, `${e.id}: "${i.form}" has a stub why_not (${i.why_not.length} chars)`);
      }
    }
  });

  // ---- 3. grounding is mandatory and not self-referential -----------------
  test(`[${label}] every entry cites real grounding`, () => {
    for (const e of std.entries) {
      assert.ok(e.grounding.citations.length >= 1, `${e.id} has no citation`);
      assert.ok(e.grounding.demand_basis.length >= 1, `${e.id} has no demand_basis`);
      for (const c of e.grounding.citations) {
        assert.ok(c.establishes.length >= 15, `${e.id}: citation "${c.source}" does not say what it establishes`);
        assert.ok(
          !/^common knowledge$|^well known$|^industry standard$/i.test(c.source),
          `${e.id}: "${c.source}" is not grounding`,
        );
        if (c.url) {
          assert.match(c.url, /^https?:\/\/[^\s]+$/, `${e.id}: malformed citation url ${c.url}`);
        }
      }
    }
  });

  test(`[${label}] no EXECUTABLE entry rests solely on a trade convention`, () => {
    // `trade_convention_only` is a warning label: a question the trade cares about
    // and shoppers may not. A standard whose executable core is trade concerns tests
    // merchants against their suppliers' interests rather than their buyers'.
    for (const e of exec) {
      const sole = e.grounding.demand_basis.length === 1 && e.grounding.demand_basis[0] === "trade_convention_only";
      assert.ok(!sole, `${e.id} is executable on trade_convention_only grounding alone`);
    }
  });

  // ---- 4. surfaces -------------------------------------------------------
  test(`[${label}] evidence_surfaces agrees with accepted_evidence`, () => {
    for (const e of std.entries) {
      const fromAccepted = [...new Set(e.accepted_evidence.map((a) => a.surface))].sort();
      const declared = [...new Set(e.evidence_surfaces)].sort();
      assert.deepEqual(
        declared, fromAccepted,
        `${e.id}: evidence_surfaces ${JSON.stringify(declared)} != surfaces in accepted_evidence ${JSON.stringify(fromAccepted)}`,
      );
    }
  });

  test(`[${label}] a public-tier entry never depends on a non-public surface`, () => {
    for (const e of std.entries) {
      if (!e.public_inspectable) continue;
      const bad = e.evidence_surfaces.filter((s) => NON_PUBLIC_SURFACES.has(s));
      assert.deepEqual(
        bad, [],
        `${e.id} claims public_inspectable but accepts ${bad.join(", ")} — a free test can never reach those, ` +
        `so the entry could never pass. (Public path surfaces: src/server/productTest.ts:771-778.)`,
      );
    }
  });

  test(`[${label}] an entry needing an external register is never executable`, () => {
    // The engine has no register client. `external_register` as accepted evidence
    // therefore forces tier=blocked, and `engine_can_perform` must be false everywhere.
    for (const e of std.entries) {
      if (e.evidence_surfaces.includes("external_register")) {
        assert.notEqual(e.tier, "executable", `${e.id} accepts external_register but claims to be executable`);
      }
      assert.notEqual(
        e.registry.engine_can_perform, true,
        `${e.id} claims the engine can perform a register lookup — no register client exists at grammar 1.0`,
      );
    }
  });

  // ---- 5. tier consistency ----------------------------------------------
  test(`[${label}] tier and binding agree`, () => {
    for (const e of exec) {
      assert.ok(e.binding, `${e.id} is executable with no binding`);
      assert.ok(e.adversarial, `${e.id} is executable with no adversarial record`);
      assert.ok(e.pass_means, `${e.id} is executable with no pass_means`);
      assert.ok(
        std.engine_contract.requirement_kinds_used.includes(e.binding!.req_kind),
        `${e.id} binds to '${e.binding!.req_kind}' which is not declared in engine_contract.requirement_kinds_used`,
      );
    }
    for (const e of advisory) {
      assert.equal(e.binding, undefined, `${e.id} is advisory but carries a binding — a bound advisory entry lies about what runs`);
    }
    for (const e of blocked) {
      assert.ok(e.blocked_by && e.blocked_by.length >= 1, `${e.id} is blocked with no blocked_by`);
      for (const g of e.blocked_by!) {
        assert.ok(gapIds.has(g), `${e.id} references ${g}, which is not defined in ENGINE_GAPS.md`);
      }
    }
    for (const e of notDiscriminating) {
      assert.equal(e.binding, undefined, `${e.id} is not_discriminating but carries a binding — it must not be run`);
    }
  });

  test(`[${label}] not_discriminating is only used where the band really is outside target`, () => {
    // The tier exists because the three-tier split conflated "the engine cannot" with
    // "the engine should not". It must not become a place to park inconvenient
    // assertions: the predicted band has to actually be outside 15-85%.
    for (const e of notDiscriminating) {
      const m = /^(\d{1,3})-(\d{1,3})%$/.exec(e.predicted_discrimination.predicted_fail_rate_band)!;
      const lo = Number(m[1]), hi = Number(m[2]);
      assert.ok(
        lo < 15 || hi > 85,
        `${e.id} is filed as not_discriminating but predicts ${lo}-${hi}%, which is inside the target band — ` +
        `if it discriminates, run it`,
      );
      assert.equal(
        e.predicted_discrimination.in_target_band, false,
        `${e.id} is not_discriminating with in_target_band=true`,
      );
    }
  });

  test(`[${label}] pass_no_blocking is claimed only where the engine can produce it`, () => {
    // src/server/productTest.ts:1179-1183 — `no_subscription` is the ONLY kind that
    // returns pass_no_blocking, and it can never return pass_evidenced. Claiming
    // either elsewhere claims a proof strength the engine does not deliver.
    for (const e of exec) {
      const b = e.binding!;
      const absence = b.req_kind === "no_subscription";
      for (const st of b.passing_states) {
        if (st === "pass_no_blocking") {
          assert.ok(absence, `${e.id} (${b.req_kind}) lists pass_no_blocking, which only no_subscription produces`);
        }
        if (st === "pass_evidenced") {
          assert.ok(!absence, `${e.id} is no_subscription and can never reach pass_evidenced`);
        }
      }
    }
  });

  // ---- 6. the claim linter, run for real --------------------------------
  test(`[${label}] no rendered string trips the REAL claim linter`, () => {
    // `binding.label` becomes `Assertion.label` and is linted by the engine, where a
    // single violation returns the merchant's ENTIRE report as `unreachable`
    // (src/server/productTest.ts:1560-1571). The other fields are published-document
    // strings; linting them too is stricter than the engine requires and deliberate.
    for (const e of std.entries) {
      const strings: Array<string | undefined> = [
        e.binding?.label, e.question, e.consumer_note, e.merchant_remediation,
        e.pass_means?.establishes, e.pass_means?.does_not_establish,
        ...e.insufficient_evidence.map((i) => i.form),
        ...e.accepted_evidence.map((a) => a.form),
      ];
      const r = lintStrings(strings);
      assert.ok(
        r.ok,
        `${e.id} contains claim-linter violations: ` +
        r.violations.map((v) => `${v.rule}: "${v.excerpt}"`).join(" | "),
      );
    }
    const top = lintStrings([std.title, std.posture.statement, ...std.out_of_scope.map((o) => o.why_not)]);
    assert.ok(top.ok, `standard-level prose trips the linter: ${top.violations.map((v) => `${v.rule}: "${v.excerpt}"`).join(" | ")}`);
  });

  // ---- 7. the honesty vocabulary ----------------------------------------
  test(`[${label}] the forbidden self-description vocabulary appears nowhere`, () => {
    const NEVER = [/standards? body/i, /\baccredited\b/i, /trusted by/i, /\bguarantee/i];
    const blob = JSON.stringify(std);
    for (const re of NEVER) {
      const m = re.exec(blob);
      assert.equal(m, null, `forbidden term ${re} appears in the standard: "${blob.slice(Math.max(0, (m?.index ?? 0) - 60), (m?.index ?? 0) + 60)}"`);
    }
  });

  test(`[${label}] certification vocabulary is never used to describe what THIS standard produces`, () => {
    // The brief forbids "certification"/"certified" outright. A coffee standard
    // cannot honour that literally and still name USDA Organic as an evidence form —
    // the engine's own CLAIM_TERMS contains the string "certified organic". So the
    // rule is enforced where it actually matters: the words may name a THIRD PARTY's
    // scheme in evidence, registry and grounding fields, and may never appear in any
    // field that describes what AisleLens or this standard is or produces.
    const selfDescribing: Array<[string, string | undefined]> = [
      ["title", std.title],
      ["posture.statement", std.posture.statement],
      ...std.entries.flatMap((e): Array<[string, string | undefined]> => [
        [`${e.id}.binding.label`, e.binding?.label],
        [`${e.id}.pass_means.establishes`, e.pass_means?.establishes],
        [`${e.id}.assertion.subject`, e.assertion.subject],
      ]),
    ];
    for (const [where, s] of selfDescribing) {
      if (!s) continue;
      assert.ok(
        !/certif/i.test(s),
        `${where} uses certification vocabulary to describe what this standard produces: "${s}"`,
      );
    }
  });

  // ---- 8. discrimination is a hypothesis, never a fact ------------------
  test(`[${label}] every executable entry predicts a band, in range, and its measured flag matches reality`, () => {
    for (const e of exec) {
      const d = e.predicted_discrimination;
      // ⚠️ THIS USED TO ASSERT `measured === false` UNCONDITIONALLY, with the message
      // "this standard has never been run". That was true of every AisleLens standard
      // until v1.0 was executed against 100 real coffee products — and an invariant
      // that hard-codes a fact about the world goes false the day the world changes.
      // What it should have been asserting all along is the CONSISTENCY: the flag and
      // the evidence for it must agree in both directions. A `measured: true` with no
      // measurement is a claim about a run that did not happen; a `measured: false`
      // sitting next to a recorded measurement is a document understating itself, which
      // is the exact class of error v1.1 exists to correct.
      const meas = (e as unknown as { measured_discrimination?: { fail_rate_pct: number; asked: number; source: string } }).measured_discrimination;
      assert.equal(
        d.measured, meas !== undefined,
        meas
          ? `${e.id} carries a measured_discrimination block but predicted_discrimination.measured is false`
          : `${e.id} claims a MEASURED discrimination rate with no measured_discrimination block to back it`,
      );
      if (meas) {
        assert.ok(meas.asked > 0, `${e.id}: a measured rate over zero products asked is not a measurement`);
        assert.ok(meas.source.length > 8, `${e.id}: a measurement with no source cannot be checked by anyone`);
      }
      const m = /^(\d{1,3})-(\d{1,3})%$/.exec(d.predicted_fail_rate_band);
      assert.ok(m, `${e.id} has a malformed band ${d.predicted_fail_rate_band}`);
      const lo = Number(m![1]), hi = Number(m![2]);
      assert.ok(lo < hi, `${e.id}: band ${lo}-${hi}% is not an interval`);
      assert.ok(hi <= 100, `${e.id}: band upper bound ${hi} exceeds 100`);
      // 15-85% is the target. Outside it the assertion carries little information —
      // and if an author chose to ship it anyway, the reasoning must say so
      // explicitly rather than the flag silently disagreeing with the numbers.
      const inBand = lo >= 15 && hi <= 85;
      if (e.predicted_discrimination.in_target_band !== undefined) {
        assert.equal(
          e.predicted_discrimination.in_target_band, inBand,
          `${e.id}: in_target_band=${e.predicted_discrimination.in_target_band} disagrees with the band ${lo}-${hi}%`,
        );
      }
      if (!inBand) {
        assert.match(
          d.reasoning, /information|discriminat|band|uniform|everyone|no one/i,
          `${e.id} predicts ${lo}-${hi}%, outside the 15-85% target, and its reasoning does not address that`,
        );
      }
    }
  });

  // ---- 9. adversarial records are substantive --------------------------
  test(`[${label}] every executable entry was actually attacked`, () => {
    for (const e of exec) {
      const a = e.adversarial!;
      assert.ok(a.attack.length >= 25, `${e.id}: the attack is too short to be an attack`);
      if (a.outcome === "survived_unchanged") {
        // An entry that survived with no residual risk is an entry whose attacker
        // was not trying. Honest residual risk beats a claim of immunity.
        assert.ok(
          a.residual_risk && a.residual_risk.length >= 25,
          `${e.id} claims survived_unchanged with no stated residual risk`,
        );
      } else {
        assert.ok(a.resolution && a.resolution.length >= 20, `${e.id}: outcome ${a.outcome} with no resolution`);
      }
    }
  });

  // ---- 10. THE NEVER-WEAKEN RULE --------------------------------------
  test(`[${label}] no weakening ships without a consistent attestation`, () => {
    for (const rel of std.changelog) {
      for (const c of rel.changes) {
        if (c.change_type !== "weakened" && c.change_type !== "demoted") continue;
        const att = c.weakening_attestation;
        assert.ok(att, `${rel.version} ${c.entry_id}: ${c.change_type} with no weakening_attestation`);
        if (att!.prior_failures_exist) {
          assert.ok(
            att!.remediation === "results_reissued" || att!.remediation === "results_invalidated",
            `${rel.version} ${c.entry_id}: failures exist under the prior form but remediation is ` +
            `'${att!.remediation}'. A weakening that leaves standing failures in place under the old ` +
            `text is exactly the event the never-weaken rule forbids.`,
          );
        } else {
          assert.equal(
            att!.remediation, "not_applicable_no_failures",
            `${rel.version} ${c.entry_id}: no prior failures, so remediation must be not_applicable_no_failures`,
          );
        }
      }
    }
  });

  test(`[${label}] every changelog entry_id resolves, in this version or a prior one`, () => {
    // The changelog is a HISTORY, and an entry id carries its version — so a release
    // block written for 1.0 names `ALS-COFFEE-1.0-…` ids, which do not exist in a 1.1
    // document. Resolving only against the current ids would force a reissue to either
    // rewrite its own history or drop it, and both destroy the thing a changelog is for.
    // `supersedes` is what makes the chain resolvable: an id resolves if some entry IS
    // it or CONTINUES it.
    const ids = new Set(std.entries.map((e) => e.id));
    for (const e of std.entries) {
      const sup = (e as unknown as { supersedes?: string }).supersedes;
      if (sup) ids.add(sup);
    }
    for (const r of std.changelog) {
      for (const c of r.changes) {
        // A `withdrawn` change legitimately names an entry that no longer exists.
        if (c.change_type === "withdrawn") continue;
        assert.ok(ids.has(c.entry_id), `changelog ${r.version} references unknown entry ${c.entry_id}`);
      }
    }
  });

  // ---- 11. hash integrity ---------------------------------------------
  test(`[${label}] standard_hash matches the content`, () => {
    const h = hashMatches(std);
    assert.ok(
      h.ok,
      `standard_hash is stale.\n  stored:   ${h.stored}\n  computed: ${h.computed}\n` +
      `Run \`node --import tsx standards/rehash.ts\` and commit the result. A citation that resolves ` +
      `to the wrong text is worse than one that does not resolve.`,
    );
    assert.equal(std.standard_hash.algorithm, "sha256");
    assert.equal(std.standard_hash.canonicalisation, "json-sorted-keys-no-hash-field");
  });

  // ---- 12. self-bounding -----------------------------------------------
  test(`[${label}] the standard states what it does not adjudicate`, () => {
    assert.ok(std.out_of_scope.length >= 3, "a standard that does not bound itself will be read as bounding nothing");
    assert.equal(
      std.posture.independently_applied, false,
      "independently_applied may only become true once a second party has applied this standard without us",
    );
  });

  // ---- 13. the ratio is honest ------------------------------------------
  test(`[${label}] most questions are NOT executable, and the document says so`, () => {
    const total = std.entries.length;
    const ratio = exec.length / total;
    assert.ok(
      ratio < 0.5,
      `${exec.length}/${total} entries are executable (${Math.round(ratio * 100)}%). Most real buyer ` +
      `questions cannot be adjudicated from public data; a standard claiming otherwise has either ` +
      `chosen only the easy questions or is overstating one of them.`,
    );
    assert.ok(exec.length >= 8, `only ${exec.length} executable entries — too few to be a conformance test`);
    assert.ok(advisory.length >= 1 && blocked.length >= 1, "a standard with no advisory or blocked entries is hiding something");
  });
}

// ===========================================================================
// THE GENERALISATION-TEST DRAFT.
//
// Held to every PER-ENTRY invariant the finished standard is held to, and NOT to
// the completeness gates (group 13's executable count and executable/advisory
// ratio), because it is deliberately a partial slice of its category. A partial
// draft may be incomplete; it may not be sloppy, ungrounded, or unlinted.
// ===========================================================================

const DRAFT = loadJson<Standard>("accessory/v0.1-draft/standard.json");

test("[accessory-draft] per-entry invariants hold exactly as they do for the finished standard", () => {
  const seen = new Set<string>();
  const prefix = `${DRAFT.standard_id}-${DRAFT.version}-`;
  for (const e of DRAFT.entries) {
    assert.ok(!seen.has(e.id), `duplicate id ${e.id}`);
    seen.add(e.id);
    assert.ok(e.id.startsWith(prefix), `${e.id} does not start with ${prefix}`);
    assert.ok(e.insufficient_evidence.length >= 1, `${e.id} has empty insufficient_evidence`);
    for (const i of e.insufficient_evidence) {
      assert.ok(i.why_not.length >= 20, `${e.id}: stub why_not on "${i.form}"`);
    }
    assert.ok(e.grounding.citations.length >= 1, `${e.id} has no citation`);
    assert.deepEqual(
      [...new Set(e.evidence_surfaces)].sort(),
      [...new Set(e.accepted_evidence.map((a) => a.surface))].sort(),
      `${e.id}: evidence_surfaces disagrees with accepted_evidence`,
    );
    if (e.public_inspectable) {
      assert.deepEqual(
        e.evidence_surfaces.filter((s) => NON_PUBLIC_SURFACES.has(s)), [],
        `${e.id} claims public_inspectable but accepts a non-public surface`,
      );
    }
    assert.equal(e.predicted_discrimination.measured, false, `${e.id} claims a measured rate`);
    if (e.tier === "executable") {
      assert.ok(e.binding && e.adversarial && e.pass_means, `${e.id} is executable but incomplete`);
      assert.ok(
        DRAFT.engine_contract.requirement_kinds_used.includes(e.binding!.req_kind),
        `${e.id} binds to an undeclared requirement kind`,
      );
    }
    if (e.tier === "blocked") {
      assert.ok(e.blocked_by && e.blocked_by.length >= 1, `${e.id} is blocked with no blocked_by`);
      for (const g of e.blocked_by!) {
        assert.ok(gapIds.has(g), `${e.id} references ${g}, which is not defined in ENGINE_GAPS.md`);
      }
    }
    const lint = lintStrings([
      e.binding?.label, e.question, e.consumer_note, e.merchant_remediation,
      e.pass_means?.establishes, e.pass_means?.does_not_establish,
    ]);
    assert.ok(lint.ok, `${e.id} trips the claim linter: ${lint.violations.map((v) => v.rule).join(", ")}`);
  }
  assert.ok(DRAFT.entries.length >= 5, "too thin to test anything about the grammar");
});

test("[accessory-draft] the buyer-parameter operator carries its parameter", () => {
  // The grammar change this draft produced. An entry whose expected value is
  // supplied at test time must declare that parameter, and no other entry may.
  for (const e of DRAFT.entries) {
    const needsParam = e.assertion.operator === "includes_buyer_parameter";
    assert.equal(
      Boolean((e as unknown as { buyer_parameter?: unknown }).buyer_parameter), needsParam,
      `${e.id}: buyer_parameter presence must match the includes_buyer_parameter operator`,
    );
  }
  const withParam = DRAFT.entries.filter((e) => e.assertion.operator === "includes_buyer_parameter");
  assert.ok(
    withParam.length >= 1,
    "the draft exists to exercise the buyer-parameter operator; if no entry uses it, the grammar change is untested",
  );
  // And it must never be executable, because the engine cannot accept a test-time parameter.
  for (const e of withParam) assert.notEqual(e.tier, "executable", `${e.id} cannot be executable — see ENGINE_GAPS G-13`);
});

test("[accessory-draft] its hash matches its content", () => {
  const h = hashMatches(DRAFT);
  assert.ok(h.ok, `draft hash is stale.\n  stored:   ${h.stored}\n  computed: ${h.computed}`);
});

// ---- 14. the governance check is not vacuous -------------------------------

test("[governance] the never-weaken check FAILS on a contradictory attestation", () => {
  // A governance check nobody has watched fail is a governance check nobody has
  // tested. This is the negative fixture for group 10.
  const bad = deepClone(MINIMAL_VALID) as unknown as Standard;
  bad.changelog[0]!.changes[0] = {
    entry_id: "ALS-FIXTURE-1.0-TEST-001",
    change_type: "weakened",
    rationale: "Loosened the accepted evidence after a merchant complained about failing this row.",
    weakening_attestation: {
      prior_failures_exist: true,
      remediation: "not_applicable_no_failures", // the contradiction
      attested_by: "nobody",
      attested_date: "2026-07-26",
    },
  };
  const violations: string[] = [];
  for (const rel of bad.changelog) {
    for (const c of rel.changes) {
      if (c.change_type !== "weakened" && c.change_type !== "demoted") continue;
      const att = c.weakening_attestation!;
      if (att.prior_failures_exist && att.remediation === "not_applicable_no_failures") {
        violations.push(`${c.entry_id}: standing failures left in place under the old text`);
      }
    }
  }
  assert.deepEqual(
    violations, ["ALS-FIXTURE-1.0-TEST-001: standing failures left in place under the old text"],
    "the never-weaken consistency rule did not fire on a deliberately contradictory attestation",
  );
});

test("[governance] the hash check FAILS on a standard whose hash is wrong", () => {
  // Same discipline: prove the hash check can fail. The fixture's hash is 64 `f`s
  // and cannot be the real digest of its own content.
  const h = hashMatches(MINIMAL_VALID);
  assert.equal(h.ok, false, "the hash check accepted a fixture with a placeholder hash — it is not checking anything");
  assert.match(standardHash(MINIMAL_VALID), /^[0-9a-f]{64}$/);
});
