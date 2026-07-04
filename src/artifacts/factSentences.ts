import type { MerchantFacts, FactSource } from "./merchantFacts.js";

// ===========================================================================
// Layer 1 of the honesty machine (tier 2a): the DETERMINISTIC fact-sentence renderer. CODE writes
// every merchant claim as a numbered, provenance-tagged sentence; the LLM only reuses them verbatim
// or emits a placeholder. The renderer's vocabulary is structurally comparison-free — no template
// contains "better", "unlike", "superior", or a competitor name. "Verbatim-or-placeholder" is
// mechanically checkable (the validator); "don't overclaim" is not. So the honesty lives here + in
// the validator, never in the model.
// ===========================================================================

export interface FactSentence {
  id: string; // "F1", "F2", …
  kind: "price" | "rating" | "availability" | "schema" | "stated" | "coverage";
  text: string; // the full sentence INCLUDING its provenance tag
  tag: string;
  numerals: string[]; // every numeric token — powers the validator's digit-tracing
}

/** Canonical numeric tokens in a string (commas stripped so "2,341" === "2341"). SHARED with the
 *  validator so the digit-trace sets are computed identically on both sides. */
export function numeralsIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Provenance-tag id extractor: "(fact F2 — crawled …)" → "F2". Used by the validator's tag-integrity check. */
export const FACT_TAG_RE = /\(fact\s+(F\d+)\s+—[^)]*\)/g;

/** Location shown in a tag: host for store-wide facts, host+path for a specific product page.
 *  Generous cap (product handles run long) and ellipsize only when actually cut — so the tag stays a
 *  human-verifiable pointer, not a mid-word stub ("…terralux-anth"). */
function loc(url: string): string {
  const MAX = 80;
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
    const full = u.hostname.replace(/^www\./, "") + path;
    return full.length > MAX ? full.slice(0, MAX - 1) + "…" : full;
  } catch {
    return url.length > MAX ? url.slice(0, MAX - 1) + "…" : url;
  }
}

/** Render MerchantFacts → numbered, tagged FactSentences. Deterministic; comparison-free vocabulary. */
export function renderFactSentences(facts: MerchantFacts): FactSentence[] {
  const out: FactSentence[] = [];
  const date = facts.crawledAt;
  let n = 0;
  const storeHost = loc(facts.storeUrl);

  const add = (kind: FactSentence["kind"], body: string, source: FactSource | { url: string }) => {
    const id = `F${++n}`;
    const tag = `(fact ${id} — crawled ${loc(source.url)}, ${date})`;
    const text = `${body} ${tag}`;
    out.push({ id, kind, text, tag, numerals: numeralsIn(text) });
  };

  // PRICE — range across the crawled set, scoped to coverage (R3/R8). Never averaged. Uses EVERYDAY
  // (regular) prices when we could detect sales; sale count noted so the merchant can verify.
  if (facts.price) {
    const p = facts.price;
    const scope = p.currencyConflict ? ` (in ${p.currency}, as served to our crawler)` : "";
    const priceWord = p.basis === "regular" ? "regular prices" : "prices";
    const oneWord = p.basis === "regular" ? "regular price" : "price";
    const saleNote =
      p.basis === "regular" && p.onSaleCount > 0
        ? ` (${p.onSaleCount} of the ${p.productCount} were on sale when we crawled; the range reflects regular prices)`
        : "";
    const body =
      p.min === p.max
        ? `Across the ${p.productCount} ${facts.brand} product page${p.productCount === 1 ? "" : "s"} we checked, the ${oneWord} was ${p.min} ${p.currency}${scope}${saleNote}.`
        : `Across the ${p.productCount} ${facts.brand} product pages we checked, ${priceWord} ranged from ${p.min} to ${p.max} ${p.currency}${scope}${saleNote}.`;
    add("price", body, { url: facts.storeUrl });
  }

  // RATING exemplar — the one citable flagship (highest review count), pinned to its PDP.
  if (facts.ratings?.top) {
    const t = facts.ratings.top;
    const name = t.productName ? `The ${t.productName}` : `One ${facts.brand} product`;
    const reviewClause = t.reviewCount != null ? ` across ${t.reviewCount} reviews` : "";
    add("rating", `${name} is rated ${t.rating}★${reviewClause} on ${facts.brand}'s own product page.`, t.source);
  }
  // RATING range — only when 2+ rated products (a range needs two points).
  if (facts.ratings && facts.ratings.productsWithRating >= 2) {
    const r = facts.ratings;
    add("rating", `${r.productsWithRating} of the ${r.productsChecked} product pages we checked publish customer ratings, ranging ${r.min}–${r.max}★.`, { url: facts.storeUrl });
  }

  // AVAILABILITY — presence count, no inference.
  if (facts.inStock) {
    add("availability", `${facts.inStock.count} of the ${facts.inStock.of} products we checked were listed in stock.`, { url: facts.storeUrl });
  }

  // SCHEMA presence — hygiene fact (structured-data coverage), presence only (R5).
  const sp = facts.schemaPresence;
  if (sp.of > 0 && (sp.shipping > 0 || sp.returns > 0)) {
    add("schema", `Of the ${sp.of} product pages we checked, ${sp.shipping} expose shipping details and ${sp.returns} expose a return policy in structured data.`, { url: facts.storeUrl });
  }

  // STATED claims — verbatim merchant copy, quoted + attributed (never reconciled).
  for (const claim of facts.stated) {
    add("stated", `${facts.brand}'s site states: "${claim.text}"`, claim.source);
  }

  return out;
}

/** The mandatory footer — appended in CODE (the model can't drop it). Explains the tags + upgrades
 *  "verify before publishing". */
export function factFooter(facts: MerchantFacts): string {
  const n = facts.coverage.pdpCount;
  return (
    `*Lines tagged "(fact … crawled …)" were read from your live site on ${facts.crawledAt} — from ${n} of your ` +
    `product page${n === 1 ? "" : "s"}, not your full catalog. Prices, ratings, and stock change; verify every ` +
    `tagged line and fill every [placeholder] with real, verifiable facts, then remove the tags before publishing.*`
  );
}
