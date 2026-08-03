// v4.5 A1 — ADJUDICATE THE TWO HITS INDIVIDUALLY, WITH DATES.
//
// D1 named tenthousand.cc; D3 named gardenerskit.com (CAD today). Neither is a finding
// until it is read against WHEN it was minted and WHAT the engine did then:
//   • the non-USD refusal shipped at v3.8 (2026-07-28). A CAD store rendered with a `$`
//     BEFORE that is the defect the refusal exists to stop; the same store rendered
//     after it would mean the refusal is not firing, which is a different and worse
//     finding. The date decides which.
//   • the store's currency TODAY is evidence about the store, not proof about the
//     moment we rendered. Both dates are printed so the reader can see the gap.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");
const conn = fs.readFileSync(path.join(repo, ".env.prod.bak"), "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  `select token, store_host, product_url, kind, engine_version, ran_at, created_at, shared_at,
          superseded_by, standard_slug, standard_version, result
     from public_tests
    where store_host in ('tenthousand.cc','gardenerskit.com')
    order by created_at asc`,
);
const out = [];
for (const r of rows) {
  const blob = r.result;
  const nested = blob?.result && typeof blob.result === "object" ? blob.result : null;
  const asserts = [...(blob?.assertions ?? nested?.assertions ?? []), ...(blob?.deferred ?? nested?.deferred ?? [])];
  const priceRows = asserts.filter((a) => typeof a?.detail === "string" && /price/i.test(a.detail));
  out.push({
    token: r.token,
    store: r.store_host,
    url: r.product_url,
    kind: r.kind,
    standard: r.standard_slug ? `${r.standard_slug} ${r.standard_version}` : null,
    engine_version: r.engine_version,
    ran_at: r.ran_at,
    created_at: r.created_at,
    shared_at: r.shared_at,
    superseded_by: r.superseded_by,
    price_rows: priceRows.map((a) => ({ label: a.label, status: a.status, detail: a.detail })),
  });
}
await client.end();
fs.writeFileSync(path.join(here, "out", "adjudicate_hits.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
