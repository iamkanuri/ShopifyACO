// ===========================================================================
// NO EM OR EN DASHES IN ANYTHING A MERCHANT READS.
//
// ⚠️ THIS IS A CREDIBILITY RULE, NOT A TYPOGRAPHY PREFERENCE. The em dash is the most
// widely recognised tell of machine-written text. Every sentence this engine emits is a
// statement about a real merchant's store that we are asking them to check, and a reader
// who clocks the report as machine-generated discounts the findings before reading them.
// The result page is also what an agency is invited to click from a cold email; a page
// that reads as generated undoes the email that linked to it.
//
// TWO LAYERS, because either alone leaks:
//
//   1. BEHAVIOURAL. Run the real matcher over fixtures and assert no dash reaches an
//      assertion's `detail` or `label`. Exact, and covers copy assembled at runtime.
//   2. SOURCE. Scan the copy-bearing modules with comments stripped. Catches a new string
//      the moment it is written, including branches no fixture happens to hit.
//
// Layer 2 needs an allowlist, and it is deliberately tiny and justified: three regexes
// that PARSE dashes out of a merchant's own text. Those must keep matching dashes, because
// merchants write them. Reading a dash is fine; emitting one is not.
// ===========================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluate, type PublicProduct, type Requirement } from "../src/server/productTest.js";

const DASH = /[–—]/;
const DASH_G = /[–—]/g;

/** Modules whose strings reach a merchant or the public result page. */
const COPY_MODULES = [
  "src/server/productTest.ts",
  "src/server/publicStandard.ts",
  "src/server/resultPage.ts",
];

/**
 * Lines permitted to contain a dash, each because it READS one rather than writing one.
 * Keyed by a stable substring of the line so the list does not rot on renumbering.
 */
const ALLOW = [
  // Measurement patterns in merchant copy: "Weight – 250g".
  String.raw`\s*[:\-–]\s*\d`,
  // Splitting a merchant's care-instruction sentence on its own punctuation.
  "const CARE_CLAUSE_SPLIT =",
  // Splitting a merchant's product title on its own separator.
  "const head = title.split(",
];

function stripComments(src: string): string {
  // Block comments first, then line comments. `//` inside a string is possible (a URL),
  // so only strip when the quote count before it is even, i.e. we are not inside one.
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      if (i < 0) return line;
      const before = line.slice(0, i);
      const quotes = (before.match(/["'`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

test("[no-em-dash] no copy-bearing module emits an em or en dash", () => {
  const offenders: string[] = [];
  for (const rel of COPY_MODULES) {
    const abs = path.resolve(process.cwd(), rel);
    stripComments(fs.readFileSync(abs, "utf8")).split("\n").forEach((line, i) => {
      if (!DASH.test(line)) return;
      if (ALLOW.some((a) => line.includes(a))) return;
      offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(
    offenders, [],
    `Em or en dash in merchant-visible copy. Rewrite the sentence so it reads naturally with a\n` +
    `colon, full stop, comma or brackets — do not simply delete the dash and leave a gap.\n` +
    `If the line PARSES a dash out of merchant text rather than emitting one, add it to ALLOW\n` +
    `in this file with the reason.\n\n${offenders.join("\n")}`,
  );
});

// --- layer 1: what the matcher actually produces ------------------------------

function mk(over: Partial<PublicProduct> = {}): PublicProduct {
  return {
    origin: "https://example.com", handle: "h", title: "Example Coffee 12oz", vendor: "Example",
    productType: "Coffee", tags: [], descriptionText: "A coffee.", variants: [],
    minPriceUsd: 10, minPriceIsZero: false, optionNames: [], optionValues: [],
    extracted: null, evidence: [], ldAvailability: null, declaredCurrency: null,
    ...over,
  } as unknown as PublicProduct;
}

test("[no-em-dash] no assertion the matcher produces carries one", () => {
  const reqs: Requirement[] = [
    { id: "a", kind: "attribute", attribute: "measurements", label: "Measurements are stated" },
    { id: "b", kind: "claim", claim: "organic", label: "An organic claim is stated" },
    { id: "c", kind: "claim", claim: "fair_trade", label: "A fair-trade claim is stated" },
    { id: "d", kind: "claim", claim: "single_origin", label: "A single-origin claim is stated" },
    { id: "e", kind: "variant_option", optionValue: "Whole Bean", label: "Whole Bean option listed" },
    { id: "f", kind: "variant_option", optionValue: "Ground", label: "Ground option listed" },
    { id: "g", kind: "price_under", capUsd: 5, label: "Price under $5" },
    { id: "h", kind: "in_stock", label: "In stock" },
    { id: "i", kind: "delivery", label: "Delivery timing is stated" },
    { id: "j", kind: "identifiers", label: "A product identifier is published" },
  ] as unknown as Requirement[];

  // Two shapes that between them reach most branches: a bare single-SKU product, and one
  // with a real variant axis.
  const products = [
    mk(),
    mk({
      optionValues: ["Whole Bean", "Coarse"], optionNames: ["Grind"],
      variants: [{ title: "Whole Bean", priceUsd: 20, available: true, options: ["Whole Bean"] }],
    } as Partial<PublicProduct>),
  ];

  const offenders: string[] = [];
  for (const p of products) {
    for (const r of reqs) {
      const a = evaluate(p, r);
      for (const [field, text] of [["detail", a.detail], ["label", a.label], ["quote", a.evidenceQuote ?? ""]] as const) {
        if (DASH_G.test(text)) offenders.push(`${r.id}.${field}: ${text}`);
        DASH_G.lastIndex = 0;
      }
    }
  }
  assert.deepEqual(offenders, [], `matcher emitted a dash:\n${offenders.join("\n")}`);
});

// --- the regression this whole pass came from ---------------------------------

test("[variant-axis] a single-format product is not reported as missing that format", () => {
  // Copper Cow's real payload: title says Ground, one variant, options `[{Title:[Default
  // Title]}]`. The old matcher answered "no 'Ground' variant found" for a product with the
  // word Ground in its title, and reported Whole Bean, Espresso and Filter as `not_proven`
  // on a product that has no grind axis to be missing from.
  const copperCow = mk({ title: "Classic Black Ground Coffee - 10oz", productType: "Coffee",
    variants: [{ title: "Default Title", priceUsd: 17, available: true, options: ["Default Title"] }],
    optionValues: [] } as Partial<PublicProduct>);

  const ground = evaluate(copperCow, { id: "g", kind: "variant_option", optionValue: "Ground", label: "Ground option listed" } as unknown as Requirement);
  assert.equal(ground.status, "pass_evidenced", `a product titled Ground Coffee must not be told it has no Ground option: ${ground.detail}`);
  assert.match(ground.evidenceQuote ?? "", /Ground Coffee/);

  for (const missing of ["Whole Bean", "Espresso", "Filter"]) {
    const a = evaluate(copperCow, { id: "m", kind: "variant_option", optionValue: missing, label: `${missing} option listed` } as unknown as Requirement);
    assert.equal(a.status, "requires_store_access",
      `"${missing}" on an axis-less product is undecidable, not a finding about the store: ${a.detail}`);
    assert.doesNotMatch(a.detail, /no "?[A-Za-z ]+"? variant found/, "must not read as an absence claim");
  }

  // A product WITH a real grind axis still answers normally: absence there is about the product.
  const withAxis = mk({ title: "Ethiopia Yirgacheffe", optionValues: ["Whole Bean", "Coarse"],
    variants: [{ title: "Whole Bean", priceUsd: 20, available: true, options: ["Whole Bean"] }] } as Partial<PublicProduct>);
  assert.equal(evaluate(withAxis, { id: "x", kind: "variant_option", optionValue: "Whole Bean", label: "Whole Bean option listed" } as unknown as Requirement).status, "pass_evidenced");
  assert.equal(evaluate(withAxis, { id: "y", kind: "variant_option", optionValue: "Espresso", label: "Espresso option listed" } as unknown as Requirement).status, "not_proven");
});

test("[claim-detail] a failing claim row names the claim it looked for", () => {
  // Three claim rows used to render a byte-identical sentence, so a merchant with three
  // findings read the same line three times and could act on none of them.
  const p = mk();
  const details = ["organic", "fair_trade", "single_origin"].map((claim) =>
    evaluate(p, { id: claim, kind: "claim", claim, label: `${claim} stated` } as unknown as Requirement).detail);
  assert.equal(new Set(details).size, 3, `claim rows must not share one sentence:\n${details.join("\n")}`);
  assert.match(details[0]!, /an organic claim/);
  assert.match(details[1]!, /a fair trade claim/);
  assert.match(details[2]!, /a single origin claim/);
});
