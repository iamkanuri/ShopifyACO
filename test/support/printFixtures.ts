// Dev/inspection script (NOT a test): prints the evidence-driven output for each
// non-cookware fixture so a human can read the actual prescriptions/artifacts.
//   npx tsx test/support/printFixtures.ts
import { analyzeRun } from "../../src/analysis/index.js";
import { NON_COOKWARE_FIXTURES, COOKWARE_VOCAB } from "./categoryFixtures.js";

for (const fx of NON_COOKWARE_FIXTURES) {
  const a = analyzeRun(fx.run());
  console.log("\n" + "=".repeat(78));
  console.log(`${fx.name.toUpperCase()} — ${a.brand} · ${a.category}  (score ${a.visibilityScore.score}/100, n=${a.basedOnResponses})`);
  console.log("=".repeat(78));
  console.log(`THREAT: ${a.threat ? a.threat.competitor : "(none)"}`);
  console.log(`PROOF POINTS: ${a.proofPoints.map((p) => `${p.label} [${p.competitors.join("/")}, ×${p.hits}]`).join(" | ") || "(none)"}`);
  const cookwareHit = JSON.stringify(a).match(COOKWARE_VOCAB);
  console.log(`COOKWARE VOCAB PRESENT: ${cookwareHit ? "YES → " + cookwareHit[0] : "no"}`);
  console.log("\n--- EVIDENCE-BACKED FIX CARDS ---");
  for (const c of a.fixCards.filter((c) => c.tier === "evidence_backed")) {
    console.log(`\n• [${c.impact.toUpperCase()}] ${c.title}`);
    console.log(`  WHY: ${c.why}`);
    console.log(`  STEP: ${c.suggestedFix}`);
    if (c.relatedSnippets.length) console.log(`  EVIDENCE: "${c.relatedSnippets[0]}"`);
  }
}
console.log("");
