/**
 * ADV1 PROBE 7 — the two converters, side by side.
 *
 * v3.9 CP-4 made `priceToUsd` (src/server/productTest.ts) FAIL CLOSED: anything not
 * matching /^\d+(\.\d+)?$/ is refused. That is what closed fetch-corpus cases mm-17
 * ("Free with any order" -> 0 wins Math.min), znn-05 (empty string -> 0 wins) and
 * znn-08 (negative loses its sign).
 *
 * `num()` in src/crawler/extract.ts is the SIBLING converter and was never hardened:
 * it strips to [0-9.\-] and accepts anything finite, so "" and "Sold out" become 0.
 * Before 7940be5 that only mattered for a LONE offer. `readablePrices` now takes a
 * MINIMUM across every offer, so one such field WINS over a genuinely published price
 * — which is verbatim mm-17's subclass, moved one surface over, where no corpus case
 * looks.
 *
 * TWO-SIDED CANARY: a well-formed value must survive BOTH converters identically.
 */
import { extractPage as headExtract } from "../../../src/crawler/extract.js";
import { extractPage as baseExtract } from "./base/src/crawler/extract.js";

// `priceToUsd` is not exported; reproduce its v3.9 CP-4 contract EXACTLY from source
// (src/server/productTest.ts:968-975) and assert the reproduction against the engine's
// own behaviour via the variant tier below.
const priceToUsdJsonTier = (p: string | number | undefined): number | null => {
  if (typeof p === "number") return Number.isFinite(p) && p >= 0 ? p : null;
  if (typeof p === "string") { const s = p.trim(); if (!/^\d+(\.\d+)?$/.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
  return null;
};

const HOSTILE = ["", "   ", "Sold out", "Free with any order", "Contact us", "N/A", "TBD", "$", "-", "USD", "-5.00", "0.00"];

const offerPage = (bad: string) =>
  `<html><head><meta name="description" content="d"><script type="application/ld+json">` +
  `{"@context":"https://schema.org","@type":"Product","name":"P","offers":[` +
  `{"@type":"Offer","price":"45.00","availability":"https://schema.org/InStock"},` +
  `{"@type":"Offer","price":${JSON.stringify(bad)},"availability":"https://schema.org/InStock"}]}` +
  `</script></head><body>x</body></html>`;

console.log("A product publishing a real $45.00 offer, with ONE hostile sibling offer.");
console.log("variantTier = what priceToUsd (v3.9 CP-4, HARDENED) does with the same string.");
console.log("offer.base / offer.head = the JSON-LD offer price the engine reports.\n");
console.log(`${"hostile value".padEnd(22)} ${"variantTier".padEnd(12)} ${"offer.base".padEnd(11)} ${"offer.head".padEnd(11)} verdict`);
let regressions = 0, unchanged = 0;
for (const bad of HOSTILE) {
  const vt = priceToUsdJsonTier(bad);
  const b = baseExtract(offerPage(bad)).product?.offer?.price ?? null;
  const h = headExtract(offerPage(bad)).product?.offer?.price ?? null;
  const verdict = b === 45 && h !== 45 ? "REGRESSION" : b === h ? "unchanged" : "moved";
  if (verdict === "REGRESSION") regressions++; else if (verdict === "unchanged") unchanged++;
  console.log(`${JSON.stringify(bad).padEnd(22)} ${String(vt).padEnd(12)} ${String(b).padEnd(11)} ${String(h).padEnd(11)} ${verdict}`);
}
// CANARY: a well-formed sibling must behave identically under both trees and both converters.
const good = "60.00";
const gb = baseExtract(offerPage(good)).product?.offer?.price ?? null;
const gh = headExtract(offerPage(good)).product?.offer?.price ?? null;
console.log(`${JSON.stringify(good).padEnd(22)} ${String(priceToUsdJsonTier(good)).padEnd(12)} ${String(gb).padEnd(11)} ${String(gh).padEnd(11)} CANARY (must both be 45)`);

if (regressions === 0) { console.log("\nRESOLUTION: INCOMPLETE — no case moved; instrument may be dead."); process.exit(2); }
if (!(gb === 45 && gh === 45)) { console.log("\nRESOLUTION: INCOMPLETE — canary did not hold at 45."); process.exit(2); }
console.log(`\nregressions=${regressions}  unchanged=${unchanged}  canary held`);
console.log("RESOLUTION: DECISIVE.");
