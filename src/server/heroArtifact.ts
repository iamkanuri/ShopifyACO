// ===========================================================================
// THE LANDING PAGE'S REAL RESULT, DERIVED (v4.3 §2).
//
// The v4.3 landing page shows a result on a named, real store. The brief is blunt about
// why this file exists rather than a hand-written fixture: one of the two design concepts
// it was drawn from invented failing verdicts for Counter Culture — a real roaster — and
// a fabricated result about a real business is the class of false statement this project
// treats as unrecoverable. It is also the worst possible place for one, because a hero is
// the part of a page that travels.
//
// So every value here comes out of `runDemo()`: the same frozen capture of
// klatchcoffee.com, replayed through the REAL `runProductTest` with only the transport
// swapped, that `/demo` serves. Nothing is re-implemented, nothing is re-typed, and the
// selection gate on that fixture already guarantees the strongest property a proof
// surface can have — every row it PASSES was individually adjudicated `true_pass` in the
// v3.2 coffee audit against the store's full untruncated evidence.
//
// ⚠️ IT IS NOT AN ALL-PASS RUN, AND THE BRIEF EXPECTED IT TO BE. The prompt allowed for
// borrowing a refusal from another store "if visual balance wants failing states the
// all-pass Klatch run lacks". Executed rather than assumed, the run is 5 proven and 5 not
// proven out of 10. "All rows adjudicated true-pass" is a statement about the PASSES —
// that none of them is a false positive — not about the verdicts. So the page needs no
// borrowed failure and no schematic: the honest artifact is already mixed.
//
// WHAT IS DERIVED AND WHAT IS NOT. Counts, statuses, quotes, surfaces, entry ids, the
// standard's version and content hash, and the peer rates with their true denominators
// all come from artifacts. The only authored strings on these sections are the section
// prose in viewer/src/copy.ts, which the claim linter reads.
// ===========================================================================

import { runDemo } from "./buyerTestDemo.js";
import { peerRatesFor } from "./publicStandard.js";
import { currentOf } from "./standardsSite.js";
import { compileStandard } from "../../standards/compile.js";
import type { HeroArtifact, HeroArtifactRow } from "../../viewer/src/heroArtifact.js";
import { HERO_ARTIFACT_SCRIPT_ID } from "../../viewer/src/heroArtifact.js";
import type { ResultState } from "../../viewer/src/copy.js";

/** The engine's four statuses → the four glyph states. Exhaustive by construction: an
 *  unknown status must not silently render as a pass, so it falls to `unproven`, which is
 *  the conservative direction — a state we cannot name is not a state we may credit. */
function stateOf(status: string): ResultState {
  switch (status) {
    case "pass_evidenced": return "proven";
    case "pass_no_blocking": return "neutral";
    case "requires_store_access": return "requires-access";
    default: return "unproven";
  }
}

let cache: HeroArtifact | null = null;

/** Test seam — the demo module caches its run, and so does this. */
export function __resetHeroArtifact(): void { cache = null; }

/**
 * Build the landing page's artifact. Cheap after the first call (the demo run is itself
 * cached), $0, and reaches no network — the capture is bytes on disk.
 */
export async function heroArtifact(): Promise<HeroArtifact> {
  if (cache) return cache;
  const d = await runDemo();

  // The peer records, joined by ENTRY ID.
  //
  // ⚠️ NOT BY LABEL. v4.1's peer benchmark — the standard layer's whole differentiator —
  // rendered on 0 of 10 rows for a full release because both renderers joined a peer
  // record to its row on `label`, and `peerRatesFor` set that to the entry's QUESTION
  // while `compileStandard` labels the requirement with the BINDING's label. Different
  // strings for all ten coffee entries. Nothing threw and no test failed, because a join
  // that finds nothing looks exactly like a standard that has published no measurement.
  // Here both sides carry the entry id, so the join is on the identifier rather than on
  // a display string that either side is free to reword.
  const published = currentOf("coffee");
  const ids = d.rows.map((r) => r.entryId).filter((x): x is string => !!x);
  const labelById = new Map<string, string>();
  let peerByEntry = new Map<string, HeroArtifactRow["peer"]>();
  if (published) {
    const compiled = compileStandard(JSON.parse(published.rawJson));
    // `bindingToRequirement` sets `id` to the ENTRY id and `label` to the binding's
    // label — read from standards/compile.ts rather than guessed. A throwaway probe
    // written from the plausible field name (`standardEntryId`) built an EMPTY map and
    // still produced correct output here, because this join is on the entry id; the map
    // only feeds `requirementLabel`, which the two result renderers join on. Silent
    // either way, which is why the field is now read from the source.
    for (const req of compiled.requirements) {
      if (req.id) labelById.set(req.id, req.label);
    }
    peerByEntry = new Map(
      peerRatesFor(published, ids, labelById).map((p) => [
        p.entryId,
        { adjudicated: p.adjudicated, failed: p.failed, asked: p.asked, undecided: p.undecided },
      ]),
    );
  }

  const base = `/standards/coffee/${d.standard.publicVersion}`;
  const rows: HeroArtifactRow[] = d.rows.map((r) => {
    const accepted = r.acceptedEvidence.find((a) => a.example) ?? r.acceptedEvidence[0];
    return {
      entryId: r.entryId,
      entryUrl: r.entryId ? `${base}/${encodeURIComponent(r.entryId)}` : null,
      // The buyer's question is what a marketing surface should show; the engine's
      // internal label is machinery. Fall back rather than render an empty cell.
      question: r.question ?? r.label,
      status: r.status,
      state: stateOf(r.status),
      detail: r.detail,
      quote: r.quote,
      surface: r.evidenceSurface,
      surfaceUrl: r.evidenceUrl,
      peer: (r.entryId && peerByEntry.get(r.entryId)) || null,
      acceptedForm: accepted?.form ?? null,
      acceptedExample: accepted?.example ?? null,
    };
  });

  cache = {
    host: d.host,
    storeName: d.storeName,
    productName: d.productName,
    productUrl: d.productUrl,
    capturedAt: d.capturedAt,
    standard: {
      title: `AisleLens Coffee Standard v${d.standard.publicVersion}`,
      version: d.standard.publicVersion,
      hash: d.standardHash,
      url: base,
    },
    counts: d.counts,
    rows,
    demoUrl: "/demo",
  };
  return cache;
}

/**
 * The artifact as a <script type="application/json"> block for the document head/body.
 *
 * ⚠️ `</script>` INSIDE JSON ENDS THE SCRIPT ELEMENT, and every string here is
 * merchant-adjacent text from a real storefront. The escape below is the standard one and
 * it is not optional: a quote containing that sequence would terminate the block early,
 * leaving the rest of the payload as live markup in the document. `<!--` is escaped for
 * the same reason. The reader in viewer/src/heroArtifact.ts refuses a payload that does
 * not parse or that carries no rows, so a truncation degrades to "no hero artifact"
 * rather than to a plausible-looking partial one.
 */
export function heroArtifactScript(a: HeroArtifact): string {
  // ⚠️ THE TWO LINE-SEPARATOR CHARACTERS ARE WRITTEN AS \u ESCAPES, NEVER AS THEMSELVES.
  // U+2028 and U+2029 are invisible in an editor and survive a copy-paste as ordinary
  // whitespace, so a literal pair here is indistinguishable from a no-op replace that has
  // quietly stopped escaping the one thing it exists for. Same family as the `\b` that
  // reached this repo as a literal 0x08 byte and the `\s` a heredoc ate down to a plain
  // `s`. They are legal in JSON and illegal in a JavaScript string literal, which is what
  // a JSON block inside a document is parsed as by some readers.
  const json = JSON.stringify(a)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" id="${HERO_ARTIFACT_SCRIPT_ID}">${json}</script>`;
}
