// v4.5 A1/D3 — DID WE EVER RENDER `$` AT A STORE THAT PUBLISHES ANOTHER CURRENCY?
//
//   node --import tsx experiments/v4-5/price_sweep_currency.ts
//
// `price_sweep.mjs` can decide D1 and D2 from the stored blob. It cannot decide D3:
// the blob holds no `declaredCurrency`. This script fetches each candidate store's
// product page and runs THE ENGINE'S OWN currency precedence over the bytes —
// `extractPage(...).offer.currency ?? shopifyActiveCurrency(html)`, upper-cased,
// exactly as `fetchPublicProduct` assembles it at productTest.ts:1431. Nothing about
// currency parsing is reimplemented here; a second implementation would drift, which
// is the mistake this repo already documents.
//
// ⚠️ RAW `fetch`, NOT `safeFetch`, AND THE REASON IS RECORDED. v2.9 measured that
// `safeFetch`'s transport (node:https pinned to a vetted IP, forced HTTP/1.1) is
// fingerprint-refused by some Cloudflare-fronted stores — 11 of 20 captured, every drop
// `rate_limited`, while raw `fetch` got 200 on the same hosts seconds later. This is a
// read-only offline measurement over URLs already stored by production, not a
// production code path, so the SSRF posture that transport buys is not what is being
// exercised. Using it here would manufacture "unreachable" answers.
//
// ⚠️ WHAT THIS CAN AND CANNOT ESTABLISH. The result was rendered at `ran_at`; these are
// the store's bytes TODAY. A store's currency is a store-level setting that changes
// rarely, but "rarely" is not "never", so a non-USD answer here is evidence about the
// store, not proof about the moment we rendered. Any hit is reported with both dates
// and adjudicated individually rather than counted.
//
// ⚠️ TWO-SIDED CANARY. Before any store is believed, the extraction is run against two
// constructed pages with known-different answers (a GBP JSON-LD page and a USD one).
// If they do not separate, the run resolves INCOMPLETE and reports no count.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractPage } from "../../src/crawler/extract.js";
import { shopifyActiveCurrency } from "../../src/server/productTest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The engine's own precedence, called the way productTest.ts:1431 calls it.
 *
 * ⚠️ `ld` IS `extracted.product`, NOT the ExtractedPage. The first draft of this file
 * read `extractPage(html).offer`, which does not exist — `offer` hangs off the Product
 * node (`extracted?.product`, productTest.ts:1398). It returned `undefined` for every
 * page, so the function answered `null` for every store, and "no store declares a
 * non-USD currency" would have been indistinguishable from "the field path is wrong".
 * That is the `grounding.sources` / `s.fitness` shape this repo has now recorded five
 * times. The two-sided canary is the only reason it was caught here.
 */
function declaredCurrencyOf(html: string): string | null {
  const ld = extractPage(html)?.product;
  return ((ld?.offer as { currency?: string | null } | null | undefined)?.currency
    ?? shopifyActiveCurrency(html) ?? null)?.toUpperCase() ?? null;
}

const CANARY_GBP = `<html><head><script type="application/ld+json">
{"@type":"Product","name":"x","offers":{"@type":"Offer","price":"135.00","priceCurrency":"GBP"}}
</script></head><body></body></html>`;
const CANARY_USD = `<html><head><script type="application/ld+json">
{"@type":"Product","name":"x","offers":{"@type":"Offer","price":"24.00","priceCurrency":"USD"}}
</script></head><body></body></html>`;

interface Row { token: string; store: string | null; url: string; kind: string; ran_at?: string | null }

const out: {
  completion: "VERIFIED_CLEAN" | "DEFECTS_FOUND" | "INCOMPLETE";
  reasons: string[];
  canary: unknown;
  checked: number;
  unreachable: { url: string; why: string }[];
  currencies: Record<string, number>;
  non_usd: unknown[];
} = { completion: "INCOMPLETE", reasons: [], canary: null, checked: 0, unreachable: [], currencies: {}, non_usd: [] };

const gbp = declaredCurrencyOf(CANARY_GBP);
const usd = declaredCurrencyOf(CANARY_USD);
out.canary = { gbp, usd, live: gbp === "GBP" && usd === "USD" };
if (!(gbp === "GBP" && usd === "USD")) {
  out.reasons.push(`two-sided canary collapsed (gbp=${gbp}, usd=${usd}); no count reported`);
  fs.writeFileSync(path.join(HERE, "out", "price_sweep_currency.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const sweep = JSON.parse(fs.readFileSync(path.join(HERE, "out", "price_sweep.json"), "utf8")) as {
  findings: { d3_candidates: Row[] };
};
// One URL per distinct store — the currency is a store-level setting, and P-16's rule
// is that perfectly-correlated duplicates inflate n while adding no information.
const byStore = new Map<string, Row>();
for (const c of sweep.findings.d3_candidates) {
  const key = c.store ?? new URL(c.url).host;
  if (!byStore.has(key)) byStore.set(key, c);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
for (const [store, row] of byStore) {
  try {
    const res = await fetch(row.url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow" });
    if (!res.ok) { out.unreachable.push({ url: row.url, why: `HTTP ${res.status}` }); continue; }
    const html = await res.text();
    const cur = declaredCurrencyOf(html);
    out.checked++;
    const key = cur ?? "(none declared)";
    out.currencies[key] = (out.currencies[key] ?? 0) + 1;
    if (cur && cur !== "USD") {
      out.non_usd.push({ store, token: row.token, url: row.url, kind: row.kind, declared_today: cur });
    }
  } catch (e) {
    out.unreachable.push({ url: row.url, why: String((e as Error).message ?? e).slice(0, 120) });
  }
  await new Promise((r) => setTimeout(r, 400));
}

// A store we could not read is not a store that answered USD.
if (out.unreachable.length > 0 && out.non_usd.length === 0) {
  out.completion = "INCOMPLETE";
  out.reasons.push(
    `${out.unreachable.length} of ${byStore.size} stores were unreachable; a clean result over the remainder is a floor, not a sweep`,
  );
} else {
  out.completion = out.non_usd.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
}
out.reasons.push(`stores=${byStore.size} checked=${out.checked} unreachable=${out.unreachable.length}`);

fs.mkdirSync(path.join(HERE, "out"), { recursive: true });
fs.writeFileSync(path.join(HERE, "out", "price_sweep_currency.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
