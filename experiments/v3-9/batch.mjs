// v3.9 — build adjudication batches for CP-1A (71 pass rows) and CP-1B (178 collision passes).
//
// CLASS-MAJOR ROUND-ROBIN, per v3.8's finding: batching by kind makes errors inside a batch
// correlated by construction. No adjudicator owns a whole attack class or a whole claim key.
import fs from "node:fs";

const AB = Number(process.env.A_BATCHES ?? 5);
const BB = Number(process.env.B_BATCHES ?? 8);
fs.mkdirSync("experiments/v3-9/batches", { recursive: true });

// ---------- CP-1A ----------
const axes = JSON.parse(fs.readFileSync("experiments/v3-9/out/axes.json", "utf8"));
const aUnits = axes.rows.map((r, i) => ({
  unitId: `A${String(i + 1).padStart(3, "0")}`,
  host: r.domain,
  url: r.url,
  claim: r.claim,
  asked: r.asked,
  surface: r.surface,
  engineDetail: r.detail,
  sentence: r.quote,
  v36_strata: r.strata,
  detectorHits: r.detectorHits.map((h) => `${h.id}(${h.pats.join(",")})`),
  axisMarkers: Object.fromEntries(
    Object.entries(r.axes).map(([k, v]) => [k, { hostile: v.hostileHit, honest: v.honestHit }]),
  ),
}));

// ---------- CP-1B ----------
const coll = JSON.parse(fs.readFileSync("experiments/v3-9/out/collide_report.json", "utf8"));
const bUnits = coll.candidates.map((c, i) => ({
  unitId: `B${String(i + 1).padStart(3, "0")}`,
  claimKey: c.claimKey,
  term: c.term,
  termRole: c.termRole,
  sentence: c.text,
  intent: c.intent,
  surface: c.surface,
  engineStatus: c.engineStatus,
  engineDetail: c.engineDetail,
  engineQuote: c.engineQuote,
}));

function roundRobin(units, n, keyOf) {
  const byClass = new Map();
  for (const u of units) {
    const k = keyOf(u);
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(u);
  }
  const batches = Array.from({ length: n }, () => []);
  let i = 0;
  for (const arr of byClass.values()) for (const u of arr) batches[i++ % n].push(u);
  return batches;
}

const aB = roundRobin(aUnits, AB, (u) => u.claim);
const bB = roundRobin(bUnits, BB, (u) => u.claimKey);

const manifest = { A: { total: aUnits.length, batches: [] }, B: { total: bUnits.length, batches: [] } };
aB.forEach((b, i) => {
  const p = `experiments/v3-9/batches/a_b${i + 1}.json`;
  fs.writeFileSync(p, JSON.stringify({ batch: i + 1, of: AB, kind: "CP-1A", units: b }, null, 2));
  manifest.A.batches.push({ file: p, n: b.length, ids: b.map((u) => u.unitId) });
});
bB.forEach((b, i) => {
  const p = `experiments/v3-9/batches/b_b${i + 1}.json`;
  fs.writeFileSync(p, JSON.stringify({ batch: i + 1, of: BB, kind: "CP-1B", units: b }, null, 2));
  manifest.B.batches.push({ file: p, n: b.length, ids: b.map((u) => u.unitId) });
});

// exactly-once proof, BOTH directions
function proof(units, batches) {
  const all = new Set(units.map((u) => u.unitId));
  const seen = new Map();
  for (const b of batches) for (const id of b.ids) seen.set(id, (seen.get(id) || 0) + 1);
  return {
    expected: all.size,
    placed: seen.size,
    duplicates: [...seen].filter(([, n]) => n > 1).map(([id]) => id),
    missing: [...all].filter((id) => !seen.has(id)),
    extra: [...seen.keys()].filter((id) => !all.has(id)),
  };
}
manifest.A.proof = proof(aUnits, manifest.A.batches);
manifest.B.proof = proof(bUnits, manifest.B.batches);
const ok = (p) => p.duplicates.length === 0 && p.missing.length === 0 && p.extra.length === 0 && p.expected === p.placed;
manifest.completion = ok(manifest.A.proof) && ok(manifest.B.proof) ? "VERIFIED_CLEAN" : "INCOMPLETE";

fs.writeFileSync("experiments/v3-9/batches/manifest.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({
  A: { total: manifest.A.total, sizes: manifest.A.batches.map((b) => b.n), proof: manifest.A.proof },
  B: { total: manifest.B.total, sizes: manifest.B.batches.map((b) => b.n), proof: manifest.B.proof },
  completion: manifest.completion,
}, null, 2));
