// v4.0 — CONTRACT VERSION PER STORE, so a bump's real cost is enumerated, not asserted.
//
// `buyerTests.ts` refuses a merchant's before/after when either `engine_version` or the
// contract fingerprint moved. The ENGINE_VERSION bump 409s every saved test by design.
// `contractVersion` moving is a SECOND, independent cause, and the two are worth telling
// apart: a 409 with contractVersion unchanged is unambiguously the bump, while a moved
// contract means the engine now asks that store a different set of questions.
//
// Emits one line per snapshot: url, contractVersion, and the requirement fingerprint.
// Run in each worktree, diff the two files.
//
// COPY THIS FILE INTO THE WORKTREE — its relative imports must resolve to THAT tree's
// src/, exactly as ab_probe_tpl.ts requires. Never a file swap.
import fs from "node:fs";
import path from "node:path";
import { fetchPublicProduct, buildBuyerTask, contractVersion } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const SNAPS = process.env.SNAPS;
const OUT = process.env.CV_OUT;
if (!SNAPS || !OUT) { console.error("SNAPS and CV_OUT are required"); process.exit(2); }

// Two-sided liveness canary: two DIFFERENT requirement lists must fingerprint
// differently. If they collapse, every "unchanged" below is meaningless.
const cvA = contractVersion([{ id: "a", kind: "claim", claim: "vegan", label: "Vegan" } as never]);
const cvB = contractVersion([{ id: "a", kind: "claim", claim: "organic", label: "Organic" } as never]);
if (cvA === cvB) { console.error(`INCOMPLETE — contractVersion canary COLLAPSED (${cvA} === ${cvB})`); process.exit(2); }

interface Recorded { status: number; contentType: string | null; body: string }
interface Snap { host: string; url: string; responses: Record<string, Recorded> }

const files: Array<[string, string]> = [];
for (const d of SNAPS.split(",").map((s) => s.trim()).filter(Boolean)) {
  if (!fs.existsSync(d)) { console.error(`INCOMPLETE — snapshot dir missing: ${d}`); process.exit(2); }
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) files.push([d, f]);
}

const rows: string[] = [];
const seen = new Set<string>();
let built = 0, failed = 0;
for (const [dir, f] of files) {
  const snap: Snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (seen.has(snap.url)) continue;
  seen.add(snap.url);
  const replay = async (url: string): Promise<Recorded> => {
    const r = snap.responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url}`);
    return r;
  };
  __resetCaches();
  const got = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} } as never);
  if (!got.product) { failed++; rows.push(JSON.stringify({ url: snap.url, cv: "<no-product>", reqs: [] })); continue; }
  built++;
  const reqs = buildBuyerTask(got.product).requirements;
  rows.push(JSON.stringify({
    url: snap.url,
    cv: contractVersion(reqs),
    reqs: reqs.map((r) => `${r.kind}:${r.claim ?? ""}:${r.capUsd ?? ""}:${r.optionValue ?? ""}:${(r as { attribute?: string }).attribute ?? ""}`),
    labels: reqs.map((r) => r.label),
  }));
}
fs.writeFileSync(OUT, `${rows.join("\n")}\n`);
console.log(JSON.stringify({ canary: `${cvA} != ${cvB}`, snapshots: seen.size, built, failed, out: OUT }));
