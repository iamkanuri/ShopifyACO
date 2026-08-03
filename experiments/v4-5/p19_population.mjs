// v4.5 A2 — SCORE THE CANDIDATE RULES BEFORE BUILDING ONE.
//
// Two promise decisions are on the table. Each has a cheap-sounding implementation and a
// cost that is only visible by counting real stores. v3.5's lesson: the plausible rule
// (`mpn === sku`) scored 0 true positives and 7 false ones, and the seven were exactly
// the compliant merchants. So both rules get scored here, on the deduped corpus, BEFORE
// a line of engine code moves.
//
//   RULE 1  $0.00 is not a price.
//           population: stores whose rendered price is $0.00
//           cost: rows that would go from a stated price to a refusal
//
//   RULE 2  the stated price must come from the census-authoritative variant tiers,
//           never from the JSON-LD offer alone.
//           population: stores whose minPriceUsd came from the JSON-LD fallback
//           cost: of those, how many the fallback was answering CORRECTLY — i.e. where
//           dropping it turns a true row into a refusal. This is the number that decides
//           whether rule 2 is a fix or a recall bonfire.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const rows = fs.readFileSync(path.join(here, "out", "p19_base.jsonl"), "utf8")
  .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const priceRowOf = (r) => r.priceRow;
const rendered = (r) => {
  const d = priceRowOf(r)?.detail;
  const m = d && /Lowest readable price is \$([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(d);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};

const out = { total: rows.length, errors: rows.filter((r) => r.error).length };

// ---- RULE 1 : $0.00 ----------------------------------------------------------
const zeroMin = rows.filter((r) => r.minPriceUsd === 0);
const zeroRendered = rows.filter((r) => rendered(r) === 0);
out.rule1 = {
  stores_with_minPriceUsd_zero: zeroMin.length,
  stores_RENDERING_zero: zeroRendered.length,
  by_status: {},
  stores: zeroRendered.map((r) => ({
    host: r.host, corpus: r.corpus, status: priceRowOf(r)?.status, label: priceRowOf(r)?.label,
    detail: priceRowOf(r)?.detail, priceSource: r.priceSource,
    variantPrices: (r.variantPrices || []).slice(0, 6),
  })),
};
for (const r of zeroRendered) {
  const s = priceRowOf(r)?.status ?? "(no row)";
  out.rule1.by_status[s] = (out.rule1.by_status[s] ?? 0) + 1;
}

// A cost this rule could have and must be checked for: a store whose CHEAPEST variant is
// $0.00 (a free sample option) but which also sells real priced variants. Refusing on the
// min alone would refuse a store that does publish a real price.
out.rule1.zero_min_but_has_nonzero_variants = zeroMin
  .filter((r) => (r.variantPrices || []).some((p) => typeof p === "number" && p > 0))
  .map((r) => ({ host: r.host, variantPrices: r.variantPrices }));

// ---- RULE 2 : the JSON-LD offer fallback -------------------------------------
const bySource = {};
for (const r of rows) bySource[r.priceSource ?? "(none)"] = (bySource[r.priceSource ?? "(none)"] ?? 0) + 1;
out.rule2 = { by_price_source: bySource };

const fallback = rows.filter((r) => r.priceSource === "jsonld_fallback");
out.rule2.fallback_stores = fallback.length;
out.rule2.fallback_detail = fallback.map((r) => ({
  host: r.host, corpus: r.corpus,
  minPriceUsd: r.minPriceUsd, jsonLdOfferPrice: r.jsonLdOfferPrice,
  variantCount: r.variantCount, variantPricesNonNull: r.variantPricesNonNull,
  declaredCurrency: r.declaredCurrency,
  status: priceRowOf(r)?.status, label: priceRowOf(r)?.label, detail: priceRowOf(r)?.detail,
}));

// THE COST OF RULE 2, stated as what would be LOST. Every fallback store that currently
// renders a price row would stop stating a number. Split by whether the row is currently
// a pass (a merchant sees a green row with a number) or already not_proven.
out.rule2.cost_if_fallback_dropped = {
  rows_that_would_stop_stating_a_price: fallback.filter((r) => rendered(r) != null).length,
  of_which_currently_pass: fallback.filter((r) => rendered(r) != null && priceRowOf(r)?.status === "pass_evidenced").length,
  of_which_currently_not_proven: fallback.filter((r) => rendered(r) != null && priceRowOf(r)?.status === "not_proven").length,
};

console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(here, "out", "p19_population.json"), JSON.stringify(out, null, 2));
