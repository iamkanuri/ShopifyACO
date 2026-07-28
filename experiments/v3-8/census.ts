// ===========================================================================
// v3.8 CP-2 — THE BYTE-SHAPE CENSUS.
//
//   node --import tsx experiments/v3-8/census.ts
//
// THE DECISIVE PRE-DESIGN MEASUREMENT. Before anyone writes a cents fix, this
// answers what the captured bytes actually contain, per tier:
//   price field present? · string or number? · integer or decimal? · magnitude ·
//   currency field and value · and WHICH TIER THE ENGINE ACTUALLY USED.
//
// ⚠️ THE KILL CONDITION. The cents fix's whole premise is that `/products/{h}.js`
// serves integer CENTS and `/products/{h}.json` serves decimal STRING dollars, so
// a tier-aware rule can divide by 100 on the .js tier alone. IF ANY CAPTURED
// `.json` TIER SERVES A NUMERIC PRICE, that rule divides a correct store by 100 —
// a $50 product published as $0.50, which is the CATASTROPHIC direction. This
// script answers that before the fix exists, not after.
//
// TIER SELECTION IS THE ENGINE'S, NOT A RE-IMPLEMENTATION. `fetchPublicProduct`
// is called with the transport swapped for a replay of the recorded bytes (the
// v2-9/v3-5/v3-7 precedent). Everything downstream of the socket is production
// code. The byte-shape half IS read directly from the recorded bodies, because
// that is a question about the BYTES rather than about the engine.
//
// Completion comes from the real `src/measure/completion.ts`. A snapshot that
// could not be replayed is INCOMPLETE, never a store with no price.
// ===========================================================================

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregate, type UnitReport } from "../../src/measure/completion.js";
import { fetchPublicProduct } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const OUT = join(HERE, "out");
mkdirSync(OUT, { recursive: true });

interface Recorded { status: number; contentType: string | null; body: string; finalUrl?: string }
interface Snap {
  host: string; category?: string; cohort?: string; url: string; capturedAt: string;
  responses: Record<string, Recorded>;
}

/** Real captured store bytes only. `v3-5/revert/synth_snaps` is SYNTHETIC and is
 *  deliberately excluded — mixing manufactured bytes into a natural-frequency
 *  census would make every rate a statement about what we invented. */
const CORPORA = [
  { id: "general-v2.9", dir: join(REPO, "experiments", "v2-9", "snaps"), published: "general" },
  { id: "coffee-v3.5", dir: join(REPO, "experiments", "v3-5", "publish", "snaps_coffee100"), published: "coffee" },
  { id: "coffee-v3.2", dir: join(REPO, "experiments", "v3-2", "snaps_coffee"), published: null },
  { id: "coffee-v3.1", dir: join(REPO, "experiments", "v3-1", "snaps_coffee"), published: null },
  { id: "coffee-v3.0", dir: join(REPO, "experiments", "v3-0", "snaps_coffee"), published: null },
];

// ---- price-shape reading ----------------------------------------------------

type Shape = "absent" | "string" | "number" | "other";

interface PriceObs {
  raw: unknown;
  shape: Shape;
  /** For numbers: is it an integer by `Number.isInteger`? (1000.0 IS an integer in JS.) */
  isInteger: boolean | null;
  /** For strings: does it contain a `.`? */
  hasDecimalPoint: boolean | null;
  magnitude: number | null;
}

function observePrice(raw: unknown): PriceObs {
  if (raw === undefined || raw === null) return { raw, shape: "absent", isInteger: null, hasDecimalPoint: null, magnitude: null };
  if (typeof raw === "number") {
    return { raw, shape: "number", isInteger: Number.isInteger(raw), hasDecimalPoint: null, magnitude: Number.isFinite(raw) ? raw : null };
  }
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[^0-9.]/g, ""));
    return { raw, shape: "string", isInteger: null, hasDecimalPoint: raw.includes("."), magnitude: Number.isFinite(n) ? n : null };
  }
  return { raw, shape: "other", isInteger: null, hasDecimalPoint: null, magnitude: null };
}

const parseJson = (body: string): unknown => { try { return JSON.parse(body); } catch { return null; } };

/** Variant price observations from a `/products/{h}.json` or `.js` body. */
function tierPrices(body: string): { parsed: boolean; variantCount: number; prices: PriceObs[]; availableFlags: Array<boolean | null> } {
  const v = parseJson(body) as { product?: { variants?: unknown[] }; variants?: unknown[] } | null;
  if (!v) return { parsed: false, variantCount: 0, prices: [], availableFlags: [] };
  // `.json` wraps in `{product:{...}}`; `.js` is the product object itself.
  const variants = (v.product?.variants ?? v.variants ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(variants)) return { parsed: true, variantCount: 0, prices: [], availableFlags: [] };
  return {
    parsed: true,
    variantCount: variants.length,
    prices: variants.map((x) => observePrice(x?.price)),
    availableFlags: variants.map((x) => (typeof x?.available === "boolean" ? (x.available as boolean) : null)),
  };
}

/** Currency signals present in the page HTML, read the way the engine COULD read
 *  them if it read them at all. Every one of these is on the page and unconsulted. */
function currencySignals(html: string): Record<string, string | null> {
  const out: Record<string, string | null> = {
    jsonld_priceCurrency: null, shopify_currency_active: null, shopify_country: null, og_price_currency: null,
  };
  const ld = /"priceCurrency"\s*:\s*"([A-Za-z]{3})"/.exec(html);
  if (ld) out.jsonld_priceCurrency = ld[1]!.toUpperCase();
  const cur = /Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Za-z]{3})"/.exec(html);
  if (cur) out.shopify_currency_active = cur[1]!.toUpperCase();
  const ctry = /Shopify\.country\s*=\s*"([A-Za-z]{2})"/.exec(html);
  if (ctry) out.shopify_country = ctry[1]!.toUpperCase();
  const og = /property=["']og:price:currency["']\s+content=["']([A-Za-z]{3})["']/.exec(html)
    ?? /content=["']([A-Za-z]{3})["']\s+property=["']og:price:currency["']/.exec(html);
  if (og) out.og_price_currency = og[1]!.toUpperCase();
  return out;
}

// ---- run --------------------------------------------------------------------

interface Row {
  corpus: string;
  published: string | null;
  host: string;
  url: string;
  handle: string;
  // byte-shape, per tier
  json_status: number | null; json_parsed: boolean | null; json_variants: number | null;
  json_shapes: string[]; json_integers: number; json_magnitudes: number[];
  js_status: number | null; js_parsed: boolean | null; js_variants: number | null;
  js_shapes: string[]; js_integers: number; js_magnitudes: number[];
  json_has_available_flag: boolean | null;
  ld_price: PriceObs | null;
  currency: Record<string, string | null>;
  declared_currency: string | null;
  non_usd: boolean;
  // the engine's own answer
  engine_ok: boolean;
  engine_used_js: boolean | null;
  engine_min_price: number | null;
  engine_variant_count: number | null;
  engine_error: string | null;
}

async function main(): Promise<void> {
  const units: UnitReport[] = [];
  const rows: Row[] = [];
  const seenUrl = new Map<string, string>();
  const seenHost = new Map<string, string[]>();
  const dupUrls: Array<{ url: string; first: string; second: string }> = [];

  for (const c of CORPORA) {
    if (!existsSync(c.dir)) {
      units.push({ id: `corpus:${c.id}`, role: "sweep", completed: false, failure: `directory missing: ${c.dir}` });
      continue;
    }
    const files = readdirSync(c.dir).filter((f) => f.endsWith(".json")).sort();
    units.push({ id: `corpus:${c.id}`, role: "sweep", completed: files.length > 0, failure: files.length ? undefined : `no snapshots in ${c.dir}` });

    for (const f of files) {
      let snap: Snap;
      try {
        snap = JSON.parse(readFileSync(join(c.dir, f), "utf8")) as Snap;
      } catch (e) {
        units.push({ id: `snap:${c.id}/${f}`, role: "sweep", completed: false, failure: `unreadable: ${(e as Error).message}` });
        continue;
      }

      // DEDUPE ON PRODUCT URL. P-16's hazard: two files of one product are
      // perfectly correlated, not merely clustered — they inflate n while adding
      // no information. Recorded rather than silently dropped.
      if (seenUrl.has(snap.url)) {
        dupUrls.push({ url: snap.url, first: seenUrl.get(snap.url)!, second: `${c.id}/${f}` });
        continue;
      }
      seenUrl.set(snap.url, `${c.id}/${f}`);
      if (!seenHost.has(snap.host)) seenHost.set(snap.host, []);
      seenHost.get(snap.host)!.push(`${c.id}/${f}`);

      const handle = /\/products\/([^/?#]+)/.exec(snap.url)?.[1] ?? "";
      // ⚠️ DO NOT ANCHOR ON `snap.url`'s ORIGIN. A store that redirects apex -> www
      // records every tier under the www origin while `snap.url` stays the apex:
      // `missoma.com` and `richer-poorer.com` both do, and an origin-anchored
      // lookup found NOTHING for either — 0 bytes of page HTML, no `.json`, no
      // `.js`. The first census reported 4 non-USD stores in the general sample
      // where v3.7 published 5, and that one-store gap is the only reason this was
      // caught. Match on the PATH SUFFIX across every recorded response instead.
      const find = (suffix: string): Recorded | null => {
        for (const [u, r] of Object.entries(snap.responses)) {
          try { if (new URL(u).pathname.endsWith(suffix)) return r; } catch { /* not a URL key */ }
        }
        return null;
      };
      const jsonR = find(`/products/${handle}.json`);
      const jsR = find(`/products/${handle}.js`);
      const pageR = find(`/products/${handle}`);

      const jsonP = jsonR && jsonR.status === 200 ? tierPrices(jsonR.body) : null;
      const jsP = jsR && jsR.status === 200 ? tierPrices(jsR.body) : null;
      const html = pageR?.body ?? "";
      const cur = currencySignals(html);
      const declared = cur.jsonld_priceCurrency ?? cur.shopify_currency_active ?? cur.og_price_currency ?? null;

      // JSON-LD offer price, read off the page bytes.
      const ldm = /"@type"\s*:\s*"Offer"[\s\S]{0,400}?"price"\s*:\s*("?[0-9][0-9.,]*"?)/.exec(html);
      const ldPrice = ldm ? observePrice(ldm[1]!.startsWith('"') ? ldm[1]!.slice(1, -1) : Number(ldm[1])) : null;

      // ---- the engine's own answer, through its real code path ----
      let engine_ok = false, engine_used_js: boolean | null = null;
      let engine_min_price: number | null = null, engine_variant_count: number | null = null;
      let engine_error: string | null = null;
      const replay = async (url: string): Promise<Recorded> => {
        const r = snap.responses[url];
        if (!r) throw new Error(`REPLAY MISS: ${url}`);
        return r;
      };
      __resetCaches();
      try {
        const res = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} } as never);
        if (res.product) {
          engine_ok = true;
          engine_used_js = res.product.fetched.js;
          engine_min_price = res.product.minPriceUsd;
          engine_variant_count = res.product.variants.length;
        } else {
          engine_error = res.error?.kind ?? "no product, no error";
        }
      } catch (e) {
        engine_error = (e as Error).message;
      }
      units.push({
        id: `replay:${snap.host}`,
        role: "sweep",
        completed: engine_ok || Boolean(engine_error),
        failure: engine_ok ? undefined : `engine did not produce a product: ${engine_error}`,
      });

      rows.push({
        corpus: c.id, published: c.published, host: snap.host, url: snap.url, handle,
        json_status: jsonR?.status ?? null,
        json_parsed: jsonP ? jsonP.parsed : null,
        json_variants: jsonP ? jsonP.variantCount : null,
        json_shapes: jsonP ? [...new Set(jsonP.prices.map((p) => p.shape))] : [],
        json_integers: jsonP ? jsonP.prices.filter((p) => p.isInteger === true).length : 0,
        json_magnitudes: jsonP ? jsonP.prices.map((p) => p.magnitude).filter((m): m is number => m != null) : [],
        json_has_available_flag: jsonP ? jsonP.availableFlags.some((a) => typeof a === "boolean") : null,
        js_status: jsR?.status ?? null,
        js_parsed: jsP ? jsP.parsed : null,
        js_variants: jsP ? jsP.variantCount : null,
        js_shapes: jsP ? [...new Set(jsP.prices.map((p) => p.shape))] : [],
        js_integers: jsP ? jsP.prices.filter((p) => p.isInteger === true).length : 0,
        js_magnitudes: jsP ? jsP.prices.map((p) => p.magnitude).filter((m): m is number => m != null) : [],
        ld_price: ldPrice,
        currency: cur,
        declared_currency: declared,
        non_usd: Boolean(declared && declared !== "USD"),
        engine_ok, engine_used_js, engine_min_price, engine_variant_count, engine_error,
      });
    }
  }

  // ---- THE KILL CONDITION ---------------------------------------------------
  const jsonNumeric = rows.filter((r) => r.json_shapes.includes("number"));
  const jsonString = rows.filter((r) => r.json_shapes.includes("string"));
  const jsNumeric = rows.filter((r) => r.js_shapes.includes("number"));
  const jsString = rows.filter((r) => r.js_shapes.includes("string"));

  const killFired = jsonNumeric.length > 0;

  // Did the `.json` tier ever answer at all? If it never did, the census proves
  // nothing about it, and "no numeric prices" would be the flattering zero.
  const jsonAnswered = rows.filter((r) => r.json_status === 200 && r.json_parsed && (r.json_variants ?? 0) > 0);
  const jsAnswered = rows.filter((r) => r.js_status === 200 && r.js_parsed && (r.js_variants ?? 0) > 0);

  // ---- TWO-SIDED CANARIES ON THIS INSTRUMENT --------------------------------
  // The first run of this census reported 4 non-USD stores in the general sample
  // where v3.7 published 5. That single-store gap was the only symptom of an
  // origin-anchored tier lookup that silently found NOTHING for every store
  // redirecting apex -> www. A byte-shape reader that reads a subset and reports
  // a total is this project's most-repeated defect, so it is asserted here.
  const pageAnswered = rows.filter((r) => r.currency && Object.values(r.currency).some((v) => v !== null));
  units.push({
    id: "canary:page-tier-readable",
    role: "verifier",
    completed: pageAnswered.length >= rows.length * 0.5,
    failure: pageAnswered.length >= rows.length * 0.5 ? undefined
      : `only ${pageAnswered.length}/${rows.length} snapshots yielded ANY currency signal from the page tier. ` +
        `That is a lookup failure in this script, not a property of the stores — every Shopify page carries at least one.`,
  });

  const generalNonUsd = rows.filter((r) => r.published === "general" && r.non_usd);
  const V37_PUBLISHED_GENERAL_NON_USD = 5;   // experiments/v3-7/REPORT.md, CP-1 step 2b
  units.push({
    id: "canary:reproduces-v3.7",
    role: "verifier",
    completed: generalNonUsd.length >= V37_PUBLISHED_GENERAL_NON_USD,
    failure: generalNonUsd.length >= V37_PUBLISHED_GENERAL_NON_USD ? undefined
      : `this census finds ${generalNonUsd.length} non-USD stores in the general sample where v3.7 published ` +
        `${V37_PUBLISHED_GENERAL_NON_USD}. A LOWER count than a prior measurement of the same thing is this ` +
        `instrument's problem until proved otherwise. Found: ${generalNonUsd.map((r) => r.host).join(", ")}`,
  });

  units.push({
    id: "kill:json-tier-observed",
    role: "verifier",
    completed: jsonAnswered.length > 0,
    failure: jsonAnswered.length > 0 ? undefined
      : "NO captured `.json` tier answered with variants anywhere in the corpus. The kill condition " +
        "cannot be evaluated — 'no numeric .json prices' would be a statement about capture, not about Shopify.",
  });
  units.push({
    id: "kill:js-tier-observed",
    role: "verifier",
    completed: jsAnswered.length > 0,
    failure: jsAnswered.length > 0 ? undefined
      : "NO captured `.js` tier answered with variants anywhere in the corpus. The cents fix's premise " +
        "is unmeasurable from these bytes and cannot be designed from them.",
  });

  // ---- cents-guard blast radius (byte-shape only; no fix exists yet) ---------
  // Every .js integer price and where it sits relative to the `p > 1000` guard.
  const jsInts = rows.flatMap((r) => r.js_magnitudes.filter((m) => Number.isInteger(m)).map((m) => ({ host: r.host, m })));
  const bands = {
    "0": jsInts.filter((x) => x.m === 0).length,
    "1..999": jsInts.filter((x) => x.m > 0 && x.m < 1000).length,
    "exactly 1000": jsInts.filter((x) => x.m === 1000).length,
    "1001+": jsInts.filter((x) => x.m > 1000).length,
  };

  const agg = aggregate({
    units,
    candidates: rows.length,
    adjudicated: rows.length,
    confirmed: 0,   // a census confirms no defects; it measures shapes
  });

  const out = {
    corpora: CORPORA.map((c) => ({ ...c, dir: c.dir.replace(REPO, ".") })),
    deduped_snapshots: rows.length,
    duplicate_urls_dropped: dupUrls,
    distinct_hosts: seenHost.size,
    hosts_with_multiple_files: [...seenHost.entries()].filter(([, v]) => v.length > 1).map(([h, v]) => ({ host: h, files: v })),
    kill_condition: {
      question: "Does ANY captured `/products/{handle}.json` tier serve a NUMERIC price?",
      consequence_if_yes: "a tier-aware cents fix that divides the .json tier by 100 turns a correct $50 into $0.50 — the catastrophic direction",
      json_tiers_answering: jsonAnswered.length,
      json_with_numeric_price: jsonNumeric.length,
      json_with_string_price: jsonString.length,
      fired: killFired,
      offenders: jsonNumeric.map((r) => ({ host: r.host, url: r.url, shapes: r.json_shapes, magnitudes: r.json_magnitudes.slice(0, 6) })),
    },
    js_tier: {
      js_tiers_answering: jsAnswered.length,
      js_with_numeric_price: jsNumeric.length,
      js_with_string_price: jsString.length,
      offenders_string: jsString.map((r) => ({ host: r.host, shapes: r.js_shapes, magnitudes: r.js_magnitudes.slice(0, 6) })),
      integer_magnitude_bands: bands,
    },
    engine_used_js_tier: rows.filter((r) => r.engine_used_js === true).length,
    engine_failed: rows.filter((r) => !r.engine_ok).map((r) => ({ host: r.host, error: r.engine_error })),
    non_usd: rows.filter((r) => r.non_usd).map((r) => ({
      host: r.host, declared: r.declared_currency, signals: r.currency,
      engine_min_price: r.engine_min_price, published: r.published,
    })),
    rows,
    state: agg.state,
    decisive: agg.decisive,
    missing: agg.missing,
  };

  writeFileSync(join(OUT, "census.json"), `${JSON.stringify(out, null, 2)}\n`);

  const L: string[] = [];
  L.push("v3.8 CP-2 — BYTE-SHAPE CENSUS");
  L.push("");
  L.push(`corpora scanned            : ${CORPORA.length} (synthetic snaps deliberately excluded)`);
  L.push(`deduped snapshots          : ${rows.length}   [brief said ~338]`);
  L.push(`duplicate product URLs     : ${dupUrls.length} dropped`);
  L.push(`distinct hosts             : ${seenHost.size}`);
  L.push(`hosts with >1 file         : ${out.hosts_with_multiple_files.length}`);
  L.push(`engine produced a product  : ${rows.filter((r) => r.engine_ok).length}/${rows.length}`);
  L.push(`engine actually used .js   : ${out.engine_used_js_tier}`);
  L.push("");
  L.push("=== THE KILL CONDITION ===");
  L.push(`  .json tiers answering with variants : ${jsonAnswered.length}`);
  L.push(`  .json carrying a NUMERIC price      : ${jsonNumeric.length}`);
  L.push(`  .json carrying a STRING price       : ${jsonString.length}`);
  L.push(`  >>> KILL CONDITION ${killFired ? "***FIRED***" : "did NOT fire"}`);
  if (killFired) for (const o of jsonNumeric.slice(0, 20)) L.push(`      ${o.host}  shapes=${o.json_shapes.join("/")}  mags=${o.json_magnitudes.slice(0, 5).join(",")}`);
  L.push("");
  L.push("=== THE .js TIER (the cents fix's premise) ===");
  L.push(`  .js tiers answering with variants   : ${jsAnswered.length}`);
  L.push(`  .js carrying a NUMERIC price        : ${jsNumeric.length}`);
  L.push(`  .js carrying a STRING price         : ${jsString.length}`);
  for (const o of jsString.slice(0, 10)) L.push(`      STRING-in-.js  ${o.host}  mags=${o.js_magnitudes.slice(0, 5).join(",")}`);
  L.push("");
  L.push("  integer magnitudes vs the `p > 1000` guard:");
  for (const [k, v] of Object.entries(bands)) L.push(`      ${k.padEnd(16)} ${v}`);
  L.push("");
  L.push(`=== NON-USD (declared on the page, unread by the engine) : ${out.non_usd.length} ===`);
  for (const n of out.non_usd) L.push(`  ${n.host.padEnd(30)} ${n.declared}  engine rendered $${n.engine_min_price?.toFixed(2) ?? "null"}  [${n.published ?? "unpublished"}]`);
  L.push("");
  L.push(`completion: ${agg.state.toUpperCase()}`);
  if (agg.missing.length) for (const m of agg.missing.slice(0, 15)) L.push(`  MISSING: ${m}`);
  process.stdout.write(`${L.join("\n")}\n`);

  process.exitCode = agg.state === "incomplete" ? 2 : 0;
}

await main();
