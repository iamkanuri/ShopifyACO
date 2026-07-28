// v3.9 — merge the blinded re-examination and unblind it.
//
// ⚠️ A "KILL" IS NOT ONE KIND OF THING, and batch 1's re-examiner spotted this before I
// did. My refuter was fed everything an adjudicator flagged, which included rows flagged
// ONLY as honest carriers (misleading=no, honestCarrier=yes). A refuter killing one of
// those is answering "would a guard really break this true row?", not "is this a defect".
// Scoring both together would mix two questions and inflate the agreement rate.
//
// So the unblinding splits kills by what the ORIGINAL finding claimed, and only the
// defect-claim half bears on the confirmed count.
import fs from "node:fs";

const JOURNAL = process.argv[2];
const lines = fs.readFileSync(JOURNAL, "utf8").split("\n").filter((l) => l.trim());
const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const returns = [];
function harvest(v) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) harvest(x); return; }
  if (Array.isArray(v.verdicts) && typeof v.batch === "number" && v.verdicts.some((x) => x.rid)) returns.push(v);
  for (const x of Object.values(v)) harvest(x);
}
for (const e of events) harvest(e);

const seen = new Set(), R = [];
for (const r of returns) {
  const k = JSON.stringify(r.verdicts.map((v) => v.rid).sort());
  if (seen.has(k)) continue; seen.add(k); R.push(r);
}

const key = JSON.parse(fs.readFileSync("experiments/v3-9/reexam/KEY.json", "utf8")).key;
const originOf = new Map(key.map((k) => [k.rid, k]));
const merged = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const rowById = new Map([...merged.A_ROWS, ...merged.B_ROWS].map((r) => [r.unitId, r]));

const verdicts = new Map();
for (const b of R) for (const v of b.verdicts) if (!verdicts.has(v.rid)) verdicts.set(v.rid, v);

const rows = [];
for (const k of key) {
  const v = verdicts.get(k.rid);
  const row = rowById.get(k.unitId);
  // what did the ORIGINAL finding claim?
  const claimKind = k.kind === "A"
    ? (row?.verdict?.misleading === "yes" ? "defect" : "honest_carrier_only")
    : "defect";
  rows.push({
    rid: k.rid, unitId: k.unitId, batch: k.batch, origin: k.origin, kind: k.kind, claimKind,
    host: row?.host ?? null, claim: row?.claim ?? row?.claimKey ?? null,
    reexam: v?.refutationWasCorrect ?? null,
    confidence: v?.confidence ?? null,
    reason: v?.reason ?? null,
    reinstated: v?.refutationWasCorrect === "no",
  });
}

const missing = rows.filter((r) => r.reexam === null);
const tally = (list) => list.reduce((o, r) => ((o[r.reexam ?? "MISSING"] = (o[r.reexam ?? "MISSING"] || 0) + 1), o), {});

const defectKills = rows.filter((r) => r.claimKind === "defect");
const carrierKills = rows.filter((r) => r.claimKind === "honest_carrier_only");

function split(list, label) {
  const s = list.filter((r) => r.origin === "suspect");
  const c = list.filter((r) => r.origin === "control");
  const rate = (l) => l.length ? +(l.filter((r) => r.reinstated).length / l.length).toFixed(3) : null;
  return {
    label, n: list.length,
    suspect: { n: s.length, reinstated: s.filter((r) => r.reinstated).length, rate: rate(s) },
    control: { n: c.length, reinstated: c.filter((r) => r.reinstated).length, rate: rate(c) },
    all: { reinstated: list.filter((r) => r.reinstated).length, rate: rate(list) },
    tally: tally(list),
  };
}

const out = {
  reexamined: rows.length, missing_verdicts: missing.length,
  batches_returned: R.length,
  by_claim_kind: {
    defect_claims: split(defectKills, "kills of DEFECT claims — these bear on the confirmed count"),
    honest_carrier_only: split(carrierKills, "kills of HONEST-CARRIER-only flags — a different question"),
  },
  overall: split(rows, "all kills"),
  reinstated_defects: defectKills.filter((r) => r.reinstated).map((r) => ({
    rid: r.rid, unitId: r.unitId, batch: r.batch, origin: r.origin, kind: r.kind,
    host: r.host, claim: r.claim, confidence: r.confidence,
  })),
  rows,
  completion: missing.length ? "INCOMPLETE" : "DEFECTS_FOUND",
};
fs.writeFileSync("experiments/v3-9/out/reexam_merge.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, rows: undefined, reinstated_defects: out.reinstated_defects.length }, null, 2));
console.log("\n--- reinstated defect claims ---");
for (const r of out.reinstated_defects) console.log(`  ${r.rid} ${r.unitId} [${r.origin} ${r.batch}] ${r.host} ${r.claim} (${r.confidence})`);
