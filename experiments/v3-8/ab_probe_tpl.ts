// ===========================================================================
// v3.8 — THE A/B PROBE TEMPLATE.
//
// COPIED INTO EACH WORKTREE and run there, so its relative imports resolve to
// THAT TREE's `src/`. Never a file swap: v3.1 measured a swap that silently
// failed to apply as "0 regressions, 0 status changes" across 53 sentences, and
// a whole session's brief was written on that number. A swap that does not take
// is indistinguishable from no difference.
//
//   node --import tsx <worktree>/experiments/v3-8/ab_probe_tpl.ts
//     SNAPS=<abs path>   AB_OUT=<abs path to write jsonl>
//
// ⚠️ TWO-SIDED LIVENESS CANARY, and it is the reason this file can be believed.
// Two synthetic products with KNOWN-DIFFERENT answers are evaluated first. If
// they collapse to the same answer, the probe cannot tell anything apart and
// exits INCOMPLETE rather than reporting a clean diff. A probe that cannot
// distinguish the trees reports "no differences" — the flattering direction.
//
// ⚠️ IT RECORDS THE QUOTE AND THE DETAIL, not just the status. Two of v3.5's
// eleven regressions were invisible to a status diff: same `pass_evidenced`
// before and after, with a different rendered sentence. A merchant reading a
// green row sees nothing; the diff must.
// ===========================================================================

import fs from "node:fs";
import path from "node:path";
import { runProductTest, evaluate, type Requirement, type PublicProduct } from "../../src/server/productTest.js";
import { buildEvidence } from "../../src/server/testEvidence.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const SNAPS = process.env.SNAPS;
const OUT = process.env.AB_OUT;
if (!SNAPS || !OUT) { console.error("SNAPS and AB_OUT are required"); process.exit(2); }

interface Recorded { status: number; contentType: string | null; body: string }
interface Snap { host: string; url: string; responses: Record<string, Recorded> }

// ---- the canary -------------------------------------------------------------
// Deliberately about PRICE, because that is what this session changes. Two
// products whose price rows must differ under any correct engine.
function canary(): { ok: boolean; detail: string } {
  const mk = (minPriceUsd: number | null): PublicProduct => ({
    origin: "https://canary.example", handle: "c", title: "Canary", vendor: "V", productType: "T",
    tags: [], descriptionText: "", variants: [{ title: "Default", priceUsd: minPriceUsd, available: true, options: ["Default"] }],
    minPriceUsd, optionNames: [], optionValues: [], extracted: null,
    evidence: buildEvidence([{ surface: "product_description", text: "A product." }]),
    ldAvailability: null, storefrontObjectId: null, policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct);
  const req = { id: "price", kind: "price_under", capUsd: 50, label: "Price under $50" } as Requirement;
  const under = evaluate(mk(10), req);
  const over = evaluate(mk(500), req);
  const ok = under.status !== over.status;
  return { ok, detail: `under=${under.status} over=${over.status}` };
}

const c = canary();
if (!c.ok) {
  console.error(`INCOMPLETE — the two-sided canary COLLAPSED (${c.detail}). This probe cannot distinguish outcomes, so a clean diff from it would be meaningless.`);
  process.exit(2);
}

// ---- replay -----------------------------------------------------------------
// SNAPS is a COMMA-SEPARATED list of directories, deduped across all of them by
// product URL — the same rule the census uses. P-16's hazard: two files of one
// product are perfectly correlated, not merely clustered, so pooling them inflates
// the row count while adding no information.
const dirs = SNAPS.split(",").map((s) => s.trim()).filter(Boolean);
const files: Array<[string, string]> = [];
for (const d of dirs) {
  if (!fs.existsSync(d)) { console.error(`INCOMPLETE — snapshot dir missing: ${d}`); process.exit(2); }
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) files.push([d, f]);
}
if (!files.length) { console.error(`no snapshots in ${SNAPS}`); process.exit(2); }

const rows: string[] = [];
let evaluated = 0, failed = 0;
const seen = new Set<string>();

for (const [dir, f] of files) {
  const snap: Snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (seen.has(snap.url)) continue;      // same dedupe rule as the census
  seen.add(snap.url);
  const replay = async (url: string): Promise<Recorded> => {
    const r = snap.responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url}`);
    return r;
  };
  __resetCaches();
  try {
    const result = await runProductTest(snap.url, { fetchUrl: replay, force: true, sleep: async () => {} } as never);
    evaluated++;
    const assertions = (result as { assertions?: Array<Record<string, unknown>> }).assertions ?? [];
    for (const a of assertions) {
      rows.push(JSON.stringify({
        host: snap.host,
        label: a.label ?? null,
        status: a.status ?? null,
        // BOTH, always. A status-only diff is blind in the way that matters.
        detail: a.detail ?? null,
        quote: a.evidenceQuote ?? null,
        surface: a.evidenceSurface ?? null,
      }));
    }
  } catch (e) {
    failed++;
    rows.push(JSON.stringify({ host: snap.host, label: "<ERROR>", status: "<error>", detail: (e as Error).message, quote: null, surface: null }));
  }
}

fs.writeFileSync(OUT, `${rows.join("\n")}\n`);
console.log(JSON.stringify({
  canary: c.detail,
  snapshots: seen.size,
  evaluated,
  failed,
  rows: rows.length,
  out: OUT,
}));
