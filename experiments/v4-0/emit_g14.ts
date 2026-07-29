// v4.0 — emit the LIVE G-14 raw table, using the standing gate's own build.
//
// Not a re-implementation: the generation parameters, the dictionary lift, the control
// handling and the evaluate() call are transcribed from `standards/__tests__/g14.table.test.ts`
// and must stay in step with it. Its own assertions are the check — if this emitter and the
// gate ever disagree, the gate is right and this file is broken.
import { readFileSync } from "node:fs";
import { evaluate, type Requirement, type PublicProduct } from "../../src/server/productTest.js";
import { buildEvidence, type QuotableSurface } from "../../src/server/testEvidence.js";
import { generateAttacks } from "../../standards/attack/generate.js";
import { parseContext } from "../../standards/attack/context.js";
import { ATTACK_CLASSES } from "../../standards/attack/types.js";

const REPO = "C:/Users/iamka/Documents/projects/ShopifyACO";
const CONTRA_DETAIL = "Your public copy states the opposite of this requirement.";
const SEED = "v3-8-g14-step1";
const PER_CELL = 999;

interface ClaimTermsView { support: string[]; violating: string[] }
function liftClaimTerms(): Record<string, ClaimTermsView> {
  const src = readFileSync(`${REPO}/src/server/productTest.ts`, "utf8");
  const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error("CLAIM_TERMS' typed declaration is gone");
  const open = start + anchor.length - 1;
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("CLAIM_TERMS is not brace-balanced");
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(open, end)};`)() as Record<string, ClaimTermsView>;
}

function productWith(text: string, surface: QuotableSurface): PublicProduct {
  return {
    origin: "https://store.example", handle: "p", title: "Thing", vendor: "Acme",
    productType: "Thing", tags: [],
    descriptionText: surface === "product_description" ? text : "",
    variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
    evidence: buildEvidence([{ surface, text }]),
    ldAvailability: null, storefrontObjectId: null, policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct;
}
const realEvaluate = (claimKey: string, text: string, surface: QuotableSurface) =>
  evaluate(productWith(text, surface), { id: "claim0", kind: "claim", claim: claimKey, label: claimKey } as Requirement);

const asVocabulary = (key: string, t: ClaimTermsView) => ({
  claim_key: key, standard_id: "ENGINE-BUILTIN", standard_version: "n/a", version: null,
  supporting_terms: t.support.map((term) => ({ term })),
  violating_terms: t.violating.map((term) => ({ term })),
});

const CLAIM_TERMS = liftClaimTerms();
const keys = Object.keys(CLAIM_TERMS);
const parsed = parseContext(JSON.parse(readFileSync(`${REPO}/standards/attack/contexts/generic-collisions.json`, "utf8")));

// two-sided liveness canary, the gate's own
const pos = realEvaluate("organic", "This product is organic.", "product_description");
const neg = realEvaluate("organic", "This product ships on Tuesday.", "product_description");
if (pos.status !== "pass_evidenced" || neg.status === "pass_evidenced") {
  console.error(`INCOMPLETE — canary collapsed (pos=${pos.status} neg=${neg.status})`);
  process.exit(2);
}

const cells = new Map<string, { pass: number; total: number }>();
let hostile = 0, controls = 0, controlsOk = 0;
const problems: string[] = [];
for (const key of keys) {
  const set = generateAttacks(asVocabulary(key, CLAIM_TERMS[key]!) as never, {
    seed: SEED, perCellLimit: PER_CELL, context: parsed.context, includeControls: true,
  });
  if (set.state === "incomplete") problems.push(`generation INCOMPLETE for ${key}`);
  if (set.coverage.droppedByCap.length) problems.push(`${key}: sentences dropped by cap`);
  for (const s of [...set.attacks, ...set.controls]) {
    const r = realEvaluate(key, s.text, s.surface);
    if (s.control) {
      controls++;
      const isPass = r.status === "pass_evidenced";
      const isContra = r.status === "not_proven" && r.detail === CONTRA_DETAIL;
      if (s.termRole === "violating" ? isContra : isPass) controlsOk++;
      continue;
    }
    hostile++;
    const k = `${key}|${s.attackClass}`;
    if (!cells.has(k)) cells.set(k, { pass: 0, total: 0 });
    const c = cells.get(k)!;
    c.total++;
    if (r.status === "pass_evidenced") c.pass++;
  }
}
if (problems.length) { console.error("INCOMPLETE:\n" + problems.join("\n")); process.exit(2); }

const lines: string[] = [];
for (const key of keys) {
  const parts = ATTACK_CLASSES.map((cls) => {
    const c = cells.get(`${key}|${cls}`);
    return c ? `${cls}: [${c.pass}, ${c.total}]` : `${cls}: null`;
  });
  lines.push(`  ${key}: { ${parts.join(", ")} },`);
}
console.log("// EXPECTED");
console.log(lines.join("\n"));
console.log("\n// EXPECTED_CLASS_TOTALS");
for (const cls of ATTACK_CLASSES) {
  let p = 0, n = 0;
  for (const key of keys) { const c = cells.get(`${key}|${cls}`); if (c) { p += c.pass; n += c.total; } }
  console.log(`  ${cls}: [${p}, ${n}],`);
}
console.log(`\nEXPECTED_HOSTILE_TOTAL = ${hostile}`);
console.log(`EXPECTED_CONTROL_TOTAL = ${controls}   (meeting expectation: ${controlsOk})`);
