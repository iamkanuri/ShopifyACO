// ===========================================================================
// The substitution frame — how a report LEADS. Instead of the abstract score ("18/100"), lead with
// WHERE the merchant stands in AI's recommendation decision, naming the rivals AI actually recommends.
//
// Built to the REAL data shape (validated on fresh scans): a single dominant villain is RARE;
// FRAGMENTATION is the norm — the merchant loses, but recommendations scatter across many rivals
// (each ~2-4 of N). So the DEFAULT is the "rotating cast" frame, and the single-rival headline only
// fires when one rival genuinely dominates the recommendation share. Every count here is a
// RECOMMENDATION count (recommendation-verified against raw answers via the nameable-rivals gate),
// never a mention count. The score is demoted to PROOF, never a fabricated villain.
//
// Pure + deterministic. The named rivals must be pre-verified (nameableRivals): a rival is only
// eligible here if AI genuinely recommended it.
//
// SEVERITY-SELECTED PRESENTATION (losing_fragmented only). The both-ways A/B test resolved a real
// asymmetry: at the extreme (0 of N) the stark NUMBER punches alone and prose dilutes it; at a typical
// mid-fragmented loss (2 of N scattered) the bare number SHRUGS ("recommended sometimes" reads fine) and
// only the consideration-set-absence reframe lands. So HOW the fragmented case leads is severity-selected:
// a BRUTAL loss leads with the number; a MILD one leads with the reframe; a middle STARK band blends them
// so we degrade gracefully instead of snapping. Crucially, "brutal" is SAMPLE-GATED — a stark "AI never
// picks you" is only fired when the zero is BOTH extreme AND well-sampled enough to carry the claim
// (0 of 6 is thin evidence, not a verdict). We gate on the Wilson upper bound of the merchant's own rate.
// ===========================================================================

import { proportion } from "../benchmarks/stats.js";

export type FrameBucket =
  | "losing_fragmented" // COMMON: passed over, recommendations scattered — the default
  | "losing_dominant"   // RARE: one rival genuinely dominates the recommendation share
  | "even"              // contested: merchant ≈ top rival
  | "winning"           // merchant recommended more than any rival
  | "discovered_threat" // beats configured rivals, but an UNLISTED brand out-recommends
  | "nobody";           // no brand is confidently recommended — the slot is open

export interface FrameRival { name: string; recCount: number; source: "configured" | "discovered" }

/** How the fragmented/losing case LEADS (a rendering hint; set only for losing_fragmented):
 *  brutal = number-led, spare — the stark count is the punch;
 *  stark  = number-prominent but reframed — the middle band (near-zero or a zero too thin for "never");
 *  mild   = reframe-led — the bare number shrugs, so the consideration-set-absence language leads. */
export type FrameSeverity = "brutal" | "stark" | "mild";

export interface SubstitutionFrame {
  bucket: FrameBucket;
  headline: string;   // the LEAD
  subline: string;    // the honest count breakdown supporting it
  scoreProof: string; // the score, DEMOTED to proof
  namedRivals: FrameRival[]; // exactly the rivals named in the headline (real names, real rec counts)
  severity?: FrameSeverity;  // set only for losing_fragmented — see FrameSeverity
}

export interface FrameInput {
  brand: string;
  category: string;
  merchantRec: { count: number; total: number }; // RECOMMENDATION count / grounded answers
  nameableRivals: FrameRival[];                    // recommendation-verified rivals (any order)
  score?: number | null;
}

const plural = (n: number) => (n === 1 ? "" : "s");
const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

export function selectSubstitutionFrame(input: FrameInput): SubstitutionFrame {
  const { brand, category, merchantRec } = input;
  const own = merchantRec.count;
  const N = Math.max(1, merchantRec.total);
  const rivals = [...input.nameableRivals].filter((r) => r.recCount > 0).sort((a, b) => b.recCount - a.recCount);
  const top = rivals[0];
  const second = rivals[1];
  const topRec = top?.recCount ?? 0;
  const secondRec = second?.recCount ?? 0;
  const topConfigured = rivals.find((r) => r.source === "configured")?.recCount ?? 0;

  const scoreProof =
    input.score != null
      ? `Your AI Visibility Score of ${input.score}/100 is the summary of this: ${own} of ${N} answers recommend ${brand}.`
      : `${own} of ${N} answers recommend ${brand}.`;

  const mk = (bucket: FrameBucket, headline: string, subline: string, named: FrameRival[], severity?: FrameSeverity): SubstitutionFrame =>
    ({ bucket, headline, subline, scoreProof, namedRivals: named, severity });

  // NOBODY — AI genuinely names no confident pick: NO brand (merchant or rival) is recommended more
  // than once. A category where several rivals each win 2-3 answers is NOT "nobody" — brands ARE being
  // recommended, just scattered → that's FRAGMENTED (below), and must not be mislabeled "no picks".
  if (topRec <= 1 && own <= 1) {
    return mk(
      "nobody",
      `AI can't confidently recommend anyone in ${category} yet — no brand is named in more than one answer, and the slot is wide open.`,
      `Across ${N} shopper questions, no brand — ${brand} included (${own}) — earned more than a single recommendation. This is a category with no default: it's there for the taking.`,
      rivals.slice(0, 3),
    );
  }

  // WINNING — a CLEAR #1 (a real margin, not a 1-point nose ahead of a crowded field). A narrow lead
  // falls through to "contested" below, so we never say "you own it" when a rival is one answer behind.
  if (own > topRec && own - topRec >= 2) {
    const chasers = rivals.slice(0, 3);
    return mk(
      "winning",
      `${brand} owns the AI recommendation in ${category} — recommended in ${own} of ${N} answers, more than any rival.`,
      chasers.length
        ? `Watch your position: ${list(chasers.map((r) => `${r.name} (${r.recCount})`))} are the rivals AI recommends next.`
        : `No rival was recommended more than once in this scan. Defend it.`,
      chasers,
    );
  }

  // DISCOVERED THREAT — a rival you never listed out-recommends you, WHILE you're genuinely doing well
  // vs the ones you watch (recommended ≥20% and ≥ every configured rival). Not just "losing, and the top
  // rival happens to be unlisted" — that's plain losing (below), so this must require real standing.
  if (top && top.source === "discovered" && topRec > own && own >= topConfigured && own / N >= 0.2) {
    return mk(
      "discovered_threat",
      `${brand} beats every competitor you're watching — but ${top.name}, a brand you didn't list, is the one AI actually recommends in ${category}.`,
      `AI recommended ${top.name} in ${topRec} of ${N} answers vs ${brand}'s ${own}. It's the rival hiding outside your radar.`,
      [top],
    );
  }

  // CONTESTED / EVEN — merchant within 1 of the top rival, both genuinely recommended. Two shapes:
  //  • a DUEL (the top rival is clearly ahead of the rest) → "you and X are the two names AI trusts";
  //  • a CLUSTER (rivals bunched near the top) → "a crowded field, no clear leader" — honest for a
  //    narrow lead like ARMRA 6 vs Elm & Rye 5 vs Bulk 4, which is NOT "owning" the category.
  const contestedFloor = Math.max(3, Math.ceil(0.15 * N));
  if (top && Math.abs(own - topRec) <= 1 && Math.min(own, topRec) >= contestedFloor) {
    const duel = secondRec <= Math.max(1, topRec / 2);
    if (duel) {
      return mk(
        "even",
        `${brand} and ${top.name} are the two names AI trusts in ${category}.`,
        `AI recommended ${brand} ${own} times and ${top.name} ${topRec} across ${N} — neck and neck, well ahead of the rest. Here's how to pull ahead.`,
        [top],
      );
    }
    const named = rivals.slice(0, 3);
    const lead = own >= topRec ? `${brand} narrowly leads` : `${brand} is right in the mix in`;
    return mk(
      "even",
      `${category} is a crowded field with no clear leader — ${lead} it, but only just.`,
      `AI's picks cluster near the top: ${brand} ${own}, ${named.map((r) => `${r.name} ${r.recCount}`).join(", ")}${rivals.length > 3 ? ", …" : ""} across ${N} answers. No one owns this category — the top spot is winnable.`,
      named,
    );
  }

  // LOSING — dominant (rare) vs fragmented (default).
  const dominant = top != null && topRec >= 2 * secondRec && topRec / N >= 0.3;
  if (dominant && top) {
    return mk(
      "losing_dominant",
      `When shoppers ask AI about ${category}, it recommends ${top.name} by name${own === 0 ? ` — and never ${brand}` : ` — ${brand} comes up just ${own} time${plural(own)} in ${N}`}.`,
      `AI recommended ${top.name} in ${topRec} of ${N} answers${own > 0 ? ` vs ${brand}'s ${own}` : ` — ${brand} in 0`}. It's the clear default here.`,
      [top],
    );
  }

  // LOSING — FRAGMENTED. The honest emotional truth is CONSIDERATION-SET ABSENCE: AI names many brands
  // and never you → you're not even a candidate (worse than losing to ONE rival, which at least puts you
  // in the conversation). Instantiated with the scan's REAL names + counts, never a generic dramatic line.
  // Then the ACTION-FRAME — but only when the field is genuinely OPEN (no brand dominant): "no default →
  // the slot is open, the category is winnable" turns a diffuse loss into a concrete opportunity. When a
  // few names are ENTRENCHED (a leader holds ≥1/3), we name them honestly and do NOT claim an open slot.
  const named = rivals.slice(0, 3);
  const rivalCount = rivals.length;
  const breakdown = rivals.slice(0, 4).map((r) => `${r.name} ${r.recCount}`).join(", ") + (rivalCount > 4 ? ", …" : "");
  const open = topRec / N < 0.35; // no brand recommended in more than ~1/3 of answers → no default → open
  const topNames = `${list(named.map((r) => r.name))}${rivalCount > 3 ? ", and more" : ""}`;
  const leaders = list(named.slice(0, 2).map((r) => `${r.name} (${r.recCount})`));

  // SEVERITY SELECTION. `hi` = the Wilson 95% UPPER bound on the merchant's own recommendation rate:
  // observing `own` in `N`, we're ~95% confident the true rate is at most `hi`. It tightens as the sample
  // grows (0/24→0.14, 0/15→0.20, 0/6→0.39), so ONE number carries BOTH how extreme the loss is AND whether
  // the sample can back a "never" claim. That is the honest gate for the brutal number-led headline.
  const hi = proportion(own, N).ciHigh;
  const rate = own / N;
  const BRUTAL_CEILING = 0.22; // "AI never picks you" only when the honest ceiling is this tight — implies
  //                              N≈14+ for a zero, so 0/15 & 0/24 qualify but 0/6 (hi 0.39) does NOT.
  const MILD_RATE_FLOOR = 0.07; // at/above ~1-in-14 the bare number reads as "sometimes" → the reframe leads;
  //                               below it the loss is near-total and the count still carries the headline.

  // The reframe body — shared by the stark (blended) and mild bands. Open field → the "slot is open"
  // action-frame; entrenched field → name the leaders honestly, no false open-slot claim.
  const reframe = open
    ? `No brand owns ${category} in AI's answers yet — the picks scatter across ${rivalCount} names (${breakdown}), none recommended in more than ${topRec} of ${N}. There's no default here, which means the slot is open: this category goes to whoever AI learns to name — and it could be ${brand}.`
    : `AI keeps returning to the same names — ${leaders} lead ${category} — while ${brand} sits outside that set (${own} of ${N}). Getting into AI's answers here means displacing entrenched names.`;

  // BRUTAL — a well-sampled shutout. The stark number IS the punch; keep the prose minimal so it lands.
  if (own === 0 && hi <= BRUTAL_CEILING) {
    return mk(
      "losing_fragmented",
      `AI never recommends ${brand} when shoppers ask about ${category} — 0 of ${N} answers.`,
      open
        ? `It points them to ${topNames} instead — and no single brand owns ${category} yet, so the slot is there to take.`
        : `It points them to ${topNames} instead; ${leaders} own that slot today.`,
      named,
      "brutal",
    );
  }

  // STARK (the graceful middle) — number-prominent, then handed straight to the reframe. Two triggers:
  //  • a THIN zero (own 0 but hi > ceiling) — honest "didn't come up", NEVER the overclaiming "never";
  //  • a near-total positive (own ≥ 1, rate < floor) — "just 1 of N", the owner-flagged ambiguous 1/N case.
  if (own === 0 || rate < MILD_RATE_FLOOR) {
    const lead =
      own === 0
        ? `In the ${N} answers we checked, AI didn't recommend ${brand} in ${category} once — a thin sample, but not a good sign.`
        : `AI recommends ${brand} in just ${own} of ${N} answers about ${category} — you're barely a candidate.`;
    return mk("losing_fragmented", lead, reframe, named, "stark");
  }

  // MILD — the bare number shrugs ("recommended sometimes" reads fine), so the CONSIDERATION-SET-ABSENCE
  // reframe leads and the number rides inside it. Validated on OUAI (2/24 = 8%): the language does the
  // work the count can't. (own ≥ 2 always here — 0 and near-zero were handled above.)
  const headline = `AI recommends ${rivalCount} different brands in ${category} — ${topNames} — but names ${brand} in just ${own} of ${N}. You're barely in the running.`;
  return mk("losing_fragmented", headline, reframe, named, "mild");
}
