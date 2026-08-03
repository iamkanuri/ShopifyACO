// adv2 — WHAT DOES THE LIVE PAGE SAY, TODAY, AT THIS COMMIT? Executed, not read.
import { currentOf, renderStandard, renderFitness, renderComparison } from "../../../src/server/standardsSite.js";
import { fitnessOf } from "../../../src/server/standardsSite.js";

const s = currentOf("coffee")!;
const page = renderStandard(s, "https://lens.thirdocular.com");
const html = String(page.bodyHtml);
const needles = [
  "483", "11 confirmed", "2.28", "5.17", "$0.00 treated as a price",
  "9.99", "4.38", "160",
];
console.log("=== substrings on /standards/coffee/1.3 ===");
for (const n of needles) console.log(`  ${JSON.stringify(n).padEnd(34)} present: ${html.includes(n)}`);
// CANARY: a string that must NOT be there, so "present: true" means something.
console.log(`  ${JSON.stringify("__adv2_absent__").padEnd(34)} present: ${html.includes("__adv2_absent__")} (want false)`);

const f = fitnessOf(s);
console.log("\n=== the sentences the page derives from the general sample ===");
const cmp = renderComparison(f.samples);
console.log(cmp.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1400));

console.log("\n=== defect-class lines as rendered ===");
const fit = renderFitness(s).replace(/<[^>]+>/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
for (const line of fit) if (/\$0\.00|guard|defect|class/i.test(line)) console.log("  " + line.slice(0, 220));
