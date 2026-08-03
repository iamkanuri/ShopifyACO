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

// ===========================================================================
// v4.5 — THE SECOND DISCLOSURE: A PRICE ROW THAT STATED A FALSE NUMBER.
//
// A mechanical sweep of all 94 stored results (experiments/v4-5/price_sweep.mjs +
// price_sweep_currency.ts, both with two-sided canaries, 88 of 94 rows exercising the
// price path so the zeros are proven on real data) found FIVE permanent results carrying
// a price statement that was false when it was published:
//
//   tenthousand.cc    1 result   "Lowest readable price is $0.00." — pass_evidenced,
//                                on a real garment with 18 GS1 barcodes and a masked
//                                price. ENGINE_GAPS P-19, open until v4.5.
//   gardenerskit.com  4 results  "Lowest readable price is $75.00." — the product is
//                                C$75.00. Established rather than assumed: the store
//                                declares CAD in both signals and the numeral is
//                                UNCHANGED, which rules out a USD->CAD switch, because
//                                Shopify re-prices on a currency change and would not
//                                land on the identical 75.00. v3.8's non-USD refusal
//                                shipped two days after these were minted.
//
// ⚠️ THE WORDING DIFFERS FROM THE TIER CASE ABOVE, AND THE DIFFERENCE IS THE POINT.
// A tier grant cannot be corrected by re-running: the tier is gone, and what it inferred
// was never in the page. A PRICE defect can — the engine now refuses both of these, which
// was verified by executing the current engine against the same captured bytes:
// tenthousand generates no price row at all, and gardenerskit answers "Your store
// publishes prices in CAD … we can't answer it from your public data." So this notice
// says a re-run gives the right answer, and links one. Promising that without checking
// would be the same class of error as the row it corrects.
//
// ⚠️ TWO LAYERS AGAIN, BUT SPLIT DIFFERENTLY, AND THE ASYMMETRY IS DELIBERATE.
//   • The `$0.00` case is DERIVED from the blob — the rendered sentence is right there —
//     so a result minted before this file existed is still disclosed, and one minted
//     later would be too.
//   • The CURRENCY case CANNOT be derived: `public_tests` stores no `declaredCurrency`,
//     and the store's bytes today are evidence about the store, not proof about the
//     moment we rendered. So it is CURATED, from an adjudication recorded per token.
//     That means a result whose store publishes a non-USD price and which is not listed
//     here would NOT be disclosed. Stated plainly rather than left for a reader to infer,
//     because the tier disclosure above derives its detection and someone comparing the
//     two would reasonably assume this one does too.
// ===========================================================================

/** A stored result whose price row was wrong when it was published. */
export interface PriceCorrection {
  /** The stored assertion's label, byte-for-byte — the join key. */
  label: string;
  /** What the page says, quoted so the notice can name it without the reader hunting. */
  stated: string;
  /** Why it was wrong, in the merchant's terms. Rendered verbatim. */
  why: string;
  /** What the engine answers now, verified by execution against the same bytes. */
  nowAnswers: string;
}

export const PRICE_CORRECTIONS: Record<string, PriceCorrection[]> = {
  // tenthousand.cc — ENGINE_GAPS P-19, the `$0.00` class.
  t_dcd9b617cfa726661c11: [{
    label: "Price under $10",
    stated: "Lowest readable price is $0.00.",
    why: "The only price readable on this product page was zero, and the test treated that as a price and passed the row. A published zero on a Shopify storefront is usually a withheld or masked price rather than a free product — this one is a real garment carrying 18 GS1 barcodes — and it is never evidence that the product costs less than ten dollars.",
    nowAnswers: "The test no longer reads a zero as a price, so this row is not asked at all rather than answered wrongly.",
  }],
  // gardenerskit.com — a CAD store told its price in dollars, on four separate results.
  ...Object.fromEntries(
    ["t_1541c69ee3dc3da92381", "t_00f25444221b0aca7a92", "t_e3923f5071c749a8b6e1", "t_9d29260b05ebf35ac1c1"]
      .map((t) => [t, [{
        label: "Price under $80",
        stated: "Lowest readable price is $75.00.",
        why: "This store publishes its prices in Canadian dollars, and the test compared that number against a US-dollar cap without reading the currency. The figure on this page is the right numeral with the wrong unit: the product is C$75.00, not $75.00. The verdict happened to hold — C$75 is under US$80 — but for a reason nothing here established.",
        nowAnswers: "The test now reads the currency the store declares and refuses to answer a US-dollar question about a Canadian-dollar price, rather than converting one it never measured.",
      }]]),
  ),
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

/**
 * The price corrections for a stored row, or [] when there are none.
 *
 * ⚠️ DERIVED **OR** CURATED, and it must be both. A `$0.00` still rendered anywhere in the
 * stored blob is detected from the blob, so a row this file has never heard of is still
 * disclosed. The currency case cannot be detected that way — nothing in the blob records
 * what currency the store declared — so it is curated. `derivedOnly` is reported so a
 * caller can tell the two apart rather than presenting a guess as an adjudication.
 */
export function priceCorrections(row: Pick<StoredResultRow, "token" | "result">): { entries: PriceCorrection[]; derivedUnnamed: number } {
  const curated = PRICE_CORRECTIONS[row.token] ?? [];
  const blob = row.result as Record<string, unknown> | undefined;
  const nested = blob?.result && typeof blob.result === "object" ? (blob.result as Record<string, unknown>) : null;
  const rows = [
    ...((blob?.assertions ?? nested?.assertions ?? []) as Array<{ label?: string; detail?: string }>),
    ...((blob?.deferred ?? nested?.deferred ?? []) as Array<{ label?: string; detail?: string }>),
  ];
  // A rendered zero this file does not already name.
  const zeroRows = rows.filter((a) => typeof a.detail === "string" && /Lowest readable price is \$0\.00/.test(a.detail));
  const unnamed = zeroRows.filter((a) => !curated.some((c) => c.label === a.label)).length;
  return { entries: curated, derivedUnnamed: unnamed };
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

/**
 * Plain-text lines for the PRICE correction. Separate from `noticeLines` on purpose:
 * these two disclosures say different things and one of them offers a remedy the other
 * cannot. Collapsing them into one paragraph would make the tier notice imply a re-run
 * fixes it, which is exactly what it does not.
 */
export function priceNoticeLines(c: { entries: PriceCorrection[]; derivedUnnamed: number }): { headline: string; body: string[] } | null {
  if (!c.entries.length && !c.derivedUnnamed) return null;
  const headline = c.entries.length === 1
    ? "Correction: the price on this result was wrong when it was published"
    : "Correction: the price rows on this result were wrong when they were published";
  const body = [
    "The result itself has not been edited. Results here are append-only, so what we published stays readable exactly as it was published, and this notice sits beside it.",
  ];
  for (const e of c.entries) {
    body.push(`“${e.label}” — this row states “${e.stated}”. ${e.why} ${e.nowAnswers}`);
  }
  if (c.derivedUnnamed > 0) {
    body.push(
      `${c.derivedUnnamed} further row on this result states a price of zero. This test does not treat a published zero as a price, so that row should not have passed; it has not been individually adjudicated, and describing it further would be a guess presented as a finding.`,
    );
  }
  body.push(
    "Unlike an inference the engine can no longer make, a price is something the test can simply read again. Re-running gives the current, corrected answer for this page.",
  );
  return { headline, body };
}
