// v3.9 — probe candidate GOLD sentences against the real engine.
// A gold case must be one the engine PASSES (otherwise "was the refutation right about this
// false pass" is incoherent) AND whose correct adjudication is unambiguous.
import { evaluate, type Requirement, type PublicProduct } from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";

const CONTRA = "Your public copy states the opposite of this requirement.";
function productWith(text: string, surface: QuotableSurface): PublicProduct {
  return {
    origin: "https://store.example", handle: "p", title: "Thing", vendor: "Acme",
    productType: "Thing", tags: [], descriptionText: surface === "product_description" ? text : "",
    variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
    evidence: buildEvidence([{ surface, text }]),
    ldAvailability: null, storefrontObjectId: null, policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct;
}
const ask = (key: string, text: string) => {
  const r = evaluate(productWith(text, "product_description"),
    { id: "c", kind: "claim", claim: key, label: key } as Requirement);
  return r.status === "pass_evidenced" ? "pass" : r.detail === CONTRA ? "contradicted" : "not_proven";
};

const C: Array<[string, string, string]> = [
  // [key, text, the unambiguous correct reading]
  ["vegan", "Northbank's cereal is vegan; ours contains honey.", "DEFECT — a rival is the subject and this product is excluded"],
  ["organic", "Our other blend, the House Roast, is certified organic.", "DEFECT — a sibling product is the subject"],
  ["vegan", "The gift set also includes a vegan lip balm from Northbank.", "DEFECT — a bundled item from another brand"],
  ["organic", "Every order arrives in a mailer made from organic cotton.", "DEFECT — the mailer is the subject"],
  ["fair_trade", "This book explains how fair trade certification works.", "DEFECT — the subject matter, not the product"],
  ["organic", "One reviewer wrote that our competitor's beans taste more organic.", "DEFECT — a review quoting a rival"],
  ["vegan", "This cereal is vegan.", "CORRECT — direct assertion"],
  ["organic", "This coffee is certified organic.", "CORRECT — direct assertion"],
  ["gluten_free", "These cookies are gluten-free, dairy-free and nut-free.", "CORRECT — coordinated list still asserts each"],
  ["single_origin", "A single-origin lot from Huila, Colombia.", "CORRECT — verbless but unambiguous about this product"],
];

for (const [k, t, why] of C) {
  const o = ask(k, t);
  console.log(`${o.padEnd(14)} [${k}] ${JSON.stringify(t)}\n                 ${why}`);
}
