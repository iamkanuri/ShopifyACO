// v3.9 CP-1A — I RE-EXECUTE EVERY CONFIRMED DEFECT AGAINST THE BYTES.
//
// The brief's discipline, and this repo's rule seven times over: an adjudicator's verdict
// is a CANDIDATE. v3.0 classified "did my change cause this" by reading a refuter's prose
// and got 1 where the truth was 0; the repair was to execute against the engine. Same here.
//
// Route: the REAL `runProductTest` with a PINNED contract (`RunOptions.requirements`, the
// G-09 seam) so the claim is asked even where `CATEGORY_CLAIMS` would not select it — the
// 37 FORCED rows. Transport is the snapshot; `safeFetch` is never called and there is no
// network. Nothing about parsing, tiering or evaluation is re-implemented.
import fs from "node:fs";
import path from "node:path";
import { runProductTest, type Requirement } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const DIRS = ["experiments/v2-9/snaps", "experiments/v3-0/snaps_coffee",
  "experiments/v3-1/snaps_coffee", "experiments/v3-2/snaps_coffee"];

interface Snap { host: string; url: string; responses: Record<string, unknown> }

const byUrl = new Map<string, { dir: string; snap: Snap }>();
for (const d of DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    const snap: Snap = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    if (!byUrl.has(snap.url)) byUrl.set(snap.url, { dir: d, snap });
  }
}

const CLAIM_LABEL: Record<string, string> = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};

async function askOne(snap: Snap, claim: string) {
  __resetCaches();
  const req: Requirement[] = [{ id: "claim0", kind: "claim", claim, label: CLAIM_LABEL[claim] ?? claim } as Requirement];
  const r = await runProductTest(snap.url, {
    force: true,
    requirements: req,
    sleep: async () => {},
    fetchUrl: async (url: string) => {
      const rec = (snap.responses as Record<string, unknown>)[url];
      if (!rec) throw new Error(`REPLAY MISS: ${url}`);
      return rec as never;
    },
  } as never);
  const a = (r as { assertions?: Array<Record<string, unknown>> }).assertions ?? [];
  return a.find((x) => x.label === (CLAIM_LABEL[claim] ?? claim)) ?? a[0] ?? null;
}

// ---- two-sided liveness canary, BEFORE any verdict is recorded ----
const merged = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const confirmed = merged.A_ROWS.filter((r: { misleading_final: string }) => r.misleading_final === "yes");
const probe = byUrl.get(confirmed[0].url);
let canary = { ok: false, detail: "no probe snapshot" };
if (probe) {
  const hit = await askOne(probe.snap, confirmed[0].claim);      // expected to pass
  const miss = await askOne(probe.snap, "baking_soda_free");     // expected not to
  canary = {
    ok: Boolean(hit) && Boolean(miss) && hit.status !== miss.status,
    detail: `${confirmed[0].claim}=${hit?.status} baking_soda_free=${miss?.status}`,
  };
}
if (!canary.ok) {
  console.error(`INCOMPLETE — the two-sided canary COLLAPSED (${canary.detail}). ` +
    "This probe cannot distinguish outcomes, so any reproduction rate from it is meaningless.");
  process.exit(2);
}

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().replace(/[…]+$/, "");
const rows: Array<Record<string, unknown>> = [];
for (const c of confirmed) {
  const entry = byUrl.get(c.url);
  if (!entry) { rows.push({ unitId: c.unitId, host: c.host, state: "INCOMPLETE — no snapshot for that URL" }); continue; }
  let a: Record<string, unknown> | null = null;
  try { a = await askOne(entry.snap, c.claim); }
  catch (e) { rows.push({ unitId: c.unitId, host: c.host, state: `INCOMPLETE — replay threw: ${(e as Error).message}` }); continue; }
  if (!a) { rows.push({ unitId: c.unitId, host: c.host, state: "INCOMPLETE — the pinned run produced no row" }); continue; }

  const eq = norm(a.evidenceQuote);
  const adj = norm(c.sentence);
  const head = (s: string, n = 50) => s.slice(0, n);
  const quoteAgrees = Boolean(eq) && (eq.startsWith(head(adj)) || adj.startsWith(head(eq)));
  const passes = a.status === "pass_evidenced";
  rows.push({
    unitId: c.unitId, host: c.host, claim: c.claim, asked: c.asked,
    engineStatus: a.status, engineSurface: a.evidenceSurface ?? null,
    quoteAgrees, engineQuote: eq.slice(0, 140), adjudicated: adj.slice(0, 140),
    state: passes && quoteAgrees ? "REPRODUCED"
      : passes ? "PASSES ON A DIFFERENT SENTENCE"
        : "DOES NOT REPRODUCE",
  });
}

const tally = (s: string) => rows.filter((r) => r.state === s).length;
const incomplete = rows.filter((r) => String(r.state).startsWith("INCOMPLETE")).length;
const out = {
  canary,
  confirmed_in: confirmed.length,
  REPRODUCED: tally("REPRODUCED"),
  PASSES_ON_A_DIFFERENT_SENTENCE: tally("PASSES ON A DIFFERENT SENTENCE"),
  DOES_NOT_REPRODUCE: tally("DOES NOT REPRODUCE"),
  incomplete,
  rows,
  completion: incomplete ? "INCOMPLETE" : "VERIFIED_CLEAN",
};
fs.writeFileSync("experiments/v3-9/out/reexec.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, rows: undefined }, null, 2));
console.table(rows.map((r) => ({
  unitId: r.unitId, host: r.host, claim: r.claim, asked: r.asked,
  status: r.engineStatus, quoteAgrees: r.quoteAgrees, state: r.state,
})));
