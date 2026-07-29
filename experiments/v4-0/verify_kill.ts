// v4.0 CP-3 — VERIFY THE GATE'S BLOCKING FINDING MYSELF, BY EXECUTION.
//
// The adversarial pass returned REVERT_AND_PIN at 119 confirmed true-row losses. This
// repo's standing rule is that you never classify "did my change cause this" by reading an
// agent's prose — you A/B it. So the two blocking classes are re-executed here, guard-off
// and guard-on, in one process, against the frozen tree.
//
// Guard-off is not a re-implementation and not a second worktree: `referentGuard` is
// opt-in, so calling `findSupport` WITHOUT it reproduces the pre-guard behaviour exactly.
//
// THREE-LEGGED CANARY. A probe that cannot distinguish the two sides reports "no
// differences", which is the flattering direction.
import {
  evaluate, type Requirement, type PublicProduct,
} from "../../src/server/productTest.js";
import { buildEvidence, findSupport } from "../../src/server/testEvidence.js";

const TERMS: Record<string, string[]> = {
  organic: ["organic", "usda organic", "certified organic"],
  vegan: ["vegan", "100% vegan"],
  gluten_free: ["gluten-free", "gluten free", "no gluten"],
  bpa_free: ["bpa-free", "bpa free", "no bpa", "without bpa"],
  fair_trade: ["fair trade", "fair-trade", "fairtrade"],
  single_origin: ["single origin", "single-origin", "single estate", "single farm"],
  paraben_free: ["paraben-free", "paraben free", "no parabens", "without parabens"],
  third_party_tested: ["third-party tested", "third party tested", "independently tested", "lab tested", "certificate of analysis"],
};

const ev = (text: string) => buildEvidence([{ surface: "product_description" as const, text }]);
const before = (text: string, key: string) =>
  findSupport(ev(text), TERMS[key]!, { wholeWord: true }) ? "pass_evidenced" : "not_proven";
const after = (text: string, key: string) =>
  findSupport(ev(text), TERMS[key]!, { wholeWord: true, referentGuard: true }) ? "pass_evidenced" : "not_proven";

const mk = (text: string): PublicProduct => ({
  origin: "https://s.example", handle: "p", title: "Thing", vendor: "Acme",
  productType: "Thing", tags: [], descriptionText: text,
  variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
  minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
  evidence: ev(text), ldAvailability: null, policyStatus: "not_fetched",
  fetched: { json: true, page: false, js: false, policy: false },
} as unknown as PublicProduct);
const row = (text: string, key: string) =>
  evaluate(mk(text), { id: "c", kind: "claim", claim: key, label: key } as Requirement).status;

// ---- three-legged canary ----------------------------------------------------
const c1 = before("This product is organic.", "organic") === "pass_evidenced"
        && after("This product is organic.", "organic") === "pass_evidenced";
const c2 = before("This product ships on Tuesday.", "organic") === "not_proven"
        && after("This product ships on Tuesday.", "organic") === "not_proven";
const known = "This lot is from a cooperative that has 54 organic certified producers that farm here.";
const c3 = before(known, "organic") === "pass_evidenced" && after(known, "organic") === "not_proven";
if (!(c1 && c2 && c3)) {
  console.error(`INCOMPLETE — canary collapsed: same=${c1} neg=${c2} moves=${c3}`);
  process.exit(2);
}

// ---- CLASS A: the coordinated-clause / copula shape -------------------------
const A: Array<[string, string]> = [
  ["The beans are organic and farmers in Huila are paid above the C price.", "organic"],
  ["The bar is vegan and small farmers are paid a premium for every pod.", "vegan"],
  ["The granola is gluten free and family farms in Montana grow the oats.", "gluten_free"],
  ["The bottle is BPA-free and local growers are paid within seven days.", "bpa_free"],
  ["The serum is paraben free and partner cooperatives are certified annually.", "paraben_free"],
  ["This powder is third-party tested and organic farms in Peru grow the maca.", "third_party_tested"],
  ["The cocoa is fairtrade and two cooperatives in Peru grow all of it.", "fair_trade"],
  ["This lot is single origin and farms in Huila are visited every season.", "single_origin"],
];

// ---- CLASS B: provenance — "comes from an organic farm" ---------------------
const B: Array<[string, string]> = [
  ["This coffee comes from an organic farm in Antioquia.", "organic"],
  ["The cotton comes from organic farms in Gujarat.", "organic"],
  ["The wool comes from certified organic farms in the Yorkshire Dales.", "organic"],
  ["This tea is grown on an organic farm in the Nilgiri hills.", "organic"],
  ["This lot comes from a single origin farm in Huila.", "single_origin"],
];

// ---- THE PUNCTUATION MINIMAL PAIR -------------------------------------------
const PAIR: Array<[string, string, string]> = [
  ["no comma", "The bar is vegan and small farmers are paid a premium for every pod.", "vegan"],
  ["one comma", "The bar is vegan, and small farmers are paid a premium for every pod.", "vegan"],
];

let lost = 0;
const report = (label: string, cases: Array<[string, string]>) => {
  console.log(`\n=== ${label} ===`);
  for (const [text, key] of cases) {
    const b = before(text, key), a = after(text, key), r = row(text, key);
    const moved = b === "pass_evidenced" && a === "not_proven";
    if (moved) lost++;
    console.log(`${moved ? "LOST " : "     "} [${key}] ${b} -> ${a}  (engine row: ${r})`);
    console.log(`        ${text}`);
  }
};
report("CLASS A — the claim is copula-predicated of the product, then a supply-chain clause follows", A);
report("CLASS B — provenance: for an agricultural product, grown on a certified organic farm IS the claim", B);

console.log("\n=== THE PUNCTUATION MINIMAL PAIR ===");
for (const [label, text, key] of PAIR) {
  console.log(`${label.padEnd(10)} ${before(text, key)} -> ${after(text, key)}   ${text}`);
}

console.log(`\ncanary: same=${c1} neg=${c2} moves=${c3}  LIVE`);
console.log(`true rows lost across ${A.length + B.length} chosen cases: ${lost}`);
console.log(`completion: ${lost ? "DEFECTS_FOUND" : "VERIFIED_CLEAN"}`);
