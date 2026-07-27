import { test } from "node:test";
import assert from "node:assert/strict";
import { hashMatches, standardHash } from "../hash.js";
import { loadJson } from "./support.js";
import { compileStandard } from "../compile.js";
import { assertSidecarCoversStandard, type Sidecar } from "../applicability.js";

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
  predicted_discrimination: { predicted_fail_rate_band: string; measured: boolean };
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

const V10 = loadJson<Doc>("coffee/v1.0/standard.json");
const V11 = loadJson<Doc>("coffee/v1.1/standard.json");

/** ⚠️ A LITERAL, ON PURPOSE. Recomputing it from the file would make this test agree
 *  with whatever v1.0 happens to say today, which is exactly the check that is worth
 *  nothing. This is the value published on the site, in llms.txt, and in every citation
 *  made against v1.0. */
const V10_FROZEN_HASH = "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5";

test("[version] v1.0 IS BYTE-FROZEN — its hash is the one every citation resolves through", () => {
  assert.equal(
    standardHash(V10), V10_FROZEN_HASH,
    "coffee/v1.0/standard.json has changed. Every citation made against it now resolves to a different text. " +
    "If the change is intended, it is a NEW VERSION, not an edit — that is what v1.1 is for.",
  );
  const h = hashMatches(V10);
  assert.ok(h.ok, "v1.0's own stored standard_hash disagrees with its bytes");
});

test("[version] v1.1's hash agrees three ways: stored, recomputed, and different from v1.0", () => {
  const h = hashMatches(V11);
  assert.ok(h.ok, `v1.1's stored hash ${h.stored} does not match its content ${h.computed}`);
  assert.notEqual(h.computed, V10_FROZEN_HASH, "v1.1 hashes identically to v1.0 — then it is not a new version");
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
