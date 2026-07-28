// v3.9 CP-1B — isolate the domain_collision rows and build the adjudication candidate set.
// An engine answer is not a verdict; this produces CANDIDATES.
import fs from "node:fs";

const now = JSON.parse(fs.readFileSync("experiments/v3-9/out/g14_collisions.json", "utf8"));
const before = JSON.parse(fs.readFileSync("experiments/v3-8/out/g14_sentences.json", "utf8"));

const rowsOf = (d) => d.rows ?? d.sentences ?? d.results ?? [];
const nowRows = rowsOf(now), beforeRows = rowsOf(before);

const sub = (rs, s) => rs.filter((r) => r.subclass === s);
const coll = sub(nowRows, "domain_collision");

// --- the +232 arithmetic, stated rather than assumed ---
const src = JSON.parse(fs.readFileSync("experiments/v3-9/out/collisions_src.json", "utf8"));
const authoredSentences = src.sentences;                    // 122 distinct authored strings
const distinctTexts = new Set(coll.map((r) => r.text)).size;

// --- outcomes ---
const CONTRA = "Your public copy states the opposite of this requirement.";
const outcome = (r) =>
  r.engineStatus === "pass_evidenced" ? "pass"
    : r.engineDetail === CONTRA ? "contradicted" : "not_proven";

const tally = {};
for (const r of coll) tally[outcome(r)] = (tally[outcome(r)] || 0) + 1;

const byKey = {};
for (const r of coll) {
  const k = r.claimKey;
  byKey[k] ??= { total: 0, pass: 0, contradicted: 0, not_proven: 0 };
  byKey[k].total++; byKey[k][outcome(r)]++;
}

// --- group by (claimKey, domain-ish, text) so an adjudicator sees one unit per sentence ---
const groups = new Map();
for (const r of coll) {
  const gid = `${r.claimKey}|${r.term}|${r.text}`;
  if (!groups.has(gid)) {
    groups.set(gid, {
      groupId: gid, claimKey: r.claimKey, term: r.term, termRole: r.termRole,
      text: r.text, intent: r.intent, surface: r.surface,
      engineStatus: r.engineStatus, engineDetail: r.engineDetail,
      engineQuote: r.engineQuote ?? r.quote ?? null,
      outcome: outcome(r), n: 0,
    });
  }
  groups.get(gid).n++;
}
const G = [...groups.values()];

// candidates = the ones the engine PASSED (a false pass is the defect shape here)
const candidates = G.filter((g) => g.outcome === "pass");

// two-sided canary: the set must contain both passes and non-passes, or the executor is broken
const canary = { passes: tally.pass ?? 0, nonPasses: (tally.not_proven ?? 0) + (tally.contradicted ?? 0) };
const live = canary.passes > 0 && canary.nonPasses > 0;

const out = {
  v38_baseline: {
    total_rows: beforeRows.length,
    adjacent_vocabulary_rows: nowRows.length ? sub(beforeRows, "domain_collision").length : null,
    adjacent_subclasses: [...new Set(beforeRows.filter((r) => r.attackClass === "adjacent_vocabulary").map((r) => r.subclass))],
    adjacent_total: beforeRows.filter((r) => r.attackClass === "adjacent_vocabulary").length,
  },
  v39_run: {
    total_rows: nowRows.length,
    delta_vs_v38: nowRows.length - beforeRows.length,
    domain_collision_rows: coll.length,
    adjacent_total: nowRows.filter((r) => r.attackClass === "adjacent_vocabulary").length,
  },
  arithmetic: {
    authored_domains: src.domains.length,
    authored_sentences: authoredSentences,
    distinct_texts_executed: distinctTexts,
    executed_rows: coll.length,
    why:
      "The generator emits one row per (term, sentence) pair where `collidesWith.includes(term)` " +
      "(generate.ts:177). A domain that collides with several terms of the same key therefore " +
      "contributes its sentences once PER TERM. So 122 authored strings become " +
      `${coll.length} executed rows across ${distinctTexts} distinct texts.`,
    delta_check: nowRows.length - beforeRows.length === coll.length,
  },
  outcomes: tally,
  byKey,
  canary: { ...canary, live },
  candidate_count: candidates.length,
  candidates,
  completion: !live ? "INCOMPLETE" : coll.length === 0 ? "INCOMPLETE" : "CANDIDATES_READY",
};

fs.writeFileSync("experiments/v3-9/out/collide_report.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  v38: out.v38_baseline, v39: out.v39_run, arithmetic: out.arithmetic,
  outcomes: out.outcomes, byKey: out.byKey, canary: out.canary,
  candidate_count: out.candidate_count, completion: out.completion,
}, null, 2));
