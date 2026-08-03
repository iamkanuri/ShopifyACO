/**
 * ADV1 PROBE 2 — CHOSEN INPUT against `parseOffer`/`readablePrices` and `zeroAwareMin`.
 * A real-store replay is a regression check; this is the acceptance gate (v3.2 rule).
 *
 * Every case is A/B'd mechanically against the parent commit 6bac24a via a git worktree,
 * so "did my change cause this" is never read off prose.
 *
 * TWO-SIDED CANARY at the top: one case that MUST differ, one that MUST agree.
 */
import { extractPage as headExtract } from "../../../src/crawler/extract.js";
import { extractPage as baseExtract } from "./base/src/crawler/extract.js";
import { zeroAwareMin } from "../../../src/server/productTest.js";

const page = (offers: string, extra = "") =>
  `<html><head><meta name="description" content="d"><script type="application/ld+json">` +
  `{"@context":"https://schema.org","@type":"Product","name":"Probe","offers":${offers}${extra}}` +
  `</script></head><body>x</body></html>`;

type Case = { id: string; why: string; html: string; honest: number | null };

const CASES: Case[] = [
  // ---- CANARY -----------------------------------------------------------
  { id: "canary-differ", why: "first offer priceless, second priced — MUST differ base vs head",
    html: page(`[{"@type":"Offer","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"23.00"}]`), honest: 23 },
  { id: "canary-agree", why: "plain single offer — MUST agree base vs head",
    html: page(`{"@type":"Offer","price":"23.00"}`), honest: 23 },

  // ---- A: the shapes the brief names ------------------------------------
  { id: "neg-only", why: "a single NEGATIVE price string",
    html: page(`{"@type":"Offer","price":"-5.00"}`), honest: null },
  { id: "neg-mixed", why: "a negative BESIDE a real price in an offers array",
    html: page(`[{"@type":"Offer","price":"45.00"},{"@type":"Offer","price":"-5.00"}]`), honest: 45 },
  { id: "str-vs-num", why: "string price and numeric price in one array",
    html: page(`[{"@type":"Offer","price":29.5},{"@type":"Offer","price":"23.00"}]`), honest: 23 },
  { id: "nan", why: "an unparseable price string",
    html: page(`{"@type":"Offer","price":"Contact us"}`), honest: null },
  { id: "infinity", why: "a price of 1e999 (Infinity once Number()'d)",
    html: page(`{"@type":"Offer","price":1e999}`), honest: null },
  { id: "mixed-agg", why: "an Offer and an AggregateOffer in ONE array",
    html: page(`[{"@type":"Offer","price":"45.00"},{"@type":"AggregateOffer","lowPrice":"23.00","highPrice":"99.00"}]`), honest: 23 },
  { id: "agg-low-gt-price", why: "AggregateOffer where lowPrice > price",
    html: page(`{"@type":"AggregateOffer","price":"23.00","lowPrice":"45.00","highPrice":"99.00"}`), honest: 23 },
  { id: "agg-nested", why: "AggregateOffer whose real prices are in a NESTED offers[]",
    html: page(`{"@type":"AggregateOffer","offers":[{"@type":"Offer","price":"23.00"},{"@type":"Offer","price":"45.00"}]}`), honest: 23 },
  { id: "ps-array", why: "priceSpecification as an ARRAY",
    html: page(`{"@type":"Offer","priceSpecification":[{"@type":"PriceSpecification","price":"23.00"}]}`), honest: 23 },
  { id: "zero-with-real", why: "a 0.00 offer BESIDE a real one",
    html: page(`[{"@type":"Offer","price":"45.00"},{"@type":"Offer","price":"0.00"}]`), honest: 45 },
  { id: "all-zero", why: "every offer 0.00",
    html: page(`[{"@type":"Offer","price":"0.00"},{"@type":"Offer","price":"0.00"}]`), honest: null },

  // ---- THE ONE THAT MATTERS: a cheaper number that is NOT this product's price
  { id: "unit-price-spec", why: "UnitPriceSpecification — schema.org's REFERENCE price per unit (EU unit pricing). NOT what you pay.",
    html: page(`{"@type":"Offer","price":"23.00","priceCurrency":"EUR","priceSpecification":{"@type":"UnitPriceSpecification","price":"9.20","priceCurrency":"EUR","referenceQuantity":{"@type":"QuantitativeValue","value":100,"unitCode":"GRM"}}}`), honest: 23 },
  { id: "subscription-plan", why: "a selling-plan / subscription offer beside the one-time offer",
    html: page(`[{"@type":"Offer","name":"One-time purchase","price":"23.00"},{"@type":"Offer","name":"Subscribe & save 20%","price":"18.40"}]`), honest: 23 },
  { id: "eu-locale", why: "a locale-formatted price in one offer of the array",
    html: page(`[{"@type":"Offer","price":"1299.00"},{"@type":"Offer","price":"1.299,00"}]`), honest: 1299 },
  { id: "shipping-in-offer", why: "an offer carrying a shippingRate priceSpecification (a SHIPPING price, not a product price)",
    html: page(`{"@type":"Offer","price":"23.00","shippingDetails":{"@type":"OfferShippingDetails","shippingRate":{"@type":"MonetaryAmount","value":"4.95"}},"priceSpecification":{"@type":"DeliveryChargeSpecification","price":"4.95"}}`), honest: 23 },
  { id: "sub-cent", why: "a price of 0.004 — rounds to $0.00 in toFixed(2), the exact sentence this change exists to kill",
    html: page(`{"@type":"Offer","price":"0.004"}`), honest: null },
];

let canaryDiffer = false, canaryAgree = false;
const out: string[] = [];
for (const c of CASES) {
  const b = baseExtract(c.html).product?.offer?.price ?? null;
  const h = headExtract(c.html).product?.offer?.price ?? null;
  if (c.id === "canary-differ" && b !== h) canaryDiffer = true;
  if (c.id === "canary-agree" && b === h) canaryAgree = true;
  const moved = b !== h;
  const baseOk = b === c.honest, headOk = h === c.honest;
  const verdict = !moved
    ? (headOk ? "unchanged-ok" : "RESIDUAL")
    : (headOk ? "CLOSED" : baseOk ? "REGRESSION" : "moved-still-wrong");
  out.push(`${c.id.padEnd(18)} base=${String(b).padEnd(11)} head=${String(h).padEnd(11)} honest=${String(c.honest).padEnd(11)} ${verdict.padEnd(18)} ${c.why}`);
}

console.log("=== parseOffer / readablePrices, chosen input, A/B vs 6bac24a ===");
console.log(out.join("\n"));
if (!canaryDiffer || !canaryAgree) {
  console.log(`\nRESOLUTION: INCOMPLETE — canary collapsed (differ=${canaryDiffer} agree=${canaryAgree}).`);
  process.exit(2);
}

// ---- zeroAwareMin, chosen input (head only — the function does not exist at base) ----
console.log("\n=== zeroAwareMin, chosen input ===");
const z = (prices: number[], fb: number | null, honest: string) => {
  const r = zeroAwareMin(prices, fb);
  console.log(`  zeroAwareMin(${JSON.stringify(prices)}, ${fb}) -> min=${r.minPriceUsd} zeroFlag=${r.publishedZeroPrice}   | honest: ${honest}`);
  return r;
};
// canary: two inputs with known-different answers
const zc1 = z([24, 30], null, "24");
const zc2 = z([0], null, "refuse, zero");
if (zc1.minPriceUsd === zc2.minPriceUsd) { console.log("RESOLUTION: INCOMPLETE — zeroAwareMin canary collapsed."); process.exit(2); }
z([-5], null, "NOT zero — the merchant published -5.00");
z([-5, 45], null, "45");
z([NaN], null, "NOT zero — unparseable");
z([Infinity], null, "NOT a price");
z([-0], null, "zero (ok)");
z([], -5, "NOT a price; base gave -5 too");
z([0.004], null, "0.004 -> renders as $0.00");
z([0], -5, "refuse");

// what the row would actually RENDER for each
console.log("\n=== what toFixed(2) renders ===");
for (const v of [0.004, 0.0049, Infinity, -5]) console.log(`  ${String(v).padEnd(10)} -> "$${(v as number).toFixed(2)}"`);
console.log("\nRESOLUTION: DECISIVE (canaries live both ways).");
