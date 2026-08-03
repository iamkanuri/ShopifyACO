// ===========================================================================
// v3.8 CP-1B — THE FETCH-LAYER ADVERSARIAL HARNESS.
//
//   node --import tsx experiments/v3-8/fetch_harness.ts [cases.json]
//
// WHY THIS EXISTS. All 18 of v3.7's general-sample defects came from SAMPLING
// REAL STORES, and four of the seven classes live UPSTREAM of `evaluate` — in
// `fetchPublicProduct` / `priceToUsd` / tier selection — where the adversarial
// corpus structurally cannot express them. This repo's central rule ("sampling
// real stores catches artefacts; only executing against deliberately chosen
// input catches logic") has never been applied to that layer at all.
//
// WHAT IT DOES. Takes SEMANTIC case specs — what a merchant publishes, per tier —
// synthesizes REAL HTTP response bodies from them, and feeds those through the
// REAL `fetchPublicProduct` -> extract -> tier-selection -> price path with only
// the transport swapped. Nothing about parsing, tier order, robots, or the price
// conversion is reimplemented here; if it were, this would be a second engine
// that drifts, which is the mistake this repo already documents.
//
// The AUTHORS of the cases wrote no bytes and no fix. This file writes the bytes.
// The fix, if any, is written later by someone who did not author either.
//
// Completion comes from the real `src/measure/completion.ts`.
// ===========================================================================

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregate, type UnitReport } from "../../src/measure/completion.js";
import { fetchPublicProduct, evaluate, type Requirement } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

// ---- the case spec ----------------------------------------------------------

interface VariantSpec { title?: string; price?: string | number | null; available?: boolean | null }
interface TierSpec { status?: number; variants?: VariantSpec[]; raw_body?: string; content_type?: string }
interface StoreSpec {
  jsonld?: { price?: string | number | null; priceCurrency?: string | null; availability?: string | null } | null;
  bootstrap?: { currency?: string | null; country?: string | null; product_type?: string | null; variant_prices?: number[] } | null;
  json_tier?: TierSpec | null;
  js_tier?: TierSpec | null;
  page_status?: number;
  robots_disallow?: string[];
}
interface HonestAnswer {
  min_price_usd: number | null;
  currency: string | null;
  verdict: "pass" | "not_proven" | "requires_store_access";
  must_not_render: string[];
}
export interface FetchCase {
  id: string; attack_class: string; subclass: string; intent: string; why: string;
  unreachable_by_real_store_sample?: boolean;
  store: StoreSpec;
  honest_answer: HonestAnswer;
}

// ---- synthesis --------------------------------------------------------------

const HOST = "case.example";
const HANDLE = "p";
const ORIGIN = `https://${HOST}`;
const URL_PAGE = `${ORIGIN}/products/${HANDLE}`;

const j = (v: unknown): string => JSON.stringify(v);

/** A product page carrying JSON-LD and the Shopify analytics bootstrap. Shaped
 *  after the real captured pages, not invented: `var meta = {...};` on its own
 *  line, `Shopify.currency = {"active":...}`, an `og:price:currency` meta. */
function synthPage(s: StoreSpec): string {
  // ⚠️ v4.5 REPAIR — THIS SYNTHESIZER USED TO IGNORE `offers_shape` AND `offers`, so any
  // case describing an offers ARRAY or an AggregateOffer was silently flattened into ONE
  // plain Offer built from the scalar `price`. `mm-01` ("offers is an ARRAY and parseOffer
  // commits to the first object") and `mm-02` (AggregateOffer with price and lowPrice)
  // therefore never presented the shape they are named for — they were VACUOUS, failing
  // for the generic reason rather than the authored one, and they flagged identically
  // before and after a change that demonstrably fixes that shape on real stores.
  // Same family as v3.4's `[publish]` mutations, which all matched the wrong error because
  // the unmutated fixture was already rejected. A case that cannot fire proves nothing.
  const spec = s.jsonld as (typeof s.jsonld & { offers_shape?: string; offers?: unknown }) | null | undefined;
  const scalarOffer = {
    "@type": "Offer",
    ...(s.jsonld?.price === undefined ? {} : { price: s.jsonld.price }),
    ...(s.jsonld?.priceCurrency == null ? {} : { priceCurrency: s.jsonld.priceCurrency }),
    ...(s.jsonld?.availability == null ? {} : { availability: `https://schema.org/${s.jsonld.availability}` }),
  };
  const offersNode = spec?.offers !== undefined && spec.offers !== null ? spec.offers : scalarOffer;
  const ld = s.jsonld
    ? `<script type="application/ld+json">${j({
      "@context": "https://schema.org", "@type": "Product", name: "Case Product",
      offers: offersNode,
    })}</script>`
    : "";
  const b = s.bootstrap;
  const meta = b
    ? `<script>var meta = ${j({
      product: {
        id: 111111111,
        ...(b.product_type == null ? {} : { type: b.product_type }),
        variants: (b.variant_prices ?? []).map((p, i) => ({ id: 900000 + i, price: p, sku: `SKU${i}` })),
      },
      page: { pageType: "product" },
    })};\n</script>`
    : "";
  const cur = b?.currency ? `<script>Shopify.currency = {"active":"${b.currency}","rate":"1.0"};</script>` : "";
  const ctry = b?.country ? `<script>Shopify.country = "${b.country}";</script>` : "";
  const og = b?.currency ? `<meta property="og:price:currency" content="${b.currency}">` : "";
  return `<!doctype html><html><head><title>Case Product</title>${og}${ld}</head><body>
<h1>Case Product</h1><div class="rte"><p>A product for a chosen-input case.</p></div>
${meta}${cur}${ctry}</body></html>`;
}

function synthTierBody(t: TierSpec, wrap: boolean): string {
  if (typeof t.raw_body === "string") return t.raw_body;
  const variants = (t.variants ?? []).map((v, i) => ({
    id: 800000 + i,
    title: v.title ?? `V${i}`,
    ...(v.price === undefined ? {} : { price: v.price }),
    ...(v.available === null || v.available === undefined ? {} : { available: v.available }),
    option1: v.title ?? `V${i}`,
  }));
  const product = { id: 111111111, title: "Case Product", vendor: "Acme", product_type: "Thing", tags: [], body_html: "<p>A product.</p>", options: [{ name: "Style", values: variants.map((v) => v.title) }], variants };
  return wrap ? j({ product }) : j(product);
}

/** The recorded-response map a replay transport serves. */
function synthResponses(s: StoreSpec): Record<string, { status: number; contentType: string | null; body: string }> {
  const r: Record<string, { status: number; contentType: string | null; body: string }> = {};
  const dis = (s.robots_disallow ?? []).map((d) => `Disallow: ${d}`).join("\n");
  r[`${ORIGIN}/robots.txt`] = { status: 200, contentType: "text/plain", body: `User-agent: *\n${dis}\n` };
  r[URL_PAGE] = { status: s.page_status ?? 200, contentType: "text/html; charset=utf-8", body: synthPage(s) };
  if (s.json_tier) {
    r[`${URL_PAGE}.json`] = {
      status: s.json_tier.status ?? 200,
      contentType: s.json_tier.content_type ?? "application/json; charset=utf-8",
      body: synthTierBody(s.json_tier, true),
    };
  }
  if (s.js_tier) {
    r[`${URL_PAGE}.js`] = {
      status: s.js_tier.status ?? 200,
      contentType: s.js_tier.content_type ?? "text/javascript; charset=utf-8",
      body: synthTierBody(s.js_tier, false),
    };
  }
  return r;
}

// ---- execution --------------------------------------------------------------

export interface CaseResult {
  id: string; attack_class: string; subclass: string; intent: string; why: string;
  unreachable_by_real_store_sample: boolean;
  engine: {
    ok: boolean; error: string | null;
    minPriceUsd: number | null; variantCount: number; usedJs: boolean;
    ldCurrencyAvailable: string | null;
    priceRowStatus: string | null; priceRowDetail: string | null; capUsd: number | null;
  };
  honest_answer: HonestAnswer;
  /** Mechanical checks only. NOT a verdict — adjudication is a separate pass. */
  flags: string[];
}

export async function runCase(c: FetchCase): Promise<CaseResult> {
  const responses = synthResponses(c.store);
  const replay = async (url: string) => {
    const r = responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url}`);
    return r;
  };
  __resetCaches();
  const out: CaseResult = {
    id: c.id, attack_class: c.attack_class, subclass: c.subclass, intent: c.intent, why: c.why,
    unreachable_by_real_store_sample: c.unreachable_by_real_store_sample === true,
    engine: {
      ok: false, error: null, minPriceUsd: null, variantCount: 0, usedJs: false,
      ldCurrencyAvailable: null, priceRowStatus: null, priceRowDetail: null, capUsd: null,
    },
    honest_answer: c.honest_answer,
    flags: [],
  };
  try {
    const res = await fetchPublicProduct(URL_PAGE, { fetchUrl: replay, sleep: async () => {} } as never);
    if (!res.product) { out.engine.error = res.error?.kind ?? "no product"; return out; }
    const p = res.product;
    out.engine.ok = true;
    out.engine.minPriceUsd = p.minPriceUsd;
    out.engine.variantCount = p.variants.length;
    out.engine.usedJs = p.fetched.js;
    // The currency the engine ALREADY PARSED and does not read.
    out.engine.ldCurrencyAvailable =
      (p.extracted?.product?.offer as { currency?: string | null } | null | undefined)?.currency ?? null;

    if (p.minPriceUsd != null) {
      // The cap the engine would generate for itself, so the row is the row a
      // merchant would actually see rather than one this harness invented.
      const cap = Math.max(1, Math.ceil((p.minPriceUsd + 5) / 5) * 5);
      out.engine.capUsd = cap;
      const req = { id: "price", kind: "price_under", capUsd: cap, label: `Price under $${cap}` } as Requirement;
      const a = evaluate(p, req);
      out.engine.priceRowStatus = a.status;
      out.engine.priceRowDetail = a.detail ?? null;
    } else {
      const req = { id: "price", kind: "price_under", capUsd: 50, label: "Price under $50" } as Requirement;
      const a = evaluate(p, req);
      out.engine.priceRowStatus = a.status;
      out.engine.priceRowDetail = a.detail ?? null;
    }
  } catch (e) {
    out.engine.error = (e as Error).message;
    return out;
  }

  // ---- mechanical flags (candidates, never verdicts) ----
  const h = c.honest_answer;
  const rendered = out.engine.minPriceUsd;
  if (h.min_price_usd === null && rendered !== null) out.flags.push("states_a_price_where_none_is_establishable");
  if (h.min_price_usd !== null && rendered !== null && Math.abs(rendered - h.min_price_usd) > 0.005) {
    const ratio = h.min_price_usd ? rendered / h.min_price_usd : null;
    out.flags.push(`wrong_price rendered=${rendered} honest=${h.min_price_usd}${ratio ? ` ratio=${ratio.toFixed(4)}` : ""}`);
  }
  if (h.currency && h.currency !== "USD" && out.engine.priceRowDetail?.includes("$")) {
    out.flags.push(`renders_dollar_sign_for_${h.currency}`);
  }
  for (const s of h.must_not_render ?? []) {
    if (out.engine.priceRowDetail && out.engine.priceRowDetail.includes(s)) out.flags.push(`rendered_forbidden_string ${j(s)}`);
  }
  // Status mismatch against the honest verdict.
  const map: Record<string, string> = { pass: "pass_evidenced", not_proven: "not_proven", requires_store_access: "requires_store_access" };
  if (out.engine.priceRowStatus && map[h.verdict] && out.engine.priceRowStatus !== map[h.verdict]) {
    out.flags.push(`status ${out.engine.priceRowStatus} != honest ${map[h.verdict]}`);
  }
  return out;
}

// ---- entry point ------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const casesPath = process.argv[2] ?? join(HERE, "fetch_cases.json");
  const cases = JSON.parse(readFileSync(casesPath, "utf8")) as FetchCase[];
  const units: UnitReport[] = [];
  const results: CaseResult[] = [];

  // TWO-SIDED LIVENESS CANARY on the harness itself. Two cases with known-different
  // answers. If they collapse, the synthesizer is not reaching the engine and every
  // "no flag" below is meaningless.
  const canaryA = await runCase({
    id: "_canary_cheap", attack_class: "_canary", subclass: "cheap", intent: "liveness", why: "liveness",
    store: { json_tier: { variants: [{ title: "A", price: "5.00", available: true }] } },
    honest_answer: { min_price_usd: 5, currency: null, verdict: "pass", must_not_render: [] },
  });
  const canaryB = await runCase({
    id: "_canary_dear", attack_class: "_canary", subclass: "dear", intent: "liveness", why: "liveness",
    store: { json_tier: { variants: [{ title: "A", price: "500.00", available: true }] } },
    honest_answer: { min_price_usd: 500, currency: null, verdict: "pass", must_not_render: [] },
  });
  const canaryLive = canaryA.engine.minPriceUsd === 5 && canaryB.engine.minPriceUsd === 500;
  units.push({
    id: "canary:harness-live", role: "verifier", completed: canaryLive,
    failure: canaryLive ? undefined
      : `the synthesizer is NOT reaching the engine: cheap=${canaryA.engine.minPriceUsd} (want 5), ` +
        `dear=${canaryB.engine.minPriceUsd} (want 500), errors=${canaryA.engine.error}/${canaryB.engine.error}. ` +
        `Every "no defect" result below would be an artefact.`,
  });

  for (const c of cases) {
    try {
      results.push(await runCase(c));
      units.push({ id: `case:${c.id}`, role: "sweep", completed: true });
    } catch (e) {
      units.push({ id: `case:${c.id}`, role: "sweep", completed: false, failure: (e as Error).message });
    }
  }

  const flagged = results.filter((r) => r.flags.length > 0);
  const agg = aggregate({ units, candidates: cases.length, adjudicated: results.length, confirmed: 0 });

  writeFileSync(join(OUT, "fetch_results.json"), `${JSON.stringify({
    canary: { cheap: canaryA.engine.minPriceUsd, dear: canaryB.engine.minPriceUsd, live: canaryLive },
    cases: cases.length, executed: results.length,
    flagged: flagged.length,
    unreachable_by_real_sample: results.filter((r) => r.unreachable_by_real_store_sample).length,
    flagged_and_unreachable: flagged.filter((r) => r.unreachable_by_real_store_sample).length,
    state: agg.state, decisive: agg.decisive, missing: agg.missing,
    results,
  }, null, 2)}\n`);

  const L: string[] = [];
  L.push("v3.8 CP-1B — FETCH-LAYER HARNESS");
  L.push(`  canary                     : cheap=$${canaryA.engine.minPriceUsd} dear=$${canaryB.engine.minPriceUsd}  ${canaryLive ? "LIVE" : "COLLAPSED"}`);
  L.push(`  cases                      : ${cases.length}`);
  L.push(`  executed                   : ${results.length}`);
  L.push(`  flagged (candidates)       : ${flagged.length}`);
  L.push(`  flagged AND unreachable by a real-store sample : ${flagged.filter((r) => r.unreachable_by_real_store_sample).length}   <-- the campaign headline`);
  L.push("");
  const byClass = new Map<string, CaseResult[]>();
  for (const r of results) { if (!byClass.has(r.attack_class)) byClass.set(r.attack_class, []); byClass.get(r.attack_class)!.push(r); }
  L.push("per class:  flagged/total");
  for (const [k, v] of byClass) L.push(`  ${k.padEnd(26)} ${String(v.filter((x) => x.flags.length).length).padStart(3)}/${String(v.length).padEnd(3)}`);
  L.push("");
  L.push("FLAGGED CASES (candidates, NOT verdicts):");
  for (const r of flagged) {
    L.push(`  [${r.id}] ${r.attack_class}/${r.subclass}${r.unreachable_by_real_store_sample ? "  *UNREACHABLE-BY-SAMPLE*" : ""}`);
    L.push(`      rendered minPriceUsd=${r.engine.minPriceUsd}  row=${r.engine.priceRowStatus}`);
    L.push(`      detail: ${j(String(r.engine.priceRowDetail).slice(0, 120))}`);
    for (const f of r.flags) L.push(`      FLAG: ${f}`);
  }
  L.push("");
  L.push(`completion: ${agg.state.toUpperCase()}`);
  for (const m of agg.missing.slice(0, 10)) L.push(`  MISSING: ${m}`);
  process.stdout.write(`${L.join("\n")}\n`);
  process.exitCode = agg.state === "incomplete" ? 2 : 0;
}
