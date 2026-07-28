// v3.9 CP-4 — VERIFY THE MECHANISM BY EXECUTION BEFORE DESIGNING ANYTHING.
//
// Claimed: a non-numeric price string survives `replace(/[^0-9.]/g,"")` as "", and
// Number("") === 0, so a malformed price parses as $0.00 and FAILS OPEN.
//
// `priceToUsd` is not exported. Lift the function's source out of productTest.ts and
// evaluate it, exactly as v3.8's harness lifts CLAIM_TERMS — a re-implementation would
// be a second engine that drifts, which is the mistake this repo already records.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("src/server/productTest.ts", "utf8");
const anchor = "const priceToUsd = ";
const start = src.indexOf(anchor);
if (start < 0) throw new Error("priceToUsd is no longer in productTest.ts — repair this probe, do not run it");
// take to the terminating `};` of the arrow function
const open = src.indexOf("{", start + anchor.length);
let depth = 0, end = -1;
for (let i = open; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) throw new Error("priceToUsd is not brace-balanced — refusing to guess");
const body = src.slice(open, end);
const argSig = src.slice(start + anchor.length, open).trim(); // "(p: ..., tier: ...): number|null =>"
// strip TS annotations for evaluation
const jsFn = `(function(p, tier) ${body.replace(/:\s*(number|string|PriceTier|number \| null|string \| number \| undefined)/g, "")})`;
// eslint-disable-next-line no-new-func
const priceToUsd = new Function(`return ${jsFn};`)() as (p: unknown, tier: string) => number | null;

// two-sided liveness canary — a lift that silently returns a constant reads exactly
// like a clean sweep.
const canaryA = priceToUsd("19.99", "json");   // must be 19.99
const canaryB = priceToUsd("1.2.3", "json");   // must be null (Number("1.2.3") is NaN)
const live = canaryA === 19.99 && canaryB === null;

const CASES: Array<[unknown, string, string]> = [
  // [input, tier, what a merchant page would mean by it]
  ["USD", "json", "a currency CODE landed in the price field"],
  ["EUR", "json", "a currency code"],
  ["", "json", "an empty price"],
  ["   ", "json", "whitespace only"],
  ["N/A", "json", "an explicit not-available"],
  ["TBD", "json", "a placeholder"],
  ["Contact us", "json", "call-for-price copy"],
  ["Sold out", "json", "a status string in the price slot"],
  ["$", "json", "a bare currency symbol"],
  ["-", "json", "a dash placeholder"],
  ["null", "json", "the STRING null"],
  ["free", "json", "a genuinely free item, said in words"],
  // shapes that are wrong in a different direction
  ["-5.00", "json", "a NEGATIVE price — the sign character is stripped"],
  ["1e5", "json", "exponent notation — 'e' stripped, 100000 becomes 15"],
  ["1,299.00", "json", "thousands separator (intended to work)"],
  ["$19.99", "json", "leading symbol (intended to work)"],
  ["19.99 USD", "json", "trailing code (intended to work)"],
  ["1.2.3", "json", "two decimal points"],
  // the js tier, for contrast — it already fails closed
  ["USD", "js", "currency code on the .js tier"],
  [1000, "js", "the v3.8 cents boundary"],
  [-1, "js", "negative integer on .js"],
];

const rows = CASES.map(([p, tier, why]) => {
  let got: unknown, threw: string | null = null;
  try { got = priceToUsd(p, tier); } catch (e) { threw = (e as Error).message; }
  const failsOpen = typeof got === "number" && Number.isFinite(got) &&
    (typeof p !== "number") && !/^[\s$,]*[\d,]+(\.\d+)?[\s A-Za-z]*$/.test(String(p));
  return {
    input: JSON.stringify(p), tier, why,
    returned: threw ? `THREW: ${threw}` : JSON.stringify(got),
    statesAPrice: typeof got === "number",
    rendersAs: typeof got === "number" ? `$${got.toFixed(2)}` : "(refuses)",
    failsOpen,
  };
});

const zeroCases = rows.filter((r) => r.returned === "0");
const out = {
  canary: { a: canaryA, b: canaryB, live },
  lifted_signature: argSig.replace(/\s+/g, " "),
  rows,
  mechanism_confirmed: zeroCases.length > 0,
  zero_producing_inputs: zeroCases.map((r) => r.input),
  completion: !live ? "INCOMPLETE" : zeroCases.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN",
};

console.log("canary:", JSON.stringify(out.canary), live ? "LIVE" : "*** DEAD — DO NOT TRUST ***");
console.table(rows);
console.log("\nmechanism confirmed:", out.mechanism_confirmed);
console.log("inputs that produce a stated $0.00:", out.zero_producing_inputs.join(", "));
console.log("completion:", out.completion);
writeFileSync("experiments/v3-9/out/cp4_probe.json", JSON.stringify(out, null, 2));
