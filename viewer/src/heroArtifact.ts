// ===========================================================================
// THE LANDING PAGE'S REAL RESULT — the shape, and the one way to read it.
//
// ⚠️ WHY THIS FILE EXISTS AT ALL, AND WHY IT IS UNDER viewer/src/.
//
// §2 of the v4.3 brief is absolute about one thing: every figure on the landing page is
// derived from an artifact and never hand-typed, and the hero shows the REAL pinned
// Klatch run rather than invented verdicts about a named business. The artifact lives
// behind `runDemo()` in src/server/buyerTestDemo.ts.
//
// The viewer bundle imports NOTHING from `src/`. That is the secrets boundary — it is
// what keeps the service-role key and the provider keys out of the client, and it is
// verified by grepping viewer/dist. So the landing page cannot reach the artifact, and
// the two options that remain are both wrong on their own:
//
//   • retype the numbers here → exactly the hand-typed figure §2.3 forbids, and the
//     class of defect that put "162 requirements … ten of those passes were wrong" on
//     the live site against an artifact reading 160 and 7;
//   • fetch it after mount → React wipes the server snapshot when it mounts, so the
//     hero would flash empty on every load, and a reader with no JavaScript would get
//     nothing at all on the one section that carries the proof.
//
// So the SERVER derives it (src/server/heroArtifact.ts), renders it into the JS-off
// snapshot, AND serialises it into the document as JSON that React reads synchronously
// on first render. One derivation, two renderers, no duplication — the same arrangement
// as viewer/src/copy.ts (imported by src/server/publicSsr.ts) and viewer/src/peerSentence.ts
// (imported by both result renderers). The direction is fixed: shared things live on the
// viewer side and the server imports them, never the reverse.
//
// This file is pure types plus one DOM read. No React, no imports — so the server pays
// nothing to pull it in.
// ===========================================================================

import type { ResultState } from "./copy";

/** The id of the <script type="application/json"> the server writes into the document. */
export const HERO_ARTIFACT_SCRIPT_ID = "al-hero-artifact";

/** One executed requirement, flattened to what a marketing surface may show. */
export interface HeroArtifactRow {
  /** The published entry this row executes — the citation. */
  entryId: string | null;
  /** Where that entry is readable. Null when the label could not be traced back, which
   *  the page states rather than hiding. */
  entryUrl: string | null;
  /** The BUYER's question from the standard, not the engine's internal label. */
  question: string;
  /** The engine's own status vocabulary, carried verbatim. */
  status: string;
  /** The glyph key. Colour never carries a state alone. */
  state: ResultState;
  detail: string;
  /** The store's own sentence. Null for rows a quote cannot settle (an option list) and
   *  for rows with nothing to quote — the two are distinguished by `status`. */
  quote: string | null;
  surface: string | null;
  surfaceUrl: string | null;
  /**
   * How the measured sample did on this same question.
   *
   * ⚠️ NEVER "of 100". Five of the ten measured coffee entries were asked of fewer than
   * 100 products and one could only be DECIDED on 74 of the 100 it was asked. The
   * denominator travels with the number, and `peerSentence()` is the one place that
   * turns these four fields into a sentence.
   */
  peer: { adjudicated: number; failed: number; asked: number; undecided: number } | null;
  /** What the STANDARD publishes as satisfying evidence for this entry — its own example
   *  string, used for the illustrative half of the before/after. Never authored here. */
  acceptedForm: string | null;
  acceptedExample: string | null;
}

export interface HeroArtifact {
  host: string;
  storeName: string | null;
  productName: string | null;
  productUrl: string;
  capturedAt: string;
  standard: { title: string; version: string; hash: string; url: string };
  counts: { pass: number; notProven: number; requiresAccess: number; total: number };
  rows: HeroArtifactRow[];
  /** Where the complete result lives. */
  demoUrl: string;
}

/**
 * Read the artifact the server serialised into this document.
 *
 * Returns null when it is absent — a dev server with no SSR, or a shell that failed to
 * render it. Every caller must handle null by rendering NOTHING rather than a
 * placeholder: a hero that invents a plausible-looking result when the real one is
 * missing is the exact failure this whole arrangement exists to prevent, and it would
 * look completely normal.
 */
export function readHeroArtifact(): HeroArtifact | null {
  // ⚠️ THE DOM IS REACHED THROUGH `globalThis`, NOT THROUGH THE GLOBAL `document`.
  // This module is imported by src/server/heroArtifact.ts, and the ROOT tsconfig — the
  // server one — does not include the `dom` lib. A bare `document` here is a typecheck
  // error in `npm run typecheck` even though it is perfectly valid in the viewer's own
  // build, which is exactly the kind of split that makes a shared module stop being
  // shareable. viewer/src/peerSentence.ts states the same constraint for the same reason:
  // anything both sides import has to be pure data-in/data-out with no ambient
  // environment. The narrow structural type below is all this function needs.
  const g = globalThis as {
    document?: { getElementById(id: string): { textContent: string | null } | null };
  };
  const el = g.document?.getElementById(HERO_ARTIFACT_SCRIPT_ID);
  if (!el?.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as HeroArtifact;
    // A truncated or half-rendered payload parses fine and then renders a hero with no
    // rows, which reads as "this store passed everything". Refuse it instead.
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    if (!parsed.standard?.hash || !parsed.counts) return null;
    return parsed;
  } catch {
    return null;
  }
}
