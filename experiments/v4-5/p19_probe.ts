// v4.5 A2 — THE P-19 PROBE AND THE A/B INSTRUMENT, IN ONE FILE.
//
//   node --import tsx experiments/v4-5/p19_probe.ts            -> out/p19_<label>.jsonl
//   P19_LABEL=fix node --import tsx experiments/v4-5/p19_probe.ts
//
// It answers two different questions with one execution, deliberately, because they must
// be answered on the SAME rows or the second is not a measurement of the first:
//
//   1. POPULATION — before writing any rule, how many real stores are in each P-19 class,
//      and what does a candidate rule COST? This repo's standing rule is "score the
//      candidate rules before building one": v3.5's plausible-sounding `mpn === sku` rule
//      scored 0 true positives and 7 false ones, and the seven were the compliant case.
//   2. A/B — run at base, run at fix, diff. Quote-level, never status-only: v3.5 found two
//      regressions that were invisible to a status diff because the STATUS was identical
//      and the rendered sentence had changed underneath it.
//
// ⚠️ IT REPLAYS THROUGH THE REAL ENGINE, transport swapped, exactly as v2.9 established.
// Nothing about tier order, price parsing, currency precedence or row rendering is
// reimplemented here. A re-implementation would be a second engine that drifts, which is
// the mistake this repo already documents in four places.
//
// ⚠️ PRICE SOURCE IS DERIVED FROM THE RETURNED PRODUCT, not from instrumenting internals.
// `minPriceUsd` is `prices.length ? Math.min(...prices) : (ld?.offer?.price ?? null)`
// (productTest.ts:1423), and `variants[].priceUsd` is the same `prices` array before the
// min. So: any non-null `priceUsd` among the variants => the VARIANT TIER supplied it;
// none, but a non-null `minPriceUsd` => the JSON-LD OFFER FALLBACK did. That is the
// fallback P-19 names, and it is the one `parseOffer` fills with the FIRST offer object
// rather than the minimum.
//
// ⚠️ A REPLAY MISS IS A HARD ERROR, never a synthesised 404. A missing response must not
// look like a store that answered — the `INCOMPLETE`-is-not-zero rule.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runProductTest, fetchPublicProduct } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });
const LABEL = process.env.P19_LABEL || "base";

interface Recorded { status: number; contentType: string | null; body: string; finalUrl?: string }
interface Snap { host: string; category?: string; cohort?: string; url: string; capturedAt: string; responses: Record<string, Recorded> }

/** Identical to experiments/v3-8/census.ts. Synthetic snaps are excluded on purpose. */
const CORPORA = [
  { id: "general-v2.9", dir: path.join(REPO, "experiments", "v2-9", "snaps") },
  { id: "coffee-v3.5", dir: path.join(REPO, "experiments", "v3-5", "publish", "snaps_coffee100") },
  { id: "coffee-v3.2", dir: path.join(REPO, "experiments", "v3-2", "snaps_coffee") },
  { id: "coffee-v3.1", dir: path.join(REPO, "experiments", "v3-1", "snaps_coffee") },
  { id: "coffee-v3.0", dir: path.join(REPO, "experiments", "v3-0", "snaps_coffee") },
];

/** P-16: two files of one product are PERFECTLY CORRELATED, not merely clustered — they
 *  inflate n while adding no information. Dedup on the registrable-ish host, stripping a
 *  leading `www.` so `deathwishcoffee.com` and `www.deathwishcoffee.com` are one store. */
const dedupKey = (host: string) => host.replace(/^www\./i, "").toLowerCase();

const seen = new Set<string>();
const snaps: Array<{ corpus: string; file: string; snap: Snap }> = [];
for (const c of CORPORA) {
  if (!fs.existsSync(c.dir)) continue;
  for (const f of fs.readdirSync(c.dir).filter((x) => x.endsWith(".json")).sort()) {
    const snap = JSON.parse(fs.readFileSync(path.join(c.dir, f), "utf8")) as Snap;
    const k = dedupKey(snap.host);
    if (seen.has(k)) continue;
    seen.add(k);
    snaps.push({ corpus: c.id, file: f, snap });
  }
}

const outPath = path.join(OUT, `p19_${LABEL}.jsonl`);
fs.writeFileSync(outPath, "");

let evaluated = 0, hardErrors = 0;
const canary = { cheapSeen: false, dearSeen: false };

for (const { corpus, snap } of snaps) {
  const misses: string[] = [];
  const replay = async (url: string) => {
    const r = snap.responses[url];
    if (!r) { misses.push(url); throw new Error(`REPLAY MISS: ${url}`); }
    return r;
  };
  const rec: Record<string, unknown> = { host: snap.host, key: dedupKey(snap.host), corpus, url: snap.url, capturedAt: snap.capturedAt };
  try {
    __resetCaches();
    const fp = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} });
    const p = fp.product;
    const variantPrices = (p?.variants ?? []).map((v) => v.priceUsd);
    const fromVariants = variantPrices.some((x) => x != null);
    rec.minPriceUsd = p?.minPriceUsd ?? null;
    rec.declaredCurrency = p?.declaredCurrency ?? null;
    rec.variantCount = variantPrices.length;
    rec.variantPricesNonNull = variantPrices.filter((x) => x != null).length;
    rec.jsonLdOfferPrice = p?.extracted?.product?.offer?.price ?? null;
    rec.priceSource = p?.minPriceUsd == null ? "none" : fromVariants ? "variant_tier" : "jsonld_fallback";
    rec.variantPrices = variantPrices;

    __resetCaches();
    const result = await runProductTest(snap.url, { fetchUrl: replay, force: true, sleep: async () => {} });
    const rows = [...(result.assertions ?? []), ...(result.deferred ?? [])].map((a) => ({
      label: a.label, status: a.status, detail: a.detail ?? null,
    }));
    rec.rows = rows;                                   // QUOTE-LEVEL, untruncated
    const priceRow = rows.find((r) => /Lowest readable price is \$|publishes prices in |No public price/.test(String(r.detail ?? "")))
      ?? rows.find((r) => /^Price under \$/i.test(r.label));
    rec.priceRow = priceRow ?? null;
    if (typeof rec.minPriceUsd === "number") {
      if (rec.minPriceUsd > 0 && rec.minPriceUsd < 50) canary.cheapSeen = true;
      if (rec.minPriceUsd >= 50) canary.dearSeen = true;
    }
    rec.replayMisses = misses;
    evaluated++;
  } catch (e) {
    rec.error = String((e as Error).message).slice(0, 300);
    rec.replayMisses = misses;
    hardErrors++;
  }
  fs.appendFileSync(outPath, JSON.stringify(rec) + "\n");
}

// ---- two-sided liveness canary ----------------------------------------------
// Computed FROM THE DATA, not declared. If every store came back with no price, or
// every price landed in one band, the instrument is not reading prices and a clean
// diff would mean nothing.
const live = canary.cheapSeen && canary.dearSeen;
const summary = {
  label: LABEL,
  completion: !live ? "INCOMPLETE" : hardErrors > 0 ? "DEFECTS_FOUND" : "VERIFIED_CLEAN",
  corpora: CORPORA.length,
  deduped_stores: snaps.length,
  evaluated,
  hard_errors: hardErrors,
  canary: { ...canary, live },
  reasons: live ? [] : ["price canary collapsed: the run did not observe both a sub-$50 and a >=$50 price, so it is not reading prices"],
  out: outPath,
};
fs.writeFileSync(path.join(OUT, `p19_${LABEL}_summary.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
