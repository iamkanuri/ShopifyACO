// ===========================================================================
// RENDERING an attack set for a human attacker to work through, and for the
// review record.
//
// The output is deliberately organised BY CLASS rather than by term. The decaf
// review's central insight was that the CLASSES that closed are what matter, not
// the sentence count: narrowing closed adjacent-vocabulary 7/7 and denial 5/5,
// and zero of everything about the subject — a fact a flat list of 40 sentences
// hides and a per-class table makes unmissable.
//
// Pure: no clock, no I/O.
// ===========================================================================

import { CLASS_PURPOSE, type AttackSentence, type AttackSet } from "./types.js";

const bar = (n: number, max: number, width = 24): string =>
  max <= 0 ? "" : "#".repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)));

function renderSentence(s: AttackSentence): string {
  const where = s.surface === "product_description" ? "" : `  [${s.surface}]`;
  return `    ${s.control ? "CONTROL " : ""}${s.text}${where}\n      ↳ ${s.id} — ${s.intent}`;
}

export function renderAttackSet(set: AttackSet): string {
  const L: string[] = [];
  L.push(`ATTACK SET — ${set.source.claimKey} (${set.source.standardId} ${set.source.standardVersion})`);
  L.push(`  context: ${set.contextId}   seed: ${set.seed}   vocabulary_hash: ${set.source.vocabularyHash ?? "<none>"}`);
  L.push("");
  L.push(set.summary);
  L.push("");

  if (set.state === "incomplete" && set.attacks.length === 0) return L.join("\n");

  const max = Math.max(1, ...Object.values(set.coverage.byClass));
  L.push("PER CLASS — the unit that matters. A count is not a closure.");
  for (const [cls, n] of Object.entries(set.coverage.byClass)) {
    const scheduled = set.scheduledClasses.includes(cls as never);
    const note = !scheduled
      ? "NOT SCHEDULED — this class was never attacked"
      : set.coverage.notExercised.includes(cls as never)
        ? "NOT EXERCISED — no terms of this class's role; it ran against nothing"
        : bar(n, max);
    L.push(`  ${cls.padEnd(28)} ${String(n).padStart(4)}  ${note}`);
  }
  L.push("");

  if (set.coverage.droppedByCap.length) {
    const subs = [...new Set(set.coverage.droppedByCap.map((d) => `${d.attackClass}/${d.subclass}`))].sort();
    L.push(`CAPPED — ${set.coverage.droppedByCap.length} generated sentence(s) are NOT shown above.`);
    L.push("  A cell showing N attacks is not a cell with N available. Raise --limit to see them.");
    L.push(`  ${subs.length} subclass(es) affected: ${subs.slice(0, 10).join(", ")}${subs.length > 10 ? `, … +${subs.length - 10}` : ""}`);
    L.push("");
  }

  if (set.coverage.untested.length) {
    L.push(`UNTESTED — ${set.coverage.untested.length} term/class cell(s) produced no attack.`);
    L.push("  A term with no attack in a class is an UNTESTED term, not a term that survived.");
    const byReason = new Map<string, typeof set.coverage.untested>();
    for (const c of set.coverage.untested) {
      const k = c.omission?.reason ?? "unknown";
      byReason.set(k, [...(byReason.get(k) ?? []), c]);
    }
    for (const [reason, cellList] of byReason) {
      L.push(`  ${reason} — ${cellList.length} cell(s)`);
      L.push(`    ${cellList[0]!.omission?.detail ?? ""}`);
      const terms = [...new Set(cellList.map((c) => `${c.attackClass}:${c.term}`))];
      for (const t of terms.slice(0, 8)) L.push(`      · ${t}`);
      if (terms.length > 8) L.push(`      · … and ${terms.length - 8} more`);
    }
    L.push("");
  }

  for (const cls of set.scheduledClasses) {
    const mine = set.attacks.filter((a) => a.attackClass === cls);
    const ctrl = set.controls.filter((a) => a.attackClass === cls);
    if (!mine.length && !ctrl.length) continue;
    L.push(`── ${cls} (${mine.length} attacks, ${ctrl.length} controls)`);
    L.push(`   ${CLASS_PURPOSE[cls]}`);
    const bySub = new Map<string, AttackSentence[]>();
    for (const s of [...mine, ...ctrl]) bySub.set(s.subclass, [...(bySub.get(s.subclass) ?? []), s]);
    for (const [sub, list] of bySub) {
      L.push(`  ${sub} (${list.length})`);
      for (const s of list) L.push(renderSentence(s));
    }
    L.push("");
  }

  L.push("WHAT THIS SET IS NOT.");
  L.push("  It is not an adjudication: nothing here says what the engine returns, and nothing");
  L.push("  here says a sentence is genuinely misleading. Both are the human's judgement.");
  L.push("  It is not independent: a generated set is still the AUTHOR'S set. The generator");
  L.push("  lowers the cost of coverage and does nothing whatever for independence, so the");
  L.push("  gate's separation of author, attacker and refuter stands unchanged.");
  return L.join("\n");
}

/** The machine-readable form, for a reviewer's own harness. Field order is fixed
 *  so two runs diff cleanly. */
export function attackSetToJson(set: AttackSet): string {
  return JSON.stringify(
    {
      source: set.source, contextId: set.contextId, seed: set.seed,
      scheduledClasses: set.scheduledClasses,
      state: set.state, uncoveredCount: set.uncoveredCount, decisive: set.decisive, summary: set.summary,
      coverage: set.coverage,
      attacks: set.attacks, controls: set.controls,
    },
    null,
    2,
  );
}
