// adv2 — TASK C: the PINNED / RECONSTRUCTED contract path, executed.
//
// Three questions, each answered by running the real code rather than reading it:
//   C1 does the published Coffee Standard compile ANY price_under requirement?
//   C2 on a pinned contract that DOES carry a price row, what does a zero-price product
//      now answer, and is that row counted in any denominator a merchant reads?
//   C3 does `requirementFromLabel` (the stored-result reconstruction path) rebuild a
//      price row, and what does the reconstructed row say?
import fs from "node:fs";
import path from "node:path";
import { compileStandard } from "../../../standards/compile.js";
import { currentOf } from "../../../src/server/standardsSite.js";
import { runProductTest, requirementFromLabel, evaluate, fetchPublicProduct, PASSING } from "../../../src/server/productTest.js";
import { __resetCaches } from "../../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";
const REPO = path.resolve("C:/Users/iamka/Documents/projects/ShopifyACO");

// ---- C1 ---------------------------------------------------------------------
console.log("=== C1: does any published coffee standard compile a price_under requirement? ===");
for (const v of ["v1.0", "v1.1", "v1.2", "v1.3"]) {
  const p = path.join(REPO, "standards", "coffee", v, "standard.json");
  if (!fs.existsSync(p)) { console.log(`  coffee ${v}: MISSING`); continue; }
  const std = JSON.parse(fs.readFileSync(p, "utf8"));
  const rep = compileStandard(std);
  const kinds = rep.requirements.map((r) => `${r.id}:${r.kind}`);
  const price = kinds.filter((k) => /price_under/.test(k));
  console.log(`  coffee ${v}: ${rep.requirements.length} compiled, price_under = ${price.length} ${JSON.stringify(price)}`);
}
// CANARY: the compile must produce SOMETHING, or "0 price rows" means "compile is dead".
const cur = currentOf("coffee") as { rawJson: string; publicVersion: string };
const curRep = compileStandard(JSON.parse(cur.rawJson));
console.log(`  CANARY current(${cur.publicVersion}) compiled ${curRep.requirements.length} requirements, kinds: ${JSON.stringify([...new Set(curRep.requirements.map((r) => r.kind))])}`);
console.log(curRep.requirements.length > 0 ? "  CANARY LIVE" : "  INCOMPLETE — compile produced nothing");

// ---- C3 ---------------------------------------------------------------------
console.log("\n=== C3: requirementFromLabel round-trip on a price label ===");
for (const l of ["Price under $10", "Price under $140", "In stock and purchasable"]) {
  const r = requirementFromLabel(l, "x");
  console.log(`  ${JSON.stringify(l)} -> ${JSON.stringify(r)}`);
}

// ---- C2 ---------------------------------------------------------------------
console.log("\n=== C2: a PINNED run carrying a price row against a zero-price store ===");
const SNAP = path.join(REPO, "experiments", "v2-9", "snaps", "tenthousand.cc.json");
const snap = JSON.parse(fs.readFileSync(SNAP, "utf8")) as { url: string; responses: Record<string, unknown> };
const replay = async (u: string) => {
  const r = (snap.responses as Record<string, { status: number; contentType: string | null; body: string }>)[u];
  if (!r) throw new Error(`REPLAY MISS ${u}`);
  return r;
};
// EXACTLY how `contractFromPublicResult` (buyerTests.ts:150) rebuilds a stored price row:
// the cap is parsed out of the label the merchant already saw.
const pinned = [
  { id: "price0", kind: "price_under" as const, label: "Price under $10", capUsd: 10 },
  requirementFromLabel("In stock and purchasable", "STOCK-X")!,
];
__resetCaches();
const res = await runProductTest(snap.url, {
  fetchUrl: replay, force: true, sleep: async () => {},
  requirements: pinned,
  standard: { id: "ADV2-PROBE", version: "1.0", hash: "deadbeef" },
});
console.log("  ok:", res.ok, "error:", res.error ?? null);
for (const a of [...(res.assertions ?? []), ...(res.deferred ?? [])]) {
  console.log(`    [${a.status}] ${a.label} :: ${a.detail}`);
}
console.log("  counters:", JSON.stringify({
  evidencedCount: res.evidencedCount, noBlockingCount: res.noBlockingCount,
  notProvenCount: res.notProvenCount, requiresAccessCount: res.requiresAccessCount,
  total: res.total, deferred: (res.deferred ?? []).length,
}));
const passing = (res.assertions ?? []).filter((a) => PASSING.includes(a.status)).length;
console.log(`  DENOMINATOR READING: "${passing} of ${res.total}" — total INCLUDES the undecidable row: ${res.requiresAccessCount > 0}`);

// Two-sided canary: the same pinned contract against a store with a REAL price must
// produce a decided price row, or "requires_store_access" proves nothing.
const SNAP2 = path.join(REPO, "experiments", "v2-9", "snaps", "fieldcompany.com.json");
const snap2 = JSON.parse(fs.readFileSync(SNAP2, "utf8")) as { url: string; responses: Record<string, unknown> };
const replay2 = async (u: string) => {
  const r = (snap2.responses as Record<string, { status: number; contentType: string | null; body: string }>)[u];
  if (!r) throw new Error(`REPLAY MISS ${u}`);
  return r;
};
__resetCaches();
const res2 = await runProductTest(snap2.url, {
  fetchUrl: replay2, force: true, sleep: async () => {},
  requirements: [{ id: "price0", kind: "price_under" as const, label: "Price under $140", capUsd: 140 }],
  standard: { id: "ADV2-PROBE", version: "1.0", hash: "deadbeef" },
});
for (const a of res2.assertions ?? []) console.log(`  CANARY(priced store) [${a.status}] ${a.label} :: ${a.detail}`);
const twoSided = (res.assertions ?? []).some((a) => a.status === "requires_store_access") && (res2.assertions ?? []).some((a) => a.status !== "requires_store_access");
console.log(twoSided ? "  CANARY LIVE (zero store refuses, priced store decides)" : "  INCOMPLETE — canary collapsed");
