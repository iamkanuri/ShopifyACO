// adv2 — HOW FAR DOES `readablePrices` REACH ON REAL STORES, measured from the ENGINE's
// own output at both commits rather than from a re-implemented JSON-LD parser.
//
// `jsonLdOfferPrice` in my probe is `product.extracted.product.offer.price` — literally
// what `parseOffer` returned. At base that is the FIRST offer object's price; at fix it is
// the MINIMUM across every offer. Diffing the two IS the population of rule 2, exactly, and
// it needs no second parser (the author's own `offer_shapes.ts` wrote one and it resolved
// INCOMPLETE with an anchor failure — "this probe under-reads and every count below is a
// floor").
import fs from "node:fs";
import path from "node:path";
const OUT = path.resolve("experiments/v4-5/adv2/out");
const read = (f) => fs.readFileSync(path.join(OUT, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const base = read("adv2_base.jsonl"), fix = read("adv2_fix.jsonl");
const k = (r) => `${r.corpus}::${r.file}`;
const F = new Map(fix.map((r) => [k(r), r]));

let joined = 0, withOffer = 0, offerMoved = 0, offerMovedButRowSafe = 0;
const moved = [], newZeroOffer = [], zeroOfferAlready = [];
for (const b of base) {
  const f = F.get(k(b)); if (!f) continue;
  joined++;
  if (b.jsonLdOfferPrice != null || f.jsonLdOfferPrice != null) withOffer++;
  if (b.jsonLdOfferPrice !== f.jsonLdOfferPrice) {
    offerMoved++;
    moved.push({ host: b.host, corpus: b.corpus, kept: b.kept, baseOffer: b.jsonLdOfferPrice, fixOffer: f.jsonLdOfferPrice, baseMin: b.minPriceUsd, fixMin: f.minPriceUsd, variantPricesNonNull: (b.variantPrices || []).filter((x) => x != null).length });
    if (b.minPriceUsd === f.minPriceUsd) offerMovedButRowSafe++;
  }
  // THE HAZARD: the LD fallback is now a MINIMUM taken BEFORE zeroAwareMin's non-zero
  // filter, so a single $0 offer in an array zeroes the whole fallback. It is masked
  // whenever the variant tier answers; it is not masked when it does not.
  if (f.jsonLdOfferPrice === 0 && b.jsonLdOfferPrice !== 0) newZeroOffer.push({ host: b.host, baseOffer: b.jsonLdOfferPrice, variantPricesNonNull: (b.variantPrices || []).filter((x) => x != null).length });
  if (f.jsonLdOfferPrice === 0 && b.jsonLdOfferPrice === 0) zeroOfferAlready.push(b.host);
}
// ---- two-sided anchor ----
// The probe must observe BOTH a store whose extracted offer moved and a large majority
// that did not, and it must see offers at all. Otherwise "2 moved" is unreadable.
const live = offerMoved > 0 && withOffer > offerMoved && withOffer > 50 && joined === 466;
console.log(JSON.stringify({
  COMPLETION: live ? "DEFECTS_FOUND" : "INCOMPLETE",
  anchor: { joined, stores_with_a_jsonld_offer_price: withOffer, offer_price_moved: offerMoved, live },
  offer_price_moved_but_row_unchanged: offerMovedButRowSafe,
  moved,
  ld_offer_became_zero_at_fix: newZeroOffer,
  ld_offer_was_already_zero: zeroOfferAlready.length,
}, null, 2));
