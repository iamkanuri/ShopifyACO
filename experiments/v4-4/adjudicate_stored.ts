// v4.4 §2 — ADJUDICATE THE FOUR STORED GRANTS against full untruncated evidence.
//
// The rendered quote is capped at 180 chars by `presentableQuote`, and the v2.8 audit
// nearly mis-classified a care row whose supporting text sat past the cut. So this
// dumps every evidence sentence on the captured page that mentions the attribute, not
// just the granted quote, and the verdict is argued against that.
import fs from "node:fs";
import path from "node:path";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const { fetchPublicProduct, attachShippingPolicy } = await import("../../src/server/productTest.js");
const { __resetCaches } = await import("../../src/server/productTestCache.js");

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");
const SNAPS: Record<string, string> = {
  "magicspoon.com": path.join(repo, "experiments/v2-9/snaps/magicspoon.com.json"),
  "www.klatchcoffee.com": path.join(repo, "experiments/v3-5/publish/snaps_coffee100/klatchcoffee.com.json"),
  "klatchcoffee.com": path.join(repo, "experiments/v3-5/publish/snaps_coffee100/klatchcoffee.com.json"),
};
// Terms whose presence makes a sentence worth reading for the granted attribute.
const PROBE: Record<string, RegExp> = {
  gluten_free: /gluten|wheat|celiac|coeliac/i,
  single_origin: /single[- ]?origin|origin|estate|farm|region|blend|ethiopia|yirgacheffe|region/i,
};

const grants = JSON.parse(fs.readFileSync(path.join(here, "attributed_grants.json"), "utf8"));
const seen = new Set<string>();

for (const g of grants) {
  const key = `${g.store}:${g.claimKey}`;
  console.log("\n" + "=".repeat(78));
  console.log(`${g.token} · ${g.store} · claim=${g.claimKey} · label="${g.label}"`);
  console.log(`GRANTED QUOTE (as published at /result/${g.token}):`);
  console.log(`  ${JSON.stringify(g.quote)}`);
  console.log(`  surface: ${g.surface} | detail: ${g.detail}`);
  if (seen.has(key)) { console.log(`  [same store+claim as an earlier row — evidence identical, not re-dumped]`); continue; }
  seen.add(key);

  const snapPath = SNAPS[g.store];
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const replay = async (url: string) => {
    const r = snap.responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url}`);
    return r;
  };
  __resetCaches();
  const f = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} });
  if (!f.product) { console.log("  no product from capture"); continue; }
  const withPolicy = f.ctx ? await attachShippingPolicy(f.product, f.ctx) : f.product;
  console.log(`\nPRODUCT TITLE: ${withPolicy.title}`);
  console.log(`EVIDENCE SENTENCES MENTIONING THE ATTRIBUTE (full, untruncated):`);
  const re = PROBE[g.claimKey] ?? /$^/;
  let hits = 0;
  for (const e of withPolicy.evidence) {
    if (!re.test(e.text)) continue;
    hits++;
    console.log(`\n  [${e.surface}] ${e.text}`);
  }
  console.log(`\n  ${hits} sentence(s) mention it, out of ${withPolicy.evidence.length} evidence sentences.`);
  if (hits === 0) console.log(`  ⚠️ ZERO — the attribute is not mentioned anywhere on the captured page.`);
}
