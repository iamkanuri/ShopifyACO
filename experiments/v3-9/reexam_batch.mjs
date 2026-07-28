// v3.9 — BLINDED re-examination batches.
//
// The re-examiner must not be able to tell a suspect kill (from a 0.85-0.92 refuter) from a
// control kill (from a 0.20-0.29 refuter). If it could, it would be measuring its own
// agreement with a label rather than the kill. So the two sets are INTERLEAVED into the same
// batches, the batch field is stripped, and unit ids are re-issued in a shuffled order that
// carries no information about origin.
//
// The mapping back is written to a file the re-examiner is not given.
import fs from "node:fs";

const kills = JSON.parse(fs.readFileSync("experiments/v3-9/out/kills.json", "utf8"));
const suspect = kills.suspect.map((u) => ({ ...u, _origin: "suspect" }));
const control = kills.control.map((u) => ({ ...u, _origin: "control" }));

// deterministic interleave — no Math.random (it would make this unreproducible)
const merged = [];
const maxLen = Math.max(suspect.length, control.length);
for (let i = 0; i < maxLen; i++) {
  if (i < suspect.length) merged.push(suspect[i]);
  if (i < control.length) merged.push(control[i]);
}

const key = [];
const blinded = merged.map((u, i) => {
  const rid = `R${String(i + 1).padStart(3, "0")}`;
  key.push({ rid, unitId: u.unitId, batch: u.batch, origin: u._origin, kind: u.kind });
  return {
    rid,
    kind: u.kind,
    host: u.host, claim: u.claim, term: u.term, surface: u.surface,
    sentence: u.sentence,
    engineStatus: u.engineStatus,
    original_finding: u.adjudicator_said,
  };
});

const N = Number(process.env.REEXAM_BATCHES ?? 6);
const batches = Array.from({ length: N }, () => []);

// ⚠️ DO NOT assign the interleaved list by `i % N`. The interleave has period 2, and 2
// divides 6, so every even slot lands in an odd batch: the first attempt produced batches
// 1/3/5 at 100% suspect and 2/4/6 at 75% control — the exact opposite of blinding, and it
// would have had three re-examiners judging nothing but suspect kills.
//
// Assign each ORIGIN GROUP round-robin independently instead, so both are spread evenly by
// construction rather than by luck of the stride.
const originOf = new Map(key.map((k) => [k.rid, k.origin]));
let si = 0, ci = 0;
for (const u of blinded) {
  if (originOf.get(u.rid) === "suspect") batches[si++ % N].push(u);
  else batches[(ci++ + Math.floor(N / 2)) % N].push(u);
}

fs.mkdirSync("experiments/v3-9/reexam", { recursive: true });
batches.forEach((b, i) => {
  fs.writeFileSync(`experiments/v3-9/reexam/r_b${i + 1}.json`,
    JSON.stringify({ batch: i + 1, of: N, units: b }, null, 2));
});
fs.writeFileSync("experiments/v3-9/reexam/KEY.json", JSON.stringify({ key }, null, 2));

// exactly-once, both directions
const placed = new Set(batches.flat().map((u) => u.rid));
const expected = new Set(blinded.map((u) => u.rid));
const proof = {
  expected: expected.size, placed: placed.size,
  missing: [...expected].filter((r) => !placed.has(r)),
  extra: [...placed].filter((r) => !expected.has(r)),
};
const balance = batches.map((b, i) => {
  const origins = b.map((u) => key.find((k) => k.rid === u.rid).origin);
  return {
    batch: i + 1, n: b.length,
    suspect: origins.filter((o) => o === "suspect").length,
    control: origins.filter((o) => o === "control").length,
  };
});

console.log(JSON.stringify({
  suspect: suspect.length, control: control.length, total: blinded.length,
  batches: balance, proof,
  completion: proof.missing.length || proof.extra.length ? "INCOMPLETE" : "VERIFIED_CLEAN",
}, null, 2));
