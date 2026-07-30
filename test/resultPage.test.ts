import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderStoredResult, resolveStored, resultPageDefects, STATUS_LABEL, STATUS_MEANS,
} from "../src/server/resultPage.js";
import type { StoredResultRow } from "../src/db/buyerTests.js";
import { peerSentence } from "../viewer/src/peerSentence.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://lens.example.com";

// ===========================================================================
// THE PERMANENT RESULT URL (v4.2 CP-1).
//
// The load-bearing property is NEGATIVE — that the page never re-runs the engine — and a
// negative is exactly what a happy-path test cannot see. The result cache is keyed on URL
// alone with a 7-day TTL, so a page that DID silently re-run would return byte-identical
// output within one process lifetime and diverge only after a Railway restart or a matcher
// change: in front of the recipient, weeks later, undetectably. So it is asserted twice —
// statically over the import graph, and behaviourally with stored numbers no engine could
// produce.
// ===========================================================================

/** A stored row whose numbers are deliberately impossible for any real run. */
function impossibleRow(over: Partial<StoredResultRow> = {}): StoredResultRow {
  return {
    token: "t_0123456789abcdef0123",
    product_url: "https://example-store.com/products/thing",
    store_host: "example-store.com",
    shop_domain: null,
    claimed_at: null,
    kind: "general",
    ran_at: "2019-03-04T05:06:07.000Z",
    created_at: "2019-03-04T05:06:07.000Z",
    engine_version: "vFROZEN-9.9.9",
    standard_slug: null,
    standard_version: null,
    standard_hash: null,
    contract_version: null,
    shared_at: null,
    rerun_of: null,
    superseded_by: null,
    result: {
      ok: true,
      productUrl: "https://example-store.com/products/thing",
      storeName: "Example Store",
      productName: "A Frozen Product Name",
      task: "frozen task",
      assertions: [
        {
          label: "Ferrous unobtainium content",
          status: "pass_evidenced",
          detail: "A FROZEN DETAIL SENTENCE THAT NO MATCHER WOULD EVER EMIT.",
          evidenceQuote: "the store's own frozen sentence",
          evidenceSurface: "product copy",
          surfacesChecked: ["product copy"],
        },
        {
          label: "Second frozen row",
          status: "not_proven",
          detail: "Another frozen detail.",
          surfacesChecked: ["structured data"],
        },
      ],
      evidencedCount: 777,
      noBlockingCount: 0,
      notProvenCount: 888,
      requiresAccessCount: 0,
      total: 1665,
      surfacesChecked: ["product copy"],
      notInspectable: [],
      suggestedCorrections: [],
      suggestedCorrection: null,
      deferred: [],
    } as unknown as Record<string, unknown>,
    ...over,
  } as StoredResultRow;
}

test("[result] a stored result RENDERS ITS STORED VERDICT — impossible numbers survive intact", () => {
  const row = impossibleRow();
  const resolved = resolveStored(row);
  assert.ok(resolved, "the stored blob should resolve");
  const page = renderStoredResult(row, resolved!, BASE);

  // If anything re-ran, these could not appear: no engine produces 777/888 on a two-row
  // result, and no matcher emits that detail sentence.
  assert.match(page.bodyHtml, /A FROZEN DETAIL SENTENCE THAT NO MATCHER WOULD EVER EMIT\./);
  assert.match(page.bodyHtml, /777 proven/);
  assert.match(page.bodyHtml, /888 not proven/);
  assert.match(page.bodyHtml, /A Frozen Product Name/);
  assert.match(page.bodyHtml, /vFROZEN-9\.9\.9/);
  // The run date, not today's date.
  assert.match(page.bodyHtml, /2019-03-04/);
  assert.doesNotMatch(page.bodyHtml, new RegExp(String(new Date().getFullYear()) + "-\\d\\d-\\d\\d"));
});

test("[result] the renderer's import graph cannot reach the engine (static)", () => {
  // A behavioural test can only show that it did not re-run on THIS input. This shows it
  // cannot: the module imports no runner, no fetcher and no matcher entry point.
  const src = readFileSync(join(ROOT, "src/server/resultPage.ts"), "utf8");
  const imports = [...src.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];/gms)].map((m) => m[1]!);
  assert.ok(imports.length >= 4, `expected several imports, found ${imports.length} — the matcher is wrong`);
  const forbidden = ["runProductTest", "fetchPublicProduct", "runStandardTest", "safeFetch", "evaluate("];
  for (const f of forbidden) {
    assert.ok(!src.includes(f), `resultPage.ts references ${f} — a stored result must never re-run anything`);
  }
  // `productTest.js` may be imported for TYPES only. A type-only import is erased at
  // runtime; a value import is not, and would put the engine one call away.
  const productTestImports = imports.filter((i) => i.includes("productTest.js"));
  for (const i of productTestImports) {
    const line = src.split("\n").find((l) => l.includes(i) && l.includes("import"))!;
    assert.match(line, /^import type /, `productTest is imported as a VALUE here, not a type: ${line.trim()}`);
  }
});

test("[result] the refusal gate catches a rendered [object Object], and is two-sided", () => {
  assert.deepEqual(resultPageDefects("<p>a clean page with normal words</p>"), []);
  assert.equal(resultPageDefects("<p>Standard [object Object] applies</p>").length, 1);
  assert.equal(resultPageDefects("<p>the value is undefined here</p>").length, 1);
  assert.equal(resultPageDefects("<p>scored NaN out of ten</p>").length, 1);
  // NOT a defect: the substring inside a longer word or an identifier.
  assert.deepEqual(resultPageDefects("<p>an undefinedness of purpose</p>"), []);
});

test("[result] a real rendered page trips no defect", () => {
  const row = impossibleRow();
  const page = renderStoredResult(row, resolveStored(row)!, BASE);
  assert.deepEqual(resultPageDefects(page.bodyHtml), []);
  assert.deepEqual(resultPageDefects(page.title + " " + page.description), []);
});

test("[result] results are APPEND-ONLY: supersession and lineage are links, not edits", () => {
  const older = impossibleRow({ superseded_by: "t_ffffffffffffffffffff" });
  const olderPage = renderStoredResult(older, resolveStored(older)!, BASE);
  // The old page still states its own verdict…
  assert.match(olderPage.bodyHtml, /777 proven/);
  // …and links forward rather than reconciling.
  assert.match(olderPage.bodyHtml, /A newer result exists for this page/);
  assert.match(olderPage.bodyHtml, /href="\/result\/t_ffffffffffffffffffff"/);

  const newer = impossibleRow({ token: "t_ffffffffffffffffffff", rerun_of: "t_0123456789abcdef0123" });
  const newerPage = renderStoredResult(newer, resolveStored(newer)!, BASE);
  assert.match(newerPage.bodyHtml, /This is a re-run/);
  assert.match(newerPage.bodyHtml, /href="\/result\/t_0123456789abcdef0123"/);
  assert.match(newerPage.bodyHtml, /linked, not reconciled/);
});

test("[result] SHARING IS AN ACT: an unshared result states it is unlisted", () => {
  const unshared = impossibleRow();
  const a = renderStoredResult(unshared, resolveStored(unshared)!, BASE);
  assert.match(a.bodyHtml, /This result is unlisted/);
  assert.match(a.bodyHtml, /will not show a preview card/);

  const shared = impossibleRow({ shared_at: "2026-07-29T00:00:00.000Z" });
  const b = renderStoredResult(shared, resolveStored(shared)!, BASE);
  assert.match(b.bodyHtml, /Marked shareable on 2026-07-29/);
  // Even shared, it stays out of search — sharing is person-to-person, not indexing.
  assert.match(b.bodyHtml, /no-index header/);
});

test("[result] RETENTION is stated on the page, because a permanent link that expires is a lie", () => {
  const row = impossibleRow();
  const page = renderStoredResult(row, resolveStored(row)!, BASE);
  assert.match(page.bodyHtml, /kept indefinitely/);
  assert.match(page.bodyHtml, /does not expire/);
});

test("[result] a general-layer result never borrows the standard's measured error rate", () => {
  const row = impossibleRow();
  const page = renderStoredResult(row, resolveStored(row)!, BASE);
  // It must NOT print a percentage: the published bound is measured while executing a
  // standard on its own category, and this run executed a generated buyer task.
  const bound = /(\d+\.\d+)\s?%/.exec(page.bodyHtml);
  assert.equal(bound, null, `a general-layer result page printed a measured rate: ${bound?.[0]}`);
  assert.match(page.bodyHtml, /general engine/);
  assert.match(page.bodyHtml, /Generated buyer task — not a published standard/);
});

test("[result] the status vocabulary is byte-identical to the one /demo publishes", () => {
  // Two renderers, one vocabulary. The `pass`/`proven` drift between our own two sites is
  // the precedent: a second hand-written copy of a label set is how it happens.
  const demo = readFileSync(join(ROOT, "src/server/buyerTestDemo.ts"), "utf8");
  for (const [k, v] of Object.entries(STATUS_LABEL)) {
    assert.ok(demo.includes(`${k}: "${v}"`), `/demo's STATUS_LABEL disagrees for ${k}`);
  }
  for (const [k, v] of Object.entries(STATUS_MEANS)) {
    assert.ok(demo.includes(v.slice(0, 60)), `/demo's STATUS_MEANS disagrees for ${k}`);
  }
});

test("[result] the RETIRED /c/ prefix still 404s — it must not fall through to the SPA", () => {
  // Caught in production after the v4.2 deploy, not by a test: deleting the /c/:token
  // route also deleted the `app.use("/c", 404)` under it, so /c/<token> answered 200 with
  // the marketing homepage. A retired outreach URL that returns 200 tells a link checker,
  // a crawler and a recipient that a dead link is live — the exact failure the retired
  // module's own comment recorded.
  const src = readFileSync(join(ROOT, "src/server/index.ts"), "utf8");
  assert.match(src, /app\.use\("\/c",\s*\(_req, res\) => \{\s*res\.status\(404\)/,
    "the /c catch-all 404 is gone; /c/<anything> now serves the SPA with HTTP 200");
  // Anti-vacuity: the file really is the router and really registers the new route too.
  assert.match(src, /app\.get\("\/result\/:token"/);
});

test("[result] the peer sentence is the SHARED one, and names its denominator", () => {
  // The trap: five of ten measured coffee entries were asked of fewer than 100 products,
  // and DELIV-001 could be DECIDED on only 74 of the 100 it was asked.
  assert.equal(
    peerSentence({ adjudicated: 74, failed: 45, asked: 100, undecided: 26 }, false),
    "45 of the 74 coffee stores we could decide (of 100 asked) don't state this either.",
  );
  assert.equal(
    peerSentence({ adjudicated: 76, failed: 74, asked: 76, undecided: 0 }, true),
    "74 of 76 coffee stores don't state this. This one does.",
  );
  // Nothing may say "of 100" when the denominator is not 100.
  const s = peerSentence({ adjudicated: 99, failed: 73, asked: 99, undecided: 0 }, false);
  assert.doesNotMatch(s, /of 100\b/);

  // The SPA must consume the shared module rather than keep its own copy.
  const spa = readFileSync(join(ROOT, "viewer/src/pages/ProductTestPage.tsx"), "utf8");
  assert.match(spa, /import \{ peerSentence \} from "\.\.\/peerSentence"/);
  assert.ok(!/function peerSentence\(/.test(spa), "the SPA still defines its own peerSentence");
});
