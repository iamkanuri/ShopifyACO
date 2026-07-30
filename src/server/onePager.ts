// ===========================================================================
// THE AGENCY ONE-PAGER (v4.2 CP-3) — `GET /result/:token/one-pager`.
//
// Designed for the reader who receives it FORWARDED WITH ZERO CONTEXT: a client who was
// sent it by their agency, or a developer the agency forwarded it to. That reader has not
// seen our site, does not know what a buying standard is, and will decide in about fifteen
// seconds whether this is a real measurement or a marketing artifact. So the page states
// what was tested, when, against which contract, what the three most material findings
// are, how to check each one, and how often this engine is wrong — in that order.
//
// ⚠️ IT IS GENERATED FROM THE STORED RUN, NEVER FROM A LIVE RE-RUN. Same property as the
// result page it hangs off, and for a sharper reason: the whole value of the artifact is
// that the PDF an agency attached in March still says in June what it said in March.
//
// ⚠️ "MOST MATERIAL" IS A STATED, DERIVED RULE, AND IT IS PRINTED ON THE ARTIFACT.
// A hand-picked "top three" is an opinion wearing the costume of a measurement, and it is
// unfalsifiable by the recipient. The rule is below in `selectMaterial`, it is executed
// rather than applied by eye, and `MATERIALITY_RULE` renders on the page itself so the
// ordering is exactly as auditable as the numbers.
// ===========================================================================
import type { Assertion } from "./productTest.js";
import type { PeerRate } from "./publicStandard.js";
import { peerSentence } from "../../viewer/src/peerSentence.js";
import { findStandard, esc, fitnessOf, type SitePage } from "./standardsSite.js";
import type { StoredResultRow } from "../db/buyerTests.js";
import type { ResolvedResult } from "./resultPage.js";

/** Printed verbatim on the artifact. If the rule below changes, this must change with it —
 *  `test/onePager.test.ts` asserts the sentence and the implementation agree on order. */
export const MATERIALITY_RULE =
  "Selection rule: unmet requirements first, ranked by how many comparable stores DO state "
  + "the same thing (the widest peer gap first); where two are equal, the one a stranger can "
  + "check on the fewest surfaces comes first. Nothing here is hand-picked.";

/**
 * How hard is this row for a stranger to verify? Lower is easier.
 *
 * A finding an agency cannot get their client to confirm in thirty seconds is not a
 * finding they will send. The product page itself is one click; structured data needs
 * view-source; a policy page is a second navigation; a row public data could not decide
 * is not checkable at all and sorts last no matter how large its peer gap.
 */
function checkCost(a: Assertion): number {
  if (a.status === "requires_store_access") return 100;
  const surfaces = a.surfacesChecked ?? [];
  const worst = (s: string): number =>
    /policy/i.test(s) ? 3 : /structured|metafield|seo|meta/i.test(s) ? 2 : 1;
  return surfaces.length ? Math.max(...surfaces.map(worst)) + surfaces.length * 0.1 : 2;
}

/** ⚠️ pg returns timestamptz as a Date OBJECT, and String(date).slice(0,10) yields
 *  "Mon Jul 27" — a day and month with no year, which on a dated artifact is worse than
 *  no date at all. Normalise through toISOString, and fall back to the raw value rather
 *  than to today: an unparseable stored date must never render as now. */
function isoDay(v: unknown): string {
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v).slice(0, 10) : new Date(t).toISOString().slice(0, 10);
}

const FAILED = new Set(["not_proven"]);
const PASSING = new Set(["pass_evidenced", "pass_no_blocking"]);

export interface MaterialRow {
  a: Assertion;
  peer: PeerRate | null;
  /** Share of comparable stores that DO state this, 0..1 — null when unmeasured. */
  peerGap: number | null;
  checkCost: number;
  entryId: string | null;
  entryUrl: string | null;
}

/**
 * The three most material findings, derived.
 *
 * Order: (1) unmet before undecidable before met — an agency sends what is missing;
 * (2) widest peer gap first, where a peer rate exists. For an unmet row the gap is the
 * share of comparable stores that DO state it: "84 of 99 state this and you do not" is
 * materially different from "3 of 99 do". A row with NO measured peer rate sorts after
 * every row that has one, because an unmeasured gap is not a small gap — it is an
 * unknown, and putting it above a measured one would be a claim we cannot support;
 * (3) cheaper to verify first; (4) label, so the order is deterministic and two runs of
 * the same data cannot disagree.
 */
export function selectMaterial(r: ResolvedResult, limit = 3): MaterialRow[] {
  const rank = (a: Assertion): number =>
    FAILED.has(a.status) ? 0 : a.status === "requires_store_access" ? 1 : 2;

  const rows: MaterialRow[] = r.test.assertions.map((a) => {
    const peer = r.peers.find((x) => x.requirementLabel === a.label || x.label === a.label || x.entryId === a.label) ?? null;
    const gap = peer && peer.adjudicated > 0
      ? (PASSING.has(a.status) ? peer.failed / peer.adjudicated : (peer.adjudicated - peer.failed) / peer.adjudicated)
      : null;
    // entryUrls is keyed by ENTRY ID; the peer record is what carries it (see resultPage).
    const entryId = peer?.entryId ?? (r.entryUrls[a.label] ? a.label : null);
    return { a, peer, peerGap: gap, checkCost: checkCost(a), entryId,
             entryUrl: entryId ? r.entryUrls[entryId] ?? null : null };
  });

  return rows
    .sort((x, y) =>
      rank(x.a) - rank(y.a)
      || (x.peerGap === null ? 1 : 0) - (y.peerGap === null ? 1 : 0)
      || (y.peerGap ?? 0) - (x.peerGap ?? 0)
      || x.checkCost - y.checkCost
      || x.a.label.localeCompare(y.a.label))
    .slice(0, limit);
}

/** How a stranger checks this row, in one imperative sentence. Derived from the row. */
function howToCheck(m: MaterialRow, productUrl: string): string {
  const surfaces = (m.a.surfacesChecked ?? []).join(", ") || "the product page";
  if (m.a.status === "requires_store_access") {
    return `Not checkable from the public page — the surface that would settle it is not published at all. Listed so the absence is visible rather than silently dropped.`;
  }
  if (m.a.evidenceQuote) {
    return `Open ${productUrl} and search the page for the quoted sentence. It is the store's own words, read from ${m.a.evidenceSurface ?? surfaces}.`;
  }
  return `Open ${productUrl} and look at ${surfaces}. The claim is that nothing there settles this question — one sentence anywhere on those surfaces would.`;
}

export function renderOnePager(row: StoredResultRow, r: ResolvedResult, base: string): SitePage {
  const t = r.test;
  const ranAt = row.ran_at ?? row.created_at;
  const ranDay = isoDay(ranAt);
  const host = row.store_host ?? (() => { try { return new URL(row.product_url).host; } catch { return "the store"; } })();
  const permalink = `${base}/result/${row.token}`;
  const material = selectMaterial(r, 3);

  // EVERY FIGURE DERIVED. `test/onePager.test.ts` renders this against an artifact whose
  // numbers it changed and requires the page to move with it, so a literal cannot survive.
  const met = t.evidencedCount + t.noBlockingCount;
  const unmet = t.notProvenCount;
  const undecidable = t.requiresAccessCount;

  const published = row.standard_slug && row.standard_version
    ? findStandard(row.standard_slug, row.standard_version) : null;
  const sample = published ? (fitnessOf(published)?.samples ?? []).find((x) => x.name === row.standard_slug) ?? null : null;

  // ONE footer line, and it says what the number is a rate OF. A bare percentage next to a
  // verdict reads as a confidence score for THAT verdict, which it is not.
  const errorLine = sample
    ? `Measured false-pass rate of the engine that produced this, executing ${esc(String(published!.doc.standard_id))} v${esc(String(published!.doc.version))} on ${sample.products_evaluated ?? sample.stores} real ${esc(row.standard_slug ?? "")} products across ${sample.stores} storefronts: ${sample.point_estimate_pct.toFixed(2)}% point estimate, ${sample.bound_95_cluster_icc02_pct.toFixed(2)}% 95% upper bound, over ${sample.pass_rows_audited} passing rows each read individually. It is the rate at which this engine calls a requirement proven when the evidence does not support it — not a confidence score for any row above, and not a claim about ${esc(host)}.`
    : `This run used the general engine, not a published standard. The measured false-pass rates we publish are measured while executing a standard on its own category, so none is quoted here: it would attribute a measurement to a different thing than the one that produced this page.`;

  const rowsHtml = material.map((m, i) => `<section class="op-finding">
  <p class="op-n">Finding ${i + 1} · ${esc(m.a.status === "not_proven" ? "not stated on the page"
    : m.a.status === "requires_store_access" ? "not decidable from public data" : "stated on the page")}</p>
  <h3>${esc(m.a.label)}</h3>
  <p>${esc(m.a.detail)}</p>
  ${m.a.evidenceQuote ? `<blockquote class="op-quote">${esc(m.a.evidenceQuote)}</blockquote>` : ""}
  ${m.peer ? `<p class="op-peer">${esc(peerSentence(m.peer, PASSING.has(m.a.status)))}</p>` : ""}
  <p class="op-check"><strong>Check it:</strong> ${esc(howToCheck(m, row.product_url))}</p>
  ${m.entryUrl ? `<p class="op-cite">Requirement <a href="${esc(base + m.entryUrl)}"><code>${esc(m.entryId ?? m.a.label)}</code></a> of the published standard.</p>` : ""}
</section>`).join("");

  return {
    title: `${t.productName ?? host} — buyer-test summary, ${ranDay}`,
    description: `${unmet} of ${t.total} machine-buyer requirements are not stated on ${host}'s product page, tested ${ranDay}. Each finding is checkable on the live page.`,
    canonical: permalink,
    jsonLd: "",
    bodyHtml: `<div class="op-doc">
  <p class="op-kicker">Machine-buyer conformance summary</p>
  <h1>${esc(t.productName ?? host)}</h1>
  <p class="op-sub">${esc(row.product_url)}</p>

  <dl class="op-facts">
    <div><dt>Tested</dt><dd>${esc(ranDay)}</dd></div>
    <div><dt>Requirements</dt><dd>${t.total}</dd></div>
    <div><dt>Stated on the page</dt><dd>${met}</dd></div>
    <div><dt>Not stated</dt><dd><strong>${unmet}</strong></dd></div>
    ${undecidable ? `<div><dt>Not decidable publicly</dt><dd>${undecidable}</dd></div>` : ""}
    <div><dt>Contract</dt><dd>${r.standard
      ? `${esc(r.standard.id)} v${esc(r.standard.version)}`
      : "generated buyer task (no published standard covers this product)"}</dd></div>
    ${r.standard ? `<div><dt>Content hash</dt><dd><code>${esc(r.standard.hash.slice(0, 16))}…</code></dd></div>` : ""}
  </dl>

  <p class="op-what"><strong>What this is.</strong> An AI shopping assistant reading this product page
  can only use what the page actually states in a machine-readable form. Each requirement below is a
  question a buyer asks; the test reports whether the page answers it, and quotes the sentence that
  did. <strong>“Not stated” is a statement about the page, not about the product.</strong> It does not
  mean the product lacks the property, and nothing here is a criticism of it.</p>

  <h2>The ${material.length} most material findings</h2>
  <p class="op-rule">${esc(MATERIALITY_RULE)}</p>
  ${rowsHtml}

  <h2>Provenance</h2>
  <ul class="op-prov">
    <li>Full result, permanent and unchanging: <a href="${esc(permalink)}">${esc(permalink)}</a></li>
    ${r.standard ? `<li>The standard this ran, versioned and content-hashed: <a href="${esc(base)}/standards/${esc(row.standard_slug ?? "")}/${esc(row.standard_version ?? "")}">${esc(base)}/standards/${esc(row.standard_slug ?? "")}/${esc(row.standard_version ?? "")}</a></li>` : ""}
    <li>Method: <a href="${esc(base)}/methodology">${esc(base)}/methodology</a></li>
    <li>Engine <code>${esc(row.engine_version ?? "unrecorded")}</code>${row.contract_version ? ` · contract <code>${esc(row.contract_version)}</code>` : ""}</li>
  </ul>

  <p class="op-error">${errorLine}</p>
  <p class="op-fine">The store did not ask for this test and has no involvement in it. The page may have
  changed since ${esc(ranDay)}; the permanent link above states the date it was read.</p>
</div>`,
  };
}
