import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  semanticStatsIn, resultNotice, grantForRow, noticeLines, TIER_GRANT_ATTRIBUTIONS,
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
