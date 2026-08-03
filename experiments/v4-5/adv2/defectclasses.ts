// adv2 — DOES THE PUBLISHED PAGE STILL SAY "no guard addresses it" ABOUT A CLASS THE
// SHIPPED ENGINE NOW GUARDS? Executed against the renderer, not read off the JSON.
import { currentOf, renderFitness, fitnessOf } from "../../../src/server/standardsSite.js";

const s = currentOf("coffee")!;
const text = renderFitness(s).replace(/<[^>]+>/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
const i = text.findIndex((l) => l.includes("$0.00 treated as a price"));
console.log("=== rendered lines around the '$0.00 treated as a price' class ===");
console.log(text.slice(i, i + 6).map((l) => "  " + l.slice(0, 150)).join("\n"));

const f = fitnessOf(s);
const g = f.samples.find((x) => x.name === "general");
console.log("\n=== the same artifact, two sections apart ===");
console.log("  defect_classes:   '$0.00 treated as a price' count",
  g.defect_classes.find((c) => c.klass.includes("$0.00")).count,
  "addressed_by_a_guard =", g.defect_classes.find((c) => c.klass.includes("$0.00")).addressed_by_a_guard);
console.log("  surviving_defects:", JSON.stringify(g.surviving_defects));
console.log("  confirmed_false_positives:", g.confirmed_false_positives, "over", g.pass_rows_audited, "rows");
const sum = g.defect_classes.reduce((n, c) => n + c.count, 0);
console.log(`  SUM of defect_classes counts = ${sum}; confirmed_false_positives = ${g.confirmed_false_positives}; surviving_defects length = ${g.surviving_defects.length}`);
console.log(sum === g.confirmed_false_positives ? "  consistent" : "  ⚠️ INCONSISTENT — the class table and the confirmed count disagree by " + (sum - g.confirmed_false_positives));
// CANARY: the renderer must actually be emitting these lines.
console.log(`\nCANARY class line found at index ${i} (must be >= 0): ${i >= 0}`);
console.log(`CANARY a string that is not there: ${text.some((l) => l.includes("__adv2_absent__"))} (want false)`);
