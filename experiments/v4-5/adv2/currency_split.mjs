// adv2 — HOW MANY REAL STORES COULD SPLIT PRICE AND CURRENCY ACROSS OFFER OBJECTS?
//
// `parseOffer` now takes `price` as a minimum over EVERY offer while `currency` still
// comes from offers[0]. Before the change the two were guaranteed to come from the same
// object. This counts the real-store exposure.
//
// ⚠️ ANCHORED, because the author's own `offer_shapes.ts` probe wrote a second JSON-LD
// parser, under-read the engine by one store, and correctly resolved INCOMPLETE. This
// probe must find a JSON-LD offer price on at least as many snapshots as the ENGINE did
// (284, from adv2_fix.jsonl) or it reports INCOMPLETE and its counts are unreadable.
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve("C:/Users/iamka/Documents/projects/ShopifyACO");
const CORPORA = [
  ["general-v2.9", path.join(REPO, "experiments", "v2-9", "snaps")],
  ["coffee-v3.5", path.join(REPO, "experiments", "v3-5", "publish", "snaps_coffee100")],
  ["coffee-v3.2", path.join(REPO, "experiments", "v3-2", "snaps_coffee")],
  ["coffee-v3.1", path.join(REPO, "experiments", "v3-1", "snaps_coffee")],
  ["coffee-v3.0", path.join(REPO, "experiments", "v3-0", "snaps_coffee")],
];
const fixRows = fs.readFileSync(path.join(REPO, "experiments/v4-5/adv2/out/adv2_fix.jsonl"), "utf8")
  .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const ENGINE_WITH_OFFER = fixRows.filter((r) => r.jsonLdOfferPrice != null).length;

const num = (v) => { if (v == null) return null; const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const types = (n) => arr(n?.["@type"]).map((t) => String(t).toLowerCase());

let snaps = 0, withProduct = 0, withOfferPrice = 0;
const multiCurrency = [], zeroBesideReal = [], firstNotCheapest = [], unitSpec = [];

for (const [cid, dir] of CORPORA) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    snaps++;
    const html = snap.responses?.[snap.url]?.body ?? "";
    const blocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    let product = null;
    const walk = (n) => {
      if (product || !n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const x of n) walk(x); return; }
      if (types(n).includes("product")) { product = n; return; }
      for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
    };
    for (const b of blocks) { try { walk(JSON.parse(b)); } catch { /* a block that does not parse is not a product node */ } }
    if (!product) continue;
    withProduct++;
    const offers = arr(product.offers).filter((o) => o && typeof o === "object");
    const prices = [], currencies = [], specPrices = [];
    for (const o of offers) {
      for (const v of [o.price, o.lowPrice, o.priceSpecification?.price]) { const n = num(v); if (n != null) prices.push(n); }
      if (o.priceCurrency != null) currencies.push(String(o.priceCurrency).toUpperCase());
      const sp = num(o.priceSpecification?.price), pp = num(o.price);
      if (sp != null && pp != null && sp !== pp) specPrices.push({ price: pp, spec: sp, specType: arr(o.priceSpecification?.["@type"]).join("|") });
    }
    if (!prices.length) continue;
    withOfferPrice++;
    const first = (() => { const o = offers[0]; for (const v of [o?.price, o?.lowPrice, o?.priceSpecification?.price]) { const n = num(v); if (n != null) return n; } return null; })();
    const min = Math.min(...prices);
    const rec = { host: snap.host, corpus: cid, nOffers: offers.length, first, min, currencies: [...new Set(currencies)] };
    if (new Set(currencies).size > 1) multiCurrency.push(rec);
    if (prices.some((p) => p === 0) && prices.some((p) => p > 0)) zeroBesideReal.push(rec);
    if (first != null && min < first) firstNotCheapest.push(rec);
    if (specPrices.length) unitSpec.push({ ...rec, specPrices });
  }
}

const live = withOfferPrice >= ENGINE_WITH_OFFER && snaps === 466 && withProduct > 0;
console.log(JSON.stringify({
  COMPLETION: live ? "DEFECTS_FOUND" : "INCOMPLETE",
  anchor: {
    snapshots: snaps, with_a_jsonld_product_node: withProduct,
    this_probe_with_an_offer_price: withOfferPrice,
    engine_with_an_offer_price: ENGINE_WITH_OFFER,
    live,
    reason: live ? null : "this probe reads fewer offer prices than the engine did; every count below is a floor and must not be reported as a population",
  },
  multi_currency_offer_sets: { count: multiCurrency.length, stores: multiCurrency },
  zero_beside_a_real_price_in_offers: { count: zeroBesideReal.length, stores: zeroBesideReal },
  first_offer_not_cheapest: { count: firstNotCheapest.length, stores: firstNotCheapest },
  priceSpecification_disagrees_with_price: { count: unitSpec.length, stores: unitSpec.slice(0, 10) },
}, null, 2));
