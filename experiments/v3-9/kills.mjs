// v3.9 — THE ASYMMETRY, MADE CONCRETE.
//
// Confirmations were re-executed against the bytes (15/15 REPRODUCED). Refutations never
// were. The unverified side is the one that REMOVES findings, so it fails in the flattering
// direction — and the per-batch kill rate runs 0.20 to 0.917 on compositionally matched
// batches, which means the flattering side is also the unstable side.
//
// This builds the re-examination set the user asked for: weighted toward the high-kill
// refuters, with low-kill batches carried as a CONTROL so the result is two-sided. A
// re-examination that only looked at harsh refuters could only find one kind of error.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync("experiments/v3-9/out/merged.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("experiments/v3-9/batches/manifest.json", "utf8"));
const batchOf = new Map();
manifest.A.batches.forEach((b, i) => b.ids.forEach((id) => batchOf.set(id, `A${i + 1}`)));
manifest.B.batches.forEach((b, i) => b.ids.forEach((id) => batchOf.set(id, `B${i + 1}`)));

const all = [...m.A_ROWS.map((r) => ({ ...r, kind: "A" })), ...m.B_ROWS.map((r) => ({ ...r, kind: "B" }))];
const killed = all.filter((r) => r.refutedAway).map((r) => ({ ...r, batch: batchOf.get(r.unitId) }));

const rate = {
  A1: 0.200, A2: 0.846, A3: 0.462, A4: 0.200, A5: 0.917,
  B1: 0.500, B2: 0.857, B3: 0.250, B4: 0.278, B5: null, B6: null, B7: 0.625, B8: null,
};
// recompute rates from the data rather than trusting the table above
const byBatch = {};
for (const r of all) {
  const b = batchOf.get(r.unitId);
  byBatch[b] ??= { seen: 0, killed: 0 };
  if (r.refuterSeen) byBatch[b].seen++;
  if (r.refutedAway) byBatch[b].killed++;
}
for (const b of Object.keys(byBatch)) {
  byBatch[b].rate = byBatch[b].seen ? +(byBatch[b].killed / byBatch[b].seen).toFixed(3) : null;
}
const rates = Object.entries(byBatch).map(([b, v]) => ({ batch: b, ...v })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));

const HIGH = rates.filter((r) => r.rate !== null && r.rate >= 0.6).map((r) => r.batch);
const LOW = rates.filter((r) => r.rate !== null && r.rate <= 0.3).map((r) => r.batch);

const highKills = killed.filter((k) => HIGH.includes(k.batch));
const lowKills = killed.filter((k) => LOW.includes(k.batch));

// EVERY high-kill kill is re-examined (they are the suspect set and there are few enough).
// The low-kill batches supply the CONTROL: if the re-examiner overturns kills at the same
// rate in both, the finding is re-examiner harshness rather than original-refuter harshness.
const unit = (k) => ({
  unitId: k.unitId, batch: k.batch, kind: k.kind,
  host: k.host ?? null, claim: k.claim ?? k.claimKey ?? null,
  term: k.term ?? null, surface: k.surface ?? null,
  sentence: k.sentence ?? null,
  engineStatus: k.engineStatus ?? "pass_evidenced",
  adjudicator_said: k.kind === "A"
    ? { misleading: k.verdict?.misleading, honestCarrier: k.verdict?.honestCarrier,
        axes: k.verdict?.axisAttribution ?? [], reason: k.verdict?.reason }
    : { verdict: k.verdict?.verdict, reason: k.verdict?.reason },
});

const out = {
  rates,
  high_kill_batches: HIGH, low_kill_batches: LOW,
  totals: { all_kills: killed.length, high: highKills.length, low: lowKills.length },
  suspect: highKills.map(unit),
  control: lowKills.map(unit),
};
fs.mkdirSync("experiments/v3-9/reexam", { recursive: true });
fs.writeFileSync("experiments/v3-9/reexam/suspect.json", JSON.stringify({ units: out.suspect }, null, 2));
fs.writeFileSync("experiments/v3-9/reexam/control.json", JSON.stringify({ units: out.control }, null, 2));
fs.writeFileSync("experiments/v3-9/out/kills.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ rates, HIGH, LOW, totals: out.totals }, null, 2));
