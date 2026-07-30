// ===========================================================================
// THE PEER SENTENCE — ONE IMPLEMENTATION, TWO RENDERERS (v4.2 CP-1).
//
// This lived inside `viewer/src/pages/ProductTestPage.tsx`. v4.2 added a second renderer
// (the permanent result page, server-side) that has to say the same thing, and a second
// hand-written copy of a rule this careful is the "site disagrees with itself" defect the
// repo has already paid for three times — most recently as the one-word `pass`/`proven`
// drift between two of our own pages.
//
// ⚠️ IT LIVES UNDER viewer/src/, NOT src/. The direction is fixed: the viewer bundle
// imports NOTHING from src/ (that is the secrets boundary, verified by grepping
// viewer/dist), so anything shared has to sit on the viewer side and be imported by the
// server — exactly as `viewer/src/copy.ts` already is by `src/server/publicSsr.ts`.
// This file is pure data-in/string-out with no React and no imports, so it costs the
// server nothing to pull in.
// ===========================================================================

/** Structural — both sides have their own nominal `PeerRate`; only these fields matter. */
export interface PeerRateLike {
  /** Rows the measured sample could actually DECIDE. NOT always 100. */
  adjudicated: number;
  /** How many of those the sample's stores failed. */
  failed: number;
  /** Rows the entry was ASKED of, including ones nothing could decide. */
  asked: number;
  /** `asked - adjudicated`. Non-zero means the denominator must be named explicitly. */
  undecided: number;
}

/**
 * ⚠️ NEVER "of 100". Five of the ten measured coffee entries were asked of fewer than 100
 * products, each for a recorded reason (24 products publish no Product schema, so
 * IDENT-001 was asked of 76; one is pre-portioned, so the FORMAT and GRIND entries were
 * asked of 99) — and one, the delivery entry, could only be DECIDED on 74 of the 100 it
 * was asked, because 26 returned "requires store access".
 *
 * Counting an undecided row as a pass is a DIFFERENT MEASUREMENT, and this repo has
 * published both by accident: v1.1 stated 45% for DELIV-001, which is 45/100, where the
 * adjudicated reading is 45/74 = 60.8% — 15.8 points higher, with no denominator stated
 * so a reader could not tell which had been taken. So the sentence names the denominator
 * it actually used, every time.
 */
export function peerSentence(p: PeerRateLike, storePassed: boolean): string {
  const base = p.undecided > 0
    ? `${p.failed} of the ${p.adjudicated} coffee stores we could decide (of ${p.asked} asked)`
    : `${p.failed} of ${p.adjudicated} coffee stores`;
  return storePassed
    ? `${base} don't state this. This one does.`
    : `${base} don't state this either.`;
}
