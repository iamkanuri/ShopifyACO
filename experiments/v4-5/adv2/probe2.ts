// adv2 — MY OWN PROBE. Same replay technique as v2.9/p19_probe (engine, transport swapped),
// but it records the things p19_probe.ts DROPS and that the author's claims depend on:
//
//   • ASSERTIONS vs DEFERRED, kept apart. p19_probe.ts flattens them
//     (`rec.rows = [...assertions, ...deferred]`), so a row moving from the merchant's
//     TABLE to the "below the table" list — which is what the requires_store_access
//     collapse does when the first access row changes — is invisible to its diff.
//   • The result-level counters (evidencedCount / requiresAccessCount / total), which are
//     what a merchant's headline reads off, and which no A/B in this change touched.
//   • EVERY snapshot, not the deduped 335 — so the question "does the dedup hide a
//     change?" can be answered by execution instead of by argument.
//   • buildBuyerTask's requirement labels, so a candidate-list change is observable
//     independently of what the row rendered.
//
// REPO_ROOT env var points at the snapshot corpora (they are gitignored, so a worktree
// checkout does not have them). ENGINE comes from THIS tree.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runProductTest, fetchPublicProduct, buildBuyerTask } from "../../../src/server/productTest.js";
import { __resetCaches } from "../../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAP_ROOT = process.env.REPO_ROOT || path.resolve(HERE, "..", "..", "..");
const OUT = process.env.ADV2_OUT || path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });
const LABEL = process.env.ADV2_LABEL || "base";

interface Recorded { status: number; contentType: string | null; body: string; finalUrl?: string }
interface Snap { host: string; url: string; capturedAt: string; responses: Record<string, Recorded> }

const CORPORA = [
  { id: "general-v2.9", dir: path.join(SNAP_ROOT, "experiments", "v2-9", "snaps") },
  { id: "coffee-v3.5", dir: path.join(SNAP_ROOT, "experiments", "v3-5", "publish", "snaps_coffee100") },
  { id: "coffee-v3.2", dir: path.join(SNAP_ROOT, "experiments", "v3-2", "snaps_coffee") },
  { id: "coffee-v3.1", dir: path.join(SNAP_ROOT, "experiments", "v3-1", "snaps_coffee") },
  { id: "coffee-v3.0", dir: path.join(SNAP_ROOT, "experiments", "v3-0", "snaps_coffee") },
];

const dedupKey = (host: string) => host.replace(/^www\./i, "").toLowerCase();

// EVERY snapshot, with a flag saying whether the author's dedup would have kept it.
const seen = new Set<string>();
const snaps: Array<{ corpus: string; file: string; snap: Snap; kept: boolean }> = [];
for (const c of CORPORA) {
  if (!fs.existsSync(c.dir)) { console.error(`MISSING CORPUS DIR ${c.dir}`); continue; }
  for (const f of fs.readdirSync(c.dir).filter((x) => x.endsWith(".json")).sort()) {
    const snap = JSON.parse(fs.readFileSync(path.join(c.dir, f), "utf8")) as Snap;
    const k = dedupKey(snap.host);
    const kept = !seen.has(k);
    seen.add(k);
    snaps.push({ corpus: c.id, file: f, snap, kept });
  }
}

const outPath = path.join(OUT, `adv2_${LABEL}.jsonl`);
fs.writeFileSync(outPath, "");
let evaluated = 0, hardErrors = 0;
const canary = { cheapSeen: false, dearSeen: false, keptSeen: false, droppedSeen: false };

for (const { corpus, file, snap, kept } of snaps) {
  const misses: string[] = [];
  const replay = async (url: string) => {
    const r = snap.responses[url];
    if (!r) { misses.push(url); throw new Error(`REPLAY MISS: ${url}`); }
    return r;
  };
  if (kept) canary.keptSeen = true; else canary.droppedSeen = true;
  const rec: Record<string, unknown> = {
    corpus, file, host: snap.host, key: dedupKey(snap.host), url: snap.url, kept,
  };
  try {
    __resetCaches();
    const fp = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} });
    const p = fp.product;
    rec.minPriceUsd = p?.minPriceUsd ?? null;
    rec.publishedZeroPrice = (p as unknown as { publishedZeroPrice?: boolean } | null)?.publishedZeroPrice ?? null;
    rec.declaredCurrency = p?.declaredCurrency ?? null;
    rec.jsonLdOfferPrice = p?.extracted?.product?.offer?.price ?? null;
    rec.variantPrices = (p?.variants ?? []).map((v) => v.priceUsd);
    if (p) {
      const task = buildBuyerTask(p);
      rec.requirementLabels = task.requirements.map((r) => r.label);
      rec.requirementKinds = task.requirements.map((r) => r.kind);
      // COUNTERFACTUAL, executed rather than argued: if this product's price were refused
      // (which is exactly what zeroAwareMin does), does a LOWER-RANKED requirement take the
      // freed MAX_REQUIREMENTS slot? That is the question the corpus cannot answer, because
      // no zero-price store in it was at the cap.
      const cf = buildBuyerTask({ ...p, minPriceUsd: null } as typeof p);
      rec.cfLabels = cf.requirements.map((r) => r.label);
      const before = new Set(task.requirements.map((r) => r.label));
      rec.cfGained = cf.requirements.map((r) => r.label).filter((l) => !before.has(l));
    }

    __resetCaches();
    const result = await runProductTest(snap.url, { fetchUrl: replay, force: true, sleep: async () => {} });
    rec.assertions = (result.assertions ?? []).map((a) => ({ label: a.label, status: a.status, detail: a.detail ?? null }));
    rec.deferredRows = (result.deferred ?? []).map((a) => ({ label: a.label, status: a.status, detail: a.detail ?? null }));
    rec.counters = {
      evidencedCount: result.evidencedCount, noBlockingCount: result.noBlockingCount,
      notProvenCount: result.notProvenCount, requiresAccessCount: result.requiresAccessCount,
      total: result.total, deferredCount: (result.deferred ?? []).length,
      suggestedCorrections: (result.suggestedCorrections ?? []).length,
      notInspectable: (result.notInspectable ?? []).join("|"),
      error: result.error ?? null,
    };
    if (typeof rec.minPriceUsd === "number") {
      if (rec.minPriceUsd > 0 && rec.minPriceUsd < 50) canary.cheapSeen = true;
      if (rec.minPriceUsd >= 50) canary.dearSeen = true;
    }
    rec.replayMisses = misses;
    evaluated++;
  } catch (e) {
    rec.error = String((e as Error).message).slice(0, 300);
    rec.replayMisses = misses;
    hardErrors++;
  }
  fs.appendFileSync(outPath, JSON.stringify(rec) + "\n");
}

const live = canary.cheapSeen && canary.dearSeen && canary.keptSeen && canary.droppedSeen;
const summary = {
  label: LABEL,
  completion: !live ? "INCOMPLETE" : hardErrors > 0 ? "DEFECTS_FOUND" : "VERIFIED_CLEAN",
  snapshots_total: snaps.length,
  kept_by_dedup: snaps.filter((s) => s.kept).length,
  dropped_by_dedup: snaps.filter((s) => !s.kept).length,
  evaluated, hard_errors: hardErrors,
  canary: { ...canary, live },
  reasons: live ? [] : ["canary collapsed: need both a sub-$50 and a >=$50 price AND both kept and dropped snapshots"],
  out: outPath,
};
fs.writeFileSync(path.join(OUT, `adv2_${LABEL}_summary.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
