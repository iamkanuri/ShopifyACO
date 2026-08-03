/**
 * ADV1 PROBE 4 — REACHABILITY of the new `publishedZeroPrice` sentence, and whether
 * it can render for a product that DOES publish a real price.
 *
 * Part 1: does `buildBuyerTask` even emit a price row when publishedZeroPrice is set?
 * Part 2: end-to-end shape — an offers array with an unreadable/zero price BESIDE a
 *         real one, when the variant tier is empty (which is the NORMAL path for a
 *         store with complete page JSON-LD, because `pageSufficient` skips .json).
 * Part 3: corpus frequency of the enabling conditions, over the real snapshots.
 *
 * TWO-SIDED CANARIES throughout.
 */
import fs from "node:fs";
import path from "node:path";

import { extractPage as headExtract } from "../../../src/crawler/extract.js";
import { extractPage as baseExtract } from "./base/src/crawler/extract.js";
import { zeroAwareMin, evaluate, buildBuyerTask, type PublicProduct, type Requirement } from "../../../src/server/productTest.js";

const base = (over: Partial<PublicProduct> = {}): PublicProduct => ({
  origin: "https://probe.example", handle: "p", title: "Probe Coffee", vendor: "Probe", productType: "Coffee",
  tags: [], descriptionText: "A bag of coffee beans, roasted weekly.", variants: [],
  minPriceUsd: null, publishedZeroPrice: false, optionNames: [], optionValues: [],
  extracted: null, evidence: [], ldAvailability: null, storefrontObjectId: null,
  declaredCurrency: null,
  ...over,
} as unknown as PublicProduct);

const priceReq: Requirement = { id: "price", kind: "price_under", capUsd: 10, label: "Price under $10" };

console.log("=== PART 1: is the new sentence reachable from buildBuyerTask? ===");
const zeroProd = base({ ...zeroAwareMin([0, 0], null) });
const realProd = base({ ...zeroAwareMin([24], null) });
const zeroTask = buildBuyerTask(zeroProd);
const realTask = buildBuyerTask(realProd);
const hasPrice = (t: { requirements: Requirement[] }) => t.requirements.some((r) => r.kind === "price_under");
console.log(`  publishedZeroPrice product -> price row generated? ${hasPrice(zeroTask)}   (labels: ${zeroTask.requirements.map((r) => r.label).join(" | ")})`);
console.log(`  ordinary $24 product       -> price row generated? ${hasPrice(realTask)}   (cap label: ${realTask.requirements.find((r) => r.kind === "price_under")?.label})`);
if (hasPrice(zeroTask) === hasPrice(realTask)) { console.log("RESOLUTION: INCOMPLETE — canary collapsed in part 1."); process.exit(2); }
console.log(`  => the honest sentence is UNREACHABLE from buildBuyerTask; it needs a SUPPLIED price_under requirement.`);
console.log(`  evaluate() with a supplied requirement renders:`);
console.log(`    zero  : ${JSON.stringify(evaluate(zeroProd, priceReq).detail)}`);
console.log(`    normal: ${JSON.stringify(evaluate(realProd, priceReq).detail)}`);

console.log("\n=== PART 2: can that sentence render for a product publishing a REAL price? ===");
const page = (offers: string) =>
  `<html><head><meta name="description" content="d"><script type="application/ld+json">` +
  `{"@context":"https://schema.org","@type":"Product","name":"Probe","offers":${offers}}</script></head><body>x</body></html>`;
const SHAPES: Array<{ id: string; offers: string; truth: string }> = [
  { id: "zero-beside-real", offers: `[{"@type":"Offer","price":"45.00","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"0.00","availability":"https://schema.org/InStock"}]`, truth: "publishes 45.00" },
  { id: "contact-us", offers: `[{"@type":"Offer","price":"45.00","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"Contact us","availability":"https://schema.org/InStock"}]`, truth: "publishes 45.00" },
  { id: "empty-string", offers: `[{"@type":"Offer","price":"45.00","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"","availability":"https://schema.org/OutOfStock"}]`, truth: "publishes 45.00" },
  { id: "sold-out", offers: `[{"@type":"Offer","price":"45.00","availability":"https://schema.org/InStock"},{"@type":"Offer","price":"Sold out","availability":"https://schema.org/OutOfStock"}]`, truth: "publishes 45.00" },
  { id: "control-plain", offers: `{"@type":"Offer","price":"45.00","availability":"https://schema.org/InStock"}`, truth: "publishes 45.00 (control — must NOT move)" },
];
let moved = 0, control = 0;
for (const s of SHAPES) {
  const html = page(s.offers);
  const bOffer = baseExtract(html).product?.offer?.price ?? null;
  const hOffer = headExtract(html).product?.offer?.price ?? null;
  // variant tier EMPTY — the live path whenever the page's JSON-LD is complete.
  const bProd = base({ ...zeroAwareMin([], bOffer) });
  const hProd = base({ ...zeroAwareMin([], hOffer) });
  const bDetail = evaluate(bProd, priceReq).detail, hDetail = evaluate(hProd, priceReq).detail;
  const bStatus = evaluate(bProd, priceReq).status, hStatus = evaluate(hProd, priceReq).status;
  const changed = bDetail !== hDetail;
  if (s.id === "control-plain") { control = changed ? 1 : 0; }
  else if (changed) moved++;
  console.log(`\n  [${s.id}] truth: ${s.truth}`);
  console.log(`    offer.price base=${bOffer}  head=${hOffer}`);
  console.log(`    BASE ${bStatus}: ${bDetail}`);
  console.log(`    HEAD ${hStatus}: ${hDetail}`);
}
if (control !== 0) { console.log("\nRESOLUTION: INCOMPLETE — the control shape moved; the harness is not isolating the change."); process.exit(2); }
if (moved === 0) { console.log("\nRESOLUTION: INCOMPLETE — nothing moved at all; canary dead."); process.exit(2); }

console.log("\n=== PART 3: corpus frequency of the enabling conditions (397 real pages) ===");
const ROOT = path.resolve(import.meta.dirname, "../../..");
const SNAP_DIRS = ["experiments/v2-9/snaps", "experiments/v3-2/snaps_coffee", "experiments/v3-5/publish/snaps_coffee100"].map((d) => path.join(ROOT, d));
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
let pages = 0, ldOnlyPath = 0, multiOffer = 0, mixedZero = 0, hasPriceSpec = 0, negative = 0, jsonTierCaptured = 0;
for (const dir of SNAP_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    let html: string | null = null;
    for (const [u, r] of Object.entries<any>(snap.responses ?? {})) {
      if (r?.status === 200 && /html/i.test(r.contentType ?? "") && /\/products\//.test(u) && !/\.(json|js)(\?|$)/i.test(u)) { html = r.body; break; }
    }
    if (html == null) continue;
    pages++;
    const capturedJson = Object.keys(snap.responses).some((k) => /\/products\/[^/?]+\.json/.test(k));
    if (capturedJson) jsonTierCaptured++; else ldOnlyPath++;
    const e = headExtract(html);
    if (!e.product) continue;
    // re-read the raw offers to count shapes
    const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null; let offers: any = undefined;
    outer: while ((m = re.exec(html)) !== null) {
      let parsed: any; try { parsed = JSON.parse((m[1] ?? "").trim()); } catch { continue; }
      const visit = (n: any): any[] => Array.isArray(n) ? n.flatMap(visit) : (n && typeof n === "object" ? [...(Array.isArray(n["@graph"]) ? n["@graph"].flatMap(visit) : []), n] : []);
      for (const node of visit(parsed)) {
        const t = ([] as any[]).concat(node["@type"] ?? []).map(String);
        if (t.some((x) => /^(Product|ProductGroup)$/i.test(x))) { offers = node.offers; break outer; }
      }
    }
    const list = Array.isArray(offers) ? offers : offers == null ? [] : [offers];
    const vals: number[] = [];
    for (const o of list) {
      if (!o || typeof o !== "object") continue;
      if (o.priceSpecification != null) hasPriceSpec++;
      for (const v of [o.price, o.lowPrice, o.priceSpecification?.price]) { const n = num(v); if (n != null) vals.push(n); }
    }
    if (list.length > 1) multiOffer++;
    if (vals.some((v) => v <= 0) && vals.some((v) => v > 0)) { mixedZero++; console.log(`    MIXED-ZERO: ${snap.host} vals=${JSON.stringify(vals.slice(0, 12))}`); }
    if (vals.some((v) => v < 0)) negative++;
  }
}
console.log(`  product pages scanned                 ${pages}`);
console.log(`  .json tier captured (variant prices)  ${jsonTierCaptured}`);
console.log(`  NO .json captured => LD offer is the live price source   ${ldOnlyPath}`);
console.log(`  offers ARRAY with >1 entry            ${multiOffer}`);
console.log(`  offer carrying a priceSpecification   ${hasPriceSpec}`);
console.log(`  MIXED zero/unreadable BESIDE a real   ${mixedZero}`);
console.log(`  negative readable price               ${negative}`);
console.log(`\nRESOLUTION: DECISIVE (part-1 canary split, part-2 control held, ${pages} pages scanned).`);
