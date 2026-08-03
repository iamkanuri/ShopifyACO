// v4.5 A2 — WHAT IS ACTUALLY WRONG WITH THE FALLBACK? Measure the offer SHAPE.
//
// The population probe returned a number that changes the plan: 196 of 335 deduped
// stores take the JSON-LD offer fallback, and dropping it would stop 169 currently
// PASSING rows from stating a price. That is not a fix, it is a recall bonfire of the
// exact shape v4.0's G-15 referent guard was killed for (19.8 true rows lost per defect).
//
// The reason 196 stores are on that path is not that they are broken: `pageSufficient`
// SKIPS the `/products/{handle}.json` tier when the page's JSON-LD is complete. So the
// "fallback" is the ORDINARY path for most stores, and forcing the variant tiers would
// (a) spend the extra request the tier order exists to avoid — v3.2 measured `.json`
// returning 429 while HTML on the same hosts returned 200 — and (b) invalidate every
// captured snapshot, because replay serves only URLs that were actually recorded. This
// repo already wrote that rule down: a fix that invalidates the corpus it must be
// measured on is not a fix.
//
// So the defect is not WHICH SOURCE. It is how `parseOffer` reads that source. Two
// candidate mechanisms, both named in the fetch corpus, neither yet counted on real
// stores:
//   (a) `arr(raw).find(o => ...)` commits to the FIRST offer object, never a minimum.
//       -> a multi-offer array whose first entry is not the cheapest renders too high.
//   (b) `num(offers.price ?? offers.lowPrice)` — on an AggregateOffer, emitters set
//       `price` to the HIGH price, so the `??` order is backwards for a row whose whole
//       promise is the word "lowest".
//
// This counts both over the deduped corpus, and checks the four stores P-19 names.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJsonLd } from "../../src/crawler/extract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CORPORA = [
  ["general-v2.9", path.join(REPO, "experiments", "v2-9", "snaps")],
  ["coffee-v3.5", path.join(REPO, "experiments", "v3-5", "publish", "snaps_coffee100")],
  ["coffee-v3.2", path.join(REPO, "experiments", "v3-2", "snaps_coffee")],
  ["coffee-v3.1", path.join(REPO, "experiments", "v3-1", "snaps_coffee")],
  ["coffee-v3.0", path.join(REPO, "experiments", "v3-0", "snaps_coffee")],
] as const;
const dedupKey = (h: string) => h.replace(/^www\./i, "").toLowerCase();

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
const typesOf = (n: Record<string, unknown>) => arr(n["@type"]).map((t) => String(t).toLowerCase());
const numOf = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};

interface Hit { host: string; corpus: string; kind: string; first: number | null; min: number | null; low: number | null; high: number | null; nOffers: number }
const multiOffer: Hit[] = [];
const aggregate: Hit[] = [];
const seen = new Set<string>();
let stores = 0, withProduct = 0;

for (const [corpus, dir] of CORPORA) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as {
      host: string; url: string; responses: Record<string, { body: string }>;
    };
    const k = dedupKey(snap.host);
    if (seen.has(k)) continue;
    seen.add(k);
    stores++;
    // ⚠️ NOT `snap.responses[snap.url]`. Measured: 22 of the first 60 general snapshots
    // redirect (apex -> `www.`), so keying on the requested URL silently skips them. The
    // first draft of this file did exactly that and read a Product node on 135 stores
    // where the ENGINE read an offer price on 212 — a 37% under-read that would have made
    // "only 2 stores are affected" a statement about the instrument. The anchor at the
    // bottom of this file exists so that can never again pass unnoticed.
    const pageBody = snap.responses[snap.url]?.body
      ?? Object.entries(snap.responses).find(([u, r]) =>
        !/\.(json|js)$|robots\.txt$/.test(u) && typeof r?.body === "string" && /application\/ld\+json/i.test(r.body))?.[1]?.body;
    if (!pageBody) continue;
    const nodes = extractJsonLd(pageBody);
    const product = nodes.find((n) => typesOf(n).includes("product"));
    if (!product) continue;
    withProduct++;
    const offers = arr((product as Record<string, unknown>).offers).filter((o) => o && typeof o === "object") as Record<string, unknown>[];
    if (!offers.length) continue;

    // (a) multi-offer array: is the FIRST the cheapest?
    if (offers.length > 1) {
      const prices = offers.map((o) => numOf(o.price ?? o.lowPrice)).filter((n): n is number => n != null);
      if (prices.length > 1) {
        const first = numOf(offers[0]!.price ?? offers[0]!.lowPrice);
        const min = Math.min(...prices);
        if (first != null && first > min) {
          multiOffer.push({ host: snap.host, corpus, kind: "multi_offer_first_not_cheapest", first, min, low: null, high: null, nOffers: offers.length });
        }
      }
    }
    // (b) AggregateOffer where `price` is set and differs from `lowPrice`.
    const o0 = offers[0]!;
    if (typesOf(o0).includes("aggregateoffer")) {
      const price = numOf(o0.price);
      const low = numOf(o0.lowPrice);
      const high = numOf(o0.highPrice);
      if (price != null && low != null && price > low) {
        aggregate.push({ host: snap.host, corpus, kind: "aggregate_price_above_lowPrice", first: price, min: low, low, high, nOffers: offers.length });
      }
    }
  }
}

// ---- THE ANCHOR ------------------------------------------------------------
// `p19_base.jsonl` records what the ENGINE read: 212 stores yielded a JSON-LD offer
// price. This probe must find a Product node on at least that many, or it is reading
// fewer stores than the engine does and every count below is a floor of unknown depth.
// An unanchored probe that returns a small number looks exactly like a small problem.
let anchor: { engine_stores_with_offer_price: number; ok: boolean } | null = null;
const basePath = path.join(HERE, "out", "p19_base.jsonl");
if (fs.existsSync(basePath)) {
  const n = fs.readFileSync(basePath, "utf8").split(/\r?\n/).filter(Boolean)
    .map((l) => JSON.parse(l) as { jsonLdOfferPrice?: number | null })
    .filter((r) => r.jsonLdOfferPrice != null).length;
  anchor = { engine_stores_with_offer_price: n, ok: withProduct >= n };
}

const NAMED = ["fieldcompany.com", "deathwishcoffee.com", "templecoffee.com", "september.coffee"];
const out = {
  completion: anchor == null ? "INCOMPLETE" : anchor.ok ? "VERIFIED_CLEAN" : "INCOMPLETE",
  anchor_reason: anchor == null
    ? "no p19_base.jsonl to anchor against; counts are unverified"
    : anchor.ok
      ? null
      : `probe found a Product node on ${withProduct} stores but the engine read an offer price on ${anchor.engine_stores_with_offer_price}; this probe under-reads and every count below is a floor`,
  anchor,
  deduped_stores: stores,
  with_a_jsonld_product_node: withProduct,
  multi_offer_first_not_cheapest: { count: multiOffer.length, stores: multiOffer },
  aggregate_price_above_lowPrice: { count: aggregate.length, stores: aggregate },
  p19_named_stores: NAMED.map((n) => ({
    host: n,
    in_multi_offer: multiOffer.some((h) => dedupKey(h.host) === n),
    in_aggregate: aggregate.some((h) => dedupKey(h.host) === n),
  })),
};
fs.mkdirSync(path.join(HERE, "out"), { recursive: true });
fs.writeFileSync(path.join(HERE, "out", "offer_shapes.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
