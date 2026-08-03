import { htmlToText } from "../crawler/sanitize.js";

// ===========================================================================
// v4.5 — A STORE'S OWN STRING IS TEXT, AND MUST BE RENDERED AS TEXT.
//
// `esc()` in the result renderers already prevents injection: a `<p>` in a merchant's
// copy is escaped and cannot execute. What it does NOT do is stop that `<p>` being
// DISPLAYED. Measured over the 94 stored production results (experiments/v4-5/html_leak.mjs):
//
//   magicspoon.com    assertions[1].evidenceQuote ends `…keto-friendly magic!</p>`
//                     assertions[5].evidenceQuote begins `<p>We process most orders…`
//   greatjonesgoods   `task` and `productName` read `Big Deal &amp; Saucy` — on two
//                     separate permanent results
//
// Three tokens, two stores. These are the pages an agency forwards to a client, and the
// evidence quote is the one thing on them that claims to be the store's own sentence. A
// literal `</p>` inside quotation marks says we did not read the page carefully.
//
// ⚠️ WHY THE RENDERER AND NOT THE EXTRACTOR. Results are APPEND-ONLY: the three affected
// rows are already stored and `/result/:token` never re-runs, so fixing extraction would
// leave those three permanently wrong. Sanitizing where the string is printed repairs the
// stored rows and every future one at once, without editing a single stored byte. Same
// reasoning as the v4.4 render-time notice, applied to a smaller problem.
//
// ⚠️ `htmlToText` IS REUSED, NOT REIMPLEMENTED. It already strips tags and decodes the
// entity set these leaks are made of, and it is the same function the extractor runs over
// `body_html` — so the quote a merchant sees and the text the matcher matched are
// normalised by ONE implementation. A second one would drift, which is the mistake this
// repo documents in four places.
// ===========================================================================

/**
 * A merchant-supplied string, as it should APPEAR. Tags stripped, entities decoded,
 * whitespace collapsed. Call this before `esc()`, never instead of it — `esc()` is the
 * injection boundary and this is a legibility pass.
 *
 * Returns the input unchanged when there is nothing to normalise, so the overwhelming
 * majority of quotes are byte-identical before and after.
 */
export function displayText(s: string | null | undefined): string {
  if (typeof s !== "string" || s === "") return "";
  // Cheap guard: only pay for the rewrite when the string can actually contain markup.
  if (!/[<&]/.test(s)) return s;
  const out = htmlToText(s);
  // ⚠️ FAIL OPEN, NOT CLOSED. If stripping consumed everything — a quote that was ONLY
  // markup — return the original rather than an empty string. A blank quote renders as a
  // row with no evidence, which is indistinguishable from a row that never had any, and
  // this repo has now recorded five defects of exactly that shape. Better a visible `<p>`
  // than a silently empty receipt.
  return out === "" ? s : out;
}
