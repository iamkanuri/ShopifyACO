/**
 * ADV1 PROBE 1 — mechanical A/B of `extractPage` (base 6bac24a vs head 7940be5)
 * over every captured real-store snapshot on disk.
 *
 * Question: does `readablePrices` change anything OTHER than the JSON-LD offer price?
 * Specifically:
 *   • `signals.price` (a presence boolean consumed by src/diagnosis/diagnose.ts)
 *   • `pageSufficient` in fetchPublicProduct — which decides whether the
 *     `/products/{handle}.json` TIER IS FETCHED AT ALL. If that flips, every
 *     requirement kind that reads the .json tier moves, not just price.
 *
 * TWO-SIDED LIVENESS CANARY: two synthetic pages with KNOWN-DIFFERENT answers
 * between the two trees. If they collapse, this run is INCOMPLETE, not clean.
 */
import fs from "node:fs";
import path from "node:path";

import { extractPage as headExtract } from "../../../src/crawler/extract.js";
import { extractPage as baseExtract } from "./base/src/crawler/extract.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SNAP_DIRS = [
  "experiments/v2-9/snaps",
  "experiments/v3-2/snaps_coffee",
  "experiments/v3-5/publish/snaps_coffee100",
].map((d) => path.join(ROOT, d));

// ---- CANARY --------------------------------------------------------------
// canaryA: an offers ARRAY whose FIRST entry has no price and whose SECOND does.
//          base reads the first object only -> null. head takes the min -> 23.
// canaryB: an ordinary single offer. Both trees must agree (23.00).
const ld = (offers: string) =>
  `<html><head><script type="application/ld+json">{"@type":"Product","name":"C","offers":${offers}}</script></head><body>x</body></html>`;
const canaryA = ld(`[{"@type":"Offer","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"23.00"}]`);
const canaryB = ld(`{"@type":"Offer","price":"23.00","availability":"https://schema.org/InStock"}`);

const cA = { base: baseExtract(canaryA).product?.offer?.price ?? null, head: headExtract(canaryA).product?.offer?.price ?? null };
const cB = { base: baseExtract(canaryB).product?.offer?.price ?? null, head: headExtract(canaryB).product?.offer?.price ?? null };
console.log(`CANARY A (must DIFFER): base=${cA.base} head=${cA.head}`);
console.log(`CANARY B (must AGREE) : base=${cB.base} head=${cB.head}`);
if (cA.base === cA.head || cB.base !== cB.head) {
  console.log("RESOLUTION: INCOMPLETE — the two trees collapsed; the A/B proves nothing.");
  process.exit(2);
}

// ---- the sweep -----------------------------------------------------------
type Row = {
  host: string; url: string;
  basePrice: number | null; headPrice: number | null;
  baseSignal: boolean; headSignal: boolean;
  baseSufficient: boolean; headSufficient: boolean;
};
const rows: Row[] = [];
let filesRead = 0, pagesFound = 0, unreadable = 0;

// mirrors src/server/productTest.ts:1392-1394 for the two fields extractPage owns.
// (pageHasText also needs jsonLdProductDescription/faqs/metaDescription; we compute the
//  extractPage-visible parts and hold the rest CONSTANT, since this change cannot move them.)
const sufficiency = (e: ReturnType<typeof headExtract>) => {
  const pageHasNode = Boolean(e.product?.name || e.product?.offer);
  const pageHasText = Boolean(e.faqs?.length || e.metaDescription);
  return pageHasNode && pageHasText && e.product?.offer?.price != null && Boolean(e.product?.offer?.availability);
};

for (const dir of SNAP_DIRS) {
  if (!fs.existsSync(dir)) { console.log(`MISSING SNAP DIR: ${dir}`); continue; }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    filesRead++;
    let snap: any;
    try { snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { unreadable++; continue; }
    const responses = snap.responses ?? {};
    // The product PAGE response: html contentType, and the url is the product path
    // (never .json / .js).
    let html: string | null = null; let url = "";
    for (const [u, r] of Object.entries<any>(responses)) {
      if (!r || r.status !== 200) continue;
      if (!/html/i.test(r.contentType ?? "")) continue;
      if (/\.(json|js)(\?|$)/i.test(u)) continue;
      if (!/\/products\//.test(u)) continue;
      html = r.body; url = u; break;
    }
    if (html == null) continue;
    pagesFound++;
    const b = baseExtract(html), h = headExtract(html);
    rows.push({
      host: snap.host ?? f, url,
      basePrice: b.product?.offer?.price ?? null, headPrice: h.product?.offer?.price ?? null,
      baseSignal: b.signals.price, headSignal: h.signals.price,
      baseSufficient: sufficiency(b), headSufficient: sufficiency(h),
    });
  }
}

const priceChanged = rows.filter((r) => r.basePrice !== r.headPrice);
const signalChanged = rows.filter((r) => r.baseSignal !== r.headSignal);
const suffChanged = rows.filter((r) => r.baseSufficient !== r.headSufficient);

console.log(`\nfiles read      ${filesRead}`);
console.log(`unreadable      ${unreadable}`);
console.log(`product pages   ${pagesFound}`);
console.log(`rows compared   ${rows.length}`);
console.log(`\nJSON-LD offer PRICE changed        ${priceChanged.length}`);
console.log(`signals.price PRESENCE changed     ${signalChanged.length}   <- diagnosis consumer`);
console.log(`pageSufficient (TIER GATE) changed ${suffChanged.length}   <- moves NON-price rows`);

const show = (label: string, list: Row[]) => {
  if (!list.length) return;
  console.log(`\n--- ${label} ---`);
  for (const r of list) {
    console.log(`  ${r.host.padEnd(30)} base=${String(r.basePrice).padEnd(10)} head=${String(r.headPrice).padEnd(10)} sig ${r.baseSignal}->${r.headSignal}  suff ${r.baseSufficient}->${r.headSufficient}`);
  }
};
show("PRICE CHANGED", priceChanged);
show("signals.price CHANGED", signalChanged);
show("pageSufficient CHANGED", suffChanged);

if (rows.length === 0) { console.log("\nRESOLUTION: INCOMPLETE — zero rows compared."); process.exit(2); }
console.log(`\nRESOLUTION: ${priceChanged.length || signalChanged.length || suffChanged.length ? "DEFECTS_FOUND-or-CHANGES" : "VERIFIED_CLEAN"} (rows=${rows.length})`);
