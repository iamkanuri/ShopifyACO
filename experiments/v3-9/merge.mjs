// v3.9 — merge the adjudication + refutation returns into the CP-1A / CP-1B tables.
//
// Reads the workflow journal rather than an agent's summary, because a summary is prose
// and the journal is the return value. `node experiments/v3-9/merge.mjs <journal.jsonl>`
//
// EXACTLY-ONCE is verified in BOTH directions, and a unit no adjudicator reached resolves
// INCOMPLETE — never as "no defect". `confirmedCount` is null on INCOMPLETE, never 0.
import fs from "node:fs";

const JOURNAL = process.argv[2];
if (!JOURNAL || !fs.existsSync(JOURNAL)) {
  console.error(`INCOMPLETE — journal not found: ${JOURNAL}`);
  process.exit(2);
}

const lines = fs.readFileSync(JOURNAL, "utf8").split("\n").filter((l) => l.trim());
const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Pull every object that looks like an adjudication or a refutation return.
const adjudications = [], refutations = [];
function harvest(v) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) harvest(x); return; }
  if (Array.isArray(v.verdicts) && typeof v.batch === "number") adjudications.push(v);
  if (Array.isArray(v.refutations) && typeof v.batch === "number") refutations.push(v);
  for (const x of Object.values(v)) harvest(x);
}
for (const e of events) harvest(e);

// de-duplicate: the journal records a value more than once (result + final)
const seenAdj = new Set(), seenRef = new Set();
const A = [], R = [];
for (const a of adjudications) {
  const k = JSON.stringify(a.verdicts.map((v) => v.unitId).sort());
  if (seenAdj.has(k)) continue; seenAdj.add(k); A.push(a);
}
for (const r of refutations) {
  const k = JSON.stringify(r.refutations.map((v) => v.unitId).sort()) + `|${r.batch}`;
  if (seenRef.has(k)) continue; seenRef.add(k); R.push(r);
}

const manifest = JSON.parse(fs.readFileSync("experiments/v3-9/batches/manifest.json", "utf8"));
const expectedA = new Set(manifest.A.batches.flatMap((b) => b.ids));
const expectedB = new Set(manifest.B.batches.flatMap((b) => b.ids));

const verdicts = new Map();
for (const a of A) for (const v of a.verdicts) {
  if (verdicts.has(v.unitId)) continue; // first wins; duplicates counted below
  verdicts.set(v.unitId, v);
}
const refuted = new Map();
for (const r of R) for (const v of r.refutations) refuted.set(v.unitId, v);

function audit(expected, label) {
  const got = [...verdicts.keys()].filter((id) => expected.has(id));
  const missing = [...expected].filter((id) => !verdicts.has(id));
  const dupIds = [];
  const count = new Map();
  for (const a of A) for (const v of a.verdicts) if (expected.has(v.unitId)) count.set(v.unitId, (count.get(v.unitId) || 0) + 1);
  for (const [id, n] of count) if (n > 1) dupIds.push(id);
  return { label, expected: expected.size, adjudicated: got.length, missing, duplicates: dupIds };
}
const auditA = audit(expectedA, "CP-1A"), auditB = audit(expectedB, "CP-1B");

// ---------- CP-1A roll-up ----------
const axesRows = JSON.parse(fs.readFileSync("experiments/v3-9/out/axes.json", "utf8")).rows;
const aUnits = JSON.parse(fs.readFileSync("experiments/v3-9/batches/a_b1.json", "utf8")).units.length;
const aAll = [];
for (let i = 1; i <= manifest.A.batches.length; i++) {
  aAll.push(...JSON.parse(fs.readFileSync(`experiments/v3-9/batches/a_b${i}.json`, "utf8")).units);
}
const A_ROWS = aAll.map((u, i) => {
  const v = verdicts.get(u.unitId);
  const ref = refuted.get(u.unitId);
  const survivesRefutation = v && !(ref && ref.refuted);
  return {
    ...u,
    verdict: v ?? null,
    refuterSeen: Boolean(ref),
    refutedAway: Boolean(ref && ref.refuted),
    misleading_final: v ? (survivesRefutation ? v.misleading : "no") : null,
    honestCarrier_final: v ? (survivesRefutation ? v.honestCarrier : "no") : null,
  };
});

// ---------- CP-1B roll-up ----------
const bAll = [];
for (let i = 1; i <= manifest.B.batches.length; i++) {
  bAll.push(...JSON.parse(fs.readFileSync(`experiments/v3-9/batches/b_b${i}.json`, "utf8")).units);
}
const B_ROWS = bAll.map((u) => {
  const v = verdicts.get(u.unitId);
  const ref = refuted.get(u.unitId);
  const survives = v && !(ref && ref.refuted);
  return {
    ...u, verdict: v ?? null, refuterSeen: Boolean(ref), refutedAway: Boolean(ref && ref.refuted),
    verdict_final: v ? (survives ? v.verdict : "refuted_away") : null,
  };
});

const tally = (arr, f) => { const o = {}; for (const x of arr) { const k = f(x); o[k] = (o[k] || 0) + 1; } return o; };

const incomplete = auditA.missing.length > 0 || auditB.missing.length > 0;
const out = {
  journal: JOURNAL,
  batches_seen: { adjudications: A.length, refutations: R.length },
  audit: { A: auditA, B: auditB },
  cp1a: {
    rows: A_ROWS.length,
    misleading: tally(A_ROWS.filter((r) => r.verdict), (r) => r.misleading_final),
    honestCarrier: tally(A_ROWS.filter((r) => r.verdict), (r) => r.honestCarrier_final),
    refuterSeen: A_ROWS.filter((r) => r.refuterSeen).length,
    refutedAway: A_ROWS.filter((r) => r.refutedAway).length,
    confirmedMisleading: incomplete ? null : A_ROWS.filter((r) => r.misleading_final === "yes").length,
    confirmedHonestCarriers: incomplete ? null : A_ROWS.filter((r) => r.honestCarrier_final === "yes").length,
  },
  cp1b: {
    rows: B_ROWS.length,
    verdicts: tally(B_ROWS.filter((r) => r.verdict), (r) => r.verdict_final),
    refuterSeen: B_ROWS.filter((r) => r.refuterSeen).length,
    refutedAway: B_ROWS.filter((r) => r.refutedAway).length,
    confirmedFalsePass: incomplete ? null : B_ROWS.filter((r) => r.verdict_final === "false_pass").length,
  },
  state: incomplete ? "INCOMPLETE" : "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/merged.json", JSON.stringify({ ...out, A_ROWS, B_ROWS }, null, 2));
console.log(JSON.stringify(out, null, 2));
