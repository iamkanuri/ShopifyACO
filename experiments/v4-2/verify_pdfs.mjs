// The two reference one-pagers, checked as ARTIFACTS: is what we claim is on them
// actually in the bytes an agency would forward?
//
// Every figure asserted here is read from the published artifact or from the stored row,
// never typed — a hand-typed expectation would only prove the two typings agree.
import { readFileSync } from "node:fs";
import { extractText, pdfHas, selfTest } from "./pdftext.mjs";

const BASE = "http://127.0.0.1:8787";
const [COFFEE, GENERAL] = process.argv.slice(2);
if (!COFFEE || !GENERAL) { console.error("usage: verify_pdfs.mjs <coffeeToken> <generalToken>"); process.exit(2); }

const fitness = JSON.parse(readFileSync(new URL("../../standards/coffee/v1.3/fitness.json", import.meta.url), "utf8"));
const coffeeSample = fitness.samples.find((s) => s.name === "coffee");
if (!coffeeSample) throw new Error("INCOMPLETE: no coffee sample in fitness.json");

const cases = [
  {
    name: "coffee / standard layer",
    pdf: "./onepager_coffee_klatchcoffee.pdf",
    token: COFFEE,
    mustFind: [
      ["the store, named", "klatchcoffee.com"],
      ["the standard and version", "ALS-COFFEE v1.3"],
      ["the content hash prefix", "ba2050578ed02748"],
      ["the selection rule, printed", "Selection rule: unmet requirements first"],
      ["the permanent citation URL", `${BASE}/result/${COFFEE}`],
      ["the methodology URL", `${BASE}/methodology`],
      ["the measured point estimate", `${coffeeSample.point_estimate_pct.toFixed(2)}%`],
      ["the measured 95% bound", `${coffeeSample.bound_95_cluster_icc02_pct.toFixed(2)}%`],
      ["the audited row count", `over ${coffeeSample.pass_rows_audited} passing rows`],
      ["a PEER LINE with a real denominator", "coffee stores don't state this"],
      ["a standard entry citation", "ALS-COFFEE-1.3-"],
      ["the not-a-criticism disclaimer", "statement about the page, not about the product"],
    ],
    mustNotFind: [
      // The denominator trap: five of ten entries were asked of fewer than 100 products.
      ["a bare “of 100” peer sentence where the denominator is 99", "of 100 coffee stores don't state this either. 92 of 99"],
      // The retired comparative sentence, in any of its revivals.
      ["the retired spread sentence", "order of magnitude"],
      ["the retired ratio sentence", "by about 1.6"],
    ],
  },
  {
    name: "general layer (no invented benchmark)",
    pdf: "./onepager_general_barebonesliving.pdf",
    token: GENERAL,
    mustFind: [
      ["the store, named", "barebonesliving.com"],
      ["it says which layer ran", "general engine, not a published standard"],
      ["the selection rule, printed", "Selection rule: unmet requirements first"],
      ["the permanent citation URL", `${BASE}/result/${GENERAL}`],
      ["the not-a-criticism disclaimer", "statement about the page, not about the product"],
    ],
    mustNotFind: [
      ["ANY measured percentage", "%"],
      ["a peer sentence it has no measurement for", "coffee stores"],
      ["a standard it did not execute", "ALS-COFFEE"],
    ],
  },
];

let failures = 0, checks = 0;
for (const c of cases) {
  const text = extractText(readFileSync(new URL(c.pdf, import.meta.url)));
  const st = selfTest(text, c.mustFind[0][1], `v42-nonce-${c.token}-zzq`);
  console.log(`\n=== ${c.name} — ${c.pdf.replace("./", "")}`);
  console.log(`    extractor canary: found=${st.positive_control_found} absent=${st.negative_control_absent} chars=${st.chars_extracted}`);
  if (!st.extractor_live) { console.log("    INCOMPLETE: extractor canary failed; nothing below is believable"); failures++; continue; }
  for (const [why, needle] of c.mustFind) {
    const ok = pdfHas(text, needle); checks++; if (!ok) failures++;
    console.log(`    ${ok ? "ok  " : "FAIL"}  ${why}`);
  }
  for (const [why, needle] of c.mustNotFind) {
    const ok = !pdfHas(text, needle); checks++; if (!ok) failures++;
    console.log(`    ${ok ? "ok  " : "FAIL"}  absent: ${why}`);
  }
}
console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures ? "DEFECTS_FOUND" : "VERIFIED_CLEAN");
process.exit(failures ? 1 : 0);
