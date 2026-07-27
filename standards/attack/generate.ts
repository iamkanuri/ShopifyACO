// ===========================================================================
// THE ATTACK TEMPLATIZER — the generator.
//
// Given any vocabulary artifact, produce the hostile sentences for every attack
// class in `VOCABULARY_REVIEW.md` §2 plus the two the evidence forced, together
// with a COVERAGE report that names every term left untested in every class.
//
// ⚠️ IT SCORES NOTHING. There is no import from the engine's matcher in this
// file, deliberately: generation and adjudication must stay apart, and a
// generator that judges its own output is the self-attack the review gate
// exists to forbid.
//
// ⚠️ THE COMPLETION STATE IS NOT REIMPLEMENTED. It comes from the real
// `src/measure/completion.ts`, because the one thing this project has proven
// four times over is that a copy of that rule drifts and then reports a broken
// run as a clean one. `uncoveredCount` is `number | null` — null when the run
// did not complete, NEVER 0.
//
// Pure and deterministic: no network, no database, no clock, no randomness.
// Selection under a cap uses a seeded hash, so the same seed produces a
// byte-identical set and a different seed produces a COMPARABLE one.
// ===========================================================================

import { aggregate, type UnitReport } from "../../src/measure/completion.js";
import type { Vocabulary } from "../vocabulary.js";
import { DEFAULT_CONTEXT } from "./context.js";
import { ORTHOGRAPHY, markCase, predicateOf, templatesFor, termShape } from "./templates.js";
import {
  ATTACK_CLASSES, type AttackClass, type AttackSentence, type AttackSet,
  type CategoryContext, type CoverageCell, type GenerateOptions, type OmissionReason, type TermRole,
} from "./types.js";

// ---- deterministic selection ------------------------------------------------

/** FNV-1a, 32-bit. A hash, not a random number generator: the same string always
 *  yields the same value, which is the whole requirement. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Take at most `limit`, chosen by seeded hash rather than by list order.
 *
 * Order-based truncation would mean a re-review after a term change silently
 * re-tests the same first three templates for ever. Hash-based selection under
 * a FIXED seed gives the same set every run, and under a NEW seed gives a
 * different set of the same size and the same classes — which is what makes two
 * reviews comparable rather than merely repeatable.
 */
function pick<T extends { id: string }>(items: T[], limit: number, seed: string): T[] {
  if (items.length <= limit) return items;
  return [...items]
    .sort((a, b) => fnv1a(`${seed}|${a.id}`) - fnv1a(`${seed}|${b.id}`) || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A readable, UNIQUE id fragment for a term.
 *
 * The hash suffix is not decoration. Slugging alone collides: `swiss water
 * process` and `swiss water® process` both reduce to `swiss-water-process`, as
 * do `co2 decaf` and `co₂ decaf` — and an orthography variant colliding with its
 * own base term is exactly the pair a review most needs to tell apart. Caught by
 * the id-uniqueness assertion, which reported 620 unique ids for 803 sentences.
 */
const slug = (s: string): string => {
  const readable = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "term";
  return `${readable}-${fnv1a(s).toString(36).slice(0, 4)}`;
};


// ---- shape validation -------------------------------------------------------

export interface ShapeProblem { field: string; detail: string }

/**
 * Is this even a vocabulary?
 *
 * A malformed input must be REJECTED, not silently produce an empty set — an
 * empty set and a complete-but-clean set are arithmetically identical, which is
 * exactly the failure `src/measure/completion.ts` exists to stop. Rejection here
 * means `incomplete` with the problems named, and `uncoveredCount: null`.
 */
export function shapeProblems(vocab: unknown): ShapeProblem[] {
  const p: ShapeProblem[] = [];
  if (!vocab || typeof vocab !== "object" || Array.isArray(vocab)) {
    return [{ field: "<root>", detail: "not an object" }];
  }
  const v = vocab as Record<string, unknown>;
  if (typeof v.claim_key !== "string" || !v.claim_key) p.push({ field: "claim_key", detail: "missing or not a string" });
  for (const list of ["supporting_terms", "violating_terms"]) {
    const arr = v[list];
    if (!Array.isArray(arr)) { p.push({ field: list, detail: "missing or not an array" }); continue; }
    arr.forEach((t, i) => {
      if (!t || typeof t !== "object" || typeof (t as { term?: unknown }).term !== "string" || !(t as { term: string }).term.trim()) {
        p.push({ field: `${list}[${i}].term`, detail: "missing, not a string, or empty" });
      }
    });
  }
  if (Array.isArray(v.supporting_terms) && Array.isArray(v.violating_terms)
    && v.supporting_terms.length === 0 && v.violating_terms.length === 0) {
    p.push({ field: "supporting_terms + violating_terms", detail: "both empty — there is nothing to attack, and an empty attack set must never read as full coverage" });
  }
  return p;
}

// ---- generation -------------------------------------------------------------

interface Candidate extends AttackSentence { }

/** Which roles a class can attack at all. Drives `not_applicable_to_role`. */
const CLASS_ROLES: Record<AttackClass, TermRole[]> = {
  letter_not_spirit: ["supporting"],
  adjacent_vocabulary: ["supporting", "violating"],
  wrong_subject: ["supporting", "violating"],
  merchant_controlled_string: ["supporting", "violating"],
  orthography: ["supporting", "violating"],
  violation: ["violating"],
  tense_modality: ["supporting", "violating"],
  denial: ["supporting", "violating"],
};

function generateCell(
  cls: AttackClass, term: string, role: TermRole, ctx: CategoryContext, wantControls: boolean,
): Candidate[] {
  const shape = termShape(term, ctx);
  const out: Candidate[] = [];
  const id = (subclass: string, i?: number) =>
    `${cls}/${subclass}#${slug(term)}${i === undefined ? "" : `@${i}`}`;

  if (cls === "orthography") {
    for (const o of ORTHOGRAPHY) {
      const variant = o.apply(term);
      if (variant === null) continue;                       // not applicable to a one-word term
      out.push({
        id: id(o.subclass), attackClass: cls, subclass: o.subclass, term, termRole: role,
        surface: "product_description",
        text: `This product ${predicateOf(variant, shape)}.`,
        intent: o.intent, control: false,
      });
    }
    return out;
  }

  if (cls === "adjacent_vocabulary") {
    // (a) THE MECHANISABLE HALF — fragment probes. The term's maximal proper
    // prefix and suffix, in a neutral frame. This reaches the shape where a
    // FRAGMENT of one term is matchable on its own, which is how a CO2 process
    // marketed under a water-sounding trade name gets read as a water method.
    const w = term.trim().split(/\s+/);
    if (w.length > 1) {
      const fragments: Array<[string, string]> = [
        ["fragment_prefix", w.slice(0, -1).join(" ")],
        ["fragment_suffix", w.slice(1).join(" ")],
      ];
      for (const [subclass, frag] of fragments) {
        out.push({
          id: id(subclass), attackClass: cls, subclass, term, termRole: role,
          surface: "product_description",
          text: `${ctx.specLabels[0] ?? "Specification"}: ${markCase(frag)}.`,
          intent:
            `a proper ${subclass === "fragment_prefix" ? "prefix" : "suffix"} of the term, in the spec-row shape where a checker is most likely to trust a value. ` +
            `The only mechanisable half of class 2 — the domain-collision half is NOT derivable and must come from the context file`,
          control: false,
        });
      }
    }
    // (b) THE HALF NO GENERATOR CAN DERIVE — supplied domain collisions.
    let n = 0;
    for (const d of ctx.adjacentDomains) {
      if (!d.collidesWith.includes(term)) continue;
      for (const s of d.sentences) {
        out.push({
          id: id("domain_collision", n++), attackClass: cls, subclass: "domain_collision", term, termRole: role,
          surface: "product_description", text: s,
          intent: `a different domain (${d.domain}) using the same string about the same product: ${d.why}`,
          control: false,
        });
      }
    }
    return out;
  }

  for (const t of templatesFor(cls, role, shape)) {
    if (t.control && !wantControls) continue;
    out.push({
      id: id(t.subclass), attackClass: cls, subclass: t.subclass, term, termRole: role,
      surface: t.surface, text: t.build(term, shape, ctx), intent: t.intent, control: t.control === true,
    });
  }
  return out;
}

/**
 * Generate the attack set for one vocabulary.
 *
 * Never throws on a bad vocabulary: it returns `incomplete` with the shape
 * problems named, because a thrown error loses the coverage report and a caller
 * that catches it is back to reading "nothing happened" as "nothing wrong".
 * `requireDecisive` from `src/measure/completion.ts` is the gate for a caller
 * that must not proceed.
 */
export function generateAttacks(vocab: unknown, opts: GenerateOptions = {}): AttackSet {
  const ctx = opts.context ?? DEFAULT_CONTEXT;
  const seed = opts.seed ?? "als-standards-s3";
  const perCellLimit = opts.perCellLimit ?? 3;
  const scheduled = opts.classes ?? [...ATTACK_CLASSES];
  const wantControls = opts.includeControls !== false;

  const problems = shapeProblems(vocab);
  const v = vocab as Vocabulary;
  const source = {
    claimKey: (v?.claim_key as string) ?? "<unknown>",
    standardId: (v?.standard_id as string) ?? "<unknown>",
    standardVersion: (v?.standard_version as string) ?? "<unknown>",
    vocabularyVersion: (v?.version as string) ?? null,
    vocabularyHash: v?.vocabulary_hash?.value ?? null,
  };

  if (problems.length) {
    const agg = aggregate({
      units: [{ id: "generate", role: "sweep", completed: false, failure: problems.map((p) => `${p.field}: ${p.detail}`).join("; ") }],
      candidates: 0, adjudicated: 0, confirmed: 0,
    });
    return {
      source, contextId: ctx.id, seed, scheduledClasses: scheduled,
      attacks: [], controls: [],
      coverage: { byClass: {}, cells: [], untested: [], notExercised: [], droppedByCap: [] },
      state: agg.state, uncoveredCount: agg.confirmedCount, decisive: agg.decisive,
      summary:
        `INCOMPLETE — the input is not a usable vocabulary (${problems.length} shape problem(s)): ` +
        `${problems.map((p) => `${p.field} ${p.detail}`).join("; ")}. ` +
        `Nothing was generated, which is NOT the same as a vocabulary with no attackable terms.`,
    };
  }

  const terms: Array<{ term: string; role: TermRole }> = [
    ...v.supporting_terms.map((t) => ({ term: t.term, role: "supporting" as TermRole })),
    ...v.violating_terms.map((t) => ({ term: t.term, role: "violating" as TermRole })),
  ];

  const cells: CoverageCell[] = [];
  const droppedByCap: Array<{ attackClass: AttackClass; term: string; subclass: string }> = [];
  const attacks: AttackSentence[] = [];
  const controls: AttackSentence[] = [];
  const units: UnitReport[] = [];

  for (const cls of ATTACK_CLASSES) {
    const isScheduled = scheduled.includes(cls);
    units.push({
      id: `class:${cls}`, role: "sweep", completed: isScheduled,
      failure: isScheduled ? undefined : "class not scheduled for this run — its terms were never attacked, so the run cannot be read as full coverage",
    });

    for (const { term, role } of terms) {
      const applicable = CLASS_ROLES[cls].includes(role);
      if (!isScheduled) {
        cells.push({ term, role, attackClass: cls, count: 0, omission: { reason: "class_not_scheduled", detail: `class ${cls} was excluded from this run` } });
        continue;
      }
      if (!applicable) {
        cells.push({
          term, role, attackClass: cls, count: 0,
          omission: { reason: "not_applicable_to_role", detail: `class ${cls} attacks ${CLASS_ROLES[cls].join(" and ")} terms only` },
        });
        continue;
      }

      const produced = generateCell(cls, term, role, ctx, wantControls);
      const available = produced.filter((c) => !c.control);
      const hostile = pick(available, perCellLimit, seed);
      const ctrl = produced.filter((c) => c.control);
      attacks.push(...hostile);
      controls.push(...ctrl);

      // NO SILENT CAPS. The cap is a real feature — 8 classes × 39 terms × every
      // template is more than a human will read — but a cell reporting "3
      // attacks" while five subclasses went unshown reads as coverage it is not.
      // Found by the corpus proof, which measured `violation/free_of` as
      // unreachable when it was merely un-picked at the default limit.
      const kept = new Set(hostile.map((h) => h.id));
      for (const d of available.filter((c) => !kept.has(c.id))) {
        droppedByCap.push({ attackClass: cls, term, subclass: d.subclass });
      }

      let omission: CoverageCell["omission"] = null;
      if (hostile.length === 0) {
        omission = cls === "adjacent_vocabulary"
          ? {
            reason: "requires_category_context" as OmissionReason,
            detail:
              `no adjacent domain in context \`${ctx.id}\` collides with this term, and the term is one word so no fragment probe exists. ` +
              `THE DOMAIN-COLLISION HALF OF CLASS 2 IS NOT MECHANISABLE — a human attacker must attempt it or the class is untested for this term`,
          }
          : {
            reason: "no_grammatical_template" as OmissionReason,
            detail: `no template in class ${cls} is grammatical for a \`${termShape(term, ctx)}\` term`,
          };
      }
      cells.push({ term, role, attackClass: cls, count: hostile.length, omission });
    }
  }

  const untested = cells.filter((c) => c.count === 0 && c.omission?.reason !== "not_applicable_to_role");
  // Cells that a scheduled, applicable class produced nothing for are the
  // "untested term" the brief requires to be reported rather than passed over.
  // Cells omitted because the class does not attack that role are not gaps.
  const adjudicable = cells.filter((c) => c.omission?.reason !== "not_applicable_to_role");
  const adjudicated = adjudicable.filter((c) => c.omission?.reason !== "class_not_scheduled");

  const agg = aggregate({
    units,
    candidates: adjudicable.length,
    adjudicated: adjudicated.length,
    confirmed: untested.filter((c) => c.omission?.reason !== "class_not_scheduled").length,
  });

  const byClass: Record<string, number> = {};
  for (const cls of ATTACK_CLASSES) byClass[cls] = attacks.filter((a) => a.attackClass === cls).length;

  // A class with no terms of its role produced nothing, and "0" next to a class
  // name reads exactly like "attacked and found nothing". `decaf-method.json`
  // ships an EMPTY violating list by a measured decision, so this is the normal
  // case rather than an edge one — and the first run of this generator reported
  // `violation 0` under a FULL COVERAGE headline, which is the flattering-zero
  // failure with a new coat of paint. Named, not inferred.
  const notExercised = ATTACK_CLASSES.filter(
    (cls) => scheduled.includes(cls) && byClass[cls] === 0
      && !cells.some((c) => c.attackClass === cls && c.omission?.reason !== "not_applicable_to_role"),
  );
  const exercisedNote = notExercised.length
    ? ` NOT EXERCISED: ${notExercised.join(", ")} — scheduled, but this vocabulary has no terms of the role ${
      notExercised.map((c) => CLASS_ROLES[c].join("/")).join(", ")
    }, so the class ran against nothing. That is not the same as a class that attacked and found nothing.`
    : "";

  const capNote = droppedByCap.length
    ? ` CAP: ${droppedByCap.length} sentence(s) in ${new Set(droppedByCap.map((d) => `${d.attackClass}|${d.term}`)).size} cell(s) were not shown at --limit ${perCellLimit}, spanning ${
      new Set(droppedByCap.map((d) => `${d.attackClass}/${d.subclass}`)).size
    } subclass(es). Raise --limit to see them; a cell showing ${perCellLimit} is not a cell with ${perCellLimit} available.`
    : "";

  const summary =
    agg.state === "incomplete"
      ? `INCOMPLETE — ${agg.missing.length} of ${units.length} classes did not run` +
        (agg.unadjudicated ? `, ${agg.unadjudicated} term/class cells were never reached` : "") +
        `. ${attacks.length} sentences were generated and that number is NOT coverage. uncoveredCount is null, not zero.`
      : agg.state === "defects_found"
        ? `COVERAGE GAPS — ${agg.confirmedCount} of ${adjudicable.length} term/class cells produced no attack. ` +
          `${attacks.length} attack sentences + ${controls.length} controls across ${scheduled.length} classes. ` +
          `A term with no attack in a class is an UNTESTED term.${exercisedNote}${capNote}`
        : `FULL COVERAGE — every one of ${adjudicable.length} applicable term/class cells produced at least one attack. ` +
          `${attacks.length} attack sentences + ${controls.length} controls across ${scheduled.length} classes.${exercisedNote}${capNote}`;

  return {
    source, contextId: ctx.id, seed, scheduledClasses: scheduled,
    attacks, controls,
    coverage: { byClass, cells, untested, notExercised: [...notExercised], droppedByCap },
    state: agg.state, uncoveredCount: agg.confirmedCount, decisive: agg.decisive, summary,
  };
}

export { DEFAULT_CONTEXT };
