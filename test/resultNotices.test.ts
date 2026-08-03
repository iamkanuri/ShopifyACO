import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  semanticStatsIn, resultNotice, grantForRow, noticeLines, TIER_GRANT_ATTRIBUTIONS,
  PRICE_CORRECTIONS, priceCorrections, priceNoticeLines,
} from "../src/server/resultNotices.js";
import { renderStoredResult, resolveStored } from "../src/server/resultPage.js";
import { renderOnePager } from "../src/server/onePager.js";
import type { StoredResultRow } from "../src/db/buyerTests.js";

// ===========================================================================
// v4.4 — THE CORRECTION NOTICE ON A PERMANENT RESULT.
//
// Four stored production results carry a pass promoted by the semantic tier; three of
// them publish a pass the quoted sentence does not support, about a named third-party
// store, at a permanent citable URL. They cannot be corrected by re-running (the page
// never re-runs) and must not be corrected by editing (results are append-only), so the
// correction IS a render-time notice. This file is what stops that notice from silently
// rendering nothing.
//
// ⚠️ EVERY ASSERTION HERE IS A CONTENT ASSERTION, NEVER A PRESENCE ONE. v3.2's grounding
// renderer read a field that did not exist and published 42 empty pages with eleven
// tests green, because they asserted the presence of OTHER things. A notice that joins
// on a label byte-for-byte has exactly that failure mode: a one-character drift renders
// nothing, and nothing looks precisely like a result that needs no notice.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
// ⚠️ THE FIXTURE IS COMMITTED, AND IT HAD TO BE MOVED TO BE. It was first read straight
// from `experiments/v4-4/affected_rows.json`, the audit's own output — but `experiments/*`
// is gitignored, so on any fresh checkout the file would be absent and this test would
// have been passing on this machine alone. It is trimmed to what the assertions actually
// need (token, kind, the semantic stats, and each row's label + status) and carries no
// data that is not already public on the merchant's own product page.
const AFFECTED = join(HERE, "fixtures", "v4-4-affected-rows.json");

const baseRow = (over: Partial<StoredResultRow> = {}): StoredResultRow => ({
  token: "t_test", product_url: "https://example.com/products/x", store_host: "example.com",
  result: {}, shop_domain: null, claimed_at: null, kind: "general", ran_at: "2026-07-30T00:00:00Z",
  engine_version: "v2.5.0", standard_slug: null, standard_version: null, standard_hash: null,
  contract_version: null, shared_at: null, rerun_of: null, superseded_by: null,
  created_at: "2026-07-30T00:00:00Z", ...over,
} as StoredResultRow);

const assertion = (label: string, status = "pass_evidenced") => ({
  label, status, detail: `Stated in your product copy.`, evidenceQuote: "A sentence.",
  evidenceSurface: "product copy", surfacesChecked: ["product copy"],
});

const testResult = (labels: string[], semantic?: unknown) => ({
  ok: true, productUrl: "https://example.com/products/x", storeName: "Example", productName: "Widget",
  task: "buy a widget", assertions: labels.map((l) => assertion(l)),
  evidencedCount: labels.length, noBlockingCount: 0, notProvenCount: 0, requiresAccessCount: 0,
  total: labels.length, surfacesChecked: ["product copy"], notInspectable: [],
  suggestedCorrections: [], suggestedCorrection: null, deferred: [],
  ...(semantic ? { semantic } : {}),
});

// ---------------------------------------------------------------------------
// 1. DETECTION is derived from the blob, at both stored shapes.
// ---------------------------------------------------------------------------
test("[notice] semantic stats are read at BOTH stored shapes", () => {
  const stats = { called: true, granted: 1, vetoed: 0, discarded: 0, costUsd: 0.0016 };
  // general: the bare ProductTestResult
  assert.equal(semanticStatsIn({ result: testResult(["A"], stats) as never })?.granted, 1);
  // standard: the whole StandardRunResult, one level down
  assert.equal(semanticStatsIn({ result: { ok: true, result: testResult(["A"], stats) } as never })?.granted, 1);
  // absent ⇒ null, and null is NOT zero: it means the tier never ran and was never stored
  assert.equal(semanticStatsIn({ result: testResult(["A"]) as never }), null);
});

test("[notice] a result the tier did not grant on gets NO notice", () => {
  const zero = { called: true, granted: 0, vetoed: 2, discarded: 1, costUsd: 0.001 };
  assert.equal(resultNotice(baseRow({ result: testResult(["A"], zero) as never })), null);
  assert.equal(resultNotice(baseRow({ result: testResult(["A"]) as never })), null);
});

test("[notice] detection does NOT depend on membership of the curated map", () => {
  // A token nobody has adjudicated still gets a notice — it reports an UNNAMED row.
  // A curated-list-only design would silently miss every result minted after this file.
  const stats = { called: true, granted: 2, vetoed: 0, discarded: 0, costUsd: 0.002 };
  const n = resultNotice(baseRow({ token: "t_never_seen", result: testResult(["A"], stats) as never }));
  assert.ok(n, "an unknown token with granted>0 must still produce a notice");
  assert.equal(n!.affected.length, 0);
  assert.equal(n!.unnamed, 2);
  const { body } = noticeLines(n!);
  assert.ok(body.some((l) => /2 further row|not which row/.test(l)),
    "an unnamed grant must say the row is not recorded, never invent one");
});

// ---------------------------------------------------------------------------
// 2. ATTRIBUTION joins on the label BYTE-FOR-BYTE — the vacuity trap.
// ---------------------------------------------------------------------------
test("[notice] every curated label resolves against the row it describes", () => {
  // ⚠️ THE ANTI-VACUITY ANCHOR. This reads the REAL production rows the attributions
  // were written from. If the file is absent the test does not quietly pass: it fails,
  // because "the fixture moved" and "every label matches" are indistinguishable
  // otherwise, and that is exactly how v3.7's x=0-floor guard went green testing nothing.
  assert.ok(existsSync(AFFECTED),
    `experiments/v4-4/affected_rows.json is missing. It is the evidence the curated `
    + `attributions were derived from; without it this test proves nothing and must fail.`);
  const rows = JSON.parse(readFileSync(AFFECTED, "utf8")) as Array<Record<string, any>>;
  assert.equal(rows.length, 4, "the production audit found exactly four affected rows");

  let joined = 0;
  for (const r of rows) {
    const grants = TIER_GRANT_ATTRIBUTIONS[r.token];
    assert.ok(grants?.length, `no attribution recorded for ${r.token}`);
    const res = r.kind === "standard" ? r.result.result : r.result;
    const labels = new Set<string>((res.assertions ?? []).map((a: any) => a.label));
    for (const g of grants) {
      assert.ok(labels.has(g.label),
        `attribution label ${JSON.stringify(g.label)} does not appear on ${r.token}. `
        + `The join is byte-for-byte; a drifted label renders NO notice and looks identical `
        + `to a result that needs none.`);
      // and the row it names must actually be a PASS — a notice on a not_proven row
      // would be correcting something that was never claimed.
      const a = (res.assertions ?? []).find((x: any) => x.label === g.label);
      assert.equal(a.status, "pass_evidenced", `${r.token}: ${g.label} is not a pass row`);
      joined++;
    }
    // and the count must match what the blob recorded, or a grant is unaccounted for
    const stats = semanticStatsIn({ result: r.result });
    assert.ok(stats, `${r.token}: no semantic stats in the stored blob`);
    assert.equal(grants.length, stats!.granted,
      `${r.token}: ${grants.length} attributions for ${stats!.granted} recorded grant(s)`);
  }
  assert.equal(joined, 4, "all four production grants must join");
});

test("[notice] the map records both verdicts — a notice that only ever says one thing is not a finding", () => {
  const all = Object.values(TIER_GRANT_ATTRIBUTIONS).flat();
  assert.ok(all.some((g) => g.verdict === "false_pass"), "no false_pass recorded");
  assert.ok(all.some((g) => g.verdict === "stands"), "no 'stands' recorded — if the notice appeared only on wrong rows, its mere presence would leak the verdict");
});

// ---------------------------------------------------------------------------
// 3. IT RENDERS — content, not presence.
// ---------------------------------------------------------------------------
test("[notice] the result page renders the notice, names the row, and marks the row itself", () => {
  const stats = { called: true, granted: 1, vetoed: 0, discarded: 0, costUsd: 0.0016 };
  const token = "t_15802547df13b8daf273";           // a real, curated production token
  const label = TIER_GRANT_ATTRIBUTIONS[token][0].label;
  const row = baseRow({ token, result: testResult([label, "Some other row"], stats) as never });
  const r = resolveStored(row)!;
  const html = renderStoredResult(row, r, "https://x.test").bodyHtml;

  assert.match(html, /bt-correction/, "the page-level notice is absent");
  assert.match(html, /did not meet the evidence bar/, "the correction's verdict sentence is absent");
  assert.match(html, /since removed from this path/, "the notice must say the tier is gone, not merely that it existed");
  assert.match(html, /bt-row-correction/, "the row-level notice is absent");
  assert.match(html, /bt-row-withdrawn/, "a withdrawn pass must be visually withdrawn, not merely footnoted");
  // the notice comes BEFORE the verdict it corrects
  assert.ok(html.indexOf("bt-correction") < html.indexOf("bt-provenance"),
    "the correction must render above the provenance card — a correction read after the number it corrects is read too late");
  // the OTHER row must NOT be marked
  const other = html.slice(html.indexOf("Some other row"));
  assert.doesNotMatch(other.slice(0, 400), /bt-row-correction/, "an unaffected row was marked");
});

test("[notice] the one-pager carries the correction — it is the copy that gets forwarded", () => {
  const stats = { called: true, granted: 1, vetoed: 0, discarded: 0, costUsd: 0.0016 };
  const token = "t_0db9852c7e19461c49f8";
  const label = TIER_GRANT_ATTRIBUTIONS[token][0].label;
  const row = baseRow({
    token, kind: "standard", standard_slug: "coffee", standard_version: "1.3",
    result: { ok: true, standard: { id: "ALS-COFFEE", version: "1.3", hash: "abc", slug: "coffee", url: "/standards/coffee/1.3", title: "t" },
      entryUrls: {}, peers: [], result: testResult([label], stats) } as never,
  });
  const r = resolveStored(row)!;
  const html = renderOnePager(row, r, "https://x.test").bodyHtml;
  assert.match(html, /op-correction/, "the forwardable artifact must carry the correction, not a pointer to it");
  assert.match(html, /since removed from this path/);
});

test("[notice] a clean result renders NO correction anywhere", () => {
  // The two-sided half: the assertions above are worthless unless the notice is also
  // shown to be ABSENT when it should be. A notice that always renders proves nothing.
  const row = baseRow({ result: testResult(["A", "B"]) as never });
  const r = resolveStored(row)!;
  assert.doesNotMatch(renderStoredResult(row, r, "https://x.test").bodyHtml, /bt-correction|bt-row-correction/);
  assert.doesNotMatch(renderOnePager(row, r, "https://x.test").bodyHtml, /op-correction/);
});

test("[notice] grantForRow is label-scoped, not token-scoped", () => {
  const stats = { called: true, granted: 1, vetoed: 0, discarded: 0, costUsd: 0.0016 };
  const token = "t_15802547df13b8daf273";
  const row = baseRow({ token, result: testResult(["Single-origin", "Price under $25"], stats) as never });
  assert.ok(grantForRow(row, "Single-origin"));
  assert.equal(grantForRow(row, "Price under $25"), null);
});

// ===========================================================================
// v4.5 — THE PRICE CORRECTION. Five stored results, two stores, two mechanisms.
// ===========================================================================

const PRICE_AFFECTED = join(process.cwd(), "experiments", "v4-5", "evidence", "price_affected_rows.json");

test("[price-notice] every curated price label resolves against the row it describes", () => {
  // ⚠️ THE ANTI-VACUITY ANCHOR, and this evidence file is deliberately TRACKED where
  // v4.4's is not. `experiments/*` is gitignored, so the equivalent tier test reads a file
  // a fresh clone does not have and fails there — a guard that cannot run is not a guard.
  // `.gitignore` carries an explicit exception for this directory for that reason.
  assert.ok(existsSync(PRICE_AFFECTED),
    "experiments/v4-5/evidence/price_affected_rows.json is missing; without it this test proves nothing and must fail.");
  const rows = JSON.parse(readFileSync(PRICE_AFFECTED, "utf8")) as Array<Record<string, any>>;
  assert.equal(rows.length, 5, "the production sweep found exactly five affected results");

  let joined = 0;
  for (const r of rows) {
    const curated = PRICE_CORRECTIONS[r.token];
    assert.ok(curated?.length, `no price correction recorded for ${r.token}`);
    const labels = new Set<string>((r.price_rows ?? []).map((a: any) => a.label));
    for (const c of curated) {
      assert.ok(labels.has(c.label),
        `price-correction label ${JSON.stringify(c.label)} does not appear on ${r.token}. `
        + `The join is byte-for-byte; a drifted label renders NO notice and looks identical `
        + `to a result that needs none — the grounding.sources shape, five releases running.`);
      // The row it names must be a PASS: correcting a row that never claimed anything
      // would be a notice about nothing.
      const a = (r.price_rows ?? []).find((x: any) => x.label === c.label);
      assert.equal(a.status, "pass_evidenced", `${r.token}: ${c.label} is not a pass row`);
      // And the quoted sentence must be the one actually stored, or the notice tells the
      // reader to look for a string that is not on the page.
      assert.ok(String(a.detail).includes(c.stated),
        `${r.token}: the notice quotes ${JSON.stringify(c.stated)} but the stored row says ${JSON.stringify(a.detail)}`);
      joined++;
    }
  }
  assert.equal(joined, 5, "all five production price rows must join");
});

test("[price-notice] BOTH mechanisms are represented, and they say different things", () => {
  // A notice that only ever describes one failure mode is a template, not a finding.
  const all = Object.values(PRICE_CORRECTIONS).flat();
  assert.ok(all.some((c) => /zero/i.test(c.why)), "no correction describes the $0.00 mechanism");
  assert.ok(all.some((c) => /Canadian dollars|currency/i.test(c.why)), "no correction describes the currency mechanism");
  // Every entry states what the engine answers NOW — that claim is the remedy this notice
  // offers, and it was verified by executing the current engine against the same bytes.
  assert.ok(all.every((c) => c.nowAnswers.length > 20), "a correction offers no current answer");
});

test("[price-notice] the remedy differs from the tier notice — a price CAN be re-run", () => {
  const lines = priceNoticeLines(priceCorrections({
    token: "t_dcd9b617cfa726661c11",
    result: { assertions: [{ label: "Price under $10", status: "pass_evidenced", detail: "Lowest readable price is $0.00." }] },
  } as any));
  assert.ok(lines, "no price notice for a token that has one");
  const body = lines!.body.join(" ");
  assert.match(body, /has not been edited/i, "the notice does not state that the result is unedited");
  assert.match(body, /re-?running gives the current/i,
    "the price notice must offer the remedy the tier notice cannot: a fresh run is correct");
  // And it must NOT claim the result was corrected in place.
  assert.doesNotMatch(body, /we have corrected this result|this row has been removed/i);
});

test("[price-notice] detection is DERIVED for the zero class, not only curated", () => {
  // A result minted later, carrying a rendered $0.00 this file has never heard of, is
  // still disclosed. The currency class cannot work this way and the module says so.
  const c = priceCorrections({
    token: "t_not_in_the_map",
    result: { assertions: [{ label: "Price under $25", status: "pass_evidenced", detail: "Lowest readable price is $0.00." }] },
  } as any);
  assert.equal(c.entries.length, 0, "an uncurated token must not get an invented attribution");
  assert.equal(c.derivedUnnamed, 1, "a rendered $0.00 on an unknown token must still be detected");
  const lines = priceNoticeLines(c);
  assert.ok(lines, "a derived-only detection renders no notice");
  assert.match(lines!.body.join(" "), /has not been individually adjudicated/i,
    "an underived row must be reported as unadjudicated rather than described");

  // Two-sided: an ordinary result gets NOTHING.
  const clean = priceCorrections({
    token: "t_clean",
    result: { assertions: [{ label: "Price under $30", status: "pass_evidenced", detail: "Lowest readable price is $24.00." }] },
  } as any);
  assert.equal(priceNoticeLines(clean), null, "a correct result was given a correction notice");
});
