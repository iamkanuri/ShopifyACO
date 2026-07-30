import { readFileSync } from "node:fs";
import { extractText, selfTest, pdfHas } from "./pdftext.mjs";
const buf = readFileSync(new URL("./smoke.pdf", import.meta.url));
const text = extractText(buf);
console.log(JSON.stringify({
  ...selfTest(text, "ALWAYS-VISIBLE-ANCHOR", "SCREEN-ONLY-CANARY"),
  has_summary: pdfHas(text, "SUMMARY-TEXT"),
  has_collapsed_body: pdfHas(text, "COLLAPSED-BODY-TEXT"),
  sample: text.replace(/\s+/g, " ").trim().slice(0, 300),
}, null, 2));
