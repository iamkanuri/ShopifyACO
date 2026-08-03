import type { StoredResultRow } from "../db/buyerTests.js";

// ===========================================================================
// v4.4 — THE DISCLOSURE ON A PERMANENT RESULT THAT AN INFERENCE TIER TOUCHED.
//
// `/result/:token` is append-only and never re-runs: that is the whole proposition,
// and it is also why a wrong row here is worse than a wrong row anywhere else. It
// cannot be corrected by re-running, only by SAYING SO on the page.
//
// v4.4 measured production and found four stored results whose verdict was moved by
// the bounded semantic tier (`semanticTier.ts`). Three of them publish a pass that the
// quoted sentence does not support, about a named third-party store, at a permanent
// citable URL — one of them inside a standard-layer result citing Coffee Standard v1.3.
//
// ⚠️ THE REMEDIATION IS A RENDER-TIME NOTICE, NEVER A BYTE EDIT. Results are
// append-only. Editing the stored blob to remove the row would destroy the record of
// what we published, which is the thing a citation resolves through, and would make the
// correction itself unauditable. Deleting the row would break a link already sent.
// Both silent options are prohibited: THE REMEDIATION IS THE DISCLOSURE.
//
// ⚠️ TWO LAYERS, BECAUSE THE BLOB CANNOT NAME THE ROW.
//   • DETECTION is DERIVED from the stored result (`semantic.granted > 0`). It cannot
//     go stale and cannot miss a row, including a row minted after this file was
//     written — which matters, because a curated list silently misses whatever it does
//     not know about, and that is the failure this repo keeps recording.
//   • ATTRIBUTION is CURATED, because `SemanticStats` records only a COUNT. Which row
//     moved was established mechanically per token (`experiments/v4-4/attribute_grants.ts`:
//     the claim-kind filter, which is exact because `applySemanticTier` can only ever
//     promote a `kind === "claim"` requirement, cross-checked against a tier-off replay
//     of the captured bytes) and each grant was then adjudicated individually against
//     the store's full untruncated evidence (`experiments/v4-4/adjudicate_stored.ts`).
//
// A detected result with no curated entry still gets a notice — it just says what the
// blob supports and no more. Claiming to name a row we have not adjudicated would be
// the same error one level up.
// ===========================================================================

/** What the stored blob records about the tier. Read at BOTH shapes: a standard-layer
 *  row stores the whole `StandardRunResult`, a general row the bare `ProductTestResult`. */
export interface StoredSemanticStats {
  called: boolean;
  granted: number;
  vetoed: number;
  discarded: number;
  costUsd: number;
}

export function semanticStatsIn(row: Pick<StoredResultRow, "result">): StoredSemanticStats | null {
  const blob = row.result as Record<string, unknown> | undefined;
  if (!blob || typeof blob !== "object") return null;
  const nested = blob.result as Record<string, unknown> | undefined;
  const s = (blob.semantic ?? (nested && typeof nested === "object" ? nested.semantic : undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!s || typeof s !== "object") return null;
  return {
    called: s.called === true,
    granted: Number(s.granted ?? 0),
    vetoed: Number(s.vetoed ?? 0),
    discarded: Number(s.discarded ?? 0),
    costUsd: Number(s.costUsd ?? 0),
  };
}

/** How the adjudication came out for one promoted row. */
export type GrantVerdict = "false_pass" | "stands";

export interface AttributedGrant {
  /** The assertion label as it is stamped on the stored result — the join key. */
  label: string;
  verdict: GrantVerdict;
  /** Why, in the merchant's terms. Rendered verbatim; keep it a statement, not a hedge. */
  why: string;
}

/**
 * The four production rows, named. Every entry here is the output of an adjudication
 * that is recorded in `experiments/v4-4/`, not a judgement made at render time.
 *
 * ⚠️ `label` MUST match the stored assertion's label byte-for-byte. A join that finds
 * nothing renders nothing, and nothing looks exactly like a result with no notice —
 * the `grounding.sources` shape, four releases running. `test/resultNotices.test.ts`
 * asserts every label here resolves against the fixture of the row it describes.
 */
export const TIER_GRANT_ATTRIBUTIONS: Record<string, AttributedGrant[]> = {
  // klatchcoffee.com — general layer, two results minted 96 seconds apart.
  t_15802547df13b8daf273: [{
    label: "Single-origin",
    verdict: "false_pass",
    why: "The sentence quoted for this row names the product and describes its flavour and its processing method. It does not say the coffee comes from one place rather than being a blend, which is what this row asks. A product named after a growing region is not a statement that the product is single-origin.",
  }],
  t_91db6f4c309fcf6734c9: [{
    label: "Single-origin",
    verdict: "false_pass",
    why: "The sentence quoted for this row names the product and describes its flavour and its processing method. It does not say the coffee comes from one place rather than being a blend, which is what this row asks. A product named after a growing region is not a statement that the product is single-origin.",
  }],
  // klatchcoffee.com — STANDARD layer. The same defect inside a citable, content-hashed
  // conformance result, which is the most load-bearing artifact this product makes.
  t_0db9852c7e19461c49f8: [{
    label: "A single-origin claim is stated in readable text",
    verdict: "false_pass",
    why: "The sentence quoted for this row names the product and describes its flavour and its processing method. It does not state a single-origin claim in readable text, which is what this entry asks. A product named after a growing region is not a statement that the product is single-origin.",
  }],
  // magicspoon.com — adjudicated and it STANDS. Recorded anyway, because a notice that
  // appeared only on the wrong rows would let a reader infer the verdict from the
  // presence of the notice, and because the row was reached by inference either way.
  t_5996b5618d2d5f9988eb: [{
    label: "Gluten-free",
    verdict: "stands",
    why: "This row was reached by inference rather than by matching text, and it was re-read against the store's full page: the page states the product line is certified gluten free, so the verdict holds. The sentence the engine chose to quote is a cross-sell line rather than the certification sentence a few paragraphs further down, which is a weaker receipt than the page actually offers.",
  }],
};

export interface ResultNotice {
  /** True when at least one row on this page was promoted by the tier. */
  affected: AttributedGrant[];
  /** Rows we know exist but cannot name — `granted` exceeds the curated attributions. */
  unnamed: number;
  stats: StoredSemanticStats;
}

/**
 * The notice for a stored row, or null when the tier granted nothing on it.
 *
 * ⚠️ DETECTION IS ON `granted > 0`, NOT ON MEMBERSHIP OF THE CURATED MAP. A result
 * minted before this file existed, or minted later by a path that still runs the tier,
 * is still disclosed — it just reports an unnamed row instead of a named one.
 */
export function resultNotice(row: Pick<StoredResultRow, "token" | "result">): ResultNotice | null {
  const stats = semanticStatsIn(row);
  if (!stats || stats.granted <= 0) return null;
  const affected = TIER_GRANT_ATTRIBUTIONS[row.token] ?? [];
  return { affected, unnamed: Math.max(0, stats.granted - affected.length), stats };
}

/** The per-row verdict, for a renderer walking assertions. */
export function grantForRow(
  row: Pick<StoredResultRow, "token" | "result">,
  label: string,
): AttributedGrant | null {
  const n = resultNotice(row);
  if (!n) return null;
  return n.affected.find((g) => g.label === label) ?? null;
}

/** Plain-text lines for the one-pager and any non-HTML surface. Single source of wording. */
export function noticeLines(n: ResultNotice): { headline: string; body: string[] } {
  const wrong = n.affected.filter((g) => g.verdict === "false_pass");
  const headline = wrong.length
    ? `Correction: ${wrong.length} row on this result did not meet the evidence bar`
    : "Notice: a row on this result was reached by inference";
  const body = [
    "This result was produced under a configuration that included an inference tier, since removed from this path. That tier could promote a requirement to “proven” by reading a sentence rather than by matching the store's own words, and it made a different judgement on different runs of the same page.",
    "The result itself has not been edited. Results here are append-only, so what we published stays readable exactly as it was published, and this notice sits beside it.",
  ];
  for (const g of n.affected) {
    body.push(
      g.verdict === "false_pass"
        ? `“${g.label}” — this row's pass does not meet the evidence bar. ${g.why}`
        : `“${g.label}” — reviewed, and the verdict stands. ${g.why}`,
    );
  }
  if (n.unnamed > 0) {
    body.push(
      `${n.unnamed} further row on this result was promoted by that tier. The stored result records that it happened but not which row, and naming one we have not adjudicated would be a guess presented as a finding.`,
    );
  }
  return { headline, body };
}
