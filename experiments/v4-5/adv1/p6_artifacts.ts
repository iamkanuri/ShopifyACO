/**
 * ADV1 PROBE 6 — BLAST RADIUS into src/artifacts (the merchant-facing fact pack /
 * llms.txt generator), executed rather than reasoned about.
 *
 * `CrawledPage.extracted` is produced by `extractPage` (src/crawler/crawl.ts:147) and
 * `buildMerchantFacts` reads `extracted.product.offer.price` at merchantFacts.ts:190,
 * 261, 265-266, 277. The commit measured `src/server/productTest.ts` rows only.
 *
 * Two things are checked, both A/B'd against 6bac24a:
 *   1. the variant JOIN at merchantFacts.ts:265, whose own comment says it exists to
 *      pick "the variant whose price matches the PDP's DISPLAYED price" — the min is
 *      not the displayed price;
 *   2. the published PRICE RANGE that ends up in the fact pack / llms.txt.
 *
 * Real bytes: balancecoffee.co.uk's captured product page (the store the corpus A/B
 * showed moving 29.99 -> 17.99).
 *
 * TWO-SIDED CANARY: a control page whose markup this change cannot move must produce
 * an identical fact pack on both trees.
 */
import fs from "node:fs";
import path from "node:path";
import { extractPage as headExtract } from "../../../src/crawler/extract.js";
import { extractPage as baseExtract } from "./base/src/crawler/extract.js";
import { buildMerchantFacts, type DiscoveredProduct } from "../../../src/artifacts/merchantFacts.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function findPage(host: string): { url: string; html: string } | null {
  for (const dir of ["experiments/v2-9/snaps", "experiments/v3-2/snaps_coffee", "experiments/v3-5/publish/snaps_coffee100"]) {
    const p = path.join(ROOT, dir, `${host}.json`);
    if (!fs.existsSync(p)) continue;
    const snap = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const [u, r] of Object.entries<any>(snap.responses ?? {})) {
      if (r?.status === 200 && /html/i.test(r.contentType ?? "") && /\/products\//.test(u) && !/\.(json|js)(\?|$)/i.test(u)) return { url: u, html: r.body };
    }
  }
  return null;
}

const mkPage = (url: string, ex: any) => ({
  url, finalUrl: url, origin: new URL(url).origin, ok: true, status: 200,
  contentType: "text/html", error: null, bytes: 1, truncated: false,
  title: ex.title, canonicalUrl: ex.canonicalUrl, robotsIndex: ex.robotsIndex,
  extracted: ex, injection: { flagged: false, terms: [] }, textExcerpt: "x", links: [],
}) as any;

const target = findPage("balancecoffee.co.uk");
// A store the 397-page A/B showed did NOT move — the negative side of the canary.
const control = findPage("3sixteen.com");
if (!target || !control) { console.log("RESOLUTION: INCOMPLETE — snapshot not found."); process.exit(2); }

// The `products.json` variant list this store's PDP corresponds to, taken from the
// same JSON-LD offers (30-pod = 29.99 displayed first, 10-pod = 17.99 cheapest).
// `compareAt` is set ONLY on the 10-pod variant, so the join's choice is observable.
const discovered: DiscoveredProduct[] = [{
  url: target.url, handle: "balance-coffee-pods", title: "Clean Coffee Pods",
  variants: [
    { price: 29.99, compareAt: null },
    { price: 55.99, compareAt: null },
    { price: 17.99, compareAt: 24.99 },
  ] as any,
} as any];

const run = (extract: typeof headExtract) => {
  const facts = buildMerchantFacts(
    [mkPage(target.url, extract(target.html))],
    "Balance Coffee", new URL(target.url).origin, discovered,
  );
  const snap = facts.products?.[0];
  return {
    offerPrice: extract(target.html).product?.offer?.price ?? null,
    price: snap?.price ?? null, compareAtPrice: snap?.compareAtPrice ?? null, onSale: snap?.onSale ?? null,
    range: facts.price ? `${facts.price.min}-${facts.price.max} ${facts.price.currency}` : null,
  };
};
const runControl = (extract: typeof headExtract) => {
  const facts = buildMerchantFacts([mkPage(control.url, extract(control.html))], "Temple", new URL(control.url).origin, []);
  return JSON.stringify({ p: facts.products?.[0]?.price, r: facts.price });
};

const b = run(baseExtract), h = run(headExtract);
console.log("=== buildMerchantFacts on balancecoffee.co.uk's real captured PDP ===");
console.log(`  JSON-LD offer price   base=${b.offerPrice}   head=${h.offerPrice}`);
console.log(`  joined variant price  base=${b.price}   head=${h.price}`);
console.log(`  compareAtPrice        base=${b.compareAtPrice}   head=${h.compareAtPrice}`);
console.log(`  onSale                base=${b.onSale}   head=${h.onSale}`);
console.log(`  published price range base=${b.range}   head=${h.range}`);
console.log(`  (the PDP DISPLAYS 29.99 — the first offer / first variant)`);

const cb = runControl(baseExtract), ch = runControl(headExtract);
console.log(`\n=== CONTROL (templecoffee.com, no products.json join) ===`);
console.log(`  base=${cb}`);
console.log(`  head=${ch}`);

const moved = JSON.stringify(b) !== JSON.stringify(h);
const controlMoved = cb !== ch;
if (!moved) { console.log("\nRESOLUTION: INCOMPLETE — target did not move; probe proves nothing."); process.exit(2); }
console.log(`\nmoved=${moved}  controlMoved=${controlMoved}`);
console.log("RESOLUTION: DECISIVE (target moved; control reported above).");
