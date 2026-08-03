// v4.4 §3 — THE MEASUREMENT. Three runs over identical snapshots.
//
//   RUN A  tier OFF  — the baseline every published bound describes.
//   RUN B  tier ON, as-prod-configured — precision.
//   RUN C  tier ON again, identical input — STABILITY. B vs C is the variance rate.
//
// ⚠️ THE INSTRUMENT IS NOT REBUILT. This calls `runProductTest` with only the STORE
// transport swapped for a replay of recorded bytes (`experiments/v2-9/replay.ts`'s
// design, validated at 99.6% row agreement). The MODEL call is live and unswapped, which
// is the whole point: an offline stub would measure a stub.
//
// ⚠️ QUOTE-LEVEL DIFFS, NOT STATUS DIFFS. The tier can leave a row `pass_evidenced` and
// change the sentence under it, and v3.5 recorded two regressions that a status
// comparison, a pass-count and a merchant reading a green row all saw as nothing. Every
// comparison here is over (status, detail, quote, surface).
//
// ⚠️ A GRANT RATE OF ZERO IS A BROKEN INSTRUMENT UNTIL PROVEN OTHERWISE. The tier
// returns empty on a missing key, a 3s timeout and malformed JSON — all indistinguishable
// from "nothing to add". TWO-SIDED CANARY: (1) the seeded klatchcoffee.com capture must
// produce its known grant, (2) `called: true` must be recorded per store. Either failing
// resolves INCOMPLETE rather than reporting a flattering zero.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const { runProductTest } = await import("../../src/server/productTest.js");
const { semanticSpendUsd } = await import("../../src/server/semanticTier.js");
const { __resetCaches } = await import("../../src/server/productTestCache.js");
const { MODELS, PRICING } = await import("../../src/engines/models.js");
const { ENV } = await import("../../src/server/env.js");

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");

const COFFEE = path.join(repo, "experiments/v3-5/publish/snaps_coffee100");
const GENERAL = path.join(repo, "experiments/v2-9/snaps");
// The seeded known-positive. v4.3 observed a grant on this exact capture; a pilot that
// cannot recover it is a broken pilot, not a clean one.
const SEED = "klatchcoffee.com.json";

const LIMIT = Number(process.env.PILOT_N ?? 20);
const OUT = path.join(here, process.env.MEASURE_OUT ?? "pilot.jsonl");

function pick(): Array<{ dir: string; file: string; cohort: string }> {
  const coffee = fs.readdirSync(COFFEE).filter((f) => f.endsWith(".json")).sort();
  const general = fs.readdirSync(GENERAL).filter((f) => f.endsWith(".json")).sort();
  if (!coffee.includes(SEED)) throw new Error(`seed capture ${SEED} missing from ${COFFEE}`);
  const half = Math.floor(LIMIT / 2);
  // Deterministic selection: the seed, then evenly-spaced picks so the pilot is not the
  // alphabetical head of one corpus. No RNG — the same 20 every run, so B and C compare.
  const stride = (arr: string[], n: number) => {
    const step = Math.max(1, Math.floor(arr.length / n));
    return Array.from({ length: n }, (_, i) => arr[(i * step) % arr.length]);
  };
  const c = [SEED, ...stride(coffee.filter((f) => f !== SEED), half - 1)];
  const g = stride(general, LIMIT - c.length);
  return [
    ...c.map((file) => ({ dir: COFFEE, file, cohort: "coffee" })),
    ...g.map((file) => ({ dir: GENERAL, file, cohort: "general" })),
  ];
}

interface Row { label: string; status: string; detail: string; quote: string | null; surface: string | null }
const rowsOf = (r: any): Row[] => (r.assertions ?? []).map((a: any) => ({
  label: a.label, status: a.status, detail: a.detail,
  quote: a.evidenceQuote ?? null, surface: a.evidenceSurface ?? null,
}));
const same = (x: Row, y: Row) =>
  x.status === y.status && x.detail === y.detail && x.quote === y.quote && x.surface === y.surface;

async function once(snapPath: string, tierOn: boolean) {
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const misses: string[] = [];
  const replay = async (url: string) => {
    const r = snap.responses[url];
    if (!r) { misses.push(url); throw new Error(`REPLAY MISS: ${url}`); }
    return r;
  };
  __resetCaches();
  const before = semanticSpendUsd();
  const res: any = await runProductTest(snap.url, {
    fetchUrl: replay, force: true, sleep: async () => {},
    // `{}` lets the real gate decide (key present + PRODUCT_TEST_SEMANTIC !== "0").
    semantic: tierOn ? {} : { disabled: true },
  });
  return { res, rows: rowsOf(res), misses, spend: semanticSpendUsd() - before, url: snap.url, host: snap.host };
}

// ---------------------------------------------------------------------------
console.log(`AS-PROD CONFIGURATION, recorded rather than assumed:`);
console.log(`  model                 ${MODELS.openai}`);
console.log(`  pricing               in $${PRICING[MODELS.openai].inputPerM}/M  out $${PRICING[MODELS.openai].outputPerM}/M`);
console.log(`  temperature           NOT SET in the request body (semanticTier.ts defaultComplete)`);
console.log(`                        ⚠️ the module header says "temperature 0"; the body sets none,`);
console.log(`                        so the tier runs at the API default. A rule stated only in a`);
console.log(`                        comment is not a rule — and this one bears directly on variance.`);
console.log(`  response_format       json_object    max_completion_tokens 700    timeout 3000ms`);
console.log(`  PRODUCT_TEST_SEMANTIC ${process.env.PRODUCT_TEST_SEMANTIC ?? "(unset ⇒ enabled)"}`);
console.log(`  openai key present    ${Boolean(ENV.keys.openai)}`);
if (!ENV.keys.openai) { console.log(`\ncompletion: INCOMPLETE\n  reason: no OpenAI key — the tier cannot be measured, only observed returning empty`); process.exit(2); }

const picks = pick();
console.log(`\npilot: ${picks.length} stores (${picks.filter((p) => p.cohort === "coffee").length} coffee, ${picks.filter((p) => p.cohort === "general").length} general), seed ${SEED} included: ${picks.some((p) => p.file === SEED)}`);

fs.writeFileSync(OUT, "");
const reasons: string[] = [];
let calledCount = 0, evaluated = 0, claimRowsAsked = 0;
let grantsB = 0, grantsC = 0, varianceRows = 0, seedGrant = false;
let spendTotal = 0;
const grantRecords: any[] = [];
const varianceRecords: any[] = [];

for (const p of picks) {
  const snapPath = path.join(p.dir, p.file);
  try {
    const A = await once(snapPath, false);
    const B = await once(snapPath, true);
    const C = await once(snapPath, true);
    if (!A.res.ok) { console.log(`  skip ${p.file}: run A not ok (${A.res.errorKind ?? A.res.error})`); continue; }
    evaluated++;
    spendTotal += B.spend + C.spend;

    const bStats = B.res.semantic, cStats = C.res.semantic;
    if (bStats?.called) calledCount++;
    // Claim rows the tier was ASKED about — the denominator. `applySemanticTier` only
    // returns stats when it called, so an absent stats object means it had nothing to ask.
    const askedB = bStats ? (bStats.granted + bStats.vetoed + bStats.discarded) : 0;

    // ---- precision leg: every row where B differs from A ----
    const byLabelA = new Map(A.rows.map((r) => [r.label, r]));
    const gains: any[] = [];
    for (const b of B.rows) {
      const a = byLabelA.get(b.label);
      if (!a || same(a, b)) continue;
      gains.push({ label: b.label, from: a.status, to: b.status,
        quoteFrom: a.quote, quoteTo: b.quote, detailFrom: a.detail, detailTo: b.detail, surface: b.surface });
    }
    if (gains.length) {
      grantsB += gains.length;
      grantRecords.push({ host: A.host, url: A.url, cohort: p.cohort, gains, stats: bStats });
      if (p.file === SEED) seedGrant = true;
    }
    if (cStats?.granted) grantsC += cStats.granted;
    claimRowsAsked += askedB;

    // ---- stability leg: B vs C on identical input ----
    const byLabelB = new Map(B.rows.map((r) => [r.label, r]));
    const flips: any[] = [];
    for (const c of C.rows) {
      const b = byLabelB.get(c.label);
      if (!b || same(b, c)) continue;
      flips.push({ label: c.label, bStatus: b.status, cStatus: c.status,
        bQuote: b.quote, cQuote: c.quote, direction: b.status === c.status ? "quote-only" : `${b.status}→${c.status}` });
    }
    if (flips.length) { varianceRows += flips.length; varianceRecords.push({ host: A.host, cohort: p.cohort, flips }); }

    fs.appendFileSync(OUT, JSON.stringify({
      host: A.host, url: A.url, cohort: p.cohort,
      A: A.rows, B: B.rows, C: C.rows,
      statsB: bStats ?? null, statsC: cStats ?? null,
      gains, flips, spend: B.spend + C.spend,
    }) + "\n");
    console.log(`  ${p.cohort.padEnd(7)} ${A.host.padEnd(30)} called=${Boolean(bStats?.called)} asked=${askedB} B-changes=${gains.length} B/C-flips=${flips.length}`);
  } catch (e) {
    console.log(`  ERROR ${p.file}: ${(e as Error).message}`);
    reasons.push(`${p.file}: ${(e as Error).message}`);
  }
}

// ---- canaries -------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log(`stores evaluated          ${evaluated}/${picks.length}`);
console.log(`tier reported called      ${calledCount}`);
console.log(`claim rows asked (B)      ${claimRowsAsked}`);
console.log(`rows B changed vs A       ${grantsB}`);
console.log(`grants recorded by tier B ${grantRecords.reduce((n, r) => n + (r.stats?.granted ?? 0), 0)}`);
console.log(`grants recorded by tier C ${grantsC}`);
console.log(`rows differing B vs C     ${varianceRows}   <-- THE VARIANCE MEASUREMENT`);
console.log(`spend this run            $${spendTotal.toFixed(5)}`);
console.log(`\ncanary 1 — seeded klatch grant recovered: ${seedGrant}`);
console.log(`canary 2 — tier called on >=1 store:      ${calledCount > 0}`);
if (!calledCount) reasons.push("the tier reported called on NO store — an empty result is indistinguishable from a dead instrument");
if (!seedGrant) reasons.push("the seeded klatchcoffee.com grant did not reappear — the pilot cannot detect what it was built to detect");

console.log(`\nGRANTS / CHANGES, in full:`);
for (const r of grantRecords) {
  console.log(`\n  ${r.host} (${r.cohort})  stats=${JSON.stringify(r.stats)}`);
  for (const g of r.gains) {
    console.log(`    ${g.from} → ${g.to}   "${g.label}"`);
    console.log(`      detail: ${g.detailTo}`);
    console.log(`      quote : ${g.quoteTo ? JSON.stringify(g.quoteTo) : "(none)"}`);
    console.log(`      surface: ${g.surface}`);
  }
}
if (varianceRecords.length) {
  console.log(`\nVARIANCE, B vs C on identical input:`);
  for (const v of varianceRecords) {
    console.log(`\n  ${v.host} (${v.cohort})`);
    for (const f of v.flips) {
      console.log(`    ${f.direction}  "${f.label}"`);
      console.log(`      B quote: ${f.bQuote ? JSON.stringify(f.bQuote) : "(none)"}`);
      console.log(`      C quote: ${f.cQuote ? JSON.stringify(f.cQuote) : "(none)"}`);
    }
  }
}

// ---- extrapolation --------------------------------------------------------
const perStore = evaluated ? spendTotal / evaluated : 0;
const FULL = 338;
console.log(`\n${"=".repeat(78)}`);
console.log(`EXTRAPOLATION TO THE FULL CORPUS (${FULL} captured stores, A+B+C):`);
console.log(`  measured spend per store (B+C)  $${perStore.toFixed(5)}`);
console.log(`  projected full-corpus spend     $${(perStore * FULL).toFixed(2)}`);
console.log(`  observed grant rate             ${claimRowsAsked ? ((grantRecords.reduce((n, r) => n + (r.stats?.granted ?? 0), 0) / claimRowsAsked) * 100).toFixed(2) : "n/a"}% of claim rows asked`);

const completion = reasons.length ? "INCOMPLETE" : "VERIFIED_CLEAN";
console.log(`\ncompletion: ${completion}`);
for (const r of reasons) console.log(`  reason: ${r}`);
console.log(`written to ${path.relative(repo, OUT)}`);
