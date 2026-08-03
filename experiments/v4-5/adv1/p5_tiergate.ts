/**
 * ADV1 PROBE 5 — is the TIER GATE mechanism live?
 *
 * `signals.price` (src/crawler/extract.ts:311) and `pageSufficient`
 * (src/server/productTest.ts:1394) both read `offer.price != null`. `readablePrices`
 * can only ADD readable values, so both can flip false->true. The 397-page replay
 * found 0 instances. That is a statement about the corpus, not about the mechanism.
 * This executes the mechanism on chosen input.
 *
 * A pageSufficient flip means the `/products/{handle}.json` TIER IS NOT FETCHED, which
 * changes descriptionText / variants / optionValues / tags — i.e. rows of OTHER kinds.
 *
 * Also dumps the ONE real store carrying a priceSpecification, so the
 * UnitPriceSpecification / DeliveryChargeSpecification class is checked against real
 * bytes rather than asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { extractPage as headExtract } from "../../../src/crawler/extract.js";
import { extractPage as baseExtract } from "./base/src/crawler/extract.js";

const page = (offers: string) =>
  `<html><head><meta name="description" content="A real meta description."><script type="application/ld+json">` +
  `{"@context":"https://schema.org","@type":"Product","name":"Probe","offers":${offers}}</script></head><body>x</body></html>`;

const sufficiency = (e: ReturnType<typeof headExtract>) => {
  const pageHasNode = Boolean(e.product?.name || e.product?.offer);
  const pageHasText = Boolean(e.faqs?.length || e.metaDescription);
  return pageHasNode && pageHasText && e.product?.offer?.price != null && Boolean(e.product?.offer?.availability);
};

const CASES: Array<{ id: string; offers: string }> = [
  // FIRST offer carries availability but NO price; a LATER one carries the price.
  { id: "price-only-on-later-offer", offers: `[{"@type":"Offer","availability":"https://schema.org/InStock","sku":"A"},{"@type":"Offer","price":"23.00","sku":"B"}]` },
  // AggregateOffer wrapper with no price, member offer priced -> still null (control).
  { id: "control-priced-first", offers: `[{"@type":"Offer","price":"23.00","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"45.00"}]` },
];

console.log("=== tier-gate mechanism, chosen input, A/B vs 6bac24a ===");
let flipped = 0, held = 0;
for (const c of CASES) {
  const html = page(c.offers);
  const b = baseExtract(html), h = headExtract(html);
  const bs = sufficiency(b), hs = sufficiency(h);
  const changed = b.signals.price !== h.signals.price || bs !== hs;
  if (c.id.startsWith("control")) { if (!changed) held++; } else if (changed) flipped++;
  console.log(`  [${c.id}]`);
  console.log(`    offer.price     base=${b.product?.offer?.price ?? null}  head=${h.product?.offer?.price ?? null}`);
  console.log(`    signals.price   base=${b.signals.price}  head=${h.signals.price}`);
  console.log(`    pageSufficient  base=${bs}  head=${hs}   <- true means /products/{handle}.json is NOT fetched`);
}
if (!flipped || !held) { console.log(`\nRESOLUTION: INCOMPLETE — canary collapsed (flipped=${flipped} held=${held}).`); process.exit(2); }

console.log("\n=== the ONE real store carrying an offer priceSpecification ===");
const ROOT = path.resolve(import.meta.dirname, "../../..");
const SNAP_DIRS = ["experiments/v2-9/snaps", "experiments/v3-2/snaps_coffee", "experiments/v3-5/publish/snaps_coffee100"].map((d) => path.join(ROOT, d));
let dumped = 0;
for (const dir of SNAP_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    let html: string | null = null;
    for (const [u, r] of Object.entries<any>(snap.responses ?? {})) {
      if (r?.status === 200 && /html/i.test(r.contentType ?? "") && /\/products\//.test(u) && !/\.(json|js)(\?|$)/i.test(u)) { html = r.body; break; }
    }
    if (!html) continue;
    const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    outer: while ((m = re.exec(html)) !== null) {
      let parsed: any; try { parsed = JSON.parse((m[1] ?? "").trim()); } catch { continue; }
      const visit = (n: any): any[] => Array.isArray(n) ? n.flatMap(visit) : (n && typeof n === "object" ? [...(Array.isArray(n["@graph"]) ? n["@graph"].flatMap(visit) : []), n] : []);
      for (const node of visit(parsed)) {
        const t = ([] as any[]).concat(node["@type"] ?? []).map(String);
        if (!t.some((x) => /^(Product|ProductGroup)$/i.test(x))) continue;
        const list = Array.isArray(node.offers) ? node.offers : node.offers == null ? [] : [node.offers];
        if (list.some((o: any) => o && typeof o === "object" && o.priceSpecification != null)) {
          dumped++;
          console.log(`  host=${snap.host}`);
          console.log(`  offers=${JSON.stringify(node.offers).slice(0, 1200)}`);
          console.log(`  base price=${baseExtract(html).product?.offer?.price}  head price=${headExtract(html).product?.offer?.price}`);
        }
        break outer;
      }
    }
  }
}
console.log(dumped ? `  (${dumped} dumped)` : "  none found");
console.log("\nRESOLUTION: DECISIVE.");
