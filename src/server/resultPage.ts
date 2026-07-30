// ===========================================================================
// THE PERMANENT RESULT URL (v4.2 CP-1) — `GET /result/:token`.
//
// WHAT IT IS FOR. An agency runs a test on a prospect's store and has something to send
// them. A standard entry has had a permanent URL since v3.2; a merchant's own verdict
// did not. `/test?url=…` re-runs the engine on every load, so there was nothing to link.
//
// ⚠️ THIS MODULE MUST NEVER RUN THE ENGINE, AND THAT IS AN ASSERTED PROPERTY, NOT AN
// INTENTION. It imports no matcher, no fetcher and no runner — `test/resultPage.test.ts`
// asserts the import graph statically AND renders a row whose stored numbers are ones no
// engine would produce, then requires those exact numbers on the page. A page that
// silently re-ran would look right almost always: the result cache is keyed on URL alone
// with a 7-day TTL, so within one process lifetime a re-run returns byte-identical
// output. It would diverge only after a Railway restart or a matcher change — i.e. only
// in front of the recipient, weeks later, with no way to tell it had happened.
//
// WHAT IS FROZEN AND WHAT IS RE-DERIVED, because they are different kinds of claim:
//   • FROZEN — every per-requirement verdict, its detail sentence, its quote and the
//     surface it was read from. That is what this store's page said on that day.
//   • RE-DERIVED — the peer rates and the published error bound. Those are measurements
//     about OUR SAMPLE and OUR ENGINE, not about this store, and they are read through
//     `measuredOf`/`fitnessOf` from the exact standard VERSION this run pinned. Freezing
//     them would make a forwarded one-pager cite a rate we have since corrected; reading
//     them from the CURRENT version would attribute another document's measurement to
//     this run. The page says which it is doing.
// ===========================================================================
import type { Assertion, ProductTestResult } from "./productTest.js";
import type { PeerRate, StandardRunResult } from "./publicStandard.js";
import { peerRatesFor } from "./publicStandard.js";
import { peerSentence } from "../../viewer/src/peerSentence.js";
import {
  findStandard, esc, fitnessOf, shortName, type SitePage,
} from "./standardsSite.js";
import type { StoredResultRow } from "../db/buyerTests.js";

/** ⚠️ pg returns timestamptz as a Date OBJECT, and String(date).slice(0,10) yields
 *  "Mon Jul 27" — a day and month with no year, which on a dated artifact is worse than
 *  no date at all. Normalise through toISOString, and fall back to the raw value rather
 *  than to today: an unparseable stored date must never render as now. */
function isoDay(v: unknown): string {
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v).slice(0, 10) : new Date(t).toISOString().slice(0, 10);
}

const p = (s: unknown) => `<p>${esc(s)}</p>`;

// Byte-identical to the labels /demo publishes. Imported rather than retyped would be
// better still, but they are module-private there; `test/resultPage.test.ts` asserts the
// two maps agree so this copy cannot drift.
export const STATUS_LABEL: Record<string, string> = {
  pass_evidenced: "Proven",
  pass_no_blocking: "No blocking evidence",
  not_proven: "Not proven",
  requires_store_access: "Requires store access",
};
export const STATUS_MEANS: Record<string, string> = {
  pass_evidenced: "The store publishes a statement that settles this, and the sentence is quoted below.",
  pass_no_blocking: "Nothing on the page contradicts this. That is an inference, not proof, and it is labelled as one.",
  not_proven: "We read every surface named below and found nothing that settles it. That is a statement about what this page publishes — NOT that the claim is false, and not that the product lacks the property.",
  requires_store_access: "The surface that would settle this could not be read from public data at all. Reported as unchecked rather than as a result.",
};

const PASSING = new Set(["pass_evidenced", "pass_no_blocking"]);

/** What the stored blob is, once `kind` has told us which shape it holds. */
export interface ResolvedResult {
  test: ProductTestResult;
  standard: StandardRunResult["standard"] | null;
  entryUrls: Record<string, string>;
  peers: PeerRate[];
  /** True when the peer/bound figures were re-derived from the pinned version's artifact. */
  peersRederived: boolean;
}

/**
 * Unpack a stored row. A standard-layer row stores the whole `StandardRunResult` (it
 * carries the identity, the per-entry citation URLs and the applicability refusal); a
 * general-layer row stores the bare `ProductTestResult`.
 */
export function resolveStored(row: StoredResultRow): ResolvedResult | null {
  const blob = row.result as unknown;
  if (!blob || typeof blob !== "object") return null;

  if (row.kind === "standard") {
    const s = blob as StandardRunResult;
    if (!s.result) return null;
    // Peer rates come from the version THIS RUN pinned, never from `currentOf`. A result
    // that executed v1.3 must keep citing v1.3's measurement even after v1.4 ships, or a
    // forwarded page attributes another document's numbers to a run that never saw them.
    let peers: PeerRate[] = s.peers ?? [];
    let rederived = false;
    const slug = row.standard_slug ?? s.standard?.slug ?? null;
    const version = row.standard_version ?? s.standard?.version ?? null;
    if (slug && version) {
      const published = findStandard(slug, version);
      if (published) {
        const askedIds = Object.keys(s.entryUrls ?? {});
        // ⚠️ RE-DERIVE THE RATES, CARRY THE JOIN KEY ACROSS. `requirementLabel` is the
        // engine's label for the compiled requirement and is the only thing that matches a
        // peer record to its row; it comes from the compiled contract, which this module
        // deliberately cannot reach (it must never touch the engine). The STORED record
        // has it. Re-deriving without merging it back replaces a joinable record with an
        // unjoinable one — the fix for the dropped peer line, undone one function later.
        const labelById = new Map(
          (s.peers ?? []).filter((x) => x.requirementLabel).map((x) => [x.entryId, x.requirementLabel!]),
        );
        const fresh = peerRatesFor(published, askedIds, labelById);
        if (fresh.length) { peers = fresh; rederived = true; }
      }
    }
    return { test: s.result, standard: s.standard ?? null, entryUrls: s.entryUrls ?? {}, peers, peersRederived: rederived };
  }
  const t = blob as ProductTestResult;
  if (!Array.isArray(t.assertions)) return null;
  return { test: t, standard: null, entryUrls: {}, peers: [], peersRederived: false };
}

/**
 * A rendered page that contains one of these is refused rather than served.
 *
 * This is the surviving idea from `/c/:token`'s `caseDefects`, which v4.2 retired. Its
 * stated justification — "the bundle generator does not live in this repository, so the
 * template guard cannot be applied at render time" — no longer holds, because this
 * generator IS in the repository. The RISK it guarded does hold, and is if anything
 * sharper here: these pages go to a named third-party merchant as outreach, and a page
 * that says `[object Object]` in front of a prospect spends credibility that the whole
 * product rests on. Unlike a wrong verdict it is not recoverable by re-running anything.
 *
 * `[object Object]` specifically has reached published pages in this repo three times
 * (posture, applicability, a derived assertion's `expected`) — template interpolation
 * converts without throwing.
 */
export function resultPageDefects(html: string): string[] {
  const out: string[] = [];
  for (const bad of ["[object Object]", "undefined", "NaN"]) {
    // `undefined` inside a URL or an id is not the failure mode; a bare word in prose is.
    const re = new RegExp(`(^|[\\s>(])${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s<).,]|$)`);
    const m = re.exec(html);
    if (m) out.push(`rendered the literal "${bad}": …${html.slice(Math.max(0, m.index - 50), m.index + 30).replace(/\s+/g, " ")}…`);
  }
  return out;
}

function rowHtml(a: Assertion, r: ResolvedResult): string {
  // ⚠️ `entryUrls` IS KEYED BY ENTRY ID, NOT BY ASSERTION LABEL — a direct
  // `entryUrls[a.label]` renders no citation at all and looks exactly like a row that
  // legitimately has none. The peer record is what carries the id (its own `label` is the
  // entry's QUESTION, which is what the compiled requirement is labelled with), so the
  // lookup goes through it, the same chain the SPA uses.
  const peer = r.peers.find((x) => x.requirementLabel === a.label || x.label === a.label || x.entryId === a.label) ?? null;
  const entryId = peer?.entryId ?? (r.entryUrls[a.label] ? a.label : null);
  const entryUrl = entryId ? r.entryUrls[entryId] ?? null : null;
  const cite = entryUrl
    ? `<p class="bt-cite"><a class="bt-entry" href="${esc(entryUrl)}"><code>${esc(entryId!)}</code></a></p>`
    : "";

  const receipt: string[] = [];
  if (a.evidenceQuote) {
    receipt.push(`<blockquote class="bt-quote">${esc(a.evidenceQuote)}</blockquote>`);
    // ⚠️ SAY WHY IT MAY BE CUT, AND SAY THE TRUE REASON. /demo can recover the untruncated
    // sentence because it re-runs the engine over a frozen capture and still holds the
    // product's evidence index. A STORED result does not: the engine persists the
    // ≤180-character presentable quote, not the sentence behind it. /demo's existing
    // fallback explains a missing sentence as "could not be matched back to a single
    // evidence sentence", which would be a false explanation here — the index was never
    // stored. A wrong reason for a real limit is still a wrong statement.
    receipt.push(`<p class="bt-note">This is the quote as the engine recorded it, cut to 180 characters. Open the page above and search for it — it is the store's own sentence, not ours.</p>`);
  }
  if (a.evidenceSurface) {
    receipt.push(`<p class="bt-surface">Read from <strong>${esc(a.evidenceSurface)}</strong></p>`);
  }
  const peerLine = peer
    ? `<p class="bt-peer">${esc(peerSentence(peer, PASSING.has(a.status)))}</p>`
    : "";

  return `<section class="bt-row bt-${esc(a.status)}">
  <p class="bt-status">${esc(STATUS_LABEL[a.status] ?? a.status)}</p>
  <h3>${esc(a.label)}</h3>
  ${cite}
  ${p(a.detail)}
  ${receipt.join("")}
  ${peerLine}
  <p class="bt-checked">Surfaces checked: ${esc((a.surfacesChecked ?? []).join(", ") || "—")}</p>
</section>`;
}

/** The published error bound for the pinned standard, read from its artifact. */
function boundSection(row: StoredResultRow): string {
  if (!row.standard_slug || !row.standard_version) {
    return `<section class="bt-bound" id="error-rate">
  <h2>How often is this engine wrong?</h2>
  ${p("This result was produced by the general engine, which runs requirements generated for this product rather than a published standard. The measured false-positive rate we publish is measured while executing a standard on its own category, so quoting it here would attribute a measurement to a different thing than the one that produced this page.")}
  <p class="bt-note"><a href="/standards">The published standards and their measured error rates →</a></p>
</section>`;
  }
  const published = findStandard(row.standard_slug, row.standard_version);
  const f = published ? fitnessOf(published) : null;
  const sample = f?.samples?.find((x) => x.name === row.standard_slug) ?? null;
  if (!published || !sample) {
    return `<section class="bt-bound" id="error-rate">
  <h2>How often is this engine wrong?</h2>
  ${p("No fitness measurement is published for this category at the version this result cites, so no bound is stated. An unmeasured bound would be a guess presented as a number.")}
</section>`;
  }
  return `<section class="bt-bound" id="error-rate">
  <h2>How often is this engine wrong?</h2>
  ${p(`Published, because a test result you cannot calibrate is a number without a unit. ${esc(shortName(published.doc))} v${esc(String(published.doc.version))} was executed against ${sample.products_evaluated ?? sample.stores} real products across ${sample.stores} storefronts, and every one of the ${sample.pass_rows_audited} requirements it reported as proven was read individually against the store's full page text. ${sample.confirmed_false_positives} of those passes were wrong.`)}
  <dl class="bt-bound-figures">
    <div><dt>Passing rows audited</dt><dd>${sample.pass_rows_audited}</dd></div>
    <div><dt>Confirmed wrong</dt><dd>${sample.confirmed_false_positives}</dd></div>
    <div><dt>Point estimate</dt><dd>${sample.point_estimate_pct.toFixed(2)}%</dd></div>
    <div><dt>95% upper bound</dt><dd><strong>${sample.bound_95_cluster_icc02_pct.toFixed(2)}%</strong></dd></div>
  </dl>
  <p class="bt-limit"><strong>Read that bound carefully.</strong> It is the rate at which <em>this engine</em> reports a requirement as proven when the evidence does not support it, measured while executing this standard on this category. It is not the standard's error rate, and it is not a claim about this store.</p>
  <p class="bt-note"><a href="/standards/${esc(row.standard_slug)}/${esc(row.standard_version)}#measured-error">The measurement, its method and its limits →</a></p>
</section>`;
}

export function renderStoredResult(row: StoredResultRow, r: ResolvedResult, base: string): SitePage {
  const t = r.test;
  const canonical = `${base}/result/${row.token}`;
  const ranAt = row.ran_at ?? row.created_at;
  const ranDay = isoDay(ranAt);
  const host = row.store_host ?? (() => { try { return new URL(row.product_url).host; } catch { return "the store"; } })();
  const summary = `${t.evidencedCount + t.noBlockingCount} proven · ${t.notProvenCount} not proven${
    t.requiresAccessCount ? ` · ${t.requiresAccessCount} requires store access` : ""}`;

  const supersession = row.superseded_by
    ? `<aside class="bt-limit" role="note"><strong>A newer result exists for this page.</strong>
   This one is kept exactly as it was — results here are never rewritten — so a link already
   sent still resolves to what it said. <a href="/result/${esc(row.superseded_by)}">See the newer result →</a></aside>`
    : "";
  const lineage = row.rerun_of
    ? `<p class="bt-note">This is a re-run. <a href="/result/${esc(row.rerun_of)}">The earlier result →</a> The two are linked, not reconciled: if they disagree, the store changed, and both readings are true of their own day.</p>`
    : "";

  const stdRow = r.standard
    ? `<div><dt>Standard</dt><dd><a href="/standards/${esc(row.standard_slug ?? "")}/${esc(row.standard_version ?? "")}">${esc(r.standard.id)} v${esc(r.standard.version)}</a></dd></div>
      <div><dt>Content hash</dt><dd><code>${esc(r.standard.hash)}</code></dd></div>`
    : `<div><dt>Contract</dt><dd>Generated buyer task — not a published standard</dd></div>`;

  return {
    title: `Test result — ${t.productName ?? host}${r.standard ? ` against ${r.standard.id} v${r.standard.version}` : ""}`,
    description: `A buyer test run against ${host} on ${ranDay}. ${t.total} requirements, ${summary}, each with the evidence sentence and the surface it was read from.`,
    canonical,
    // No JSON-LD: this page is deliberately not indexable, and emitting structured data
    // that invites a crawler to treat it as an article would contradict the robots header.
    jsonLd: "",
    bodyHtml: `<div class="bt-doc">
  <nav class="std-crumb"><a href="/">Home</a> / <a href="/standards">Standards</a></nav>
  <p class="bt-kicker">Test result</p>
  <h1>${esc(t.productName ?? host)}</h1>

  ${supersession}

  <aside class="bt-provenance" role="note">
    <dl>
      <div><dt>Store</dt><dd><a href="${esc(row.product_url)}" rel="nofollow noopener">${esc(t.storeName ?? host)}</a></dd></div>
      <div><dt>Page tested</dt><dd><a href="${esc(row.product_url)}" rel="nofollow noopener">${esc(row.product_url)}</a></dd></div>
      <div><dt>Test ran</dt><dd><time datetime="${esc(String(ranAt))}">${esc(ranDay)}</time></dd></div>
      <div><dt>Engine</dt><dd><code>${esc(row.engine_version ?? "unrecorded")}</code></dd></div>
      ${stdRow}
      ${row.contract_version ? `<div><dt>Contract version</dt><dd><code>${esc(row.contract_version)}</code></dd></div>` : ""}
      <div><dt>Result</dt><dd><strong>${esc(summary)}</strong></dd></div>
    </dl>
    <p><strong>This is the verdict as it was recorded on ${esc(ranDay)}, and this page does not re-run anything.</strong>
    The store may have changed since — that is the point of a dated result. Every sentence quoted below is the store's own; open the page and check.</p>
    ${lineage}
    <p class="bt-limit"><strong>What a “not proven” row is not.</strong> It means this page did not publish a statement that settles that requirement in a form a machine buyer could read. It is not a claim that the product lacks the property, and it is not a criticism of it.</p>
  </aside>

  <section class="bt-verdicts">
    <h2>What each verdict means</h2>
    <dl class="bt-legend">${
      [...new Set(t.assertions.map((a) => a.status))]
        .map((s) => `<div><dt>${esc(STATUS_LABEL[s] ?? s)} <code>${esc(s)}</code></dt><dd>${esc(STATUS_MEANS[s] ?? "")}</dd></div>`)
        .join("")
    }</dl>
  </section>

  <section class="bt-rows">
    <h2>The ${t.assertions.length} requirements</h2>
    ${p(`Read from: ${(t.surfacesChecked ?? []).join(", ") || "—"}.${
      (t.notInspectable ?? []).length ? ` Not publicly inspectable: ${t.notInspectable.join(", ")}.` : ""}`)}
    ${r.peersRederived ? `<p class="bt-note">The peer line under each row is a measurement of our sample, not of this store, and it is read from the published measurement for the exact standard version this result cites — so a correction we publish later reaches this page, while the verdicts above never move.</p>` : ""}
    ${t.assertions.map((a) => rowHtml(a, r)).join("")}
  </section>

  ${boundSection(row)}

  <section class="bt-repro">
    <h2>Run it again</h2>
    ${p("A re-run produces a NEW result at its own URL. This one is never overwritten, so a link already sent keeps resolving to what it said, and the two can be compared rather than reconciled.")}
    <p class="bt-note"><a href="/test?url=${encodeURIComponent(row.product_url)}">Re-run this test →</a> · <a href="/methodology">How this is built and measured</a>${
      r.standard ? ` · <a href="/standards/${esc(row.standard_slug ?? "")}/${esc(row.standard_version ?? "")}">Read the standard</a>` : ""}</p>
  </section>

  <section class="bt-share">
    <h2>Sharing</h2>
    ${p(row.shared_at
      ? `Marked shareable on ${isoDay(row.shared_at)}. The link is still unlisted and still carries a no-index header — marking it shareable only allows it to show a preview card when someone posts it.`
      : "This result is unlisted. Its address is unguessable, it carries a no-index header, it is in no sitemap, and it is linked from no page of this site. It will not show a preview card if posted anywhere until someone deliberately marks it shareable.")}
    <p class="bt-note">Retention: this result is kept indefinitely and is not deleted on a schedule. A permanent link that expires would be a false statement with a delay, so it does not expire.</p>
  </section>
</div>`,
  };
}
