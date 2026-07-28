// v3.9 — DOES THE RENDERED QUOTE CONTAIN THE TERM IT PROVES?
//
// `hc-08` passes in the engine and fails in the mirror, and the reason is not a harness
// bug: the engine matched against the full evidence text and RENDERS a quote truncated at
// ~180 characters. On that row the truncation cut off the word `organic`, so the merchant
// (and any AI agent) sees a green row whose quoted proof does not contain the claimed term.
//
// This is the v3.2 finding one step worse. There it was "a row that renders NO quote is
// invisible to a human audit". Here the row renders a quote that ARGUES FOR NOTHING, and it
// looks more credible than a quoteless row, not less.
//
// Measured over both the suite cases and the whole 71-row population.
import fs from "node:fs";

const suite = JSON.parse(fs.readFileSync("standards/acceptance/subject-tense/suite2.json", "utf8"));
const axes = JSON.parse(fs.readFileSync("experiments/v3-9/out/axes.json", "utf8"));

const src = fs.readFileSync("src/server/productTest.ts", "utf8");
const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
const st = src.indexOf(anchor);
const open = st + anchor.length - 1;
let d = 0, end = -1;
for (let i = open; i < src.length; i++) {
  if (src[i] === "{") d++;
  else if (src[i] === "}") { d--; if (d === 0) { end = i + 1; break; } }
}
const CLAIM_TERMS = new Function(`return ${src.slice(open, end)};`)();

const norm = (s) => String(s ?? "").toLowerCase();
const containsTerm = (text, key) => {
  const t = CLAIM_TERMS[key];
  if (!t) return null;
  return t.support.some((term) => norm(text).includes(norm(term)));
};

const suiteRows = suite.cases.map((c) => ({
  id: c.id, direction: c.direction, host: c.provenance.host, claim: c.claim_key,
  truncated: /[…]$/.test(String(c.text).trim()),
  quoteCarriesTerm: containsTerm(c.text, c.claim_key),
}));

const popRows = axes.rows.filter((r) => r.quote).map((r) => ({
  host: r.domain, claim: r.claim, asked: r.asked,
  truncated: /[…]$/.test(String(r.quote).trim()),
  quoteCarriesTerm: containsTerm(r.quote, r.claim),
}));

const out = {
  suite: {
    n: suiteRows.length,
    truncated: suiteRows.filter((r) => r.truncated).length,
    quote_omits_the_term: suiteRows.filter((r) => r.quoteCarriesTerm === false).length,
    offenders: suiteRows.filter((r) => r.quoteCarriesTerm === false),
  },
  population_71: {
    n: popRows.length,
    truncated: popRows.filter((r) => r.truncated).length,
    quote_omits_the_term: popRows.filter((r) => r.quoteCarriesTerm === false).length,
    offenders: popRows.filter((r) => r.quoteCarriesTerm === false),
    // the ones a merchant actually sees
    asked_and_omits: popRows.filter((r) => r.asked && r.quoteCarriesTerm === false).length,
  },
  completion: "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/quote_omits.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
