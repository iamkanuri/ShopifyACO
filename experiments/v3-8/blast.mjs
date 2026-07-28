// ===========================================================================
// v3.8 CP-2 — BLAST RADIUS, per mechanism, over the deduped census.
//
//   node experiments/v3-8/blast.mjs
//
// Reads `out/census.json` (which already carries the ENGINE's own answer per
// store, via `fetchPublicProduct` with the transport replayed) and asks, per
// price mechanism: how many REAL STORES does it touch, and IN WHICH DIRECTION.
//
// ⚠️ COUNTING VARIANT PRICES IS NOT COUNTING STORES, and the difference is not
// cosmetic. `minPriceUsd` is a MIN over converted prices, so a store with `.js`
// variants at 500 and 5000 cents converts to {500, 50} and the min picks 50 —
// the row renders $50.00 for a product whose true floor is $5.00. That is the
// WRONG VARIANT, not a 100x error, and a variant-level tally reports neither
// correctly. Every figure below is per store, with the direction named.
//
// The direction taxonomy, because "wrong" is not actionable:
//   overstated_100x   rendered ~= true x 100   (a $10 mug published as $1000)
//   wrong_variant     min taken over a mixed-conversion set — neither variant's
//                     true price, and usually between them
//   understated_100x  rendered ~= true / 100   THE CATASTROPHIC DIRECTION
//   correct           rendered == true
// ===========================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const census = JSON.parse(readFileSync(join(HERE, "out", "census.json"), "utf8"));

if (census.state === "incomplete") {
  console.error("REFUSING: the census is INCOMPLETE. A blast radius computed off it would be a floor wearing a total's label.");
  process.exit(2);
}

const rows = census.rows;

// The engine's conversion, quoted from src/server/productTest.ts:834-838.
const priceToUsd = (p) => {
  if (typeof p === "number") return Number.isFinite(p) ? (p > 1000 && Number.isInteger(p) ? p / 100 : p) : null;
  if (typeof p === "string") { const n = Number(p.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};

const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

// ---- MECHANISM 1: the cents guard, on stores where the engine USED the .js tier
const centsRows = [];
for (const r of rows) {
  if (r.engine_used_js !== true) continue;
  const mags = r.js_magnitudes.filter((m) => Number.isFinite(m));
  if (!mags.length) continue;
  // What the engine produced (its own answer, not a re-derivation).
  const rendered = r.engine_min_price;
  // What a correct tier-aware rule produces: the .js tier is cents, always.
  const trueMin = Math.min(...mags) / 100;
  // What the engine's per-value conversion produced, for the direction taxonomy.
  const converted = mags.map(priceToUsd);
  const engineMin = Math.min(...converted);

  let direction;
  if (near(rendered, trueMin)) direction = "correct";
  else if (near(rendered, trueMin * 100)) direction = "overstated_100x";
  else if (near(rendered, trueMin / 100)) direction = "understated_100x";
  else direction = "wrong_variant";

  centsRows.push({
    host: r.host, published: r.published, url: r.url,
    variants: mags.length,
    js_magnitudes: mags.slice(0, 8),
    rendered, trueMin, engineMin, direction,
    ratio: rendered != null && trueMin ? Number((rendered / trueMin).toFixed(4)) : null,
  });
}

const byDirection = {};
for (const c of centsRows) (byDirection[c.direction] ??= []).push(c);

// ---- MECHANISM 2: non-USD
const nonUsd = rows.filter((r) => r.non_usd);

// ---- MECHANISM 3: $0.00 as a price
const zeroPrice = rows.filter((r) => r.engine_min_price === 0);

// ---- MECHANISM 4: min-of-readable is the page MAXIMUM
// The shape: JSON-LD offer is the ONLY price source the engine used (no variant
// prices survived), while the page's own bootstrap/tier lists cheaper variants.
const minIsMax = rows.filter((r) => {
  if (r.engine_min_price == null) return false;
  const all = [...r.js_magnitudes.map((m) => m / 100), ...r.json_magnitudes];
  if (!all.length) return false;
  const trueMin = Math.min(...all);
  return trueMin > 0 && r.engine_min_price > trueMin * 1.001 && !near(r.engine_min_price, trueMin * 100);
});

// ---- report ---------------------------------------------------------------
const out = {
  census_snapshots: rows.length,
  mechanisms: {
    cents_guard: {
      stores_engine_used_js: centsRows.length,
      by_direction: Object.fromEntries(Object.entries(byDirection).map(([k, v]) => [k, v.length])),
      detail: centsRows.filter((c) => c.direction !== "correct"),
    },
    non_usd: {
      stores: nonUsd.length,
      published_sample_stores: nonUsd.filter((r) => r.published).length,
      detail: nonUsd.map((r) => ({ host: r.host, published: r.published, currency: r.declared_currency, rendered: r.engine_min_price, signals: r.currency })),
    },
    zero_price: {
      stores: zeroPrice.length,
      detail: zeroPrice.map((r) => ({ host: r.host, published: r.published, rendered: r.engine_min_price })),
    },
    min_is_not_page_min: {
      stores: minIsMax.length,
      detail: minIsMax.map((r) => ({
        host: r.host, published: r.published, rendered: r.engine_min_price,
        cheapest_readable: Math.min(...[...r.js_magnitudes.map((m) => m / 100), ...r.json_magnitudes]),
      })),
    },
  },
};
writeFileSync(join(HERE, "out", "blast.json"), `${JSON.stringify(out, null, 2)}\n`);

const L = [];
L.push("v3.8 CP-2 — BLAST RADIUS PER MECHANISM (deduped, per STORE, direction named)");
L.push(`census snapshots: ${rows.length}`);
L.push("");
L.push(`M1 · CENTS GUARD — stores where the engine used the .js tier: ${centsRows.length}`);
for (const [d, v] of Object.entries(byDirection).sort((a, b) => b[1].length - a[1].length)) {
  L.push(`   ${d.padEnd(20)} ${String(v.length).padStart(4)}`);
}
L.push("");
L.push("   every store the cents guard gets WRONG:");
for (const c of centsRows.filter((x) => x.direction !== "correct")) {
  L.push(`     ${c.host.padEnd(30)} ${c.direction.padEnd(18)} rendered $${c.rendered?.toFixed(2)}  true $${c.trueMin.toFixed(2)}  x${c.ratio}  [${c.published ?? "unpub"}]  js=${c.js_magnitudes.join(",")}`);
}
L.push("");
L.push(`M2 · NON-USD — stores declaring a non-USD currency: ${nonUsd.length}  (${out.mechanisms.non_usd.published_sample_stores} in a published sample)`);
L.push("");
L.push(`M3 · $0.00 AS A PRICE — stores the engine rendered at exactly $0.00: ${zeroPrice.length}`);
for (const z of out.mechanisms.zero_price.detail) L.push(`     ${z.host.padEnd(30)} [${z.published ?? "unpub"}]`);
L.push("");
L.push(`M4 · RENDERED MIN IS ABOVE THE CHEAPEST READABLE PRICE: ${minIsMax.length}`);
for (const m of out.mechanisms.min_is_not_page_min.detail.slice(0, 25)) {
  L.push(`     ${m.host.padEnd(30)} rendered $${m.rendered.toFixed(2)}  cheapest readable $${m.cheapest_readable.toFixed(2)}  [${m.published ?? "unpub"}]`);
}
console.log(L.join("\n"));
