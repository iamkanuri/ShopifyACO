import { test } from "node:test";
import assert from "node:assert/strict";
import { hashMatches, standardHash } from "../hash.js";
import { loadJson } from "./support.js";
import { compileStandard } from "../compile.js";
import { validate, renderResult } from "../validate.js";
import { assertSidecarCoversStandard, type Sidecar } from "../applicability.js";
import {
  ALL_RULES, checkMeasuredDiscrimination, checkCategoryFitness, checkRetirementAttested,
  wilson95, verdictFor, TARGET_BAND, type RuleError,
} from "../discrimination.js";

// ===========================================================================
// REISSUING A STANDARD (v3.3 CP-B).
//
// v1.0's posture went false about itself the day it was published, and in the
// direction that UNDERSTATES the work: it said it "is not published" while sitting
// at a stable URL in sitemap.xml, said "every failure rate in it is a prediction"
// after ten of them had been measured on 100 real products, and said it "has never
// been applied to a real store by anyone" after we had applied it. A document that is
// wrong about itself is the failure mode this project treats as unrecoverable, and it
// does not become acceptable because the error is modest.
//
// The fix is a NEW VERSION, not an edit, because `standard_hash` is what a citation
// resolves through. These tests hold the two properties that make reissuing safe:
//
//   1. THE OLD VERSION IS FROZEN. Its hash is pinned to a literal here, so an edit to
//      v1.0's bytes fails the build rather than silently invalidating every citation
//      already made against it.
//   2. NOTHING DISAPPEARS QUIETLY. Every v1.0 entry either has a v1.1 successor that
//      names it in `supersedes`, or is listed in `withdrawn_entries` with a reason. A
//      question that vanishes between versions is a coverage change no reader can see —
//      the same defect class as a conformance list that silently drops entries.
// ===========================================================================

interface Entry {
  id: string; tier: string; supersedes?: string;
  predicted_discrimination: { predicted_fail_rate_band: string; measured: boolean; reasoning: string };
  measured_discrimination?: { fail_rate_pct: number; asked: number; verdict: string; carries_information: boolean; source: string };
  [k: string]: unknown;
}
interface Doc {
  grammar_version: string; version: string; status: string;
  posture: { independently_applied: boolean; statement: string };
  entries: Entry[];
  withdrawn_entries?: Array<{ entry_id: string; reason: string }>;
  measured_fitness?: {
    measured_at: string; bands_held: number; bands_total: number;
    samples: Array<{ name: string; pass_rows_audited: number; confirmed_false_positives: number; bound_95_cluster_icc02_pct: number; is_floor?: boolean; defect_classes?: Array<{ klass: string; count: number; addressed_by_a_guard?: boolean }> }>;
  };
  [k: string]: unknown;
}

/** A grammar-1.2 entry. `predicted_discrimination` is FORBIDDEN there and the
 *  measurement carries an interval, a derived minimum n and a sample. */
interface Entry12 {
  id: string; tier: string; supersedes?: string; unbound_reason?: string;
  binding?: unknown;
  discrimination_prediction?: { direction: string; confidence: string; reasoning: string; notes?: string };
  predicted_discrimination?: unknown;
  measured_discrimination?: {
    verdict: string; n_asked: number; n_adjudicated: number; fail_count: number; fail_rate_pct: number;
    interval_95: { lower_pct: number; upper_pct: number };
    target_band?: { lower_pct: number; upper_pct: number };
    decision_rule: string; measured_on: string;
    sample: { stores: number; category_scope: string; category_standard_id?: string };
    instrument_bias?: Array<{ source: string; direction: string; magnitude_pp?: number }>;
    notes?: string;
  };
  [k: string]: unknown;
}
interface Doc12 {
  grammar_version: string; version: string; status: string; standard_id: string;
  posture: { independently_applied: boolean; statement: string };
  entries: Entry12[];
  withdrawn_entries?: Array<{ entry_id: string; reason: string }>;
  category_fitness?: Record<string, unknown>;
  measured_fitness?: unknown;
  changelog: Array<{ version: string; changes: Array<{ entry_id: string; change_type: string; weakening_attestation?: unknown }> }>;
  [k: string]: unknown;
}

const V10 = loadJson<Doc>("coffee/v1.0/standard.json");
const V11 = loadJson<Doc>("coffee/v1.1/standard.json");
const V12 = loadJson<Doc12>("coffee/v1.2/standard.json");
const V13 = loadJson<Doc12>("coffee/v1.3/standard.json");

/** ⚠️ LITERALS, ON PURPOSE. Recomputing them from the files would make these tests
 *  agree with whatever the files happen to say today, which is exactly the check that
 *  is worth nothing. These are the values published on the site, in llms.txt, and in
 *  every citation made against v1.0 and v1.1.
 *
 *  ⚠️ v1.1's WAS ONLY RECOMPUTED UNTIL v1.2 SHIPPED. This file's own comment called
 *  that the check that is worth nothing, and then the newer of the two versions was
 *  left with exactly it — the frozen-ness of a version was being asserted only for as
 *  long as it was the oldest one. Every published version gets a literal.
 *
 *  ⚠️ AND IT HAPPENED AGAIN, ONE VERSION LATER. v1.2 shipped with a three-ways test
 *  (stored == recomputed, and distinct from its predecessors) and NO literal, which
 *  cannot see an edit at all: change v1.2's bytes and rerun `issue`/`rehash`, and
 *  stored still equals recomputed and the two `notEqual`s still hold. The rule is not
 *  "pin the oldest ones" — it is that a version is pinned the moment a SUCCESSOR
 *  exists, because that is the moment it stops being the file anyone is editing and
 *  starts being only a citation target. v1.2 gets its literal here. */
const V10_FROZEN_HASH = "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5";
const V11_FROZEN_HASH = "f8ec2780f60c38931913e5b6cd37506500c8462709209de7180ba6691d6137e7";
const V12_FROZEN_HASH = "fe199a864d3d4d565986851f9bfae9e108d55e4c86af18b1f8027f3d23486b58";

test("[version] v1.0 IS BYTE-FROZEN — its hash is the one every citation resolves through", () => {
  assert.equal(
    standardHash(V10), V10_FROZEN_HASH,
    "coffee/v1.0/standard.json has changed. Every citation made against it now resolves to a different text. " +
    "If the change is intended, it is a NEW VERSION, not an edit — that is what v1.1 is for.",
  );
  const h = hashMatches(V10);
  assert.ok(h.ok, "v1.0's own stored standard_hash disagrees with its bytes");
});

test("[version] v1.1 IS BYTE-FROZEN TOO — pinned to a literal, not merely recomputed", () => {
  assert.equal(
    standardHash(V11), V11_FROZEN_HASH,
    "coffee/v1.1/standard.json has changed. Every citation made against it now resolves to a different text. " +
    "If the change is intended, it is a NEW VERSION, not an edit — that is what v1.2 is for.",
  );
  const h = hashMatches(V11);
  assert.ok(h.ok, "v1.1's own stored standard_hash disagrees with its bytes");
  assert.notEqual(V11_FROZEN_HASH, V10_FROZEN_HASH);
});

test("[version] v1.2 IS BYTE-FROZEN TOO — pinned to a literal now that v1.3 supersedes it", () => {
  assert.equal(
    standardHash(V12), V12_FROZEN_HASH,
    "coffee/v1.2/standard.json has changed. Every citation made against it now resolves to a different text. " +
    "If the change is intended, it is a NEW VERSION, not an edit — that is what v1.3 is for.",
  );
  const h = hashMatches(V12);
  assert.ok(h.ok, "v1.2's own stored standard_hash disagrees with its bytes");
  assert.notEqual(V12_FROZEN_HASH, V10_FROZEN_HASH);
  assert.notEqual(V12_FROZEN_HASH, V11_FROZEN_HASH);
});

test("[version] v1.3's hash agrees three ways: stored, recomputed, and distinct from all three predecessors", () => {
  const h = hashMatches(V13);
  assert.ok(h.ok, `v1.3's stored hash ${h.stored} does not match its content ${h.computed}`);
  assert.equal(h.computed, standardHash(V13), "recomputing v1.3's hash does not reproduce it");
  for (const [name, frozen] of [["v1.0", V10_FROZEN_HASH], ["v1.1", V11_FROZEN_HASH], ["v1.2", V12_FROZEN_HASH]] as const) {
    assert.notEqual(h.computed, frozen, `v1.3 hashes identically to ${name} — then it is not a new version`);
  }
  assert.match(h.computed, /^[0-9a-f]{64}$/);
});

test("[version] EVERY v1.0 entry survives into v1.1, or is withdrawn WITH A REASON", () => {
  const superseded = new Map<string, string>();
  for (const e of V11.entries) {
    if (!e.supersedes) continue;
    assert.ok(!superseded.has(e.supersedes), `two v1.1 entries both supersede ${e.supersedes}`);
    superseded.set(e.supersedes, e.id);
  }
  const withdrawn = new Map((V11.withdrawn_entries ?? []).map((w) => [w.entry_id, w.reason]));

  const orphans: string[] = [];
  for (const old of V10.entries) {
    if (superseded.has(old.id)) continue;
    const reason = withdrawn.get(old.id);
    if (!reason) { orphans.push(old.id); continue; }
    assert.ok(reason.length >= 20, `${old.id} is withdrawn with a reason too short to be one: ${JSON.stringify(reason)}`);
  }
  assert.deepEqual(
    orphans, [],
    "these v1.0 entries have no v1.1 successor and are not listed as withdrawn — a question that disappears between versions is a coverage change nobody can see",
  );

  // And nothing is invented: every `supersedes` must name a real v1.0 entry.
  const oldIds = new Set(V10.entries.map((e) => e.id));
  for (const e of V11.entries) {
    if (e.supersedes) assert.ok(oldIds.has(e.supersedes), `${e.id} supersedes ${e.supersedes}, which is not in v1.0`);
  }
});

test("[version] v1.1 says the four true things about itself, and keeps the one that still binds", () => {
  assert.equal(V11.status, "applied_by_author",
    "`draft` is now false (it has been applied, to 100 real products) and `published` would be a lie (no second party has run it)");
  assert.equal(V11.posture.independently_applied, false,
    "independently_applied may only become true once a second party has applied this standard without us");

  const s = V11.posture.statement;
  // The four clauses, each asserted on its own so a rewrite cannot quietly drop one.
  assert.match(s, /applied to real stores by its author/i, "the posture must say WE have applied it");
  assert.match(s, /no second party/i, "the posture must say no second party has");
  assert.match(s, /published/i, "the posture must stop claiming it is unpublished");
  assert.match(s, /measured, not predicted|MEASURED, not predicted/i, "the posture must stop calling its measured rates predictions");
  // The promotion rule has to be IN the document: the document's own bar must survive
  // its own promotion, or the bar is whatever the next author feels like.
  assert.match(s, /may only become `?published`? once a second party/i,
    "the promotion rule is not written into the document");

  // v1.0's posture said three things that are now false. It stays exactly as it was —
  // that is what freezing means — so this asserts the OLD text is still the old text.
  assert.match(V10.posture.statement, /is not published/, "v1.0's posture was edited; it is frozen");
  assert.equal(V10.status, "draft", "v1.0's status was edited; it is frozen");
});

test("[version] MEASURED discrimination is published BESIDE the prediction, never in place of it", () => {
  const exec = V11.entries.filter((e) => e.tier === "executable");
  assert.ok(exec.length >= 10, `expected 10 executable entries, got ${exec.length}`);
  for (const e of exec) {
    const m = e.measured_discrimination;
    assert.ok(m, `${e.id} is executable in a measured version and carries no measurement`);
    // THE PREDICTION SURVIVES. A document that shows its own hypothesis failing is
    // making the strongest possible case that its numbers are measured; rewriting the
    // band to match the outcome would erase exactly that.
    assert.match(e.predicted_discrimination.predicted_fail_rate_band, /^\d{1,3}-\d{1,3}%$/,
      `${e.id}: the predicted band was dropped when the measurement landed`);
    assert.equal(e.predicted_discrimination.measured, true);
    // `carries_information` is DERIVED from the measured rate and the grammar's own
    // 15-85% target band, so it cannot be asserted independently of the number.
    assert.equal(
      m!.carries_information, m!.fail_rate_pct >= 15 && m!.fail_rate_pct <= 85,
      `${e.id}: carries_information disagrees with its own measured rate ${m!.fail_rate_pct}%`,
    );
  }

  // THREE DIFFERENT NUMBERS, and the site must not run them together.
  //   bands held        — how often the PREDICTION was right
  //   above band        — how many discriminate LESS than predicted
  //   carries info      — how many MEASURED rates sit inside the target band
  const held = exec.filter((e) => e.measured_discrimination!.verdict === "held").length;
  const above = exec.filter((e) => e.measured_discrimination!.verdict === "above_band").length;
  const carries = exec.filter((e) => e.measured_discrimination!.carries_information).length;
  assert.equal(held, V11.measured_fitness!.bands_held, "bands_held disagrees with the per-entry verdicts");
  assert.equal(held + above + exec.filter((e) => e.measured_discrimination!.verdict === "below_band").length, exec.length);
  assert.notEqual(carries, held, "if these two numbers were equal the distinction would be untested here");
});

test("[version] the measurement is INSIDE v1.1 and stays in a SIDECAR for v1.0", () => {
  // The rule is not "measurements live outside the document". It is: a measurement
  // taken AFTER a version is published must not change that version's bytes, because a
  // citation resolves through its hash. v1.0's measurement came after v1.0 shipped, so
  // it is a sidecar. v1.1's came before v1.1 existed, so it is in the document, covered
  // by the hash, and cannot drift from it.
  const f = V11.measured_fitness;
  assert.ok(f, "v1.1 carries no measurement — then there was no reason to reissue");
  const coffee = f!.samples.find((s) => s.name === "coffee");
  assert.ok(coffee, "the coffee sample is missing from v1.1's measured fitness");
  assert.ok(coffee!.pass_rows_audited >= 100, "the audited row count is implausibly small");
  assert.ok(coffee!.confirmed_false_positives > 0,
    "a fitness measurement reporting ZERO confirmed false positives is the number this project has been wrong about three times; if it is genuinely zero, say so in the method");
  assert.ok(coffee!.bound_95_cluster_icc02_pct > coffee!.confirmed_false_positives / coffee!.pass_rows_audited * 100,
    "the 95% upper bound is below the point estimate");

  // The general sample is a FLOOR and must be labelled as one — comparing a partial
  // re-check against a complete audit as peers is a bigger error than either number.
  const general = f!.samples.find((s) => s.name === "general");
  assert.ok(general, "the general sample is missing");
  assert.equal(general!.is_floor, true, "the general sample is a floor and must say so");

  // Every defect class is named, with its count, and the class no guard addresses is
  // flagged. Publishing that is the point.
  assert.ok((coffee!.defect_classes ?? []).length >= 4, "fewer than four defect classes named");
  const total = (coffee!.defect_classes ?? []).reduce((n, c) => n + c.count, 0);
  assert.equal(total, coffee!.confirmed_false_positives,
    `the defect classes account for ${total} errors but the sample records ${coffee!.confirmed_false_positives}`);
  assert.ok((coffee!.defect_classes ?? []).some((c) => c.addressed_by_a_guard === false),
    "no defect class is flagged as unaddressed — v3.2 measured at least one the engine has no mechanism for");
});

test("[version] v1.1 compiles and its applicability sidecar covers exactly its executable entries", () => {
  const report = compileStandard(V11 as never);
  assert.deepEqual(report.errors, [], "v1.1 does not compile");
  assert.ok(report.requirements.length >= 10, `only ${report.requirements.length} requirements compiled from v1.1`);
  const sidecar = loadJson<Sidecar>("coffee/v1.1/applicability.json");
  const cov = assertSidecarCoversStandard(sidecar, report.requirements.map((r) => r.id));
  assert.deepEqual(cov.missing, [], "v1.1 executable entries with no applicability rule — they would default to 'always applies'");
  assert.deepEqual(cov.stale, [], "v1.1 sidecar rules for entries that do not exist");
});

test("[version] the two versions ask the SAME questions — only the self-description changed", () => {
  // v1.1 is a reissue, not a revision. If a later session edits a requirement while
  // calling it a reissue, this is where it surfaces: the questions, tiers, assertions
  // and evidence rules must be identical once the ids are mapped.
  const byOld = new Map(V11.entries.filter((e) => e.supersedes).map((e) => [e.supersedes!, e]));
  const drift: string[] = [];
  for (const old of V10.entries) {
    const next = byOld.get(old.id);
    if (!next) continue;
    for (const field of ["question", "tier", "assertion", "accepted_evidence", "insufficient_evidence", "conflict_rules", "pass_means", "applicability"]) {
      const a = JSON.stringify(old[field] ?? null);
      const b = JSON.stringify(next[field] ?? null);
      if (a !== b) drift.push(`${old.id}.${field}`);
    }
  }
  assert.deepEqual(drift, [], "v1.1 changed a requirement while presenting itself as a reissue");
});

// ===========================================================================
// v1.2 — THE GRAMMAR-1.2 REISSUE (v3.4 CP1).
//
// v1.1 was honest about the document and dishonest about two of its fields. Both
// were making measured-sounding claims from an authoring guess:
//
//   • `predicted_discrimination` — a numeric fail-rate band, on all 42 entries.
//     Against this category's own 100-product sample the bands held 1 OF 10, and
//     every miss was HIGH. A field wrong nine times in ten in a known direction is
//     worse than no field, because it looks like information.
//   • `tier: not_discriminating` on five entries, assigned from that band. None of
//     the five had ever been measured, and none had ever been bound to the engine
//     at all — so the tier was asserting a measurement that did not exist.
//
// v1.2 replaces the first with a direction and a confidence (no number, reasoning
// preserved verbatim), makes the second reachable only through a real measurement,
// and moves the five to the tier grammar 1.2 adds for exactly their state:
// `unbound` — the engine can run this kind, and THIS STANDARD has not authored the
// binding or the adversarial pass.
//
// The transform is `standards/coffee/issue_v1_2.ts`; the deliberate gate is
// `standards/coffee/verify_v1_2.ts`. These tests are the part that must hold on
// every future run of `npm test`.
// ===========================================================================

test("[version] v1.2 VALIDATES, and buying it did not cost v1.0 or v1.1 their validity", () => {
  // ⚠️ Asserted HERE and not only in schema.test.ts's STANDARD_FILES list, which a
  // concurrent session owns. A document nobody validates is a document with no
  // grammar, and the whole point of 1.2 is that 1.0 and 1.1 keep theirs.
  const schema = loadJson<Record<string, unknown>>("schema.json");
  for (const [name, doc] of [["v1.0", V10], ["v1.1", V11], ["v1.2", V12]] as const) {
    const r = validate(doc, schema);
    assert.ok(r.ok, `${name} does not validate:\n${renderResult(r)}`);
    assert.ok(r.checksRun > 500, `only ${r.checksRun} subschema checks ran over ${name} — suspiciously few for a real standard`);
  }
  assert.equal(V12.grammar_version, "1.2");
  assert.equal(V12.status, "applied_by_author", "no second party has run this document, so it may not be `published`");
  assert.equal(V12.posture.independently_applied, false);
  assert.equal("measured_fitness" in V12, false, "`category_fitness` is a MIGRATION, not an alias — a 1.2 document may not carry both names for one quantity");
  assert.ok(V12.category_fitness, "a 1.2 document with no category_fitness cannot ever be promoted to `published`");
});

test("[version] EVERY v1.0 AND v1.1 id resolves at v1.2 — the whole chain, not one hop", () => {
  const withdrawn = new Map((V12.withdrawn_entries ?? []).map((w) => [w.entry_id, w.reason]));
  const to12 = new Map<string, string>();
  for (const e of V12.entries) {
    assert.ok(e.supersedes, `${e.id} names no predecessor — a renamed question is indistinguishable from a new one`);
    assert.ok(!to12.has(e.supersedes!), `two v1.2 entries both supersede ${e.supersedes}`);
    to12.set(e.supersedes!, e.id);
  }
  const to11 = new Map(V11.entries.filter((e) => e.supersedes).map((e) => [e.supersedes!, e.id]));

  const orphans11 = V11.entries.filter((e) => !to12.has(e.id) && !withdrawn.has(e.id)).map((e) => e.id);
  assert.deepEqual(orphans11, [], "v1.1 entries with no v1.2 successor and no withdrawal reason");

  // The second hop. A v1.0 citation must still resolve at v1.2, which needs BOTH
  // links — asserting only v1.1 -> v1.2 would let a v1.0 id fall off silently.
  const orphans10 = V10.entries.filter((e) => {
    const at11 = to11.get(e.id);
    return !at11 || (!to12.has(at11) && !withdrawn.has(at11));
  }).map((e) => e.id);
  assert.deepEqual(orphans10, [], "v1.0 entries that no longer resolve at v1.2 through v1.1");

  for (const [id, reason] of withdrawn) assert.ok(reason.length >= 20, `${id} is withdrawn with a reason too short to be one`);
  assert.equal(V12.entries.length, V11.entries.length, "the entry count changed in a document that presents itself as a reissue");
});

test("[version] v1.2 is a REISSUE — every field but the declared deltas is byte-identical to v1.1", () => {
  const DELTA = new Set(["id", "supersedes", "predicted_discrimination", "discrimination_prediction", "measured_discrimination", "tier", "unbound_reason"]);
  const RETIERED = new Set(["PRICE-001", "STOCK-001", "TERMS-001", "DECAF-004", "DIET-001"]);
  const by11 = new Map(V12.entries.map((e) => [e.supersedes!, e]));
  const drift: string[] = [], tierDrift: string[] = [], reasoning: string[] = [];
  for (const old of V11.entries) {
    const next = by11.get(old.id)!;
    for (const k of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (DELTA.has(k)) continue;
      if (JSON.stringify(old[k]) !== JSON.stringify(next[k])) drift.push(`${old.id}.${k}`);
    }
    const suffix = old.id.replace(/^ALS-COFFEE-1\.1-/, "");
    const expect = RETIERED.has(suffix) ? "unbound" : old.tier;
    if (next.tier !== expect) tierDrift.push(`${old.id}: ${old.tier} -> ${next.tier}, expected ${expect}`);
    // THE REASONING SURVIVES AND THE BAND DOES NOT. SCHEMA.md §9.3 step 3: the band
    // was the part that was wrong, so a direction derived from it inherits the error.
    if (next.discrimination_prediction?.reasoning !== old.predicted_discrimination.reasoning) reasoning.push(old.id);
  }
  assert.deepEqual(drift, [], "v1.2 changed a requirement while presenting itself as a reissue");
  assert.deepEqual(tierDrift, [], "a tier moved that was not one of the five declared re-tierings");
  assert.deepEqual(reasoning, [], "a prediction's reasoning text was not preserved verbatim");

  const bands = new Set(V11.entries.map((e) => e.predicted_discrimination.predicted_fail_rate_band));
  const serialised = JSON.stringify(V12.entries);
  assert.deepEqual([...bands].filter((b) => serialised.includes(b)), [],
    "an authored fail-rate band survived into v1.2 — the band is DROPPED, not carried somewhere quieter");
  assert.equal(V12.entries.filter((e) => e.predicted_discrimination).length, 0, "`predicted_discrimination` is forbidden at grammar 1.2");
  assert.equal(V12.entries.filter((e) => e.discrimination_prediction).length, V12.entries.length);
  assert.deepEqual([...new Set(V12.entries.map((e) => e.discrimination_prediction!.direction))], ["no_prediction"]);
});

test("[version] the five `unbound` entries name a real engine kind and claim nothing they have not done", () => {
  const unbound = V12.entries.filter((e) => e.tier === "unbound");
  assert.equal(unbound.length, 5);
  assert.deepEqual(
    unbound.map((e) => e.id.replace(/^ALS-COFFEE-1\.2-/, "")).sort(),
    ["DECAF-004", "DIET-001", "PRICE-001", "STOCK-001", "TERMS-001"],
  );
  for (const e of unbound) {
    assert.ok((e.unbound_reason ?? "").length >= 40, `${e.id} occupies \`unbound\` without naming why`);
    // The half that stops the tier reading as executable-in-waiting.
    assert.match(e.unbound_reason!, /adversarial pass/i, `${e.id}: an unbound_reason that does not say the adversarial pass has not happened reads as executable-in-waiting`);
    assert.ok(!e.binding, `${e.id} is \`unbound\` and carries a binding — then it is either executable or claiming to run something it does not`);
    assert.ok(!e.measured_discrimination, `${e.id} is \`unbound\` and carries a fail rate, which could only have been produced by RUNNING it`);
  }
  assert.deepEqual(V12.entries.filter((e) => e.unbound_reason && e.tier !== "unbound").map((e) => e.id), [],
    "`unbound_reason` on another tier is a sentence about work that is not outstanding");
  assert.equal(V12.entries.filter((e) => e.tier === "not_discriminating").length, 0,
    "at grammar 1.2 `not_discriminating` requires a measurement, and none of these five has one");

  // None of it is a weakening: nothing that was being tested stops being tested,
  // because none of the five was ever bound, compiled or run.
  const release = V12.changelog[0]!;
  assert.equal(release.version, "1.2");
  const logged = new Set(release.changes.map((c) => c.entry_id));
  for (const e of unbound) assert.ok(logged.has(e.id), `${e.id} was re-tiered and the changelog does not say so`);
  assert.deepEqual(release.changes.filter((c) => c.change_type === "weakened" || c.change_type === "demoted"), [],
    "a weakening or demotion in the 1.2 release would need a weakening_attestation, and this release makes no such change");
});

test("[version] every published measurement RECOMPUTES from its own counts", () => {
  // A published interval nobody recomputes is a number, not evidence. This
  // deliberately recomputes from `fail_count`/`n_adjudicated` through the shipped
  // `wilson95`/`verdictFor` — the same functions the cross-field rules use — so a
  // hand-edited rate, interval or verdict fails here.
  const measured = V12.entries.filter((e) => e.measured_discrimination);
  assert.equal(measured.length, 10, `expected 10 measured entries, got ${measured.length}`);
  const tally: Record<string, number> = {};
  for (const e of measured) {
    const m = e.measured_discrimination!;
    assert.equal(e.tier, "executable", `${e.id} carries a measurement and is not executable`);
    assert.ok(m.n_adjudicated >= 22, `${e.id}: n=${m.n_adjudicated} is below the derived floor`);
    assert.ok(m.n_asked >= m.n_adjudicated, `${e.id}: more rows adjudicated than asked`);
    assert.ok(m.n_adjudicated <= m.sample.stores, `${e.id}: more adjudicated rows than stores — the interval assumes independent rows`);
    assert.equal(m.decision_rule, "wilson95_vs_target_band");
    assert.deepEqual(m.target_band, { lower_pct: TARGET_BAND.lowerPct, upper_pct: TARGET_BAND.upperPct });
    assert.equal(m.sample.category_scope, "this_category");
    assert.equal(m.sample.category_standard_id, V12.standard_id, "a standard may not publish a rate measured on another category's sample");

    const v = verdictFor(m.fail_count, m.n_adjudicated);
    const iv = wilson95(m.fail_count, m.n_adjudicated);
    assert.ok(Math.abs(m.fail_rate_pct - v.failRatePct!) < 0.05, `${e.id}: ${m.fail_rate_pct}% is not ${m.fail_count}/${m.n_adjudicated}`);
    assert.ok(Math.abs(m.interval_95.lower_pct - iv.lowerPct) < 0.05 && Math.abs(m.interval_95.upper_pct - iv.upperPct) < 0.05,
      `${e.id}: published interval is not the Wilson interval for ${m.fail_count}/${m.n_adjudicated}`);
    assert.equal(m.verdict, v.verdict, `${e.id}: recorded \`${m.verdict}\`, the arithmetic gives \`${v.verdict}\``);
    // Every `not_discriminating` verdict declares the instrument's biases, even
    // when the declaration is empty. An undeclared bias is not an absent one.
    if (m.verdict === "not_discriminating") assert.ok(Array.isArray(m.instrument_bias), `${e.id} retires nobody without declaring the instrument's biases`);
    tally[m.verdict] = (tally[m.verdict] ?? 0) + 1;
  }

  // ⚠️ THREE NUMBERS THAT ARE NOT THE SAME NUMBER, and briefs have run them together.
  // v1.1 published `carries_information` for 4 of 10 from a POINT ESTIMATE. Re-decided
  // by the shipped rule the split is 4 discriminating / 1 indeterminate / 5 not — the
  // same four survive, and the entry whose MEANING changes is SOURCE-001: 89.0% reads
  // as a clean retirement and its interval crosses the 85% edge, so it decides nothing.
  assert.deepEqual(tally, { discriminating: 4, not_discriminating: 5, indeterminate: 1 },
    "the verdict split changed; if that is intended it belongs in the changelog, because the document's headline sentence is derived from it");
  const source = measured.find((e) => e.id.endsWith("SOURCE-001"))!;
  assert.equal(source.measured_discrimination!.verdict, "indeterminate",
    "SOURCE-001 is the entry the third state exists for: outside the band on the point estimate, straddling it on the interval");

  // DELIV-001 is the one entry whose DENOMINATOR was wrong in v1.1, not its counts.
  const deliv = measured.find((e) => e.id.endsWith("DELIV-001"))!.measured_discrimination!;
  assert.ok(deliv.n_asked > deliv.n_adjudicated,
    "DELIV-001 has rows the engine could not decide; if that stops being true the note explaining the correction is stale");
  assert.match(deliv.notes ?? "", /requires_store_access/,
    "the record must say which reading it took — `requires_store_access` is neither a pass nor a fail");
});

test("[version] THE 21 CROSS-FIELD RULES RUN OVER v1.2, and the finding set is EXACTLY the pinned two", () => {
  // ⚠️ A checker that ran nothing looks exactly like a clean result. Three defences:
  //   1. the rules are handed real input, and the input count is asserted;
  //   2. a smoke canary per checker proves the wiring on THIS document's shape
  //      (the exhaustive one-canary-per-rule proof is `verify_v1_2.ts`, and each
  //      rule's own negative fixture is in discrimination.test.ts — duplicating all
  //      21 here would be a second copy free to drift from both);
  //   3. the finding set is asserted EXACTLY, so a new finding fails and a missing
  //      one fails too.
  const run = (doc: Doc12): RuleError[] => [
    ...doc.entries.flatMap((e, i) => checkMeasuredDiscrimination(e as never, `entries/${i}`)),
    ...checkCategoryFitness(doc as never),
    ...checkRetirementAttested(doc as never),
  ];
  assert.equal(ALL_RULES.length, 21, "the rule set changed size; the pinned finding set below was derived against 21");
  assert.equal(V12.entries.filter((e) => e.measured_discrimination).length, 10, "a rule with no input cannot fail");

  const found = run(V12).map((e) => {
    const i = Number(/^entries\/(\d+)/.exec(e.path)?.[1] ?? -1);
    return `${e.rule}@${i >= 0 ? V12.entries[i]!.id : "<standard>"}`;
  }).sort();

  // ⚠️ NOT AN ALLOWLIST OF THINGS WE DECIDED NOT TO CARE ABOUT — a debt with a
  // receipt. `bias_exceeds_margin` fires on both claim rows whose verdict is
  // `not_discriminating`, because the semantic tier was disabled for the run
  // (experiments/v3-2/run_standard.ts sets PRODUCT_TEST_SEMANTIC=0) and that is an
  // unquantified bias pointing at the band edge their intervals cleared. The rule
  // is doing its job: NEITHER ENTRY IS RETIRED — both stay `executable` — and the
  // rule is refusing to let the verdict be acted on. Dropping the declared bias
  // would make this green and the document false.
  assert.deepEqual(found, [
    "bias_exceeds_margin@ALS-COFFEE-1.2-CERT-001",
    "bias_exceeds_margin@ALS-COFFEE-1.2-CERT-002",
  ], "the cross-field finding set over v1.2 changed");

  for (const id of ["CERT-001", "CERT-002"]) {
    const e = V12.entries.find((x) => x.id.endsWith(id))!;
    assert.match(e.measured_discrimination!.notes ?? "", /MAY NOT BE ACTED ON AS A RETIREMENT/,
      `${e.id}: a rule fires on this entry and the published document says nothing about it`);
    assert.ok(e.measured_discrimination!.instrument_bias!.some((b) => b.direction === "inflates_fail_rate" && b.magnitude_pp === undefined),
      `${e.id}: the finding is pinned on an UNQUANTIFIED inflating bias; if it has been quantified the pin is stale`);
  }

  // The smoke canaries — one per checker, so an unwired checker cannot pass.
  const bend = (f: (d: Doc12) => void): string[] => {
    const d = JSON.parse(JSON.stringify(V12)) as Doc12;
    f(d);
    return run(d).map((e) => e.rule);
  };
  assert.ok(bend((d) => { d.entries.find((e) => e.id.endsWith("FORMAT-001"))!.measured_discrimination!.fail_rate_pct = 3; }).includes("rate_matches_counts"),
    "checkMeasuredDiscrimination is not wired to this document");
  assert.ok(bend((d) => { (d.category_fitness as { confirmed_false_positives: number }).confirmed_false_positives = 9999; }).includes("defects_within_rows"),
    "checkCategoryFitness is not wired to this document");
  assert.ok(bend((d) => { d.entries.find((e) => e.id.endsWith("IDENT-001"))!.tier = "not_discriminating"; }).includes("retirement_is_a_demotion"),
    "checkRetirementAttested is not wired to this document");
});

test("[version] v1.2's `category_fitness` is THIS category's, and says what it did not establish", () => {
  const f = V12.category_fitness as {
    sample: { category_scope: string; category_standard_id: string; stores: number; selection: string; deduplicated_by_brand: boolean; applicability_gate_enforced: boolean };
    pass_rows_audited: number; confirmed_false_positives: number;
    audit: { row_by_row: boolean; untruncated_evidence: boolean; borderline_recorded: boolean; borderline_count: number };
    bounds: { point_estimate_pct: number; naive_95_upper_pct: number; cluster_adjusted_95_upper_pct: number; icc: number; per_store_pct: number };
    completion_state: string; limits: string[]; defects: Array<{ entry_id: string; evidence: string; why_wrong: string; category_specific?: boolean; status?: string }>;
  };
  assert.equal(f.sample.category_scope, "this_category", "a general-sample bound is a different quantity, not a weaker version of this one");
  assert.equal(f.sample.category_standard_id, V12.standard_id);
  assert.notEqual(f.sample.selection, "first_handle", "roasters lead their catalogue with merchandise; first_handle captured t-shirts and a cocktail shaker");
  assert.equal(f.sample.deduplicated_by_brand, true);
  assert.equal(f.sample.applicability_gate_enforced, true);
  assert.equal(f.audit.row_by_row, true);
  assert.equal(f.audit.untruncated_evidence, true);
  assert.equal(f.audit.borderline_recorded, true);
  assert.ok(f.audit.borderline_count > 0, "an audit whose judgement calls are invisible cannot be checked");

  // ZERO is the number this project has been wrong about repeatedly, and the
  // completion state must never say CLEAN over a run that found defects.
  assert.ok(f.confirmed_false_positives > 0);
  assert.equal(f.completion_state, "DEFECTS_FOUND");
  assert.equal(f.defects.length, f.confirmed_false_positives, "a bound whose defects are not all named cannot be checked or fixed");
  assert.ok(Math.abs(f.bounds.point_estimate_pct - (f.confirmed_false_positives / f.pass_rows_audited) * 100) < 0.05);
  assert.ok(f.bounds.naive_95_upper_pct >= f.bounds.point_estimate_pct);
  assert.ok(f.bounds.cluster_adjusted_95_upper_pct >= f.bounds.naive_95_upper_pct,
    "clustering within stores can only WIDEN an interval; a narrower adjusted bound was applied backwards, and it flatters the number");
  assert.ok(f.bounds.per_store_pct > 0, "publishing only the row-level rate hides per-store exposure, and vice versa");

  // Every defect names an entry that exists at this version, and quotes something.
  const ids = new Set(V12.entries.map((e) => e.id));
  for (const d of f.defects) {
    assert.ok(ids.has(d.entry_id), `${d.entry_id} is not an entry of this version`);
    assert.ok(d.evidence.length >= 15 && d.why_wrong.length >= 15);
    assert.notEqual(d.evidence, d.why_wrong, "the evidence and the adjudication must not be the same sentence twice");
  }
  // Three of the ten are the store-local-identifier class, which the GENERAL sample
  // also carries; the other seven fire on vocabulary only a coffee page writes.
  assert.equal(f.defects.filter((d) => d.category_specific === false).length, 3);

  assert.ok(f.limits.length >= 3, "a fitness record with no limits is a claim of completeness no sample of this size supports");
  const limits = f.limits.join(" ");
  assert.match(limits, /sampling/i, "the record must say it bounds SAMPLING error only");
  assert.match(limits, /floor/i, "the general-sample comparison is a FLOOR and must never be published as a peer bound");
  assert.match(limits, /one product per storefront|within-store/i, "one product per store leaves within-store variation unmeasured");
});

test("[version] v1.2's posture says the true things, including the ones that got worse", () => {
  const s = V12.posture.statement;
  assert.match(s, /applied to real stores by its author/i, "the posture must say WE have applied it");
  assert.match(s, /no second party/i, "the posture must say no second party has");
  assert.match(s, /MEASURED/, "every failure rate here is measured, and the posture has to say so");
  assert.match(s, /unbound/, "five entries changed tier because the old one was false about them; a posture that omits that is understating again");
  assert.match(s, /may only become `?published`? once a second party/i, "the promotion rule is not written into the document");
  assert.match(s, /category_fitness/, "at grammar 1.2 promotion ALSO requires a fitness measurement on this category; the document's own bar must survive its own promotion");

  // ⚠️ v1.1's posture said the run covered "100 real coffee products across 77
  // storefronts". 77 is the number of storefronts that contributed at least one
  // PASSING row to the audit; the run itself drew one product from each of 100
  // distinct hosts. v1.2 states both numbers in their own places.
  assert.match(s, /100 real coffee products/);
  assert.doesNotMatch(s, /100 real coffee products[^.]*77 storefronts/,
    "the discrimination sample's store count and the false-positive audit's store count are different numbers and must not be run together");

  // v1.0 and v1.1 keep saying exactly what they said. That is what freezing means.
  assert.match(V10.posture.statement, /is not published/, "v1.0's posture was edited; it is frozen");
  assert.equal(V10.status, "draft", "v1.0's status was edited; it is frozen");
  assert.equal(V11.status, "applied_by_author", "v1.1's status was edited; it is frozen");
});

test("[version] v1.2 compiles and its applicability sidecar covers exactly its executable entries", () => {
  const report = compileStandard(V12 as never);
  assert.deepEqual(report.errors.map(String), [], "v1.2 does not compile");
  assert.equal(report.requirements.length, report.expectedExecutable, "an incomplete compile must never read as a clean one");
  assert.equal(report.requirements.length, 10, `expected 10 requirements from v1.2, got ${report.requirements.length}`);
  const sidecar = loadJson<Sidecar>("coffee/v1.2/applicability.json");
  const cov = assertSidecarCoversStandard(sidecar, report.requirements.map((r) => r.id));
  assert.deepEqual(cov.missing, [], "v1.2 executable entries with no applicability rule — they would default to 'always applies'");
  assert.deepEqual(cov.stale, [], "v1.2 sidecar rules for entries that do not exist");

  // ✅ FIXED AT v3.4 CP-2, AND THE PIN THAT SAID SO IS INVERTED RATHER THAN DELETED.
  // `compile.ts` had no branch for the 1.2 `unbound` tier, so its skip reason fell through
  // a ternary to the `blocked` wording and told a reader the ENGINE cannot run these five —
  // the opposite of what `unbound` means, which is that the engine can and this standard
  // has not authored the binding. It is now an exhaustive `switch` over the tier union, so
  // the next new tier is a TYPE ERROR rather than a sentence that lies.
  const unboundSkips = report.skipped.filter((s) => s.tier === "unbound");
  assert.equal(unboundSkips.length, 5);
  assert.ok(unboundSkips.every((s) => /^unbound —/.test(s.reason)),
    `an unbound entry is described with another tier's reason: ${unboundSkips.map((s) => s.reason).join(" | ")}`);
  assert.ok(unboundSkips.every((s) => !/blocked/.test(s.reason)),
    "an unbound skip still carries the `blocked` wording — it blames the engine for our unwritten work");
  assert.ok(unboundSkips.every((s) => /the engine HAS a requirement kind that fits/.test(s.reason)),
    "the unbound reason does not say the engine CAN run it, which is the only thing distinguishing it from blocked");

  // And the tier whose meaning CHANGED must not still restate the deleted prediction rule.
  // At 1.2 `not_discriminating` is a MEASURED verdict, not a band that was guessed at.
  const nd = report.skipped.filter((s) => s.tier === "not_discriminating");
  assert.equal(nd.length, 0, "v1.2 should occupy no `not_discriminating` tier");
  const renderedTiers = [...new Set(report.skipped.map((s) => s.tier))];
  assert.ok(renderedTiers.includes("unbound"), "the compile report does not distinguish the unbound tier at all");
});

// ===========================================================================
// v1.3 — THE ONE-ENTRY REISSUE (v3.5 CP2 Part 1).
//
// IDENT-001 had a seam running down the middle of it, and every field on one side
// of the seam said the opposite of every field on the other.
//
//   • The fields that DECIDE said PUBLICATION. `assertion` is
//     `product_identifier_published`/`is_present`; `binding.label` is "A product
//     identifier is published in structured data"; `accepted_evidence` stated a
//     check-digit test for the GTIN branch and, for MPN, exactly one qualifier —
//     "not a placeholder". The authors demonstrably knew how to write a validity
//     condition and attached none to MPN.
//   • The fields addressed to a PERSON said IDENTITY. The question asks whether a
//     shopping assistant can match this exact bag to a catalogue entry; the
//     remediation asks for a REAL manufacturer part number.
//
// A merchant saw a green row under a question the pass did not answer. Resolving it
// toward the decider fields would have meant rewriting the question down to "a
// string is present", so v1.3 resolves it the other way — and the standard already
// contained the rule: its own `insufficient_evidence` rejects an internal SKU
// published in the GTIN field for a reason that is about the VALUE and not about
// which key carries it. v1.3 applies that reason where the defect occurs.
//
// ⚠️ AND THE THING v1.3 IS ONE STEP AWAY FROM IS WIDENING THE PROMISE. Tightening
// what PASSES does not license claiming more about what a pass MEANS. So
// `pass_means.does_not_establish` keeps every clause it had, `registry.resolvable`
// is still false, and the person-facing fields are byte-identical — asserted below,
// because this is the same class of error the reissue exists to correct.
//
// The transform is `standards/coffee/issue_v1_3.ts`; the deliberate gate is
// `standards/coffee/verify_v1_3.ts`. These tests are the part that must hold on
// every future run of `npm test`.
// ===========================================================================

/** The five fields v1.3 declares it changes on IDENT-001, and nothing else. */
const V13_IDENT_DELTA = ["accepted_evidence", "adversarial", "insufficient_evidence", "measured_discrimination", "pass_means"];
const identOf = (d: Doc12): Entry12 => d.entries.find((e) => e.id.endsWith("IDENT-001"))!;

test("[version] v1.3 VALIDATES, the GRAMMAR DID NOT MOVE, and no predecessor lost its validity", () => {
  const schema = loadJson<Record<string, unknown>>("schema.json");
  for (const [name, doc] of [["v1.0", V10], ["v1.1", V11], ["v1.2", V12], ["v1.3", V13]] as const) {
    const r = validate(doc, schema);
    assert.ok(r.ok, `${name} does not validate:\n${renderResult(r)}`);
    assert.ok(r.checksRun > 500, `only ${r.checksRun} subschema checks ran over ${name} — suspiciously few for a real standard`);
  }
  // ⚠️ THE GRAMMAR STAYING AT 1.2 IS LOAD-BEARING, NOT COSMETIC. Every
  // version-specific rule in schema.json is gated on `grammar_version` being exactly
  // "1.2": `predicted_discrimination` forbidden, the rich measurement shape,
  // `not_discriminating` requiring a measurement, the publication gate. A document
  // that renamed its grammar for a CONTENT change would satisfy none of those `if`s
  // and would validate against a schema that had silently stopped asking it anything.
  assert.equal(V13.grammar_version, "1.2", "a content change is not a grammar change, and renaming the grammar switches off every 1.2 gate");
  assert.equal(V13.version, "1.3");
  assert.equal(V13.status, "applied_by_author", "no second party has run this document, so it may not be `published`");
  assert.equal(V13.posture.independently_applied, false);
  assert.equal("measured_fitness" in V13, false, "`measured_fitness` is forbidden at grammar 1.2");
  assert.ok(V13.category_fitness, "a 1.2-grammar document with no category_fitness cannot ever be promoted to `published`");
  assert.equal(V13.entries.length, V12.entries.length, "the entry count changed in a document that presents itself as a one-entry reissue");
});

test("[version] EVERY v1.0, v1.1 AND v1.2 id resolves at v1.3 — the whole chain, not one hop", () => {
  const withdrawn = new Map((V13.withdrawn_entries ?? []).map((w) => [w.entry_id, w.reason]));
  assert.deepEqual([...withdrawn.keys()], [], "v1.3 withdraws nothing; a withdrawal in a one-entry reissue is a coverage change nobody asked for");
  const to13 = new Map<string, string>();
  for (const e of V13.entries) {
    assert.ok(e.supersedes, `${e.id} names no predecessor — a renamed question is indistinguishable from a new one`);
    assert.ok(!to13.has(e.supersedes!), `two v1.3 entries both supersede ${e.supersedes}`);
    to13.set(e.supersedes!, e.id);
  }
  const to12 = new Map(V12.entries.filter((e) => e.supersedes).map((e) => [e.supersedes!, e.id]));
  const to11 = new Map(V11.entries.filter((e) => e.supersedes).map((e) => [e.supersedes!, e.id]));

  assert.deepEqual(V12.entries.filter((e) => !to13.has(e.id)).map((e) => e.id), [], "v1.2 entries with no v1.3 successor");
  assert.deepEqual(
    V11.entries.filter((e) => { const at12 = to12.get(e.id); return !at12 || !to13.has(at12); }).map((e) => e.id),
    [], "v1.1 entries that no longer resolve at v1.3 through v1.2",
  );
  // The third hop. Asserting only v1.2 -> v1.3 would let a v1.0 citation fall off silently.
  assert.deepEqual(
    V10.entries.filter((e) => { const at11 = to11.get(e.id); const at12 = at11 ? to12.get(at11) : undefined; return !at12 || !to13.has(at12); }).map((e) => e.id),
    [], "v1.0 entries that no longer resolve at v1.3 through v1.1 and v1.2",
  );
});

test("[version] v1.3 is a ONE-ENTRY reissue — 41 entries are byte-identical and the 42nd moved only where declared", () => {
  const by12 = new Map(V13.entries.map((e) => [e.supersedes!, e]));
  const strip = (o: Record<string, unknown>): string => JSON.stringify(
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== "id" && k !== "supersedes")),
  );
  const drift: string[] = [];
  let identSeen = 0;
  for (const old of V12.entries) {
    const next = by12.get(old.id)!;
    assert.equal(next.id, old.id.replace("-1.2-", "-1.3-"), `${old.id} did not become its own 1.3 form`);
    if (old.id.endsWith("IDENT-001")) {
      identSeen++;
      const moved = [...new Set([...Object.keys(old), ...Object.keys(next)])]
        .filter((k) => k !== "id" && k !== "supersedes")
        .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
        .sort();
      // ⚠️ ASSERTED, NEVER EYEBALLED. A key that moved and was not declared is
      // indistinguishable from one that was meant to, and 42 entries of JSON is
      // exactly the size at which "I read it" stops being a check.
      assert.deepEqual(moved, V13_IDENT_DELTA, "IDENT-001's changed key set is not the declared delta");
      continue;
    }
    if (strip(old) !== strip(next)) drift.push(old.id);
  }
  assert.equal(identSeen, 1, "IDENT-001 was matched a number of times that is not one");
  assert.deepEqual(drift, [], "an entry changed in a version that presents itself as changing exactly one");

  // Only ONE change is logged, and it is a strengthening, so no attestation is owed.
  const release = V13.changelog[0]!;
  assert.equal(release.version, "1.3");
  assert.equal(release.changes.length, 1, "a one-entry reissue with more than one logged change is not describing itself");
  assert.equal(release.changes[0]!.entry_id, identOf(V13).id);
  assert.equal(release.changes[0]!.change_type, "strengthened",
    "copy that passed before can now fail and nothing that failed before can now pass, which is `strengthened` and needs no attestation");
  assert.equal("weakening_attestation" in release.changes[0]!, false, "an attestation invented for a change that needs none makes the real ones cheaper");
  // THE PRE-CHANGE RATE IS MEASURED AND STATED. A tightening whose changelog does not
  // say what the old rule was measured at leaves a reader nothing to judge it against.
  const rationale = String((release.changes[0] as unknown as { rationale: string }).rationale);
  const m = identOf(V13).measured_discrimination!;
  assert.ok(rationale.includes(`${m.fail_rate_pct}%`), `the rationale does not state the measured pre-change fail rate (${m.fail_rate_pct}%)`);
  assert.ok(rationale.includes(`${m.fail_count} of ${m.n_adjudicated}`), "the rationale states a rate with no counts behind it");
});

test("[version] v1.3 TIGHTENED WHAT PASSES AND DID NOT WIDEN WHAT A PASS MEANS", () => {
  const old = identOf(V12), next = identOf(V13);

  // 1. The refusal list KEEPS EVERY CLAUSE, verbatim and first. This is the assertion
  //    the whole test exists for: the defect being corrected is a field promising more
  //    than the evidence supports, and the cheapest way to reintroduce it is to tighten
  //    the evidence rule and quietly relax the refusal in the same commit.
  const pmOld = old.pass_means as { establishes: string; does_not_establish: string };
  const pmNew = next.pass_means as { establishes: string; does_not_establish: string };
  assert.ok(pmNew.does_not_establish.startsWith(pmOld.does_not_establish),
    "`pass_means.does_not_establish` no longer opens with v1.2's clause verbatim — a clause dropped here is a promise made");
  assert.ok(pmNew.does_not_establish.length > pmOld.does_not_establish.length, "the refusal list did not grow; a replacement is not an addition");
  for (const clause of ["correct", "unique to this product", "allocated to this seller", "resolvable to any catalogue record anywhere"]) {
    assert.ok(pmNew.does_not_establish.includes(clause), `v1.3 stopped refusing \`${clause}\``);
  }
  assert.equal((next.registry as { resolvable: boolean }).resolvable, false, "no free public register resolves an arbitrary identifier, and nothing here created one");
  assert.deepEqual(next.registry, old.registry);

  // 2. The person-facing half of the seam was already right. v1.3 SUPPORTS it; it does
  //    not rewrite it. A version that answered the inconsistency by editing the question
  //    down to "a string is present" would have made the row barely worth running.
  for (const k of ["question", "consumer_note", "merchant_remediation", "assertion", "binding", "tier", "applicability", "conflict_rules", "grounding", "discrimination_prediction"]) {
    assert.deepEqual(next[k], old[k], `IDENT-001.${k} moved, and v1.3 declares that it does not`);
  }

  // 3. accepted_evidence was narrowed by APPENDING a qualifier. A rewrite could widen
  //    without looking like it; a prefix check cannot be fooled that way.
  const accOld = (old.accepted_evidence as Array<{ form: string; surface: string }>)[0]!;
  const accNew = (next.accepted_evidence as Array<{ form: string; surface: string }>)[0]!;
  assert.equal(accNew.surface, accOld.surface);
  assert.ok(accNew.form.startsWith(accOld.form), "the accepted-evidence form was rewritten rather than qualified");
  assert.match(accNew.form, /is not the seller's own internal object id for this product$/);

  // 4. insufficient_evidence gained exactly one clause, and it quotes the rule it
  //    generalises rather than paraphrasing it — a false attribution in a published
  //    document is worse than no attribution.
  const insOld = old.insufficient_evidence as Array<{ form: string; why_not: string }>;
  const insNew = next.insufficient_evidence as Array<{ form: string; why_not: string }>;
  assert.equal(insNew.length, insOld.length + 1);
  const at = insOld.findIndex((f) => f.form === "an internal SKU published in the GTIN field");
  assert.ok(at >= 0, "the SKU-in-GTIN clause the new rule generalises is not in v1.2");
  assert.deepEqual([...insNew.slice(0, at + 1), ...insNew.slice(at + 2)], insOld, "a prior insufficient_evidence clause was edited or reordered");
  assert.match(insNew[at + 1]!.form, /MPN field/);
  assert.ok(insNew[at + 1]!.why_not.includes(insOld[at]!.why_not),
    "the new clause claims to reuse the SKU-in-GTIN reasoning and does not contain it verbatim");

  // 5. The v1.0 attack is KEPT. Its residual risk — a valid GTIN duplicated across
  //    every variant — is still true, and the grammar allows ONE `adversarial` object
  //    per entry, so a second attack that replaced the first would delete a live record.
  const advOld = old.adversarial as { attack: string; outcome: string; resolution: string; residual_risk: string };
  const advNew = next.adversarial as { attack: string; outcome: string; resolution: string; residual_risk: string };
  assert.ok(advNew.attack.includes(advOld.attack), "the v1.0 attack text was overwritten rather than carried");
  assert.ok(advNew.resolution.includes(advOld.resolution), "the v1.0 resolution is amended without being quoted, so a reader cannot check the amendment");
  assert.ok(advNew.residual_risk.startsWith(advOld.residual_risk), "the v1.0 residual risk was rewritten and it is still true");
  assert.match(advNew.resolution, /survived_unchanged/, "one `outcome` field now serves two attacks and the first one's outcome is not named");
  assert.equal(advNew.outcome, "tightened_accepted_evidence");
  assert.match(advNew.residual_risk, /NO ENGINE CHANGE SHIPS WITH v1\.3/,
    "at v1.3 the document requires more than the engine checks, and the entry a reader opens must say so");
});

test("[version] IDENT-001's measurement is CARRIED AND RE-SCOPED, never re-presented as post-change", () => {
  const mOld = identOf(V12).measured_discrimination!;
  const mNew = identOf(V13).measured_discrimination!;

  // The counts did not change. Only their SCOPE did — and the arithmetic is
  // re-derived here rather than trusted, through the same shipped functions the
  // cross-field rules use.
  for (const k of ["verdict", "n_asked", "n_adjudicated", "fail_count", "fail_rate_pct", "interval_95", "target_band", "decision_rule", "measured_on", "sample"] as const) {
    assert.deepEqual(mNew[k], mOld[k], `measurement.${k} moved; v1.3 changes the requirement, not the run`);
  }
  const v = verdictFor(mNew.fail_count, mNew.n_adjudicated);
  const iv = wilson95(mNew.fail_count, mNew.n_adjudicated);
  assert.ok(Math.abs(mNew.fail_rate_pct - v.failRatePct!) < 0.05);
  assert.ok(Math.abs(mNew.interval_95.lower_pct - iv.lowerPct) < 0.05 && Math.abs(mNew.interval_95.upper_pct - iv.upperPct) < 0.05);
  assert.equal(mNew.verdict, v.verdict);

  // ⚠️ THE DIRECTION OF THE NEW BIAS IS THE WHOLE ASSERTION. Tightening accepted
  // evidence can only move rows from pass to FAIL, so the measured rate is at or below
  // what the v1.3 rule would produce: `deflates_fail_rate`. Declaring it as inflating
  // would be false AND self-serving — an inflating bias toward the cleared edge is
  // exactly what `bias_exceeds_margin` blocks a retirement on, so the flattering
  // direction is also the one that would have been caught. The honest one is not.
  const biasOld = mOld.instrument_bias ?? [], biasNew = mNew.instrument_bias ?? [];
  assert.equal(biasNew.length, biasOld.length + 1, "the re-scoping is not declared as an instrument bias");
  assert.deepEqual(biasNew.slice(0, biasOld.length), biasOld, "a v1.2 bias declaration was edited");
  const added = biasNew[biasOld.length]!;
  assert.equal(added.direction, "deflates_fail_rate");
  assert.equal(added.magnitude_pp, undefined, "the re-scoping is not quantified, and a magnitude here would be invented");
  assert.match(added.source, /double-count/, "two overlapping biases are declared with no statement that they overlap, which invites a reader to add them");

  assert.match(mNew.notes ?? "", /MEASURED AGAINST THE v1\.2 WORDING, NOT THIS ONE/,
    "a pre-change measurement is published with no statement of what it was measured against");
  assert.match(mNew.notes ?? "", /is a FLOOR/, "the direction of the re-scoping is not stated, so a reader cannot tell which way it moves");
  // `supersedes` is the grammar's re-measurement path and it is deliberately unused:
  // it records a measurement a REPLACEMENT displaced, and there is no replacement —
  // no run has been made against the v1.3 wording. Filing this one as superseded with
  // nothing in its place would delete the only measurement the entry has.
  assert.equal("supersedes" in mNew, false, "`supersedes` needs a replacement measurement, and v1.3 ships none");
  assert.match(mNew.notes ?? "", /REPLACEMENT has displaced/, "the re-measurement path is unused and the document does not say why");
});

test("[version] THE 21 CROSS-FIELD RULES RUN OVER v1.3, and the finding set is EXACTLY the pinned two", () => {
  const run = (doc: Doc12): RuleError[] => [
    ...doc.entries.flatMap((e, i) => checkMeasuredDiscrimination(e as never, `entries/${i}`)),
    ...checkCategoryFitness(doc as never),
    ...checkRetirementAttested(doc as never),
  ];
  assert.equal(ALL_RULES.length, 21, "the rule set changed size; the pinned finding set below was derived against 21");
  assert.equal(V13.entries.filter((e) => e.measured_discrimination).length, 10, "a rule with no input cannot fail");

  const found = run(V13).map((e) => {
    const i = Number(/^entries\/(\d+)/.exec(e.path)?.[1] ?? -1);
    return `${e.rule}@${i >= 0 ? V13.entries[i]!.id : "<standard>"}`;
  }).sort();

  // Both findings are INHERITED UNCHANGED from v1.2 — v1.3 neither added nor removed
  // one. `bias_exceeds_margin` fires on the two claim rows measured with the semantic
  // tier disabled, an unquantified bias pointing at the band edge their intervals
  // cleared. Neither entry is retired; the rule is refusing to let the verdict be acted on.
  assert.deepEqual(found, [
    "bias_exceeds_margin@ALS-COFFEE-1.3-CERT-001",
    "bias_exceeds_margin@ALS-COFFEE-1.3-CERT-002",
  ], "the cross-field finding set over v1.3 changed");

  // ⚠️ AND THE ONE THAT MUST NOT APPEAR. IDENT-001 gained a bias at v1.3; its interval
  // clears the UPPER band edge, so only an `inflates_fail_rate` bias can reach it. A
  // finding here would mean the direction was declared backwards — which is the same
  // check as the direction assertion above, arrived at from the rule's side instead of
  // the document's, and it is worth having twice.
  assert.deepEqual(found.filter((f) => f.endsWith("IDENT-001")), [],
    "IDENT-001 produced a cross-field finding; a tightening deflates the measured rate and cannot point at the cleared edge");
});

test("[version] v1.3's posture corrects the clause that went false, and the fitness record does not go silent", () => {
  const s = V13.posture.statement;
  // v1.2 said the ten executable entries were "unchanged in v1.1 and unchanged here".
  // One of them is not unchanged here, and a posture clause that has gone false is the
  // exact defect v1.1 was issued to fix. "Only one entry changed" is not an exemption.
  assert.doesNotMatch(s, /unchanged in v1\.1 and unchanged here/, "the posture still claims all ten executable entries are unchanged in this version");
  assert.match(s, /ONE ENTRY CHANGED AT v1\.3/, "a version whose posture does not mention its own change is understating itself again");
  assert.match(s, /keeps every clause it had/, "the posture does not record that the promise was not widened");
  assert.match(s, /THE ENGINE HAS NOT CHANGED WITH IT/, "the standard requires more than the engine checks and the posture is silent about it");
  assert.match(s, /no second party has applied this document/, "the second-party bar was dropped from the posture");
  assert.match(s, /may only become `?published`? once a second party/i, "the promotion rule is not written into the document");

  // The bound does not move — those rows were already counted as defects — but its
  // SUBJECT is now narrower than it reads, and a fitness record that goes silent while
  // the requirement it measures moves is a record a reader will apply to the wrong thing.
  const f13 = V13.category_fitness as { limits: string[]; confirmed_false_positives: number; defects: Array<{ entry_id: string }>; bounds: unknown };
  const f12 = V12.category_fitness as { limits: string[]; confirmed_false_positives: number; bounds: unknown };
  assert.deepEqual(f13.bounds, f12.bounds, "the false-positive bound moved, and v1.3 measured nothing new");
  assert.equal(f13.confirmed_false_positives, f12.confirmed_false_positives);
  assert.equal(f13.limits.length, f12.limits.length + 1, "the fitness record says nothing about the requirement having moved under it");
  assert.deepEqual(f13.limits.slice(0, f12.limits.length), f12.limits, "an existing limit was edited");
  assert.match(f13.limits.at(-1)!, /bounds the false-pass rate of the ENGINE/);
  const ids = new Set(V13.entries.map((e) => e.id));
  assert.deepEqual(f13.defects.filter((d) => !ids.has(d.entry_id)).map((d) => d.entry_id), [], "a defect cites an entry id that does not exist at v1.3");

  // The three predecessors keep saying exactly what they said. That is what freezing means.
  assert.equal(V10.status, "draft", "v1.0's status was edited; it is frozen");
  assert.equal(V11.status, "applied_by_author", "v1.1's status was edited; it is frozen");
  assert.equal(V12.status, "applied_by_author", "v1.2's status was edited; it is frozen");
  assert.match(V12.posture.statement, /unchanged in v1\.1 and unchanged here/, "v1.2's posture was edited to match v1.3; a frozen version keeps its own sentence, right or wrong");
});

test("[version] v1.3 compiles, its sidecar covers exactly its executable entries, and the binding did not move", () => {
  const report = compileStandard(V13 as never);
  assert.deepEqual(report.errors.map(String), [], "v1.3 does not compile");
  assert.equal(report.requirements.length, report.expectedExecutable, "an incomplete compile must never read as a clean one");
  assert.equal(report.requirements.length, 10, `expected 10 requirements from v1.3, got ${report.requirements.length}`);
  const sidecar = loadJson<Sidecar>("coffee/v1.3/applicability.json");
  assert.equal(sidecar.version, "1.3", "the sidecar still declares an older version, so a reader cannot tell which document it reads");
  const cov = assertSidecarCoversStandard(sidecar, report.requirements.map((r) => r.id));
  assert.deepEqual(cov.missing, [], "v1.3 executable entries with no applicability rule — they would default to 'always applies'");
  assert.deepEqual(cov.stale, [], "v1.3 sidecar rules for entries that do not exist");
  assert.equal(report.skipped.filter((s) => s.tier === "unbound").length, 5, "the five unbound entries did not survive the reissue");

  // ⚠️ THE COMPILED ROW IS BYTE-IDENTICAL TO v1.2's, AND THAT IS THE HONEST STATE.
  // The requirement is derived from `binding.req_kind`, which v1.3 does not touch, and
  // no engine change ships with this version — so the row the engine runs is the row it
  // ran at v1.2 while the document now requires more. Asserting it here means the day
  // someone implements the tightening, this line fails and forces the measurement's
  // scope to be revisited with it, instead of the two drifting apart quietly.
  const by12 = new Map(compileStandard(V12 as never).requirements.map((r) => [r.id.replace("-1.2-", "-1.3-"), { ...r, id: r.id.replace("-1.2-", "-1.3-") }]));
  const drifted = report.requirements.filter((r) => JSON.stringify(by12.get(r.id)) !== JSON.stringify(r));
  assert.deepEqual(drifted.map((r) => r.id), [], "a compiled requirement changed at v1.3 — the engine was taught something and the measurement scope was not revisited");
});
