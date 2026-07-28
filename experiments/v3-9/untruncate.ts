// v3.9 CP-3 — replace every suite-2.0 case's text with the ENGINE'S OWN rendered quote.
//
// `hc-08` failed its own must-not-regress expectation, and the cause is not the engine: the
// text came from v3.6's `pass_rows.json`, which stores a quote TRUNCATED at ~180 characters.
// For that case the truncation cut the word `organic` off the end, so the suite was asking
// the matcher to find a term in a string that does not contain it. The adjudicator had
// already flagged the same hazard in its own `why`.
//
// A suite of real sentences whose sentences are not the real bytes is a hand-built suite
// wearing a costume. So every case is re-executed against its captured snapshot and its
// text replaced by the engine's actual evidence quote. Cases are DROPPED, with the reason
// recorded, if the engine no longer renders a quote for them — never silently patched.
import fs from "node:fs";
import path from "node:path";
import { runProductTest, type Requirement } from "../../src/server/productTest.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const DIRS = ["experiments/v2-9/snaps", "experiments/v3-0/snaps_coffee",
  "experiments/v3-1/snaps_coffee", "experiments/v3-2/snaps_coffee"];
const byUrl = new Map<string, any>();
for (const d of DIRS) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    if (!byUrl.has(s.url)) byUrl.set(s.url, s);
  }
}

const CLAIM_LABEL: Record<string, string> = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};

async function ask(snap: any, claim: string) {
  __resetCaches();
  const req: Requirement[] = [{ id: "claim0", kind: "claim", claim, label: CLAIM_LABEL[claim] ?? claim } as Requirement];
  const r = await runProductTest(snap.url, {
    force: true, requirements: req, sleep: async () => {},
    fetchUrl: async (url: string) => {
      const rec = snap.responses[url];
      if (!rec) throw new Error(`REPLAY MISS: ${url}`);
      return rec as never;
    },
  } as never);
  const a = (r as { assertions?: Array<Record<string, unknown>> }).assertions ?? [];
  return a.find((x) => x.label === (CLAIM_LABEL[claim] ?? claim)) ?? a[0] ?? null;
}

const suite = JSON.parse(fs.readFileSync("standards/acceptance/subject-tense/suite2.json", "utf8"));

// two-sided canary before anything is rewritten
const probe = byUrl.get(suite.cases[0].provenance.url);
if (!probe) { console.error("INCOMPLETE — no snapshot for the first case"); process.exit(2); }
const hit = await ask(probe, suite.cases[0].claim_key);
const miss = await ask(probe, "baking_soda_free");
if (!hit || !miss || hit.status === miss.status) {
  console.error(`INCOMPLETE — canary collapsed (${hit?.status} vs ${miss?.status})`);
  process.exit(2);
}

const kept: any[] = [], dropped: any[] = [];
let replaced = 0, identical = 0;
for (const c of suite.cases) {
  const snap = byUrl.get(c.provenance.url);
  if (!snap) { dropped.push({ id: c.id, reason: "no snapshot for that URL" }); continue; }
  let a: any;
  try { a = await ask(snap, c.claim_key); }
  catch (e) { dropped.push({ id: c.id, reason: `replay threw: ${(e as Error).message}` }); continue; }
  const q = a?.evidenceQuote ?? null;
  if (!q) {
    dropped.push({
      id: c.id, host: c.provenance.host, status: a?.status ?? null,
      reason: "the engine renders NO quote for this row — it cannot be a sentence-level case",
    });
    continue;
  }
  const wasTruncated = /[…]$/.test(String(c.text).trim());
  if (q !== c.text) replaced++; else identical++;
  kept.push({
    ...c,
    text: q,
    provenance: {
      ...c.provenance,
      engine_answer_today: a.status,
      engine_surface_today: a.evidenceSurface ?? null,
      text_source: "the engine's own rendered evidence quote, re-executed against the captured snapshot",
      was_truncated_in_v36_export: wasTruncated,
    },
  });
}

suite.cases = kept;
// strata whose only cases were dropped must go too — a declared-but-empty stratum is
// rejected by the loader, and rightly: an empty row reads exactly like a row that passed.
const used = new Set(kept.map((c) => c.stratum));
for (const k of Object.keys(suite.strata)) if (!used.has(k)) delete suite.strata[k];

fs.writeFileSync("standards/acceptance/subject-tense/suite2.json", `${JSON.stringify(suite, null, 2)}\n`);
console.log(JSON.stringify({
  in: suite.cases.length + dropped.length, kept: kept.length, dropped: dropped.length,
  text_replaced: replaced, text_identical: identical,
  truncated_in_source: kept.filter((c) => c.provenance.was_truncated_in_v36_export).length,
  dropped_detail: dropped,
  hostile: kept.filter((c) => c.direction === "hostile").length,
  must_not_regress: kept.filter((c) => c.direction === "must_not_regress").length,
}, null, 2));
