// v4.5 A1 — HAS A PRICE DEFECT EVER REACHED A PERMANENT, CITABLE RESULT?
//
// `/result/:token` never re-runs. v4.4 established that a wrong row there cannot be
// corrected by re-running and must be disclosed at render time. That audit looked at
// ONE mechanism (the semantic tier). Nobody has ever mechanically audited the stored
// results for the defect class this repo has measured most: the PRICE row.
//
// THREE DETECTORS, over every row in `public_tests`:
//   D1  a rendered price of $0.00                      (P-19's first class, 11/349 stores)
//   D2  a rendered price >=100x or <=1/100 a corroborating figure in the SAME blob
//       (the pre-v3.8 cents defect: levainbakery's $10.00 mug published as $1000.00)
//   D3  a store whose bytes declare a non-USD priceCurrency while we rendered `$`
//       (the pre-v3.8 currency defect: missoma's GBP135 rendered as under-$140)
//
// ⚠️ WHAT THE BLOB DOES AND DOES NOT HOLD, because this bounds D2 and D3 and the bound
// must be stated rather than discovered later. A stored `ProductTestResult` keeps
// `assertions` (label/status/detail/evidenceSurface) and `productUrl`. It does NOT keep
// `declaredCurrency`, the variant price array, or the raw bytes. So:
//   • D1 and D2 are decidable FROM THE BLOB (D2 by cross-reading the price row against
//     any other assertion detail in the same result that states a money figure).
//   • D3 is NOT decidable from the blob. It requires the store's bytes. This script
//     therefore reports D3 as a CANDIDATE SET (every result carrying a rendered `$`
//     price row) and resolves INCOMPLETE for D3 unless the byte check ran. A detector
//     that cannot see its evidence must not report zero.
//
// ⚠️ TWO-SIDED CANARY BEFORE ANY COUNT IS BELIEVED. Each detector is run against a
// seeded known-bad row and a seeded known-good row. If a detector fails to fire on the
// bad one, or fires on the good one, the run resolves INCOMPLETE and prints no count.
// A zero from an instrument that was never shown to work is the most dangerous number
// this project tracks.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");

const envFile = process.env.PROD_ENV_FILE || path.join(repo, ".env.prod.bak");
if (!fs.existsSync(envFile)) { console.error(`no ${envFile}`); process.exit(2); }
const conn = fs.readFileSync(envFile, "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length).trim()
  .replace(/^["']|["']$/g, "");
if (!conn) { console.error("no DATABASE_URL in prod env file"); process.exit(2); }

// ---- the detectors, as pure functions over one stored result -----------------

/** Every assertion in a stored blob, at BOTH shapes (general = bare result,
 *  standard = the whole StandardRunResult with the result nested). */
function assertionsIn(blob) {
  if (!blob || typeof blob !== "object") return [];
  const nested = blob.result && typeof blob.result === "object" ? blob.result : null;
  const a = blob.assertions ?? (nested ? nested.assertions : undefined);
  const d = blob.deferred ?? (nested ? nested.deferred : undefined);
  return [...(Array.isArray(a) ? a : []), ...(Array.isArray(d) ? d : [])];
}

/** Money figures a detail string states, as numbers. `$1,299.00` -> 1299. */
function moneyIn(s) {
  if (typeof s !== "string") return [];
  return [...s.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** Is this the price row? Keyed on the engine's own rendered sentence, not the label —
 *  the label is merchant/standard-authored and varies; the sentence is ours. */
function priceRowsOf(blob) {
  return assertionsIn(blob).filter(
    (x) => typeof x?.detail === "string" && /Lowest readable price is \$/.test(x.detail),
  );
}

/** D1 — a rendered price of exactly $0.00. */
function d1(blob) {
  const hits = [];
  for (const r of priceRowsOf(blob)) {
    const m = /Lowest readable price is \$([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(r.detail);
    if (m && Number(m[1].replace(/,/g, "")) === 0) hits.push({ label: r.label, detail: r.detail, status: r.status });
  }
  return hits;
}

/** D2 — the rendered price is >=100x or <=1/100 some other money figure stated in the
 *  SAME result. The corroborating figure is any money in another assertion's detail. */
function d2(blob) {
  const hits = [];
  const rows = priceRowsOf(blob);
  if (!rows.length) return hits;
  const others = assertionsIn(blob)
    .filter((x) => !rows.includes(x))
    .flatMap((x) => moneyIn(x.detail).map((v) => ({ v, from: x.label })));
  for (const r of rows) {
    const m = /Lowest readable price is \$([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(r.detail);
    if (!m) continue;
    const rendered = Number(m[1].replace(/,/g, ""));
    if (!(rendered > 0)) continue;
    for (const o of others) {
      if (!(o.v > 0)) continue;
      const ratio = rendered / o.v;
      if (ratio >= 100 || ratio <= 1 / 100) {
        hits.push({ label: r.label, detail: r.detail, rendered, corroborating: o.v, from: o.from, ratio });
      }
    }
  }
  return hits;
}

/** D3 — candidate set only: every result that RENDERED a dollar price. Whether the
 *  store declares a non-USD currency is not in the blob; see the header. */
function d3Candidates(blob) {
  return priceRowsOf(blob).map((r) => ({ label: r.label, detail: r.detail }));
}

// ---- the two-sided canary ----------------------------------------------------

const KNOWN_BAD = {
  // A blob that every detector must fire on: a $0.00 price row, and a price row
  // rendered 100x a corroborating figure stated by another row in the same result.
  d1: { assertions: [{ label: "Price under $10", status: "pass_evidenced", detail: "Lowest readable price is $0.00." }] },
  d2: {
    assertions: [
      { label: "Price under $1005", status: "pass_evidenced", detail: "Lowest readable price is $1000.00." },
      { label: "Shipping threshold", status: "pass_evidenced", detail: "Free shipping over $10.00." },
    ],
  },
  d3: { assertions: [{ label: "Price under $140", status: "pass_evidenced", detail: "Lowest readable price is $135.00." }] },
};
const KNOWN_GOOD = {
  assertions: [
    { label: "Price under $30", status: "pass_evidenced", detail: "Lowest readable price is $24.00." },
    { label: "Shipping threshold", status: "pass_evidenced", detail: "Free shipping over $35.00." },
  ],
};

function canary() {
  const fail = [];
  if (d1(KNOWN_BAD.d1).length !== 1) fail.push("D1 did not fire on the seeded $0.00 row");
  if (d1(KNOWN_GOOD).length !== 0) fail.push("D1 fired on the known-good row");
  if (d2(KNOWN_BAD.d2).length < 1) fail.push("D2 did not fire on the seeded 100x row");
  if (d2(KNOWN_GOOD).length !== 0) fail.push("D2 fired on the known-good row");
  if (d3Candidates(KNOWN_BAD.d3).length !== 1) fail.push("D3 did not see the seeded rendered price");
  if (d3Candidates({ assertions: [{ label: "x", status: "pass_evidenced", detail: "Stated in your description." }] }).length !== 0)
    fail.push("D3 fired on a row that renders no price");
  return fail;
}

// ---- run ---------------------------------------------------------------------

const out = { completion: "INCOMPLETE", reasons: [], canary: null, rows: null, findings: { d1: [], d2: [], d3_candidates: [] } };

const canaryFailures = canary();
out.canary = canaryFailures.length ? { live: false, failures: canaryFailures } : { live: true };
if (canaryFailures.length) {
  out.reasons.push("two-sided canary failed; no count is reported");
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(here, "out", "price_sweep.json"), JSON.stringify(out, null, 2));
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(
    `select token, store_host, product_url, kind, engine_version, ran_at, created_at, result
       from public_tests order by created_at asc`,
  );
  out.rows = rows.length;

  // Liveness on the REAL data, not just the seeds: if no stored row anywhere carries a
  // rendered price row, the JSON path is unproven and a zero means nothing.
  let withPriceRow = 0;
  for (const r of rows) {
    const cands = d3Candidates(r.result);
    if (cands.length) withPriceRow++;
    for (const h of d1(r.result)) out.findings.d1.push({ token: r.token, store: r.store_host, url: r.product_url, kind: r.kind, engine: r.engine_version, ...h });
    for (const h of d2(r.result)) out.findings.d2.push({ token: r.token, store: r.store_host, url: r.product_url, kind: r.kind, engine: r.engine_version, ...h });
    for (const h of cands) out.findings.d3_candidates.push({ token: r.token, store: r.store_host, url: r.product_url, kind: r.kind, engine: r.engine_version, ...h });
  }
  out.rows_with_a_rendered_price_row = withPriceRow;

  if (rows.length === 0) {
    out.reasons.push("public_tests is empty — nothing to audit, and nothing proven about the detectors on real data");
  } else if (withPriceRow === 0) {
    out.reasons.push(
      "no stored result anywhere carries a rendered price row; D1/D2 zeros are unproven on real data (the seeds passed, the field path is unexercised)",
    );
  } else {
    out.completion = out.findings.d1.length || out.findings.d2.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";
  }
  // D3 is never resolved by this script alone.
  out.d3_note =
    "D3 is a CANDIDATE SET, not a finding. The stored blob holds no declaredCurrency, so whether any of these stores publishes a non-USD priceCurrency must be decided from the store's bytes — see price_sweep_currency.mjs.";
} finally {
  await client.end();
}

fs.mkdirSync(path.join(here, "out"), { recursive: true });
fs.writeFileSync(path.join(here, "out", "price_sweep.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, findings: { d1: out.findings.d1, d2: out.findings.d2, d3_candidates: out.findings.d3_candidates.length } }, null, 2));
