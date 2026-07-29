// v4.1 — exercise the live standard path against REPLAYED real stores.
//
// Replay, not network: this machine's `safeFetch` is fingerprint-refused by several
// Cloudflare-fronted stores (documented at v2.9), so a local throttle here says nothing
// about production. The captured corpus is the honest instrument.
import fs from "node:fs";
import path from "node:path";
import { runStandardTest } from "../../src/server/publicStandard.js";
import { loadPublishedStandards } from "../../src/server/standardsSite.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";
loadPublishedStandards();

interface Recorded { status: number; contentType: string | null; body: string }
interface Snap { host: string; url: string; responses: Record<string, Recorded> }

const CASES: Array<[string, string]> = [
  ["coffee", "experiments/v3-2/snaps_coffee/onyxcoffeelab.com.json"],
  ["coffee", "experiments/v3-2/snaps_coffee/49thcoffee.com.json"],
  ["non-coffee (apparel)", "experiments/v2-9/snaps/allbirds.com.json"],
  ["non-coffee (home)", "experiments/v2-9/snaps/fromourplace.com.json"],
];

for (const [label, rel] of CASES) {
  const f = path.join(process.cwd(), rel);
  if (!fs.existsSync(f)) { console.log(`SKIP (no snapshot): ${rel}`); continue; }
  const snap: Snap = JSON.parse(fs.readFileSync(f, "utf8"));
  const replay = async (url: string): Promise<Recorded> => {
    const r = snap.responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url}`);
    return r;
  };
  __resetCaches();
  const out = await runStandardTest(snap.url, "coffee", { fetchUrl: replay, sleep: async () => {}, force: true } as never);
  console.log(`\n===== ${label} — ${snap.host}`);
  console.log(`ok=${out.ok}  standard=${out.standard?.id} v${out.standard?.version} hash=${out.standard?.hash?.slice(0, 12)}`);
  if (out.notApplicable) {
    console.log(`  NOT APPLICABLE: verdict=${out.notApplicable.verdict} signal=${out.notApplicable.signal} text=${JSON.stringify(out.notApplicable.text)}`);
    console.log(`  detail: ${out.notApplicable.detail.slice(0, 200)}`);
    console.log(`  skipped: ${out.notApplicable.skipped.length} entries, reasons: ${[...new Set(out.notApplicable.skipped.map((s) => s.reason))].join(", ")}`);
    continue;
  }
  if (!out.ok) { console.log(`  ERROR ${out.errorKind}: ${out.error}`); continue; }
  console.log(`  rows: ${out.result!.assertions.length}  contractVersion=${(out.result as unknown as { contractVersion?: string }).contractVersion ?? "-"}`);
  for (const a of out.result!.assertions) console.log(`    ${a.status.padEnd(20)} ${a.label}`);
  console.log(`  PEER LINES (${out.peers!.length}):`);
  for (const p of out.peers!) {
    const denom = p.undecided > 0
      ? `${p.adjudicated} of the ${p.asked} coffee stores we could decide`
      : `${p.adjudicated} coffee stores`;
    console.log(`    ${p.entryId}: ${p.failed} of ${denom} do NOT state this (${p.failPct.toFixed(1)}%)`);
  }
}
console.log("\ncompletion: VERIFIED_CLEAN");
