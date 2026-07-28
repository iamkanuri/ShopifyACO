// v3.9 CP-1A — PER-DETECTOR LIVENESS. A zero occurrence is only a finding if the
// detector that returned it demonstrably fires.
//
// `tense_modality` returned 0/71 on the passing population. That is either (a) the real
// answer — merchants do not write tensed/modal copy in the sentences the engine cites as
// proof — or (b) three dead detectors. Those are indistinguishable from the number alone,
// and this repo has shipped (b) as (a) four times.
//
// The proof: re-run the SAME detector objects over v3.6's full 3,349-sentence corpus and
// require them to reproduce v3.6's own published per-stratum counts. A detector that
// reproduces 103 past_tense sentences at corpus scale and 0 in the passing population is
// LIVE, and the 0 is a fact about where those shapes land, not about the instrument.

import fs from "node:fs";
import { DETECTORS } from "../v3-6/freq/strata.js";

const sentences: any[] = fs.readFileSync("experiments/v3-6/freq/sentences.jsonl", "utf8")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// v3.6's published per-stratum sentence counts, transcribed from freq/occurrence.json
// (read from the artifact, not typed from the report).
const published = JSON.parse(fs.readFileSync("experiments/v3-6/freq/occurrence.json", "utf8"));
const pubBy: Record<string, number> = {};
for (const r of published.table) pubBy[r.stratum] = r.sentences;

const textOf = (s: any) => s.text ?? s.sentence ?? s.s ?? "";

const reproduced: Record<string, number> = {};
for (const d of DETECTORS) reproduced[d.id] = 0;
for (const s of sentences) {
  const t = textOf(s);
  if (!t) continue;
  for (const d of DETECTORS) {
    let fired = false;
    for (const [, re] of d.pats) if (re.test(t)) { fired = true; break; }
    if (!fired) continue;
    if (d.also && !d.also(t)) continue;
    reproduced[d.id]++;
  }
}

const rows = DETECTORS.map((d) => ({
  stratum: d.id,
  direction: d.direction,
  v36_published: pubBy[d.id] ?? null,
  reproduced_now: reproduced[d.id],
  agrees: pubBy[d.id] === reproduced[d.id],
  live: reproduced[d.id] > 0,
}));

const disagreements = rows.filter((r) => r.v36_published !== null && !r.agrees);
const dead = rows.filter((r) => !r.live);

// A stratum that v3.6 ALSO published as zero is not evidence of a dead detector — it is
// v3.6's own finding, reproduced. Separate the two so neither hides the other.
const deadButPublishedZero = dead.filter((r) => r.v36_published === 0);
const deadUnexplained = dead.filter((r) => r.v36_published !== 0);

const out = {
  corpus_sentences: sentences.length,
  rows,
  disagreements,
  dead_detectors_total: dead.length,
  dead_but_v36_also_published_zero: deadButPublishedZero.map((r) => r.stratum),
  dead_unexplained: deadUnexplained.map((r) => r.stratum),
  completion:
    sentences.length === 0
      ? "INCOMPLETE"
      : deadUnexplained.length > 0
        ? "DEFECTS_FOUND"
        : disagreements.length > 0
          ? "DEFECTS_FOUND"
          : "VERIFIED_CLEAN",
};

fs.writeFileSync("experiments/v3-9/out/liveness.json", JSON.stringify(out, null, 2));
console.log(`corpus sentences: ${sentences.length}`);
console.table(rows);
console.log("disagreements:", JSON.stringify(disagreements, null, 2));
console.log("dead (v3.6 also published 0):", out.dead_but_v36_also_published_zero);
console.log("dead UNEXPLAINED:", out.dead_unexplained);
console.log("completion:", out.completion);
