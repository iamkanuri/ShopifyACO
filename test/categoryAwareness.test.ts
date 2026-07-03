import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeRun } from "../src/analysis/index.js";
import { CLUSTER_DEFS, clustersForPrompt } from "../src/analysis/queryClusters.js";
import { NON_COOKWARE_FIXTURES, COOKWARE_VOCAB } from "./support/categoryFixtures.js";

// "non-toxic" is a cross-vertical shopper term (mattresses, cosmetics, baby, cleaning). The
// cluster it matches must not surface a cookware label (it used to say "ceramic").
test("cross-vertical 'non-toxic' queries surface no cookware label", () => {
  const cfg = { brand: { name: "Avocado" }, category: "mattresses", competitors: [], promptTemplates: [] };
  for (const prompt of ["best non-toxic mattress for kids", "non-toxic organic crib mattress"]) {
    const labels = clustersForPrompt(prompt, cfg).map((id) => CLUSTER_DEFS.find((d) => d.id === id)!.label);
    for (const label of labels) {
      assert.doesNotMatch(label, COOKWARE_VOCAB, `"${prompt}" surfaced a cookware label: ${label}`);
    }
  }
});

// ===========================================================================
// Category-awareness QC gate. This test REPLACES the human who used to catch
// cookware-DNA leaks before a paying merchant saw them. It enforces TWO bars for
// every non-cookware vertical (fashion / supplement / furniture):
//
//   (1) NEGATIVE: no cookware vocabulary appears anywhere in the analysis.
//   (2) POSITIVE: the prescription is TRUE & SPECIFIC — it names the actual
//       detected competitor, cites the actual reasons it won, and references a
//       real lost prompt. "Emits no cookware" and "says something specific" are
//       different bars; a generator can pass (1) and still emit generic sludge.
// ===========================================================================

for (const fx of NON_COOKWARE_FIXTURES) {
  test(`${fx.name}: analysis emits NO cookware vocabulary`, () => {
    const a = analyzeRun(fx.run());
    const hit = JSON.stringify(a).match(COOKWARE_VOCAB);
    assert.equal(hit, null, `cookware vocabulary leaked into the ${fx.name} report: ${hit?.[0]}`);
  });

  test(`${fx.name}: the comparison prescription is specific and true to this scan`, () => {
    const a = analyzeRun(fx.run());

    // Names the actual detected competitor.
    assert.equal(a.threat?.competitor, fx.expectedThreat, `expected ${fx.expectedThreat} as the threat`);
    const cmp = a.fixCards.find((c) => c.id === "cmp_threat");
    assert.ok(cmp, "expected a head-to-head comparison card");
    assert.equal(cmp!.title, `Add a "${fx.brand} vs ${fx.expectedThreat}" comparison page`);

    // References a REAL lost prompt from this scan (not a generic template).
    assert.ok(cmp!.relatedPrompts.length > 0, "comparison card must cite real lost prompts");
    assert.ok(
      cmp!.relatedPrompts.some((p) => cmp!.why.includes(p)),
      "the 'why' must quote an actual lost prompt",
    );

    // Cites the ACTUAL reasons the competitor won (a detected proof point for THAT
    // competitor, surfaced by name) — this is the intelligence, not generic sludge.
    const reasons = a.proofPoints.filter((p) => p.competitors.includes(fx.expectedThreat));
    assert.ok(reasons.length > 0, "expected detected proof points for the winning competitor");
    assert.ok(
      reasons.some((r) => cmp!.suggestedFix.toLowerCase().includes(r.label.toLowerCase())),
      "the suggested fix must name a real reason the competitor won",
    );
  });

  test(`${fx.name}: proof points are category-neutral (no cookware taxonomy)`, () => {
    const a = analyzeRun(fx.run());
    assert.ok(a.proofPoints.length > 0, "expected non-empty evidence-driven proof points");
    for (const p of a.proofPoints) {
      assert.doesNotMatch(p.label, COOKWARE_VOCAB, `proof label "${p.label}" carries cookware DNA`);
    }
  });

  // The BLIND SPOT that let the cluster bug ship: the old test only checked vocabulary ABSENCE, not
  // cluster COVERAGE — so cookware trigger keywords (a non-cookware brand's prompts matching ~zero
  // clusters) passed silently while starving the transactional analysis AND the paid buying-guide.
  test(`${fx.name}: buyer-intent clusters actually POPULATE (coverage, not just vocab-absence)`, () => {
    const a = analyzeRun(fx.run());
    const txn = a.clusters.filter((c) => c.transactional);
    assert.ok(
      txn.length >= 3,
      `expected ≥3 transactional clusters for ${fx.name}, got ${txn.length}: [${a.clusters.map((c) => c.label).join(", ")}]`,
    );
    for (const c of a.clusters) {
      assert.doesNotMatch(c.label, COOKWARE_VOCAB, `cluster label "${c.label}" carries cookware DNA`);
    }
    // Downstream: a cluster_* fix card must exist so the PAID buying-guide artifact gets a topic
    // (generate.ts derives the guide from a cluster_* card — the customer-facing symptom of the bug).
    const clusterCards = a.fixCards.filter((c) => c.id.startsWith("cluster_"));
    assert.ok(clusterCards.length >= 1, `expected ≥1 cluster fix card (paid buying-guide topic) for ${fx.name}`);
  });
}
