// v4.5 A3 — THE RAW-HTML LEAK IN A PUBLISHED EVIDENCE QUOTE.
//
// The handoff records `</p>` appearing inside a quote on a live stored result. Replaying
// the 335-store corpus produced ZERO rows with an HTML tag in the rendered detail, so the
// leak is not reproducible from captured bytes alone — it has to be read off the stored
// production blobs, which is what this does.
//
// ⚠️ TWO-SIDED CANARY. The detector is run against a seeded row that DOES carry a tag and
// one that does not. A zero from a regex that never matched anything is the failure mode
// this repo tracks; the corpus already produced one zero here and it must not be mistaken
// for evidence of cleanliness.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");
const conn = fs.readFileSync(path.join(repo, ".env.prod.bak"), "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

/** Any HTML tag, or an HTML entity, anywhere in a rendered string. */
const TAG = /<\/?[a-zA-Z][^<>]{0,60}>|&(?:nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);/g;
const tagsIn = (s) => (typeof s === "string" ? s.match(TAG) ?? [] : []);

const canaryBad = tagsIn("Roasted in small batches.</p><p>Shipped fresh.");
const canaryGood = tagsIn("Roasted in small batches. Shipped fresh.");
if (canaryBad.length === 0 || canaryGood.length !== 0) {
  console.log(JSON.stringify({ completion: "INCOMPLETE", reason: "canary collapsed", canaryBad, canaryGood }, null, 2));
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`select token, store_host, product_url, kind, result from public_tests order by created_at asc`);
await client.end();

// ⚠️ WALK EVERY STRING. The first draft of this file scanned a CURATED field list —
// `detail`, `quote`, `evidenceSurface`, `label` — and returned 0 tag hits over 94 stored
// results. The field is called `evidenceQuote`, not `quote`, so the one real leak the
// handoff described sat in the one field the list did not name. A closed list used as the
// detector fails open in the flattering direction, which is the same shape as the
// `SERVING_HEAD` protector this repo removed. The leak was only found by a separate raw
// substring scan over the whole blob. Walk everything; let the data name the fields.
const hits = [];
let scannedStrings = 0;
const walk = (node, pathStr, sink) => {
  if (typeof node === "string") {
    scannedStrings++;
    const t = tagsIn(node);
    if (t.length) sink.push({ path: pathStr, tags: [...new Set(t)], value: node.slice(0, 300) });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${pathStr}[${i}]`, sink));
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) walk(node[k], `${pathStr}.${k}`, sink);
  }
};
for (const r of rows) {
  const found = [];
  walk(r.result, "result", found);
  for (const f of found) hits.push({ token: r.token, store: r.store_host, kind: r.kind, ...f });
}
const scannedRows = scannedStrings;

const out = {
  completion: hits.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN",
  canary: { live: true, bad: canaryBad, good: canaryGood },
  stored_results: rows.length,
  assertion_rows_scanned: scannedRows,
  hits: hits.length,
  distinct_tokens: [...new Set(hits.map((h) => h.token))].length,
  distinct_stores: [...new Set(hits.map((h) => h.store))].length,
  tag_histogram: hits.flatMap((h) => h.tags).reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {}),
  detail: hits.slice(0, 40),
};
fs.mkdirSync(path.join(here, "out"), { recursive: true });
fs.writeFileSync(path.join(here, "out", "html_leak.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, detail: out.detail.slice(0, 8) }, null, 2));
