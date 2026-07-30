import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderOnePager, selectMaterial, MATERIALITY_RULE } from "../src/server/onePager.js";
import { resolveStored } from "../src/server/resultPage.js";
import { peerRatesFor } from "../src/server/publicStandard.js";
import { currentOf } from "../src/server/standardsSite.js";
import type { StoredResultRow } from "../src/db/buyerTests.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://lens.example.com";

// ===========================================================================
// THE AGENCY ONE-PAGER (v4.2 CP-3), and the peer-line join it depends on.
// ===========================================================================

// ---------------------------------------------------------------------------
// ⚠️ THE PEER LINE JOINED NOTHING, ON EVERY ROW, FOR A WHOLE RELEASE.
//
// `peerRatesFor` set `label` to the entry's QUESTION ("Can I buy this as whole beans?");
// `compileStandard` labels the requirement with the BINDING's label ("Whole bean option
// is listed and purchasable"). Both renderers joined on label, so the join matched 0 of 10
// rows and the peer benchmark — the standard layer's entire differentiator and v4.1's
// headline — rendered nowhere. Nothing threw. No test failed. A join that finds nothing
// looks exactly like a standard that has published no measurement, which is the same
// shape as the `grounding.sources` defect and the three `s.fitness` ones.
//
// This test is written so it CANNOT pass vacuously: it asserts a non-zero match count
// against the real published artifact, and it reproduces the old behaviour to prove the
// assertion has teeth.
// ---------------------------------------------------------------------------
test("[peer] a peer record joins to its assertion row by requirementLabel, and 0 by label alone", () => {
  const published = currentOf("coffee");
  assert.ok(published, "coffee must be published for this test to mean anything");

  // The ten executable entries and the labels the engine gives their compiled rows.
  const entries = published!.doc.entries.filter((e) => e.tier === "executable");
  assert.ok(entries.length >= 8, `expected the executable tier, found ${entries.length}`);
  const ids = entries.map((e) => e.id);

  // Stand-in for the compiled labels: deliberately DIFFERENT strings from the questions,
  // which is exactly the real situation.
  const labelById = new Map(ids.map((id) => [id, `ENGINE LABEL FOR ${id}`]));

  const withMap = peerRatesFor(published!, ids, labelById);
  const withoutMap = peerRatesFor(published!, ids);
  assert.ok(withMap.length > 0, "no peer rates resolved at all — the artifact or measuredOf moved");
  assert.equal(withoutMap.length, withMap.length, "the map must not change WHICH entries resolve");

  const joins = (peers: typeof withMap, label: string) =>
    peers.some((x) => x.requirementLabel === label || x.label === label || x.entryId === label);

  const engineLabels = [...labelById.values()];
  const matchedWith = engineLabels.filter((l) => joins(withMap, l)).length;
  const matchedWithout = engineLabels.filter((l) => joins(withoutMap, l)).length;

  assert.equal(matchedWith, withMap.length, "every peer record must join to its row when the label map is supplied");
  // TWO-SIDED: without the map the join must still fail, or this test is measuring nothing.
  assert.equal(matchedWithout, 0,
    "the pre-fix behaviour no longer reproduces — this test can no longer detect the defect it exists for");
});

test("[peer] every caller that has the compiled labels passes them", () => {
  // The fix is only live where it is wired. `publicStandard.ts` is the live standard route;
  // `resultPage.ts` re-derives and must carry the key across.
  const ps = readFileSync(join(ROOT, "src/server/publicStandard.ts"), "utf8");
  assert.match(ps, /peerRatesFor\(published, askedIds, labelById\)/,
    "the live standard route must pass the label map, or peer lines vanish again");
  const rp = readFileSync(join(ROOT, "src/server/resultPage.ts"), "utf8");
  assert.match(rp, /peerRatesFor\(published, askedIds, labelById\)/,
    "re-deriving peers without carrying requirementLabel across undoes the fix one function later");
});

// ---------------------------------------------------------------------------
// The one-pager itself.
// ---------------------------------------------------------------------------

function storedRow(assertions: Array<Record<string, unknown>>, over: Partial<StoredResultRow> = {}): StoredResultRow {
  const notProven = assertions.filter((a) => a.status === "not_proven").length;
  const evidenced = assertions.filter((a) => a.status === "pass_evidenced").length;
  const noBlocking = assertions.filter((a) => a.status === "pass_no_blocking").length;
  const reqAccess = assertions.filter((a) => a.status === "requires_store_access").length;
  return {
    token: "t_0123456789abcdef0123",
    product_url: "https://a-store.example/products/x",
    store_host: "a-store.example",
    shop_domain: null, claimed_at: null, kind: "general",
    ran_at: "2020-02-02T03:04:05.000Z", created_at: "2020-02-02T03:04:05.000Z",
    engine_version: "vTEST", standard_slug: null, standard_version: null,
    standard_hash: null, contract_version: null, shared_at: null,
    rerun_of: null, superseded_by: null,
    result: {
      ok: true, productUrl: "https://a-store.example/products/x",
      storeName: "A Store", productName: "A Product", task: "t",
      assertions,
      evidencedCount: evidenced, noBlockingCount: noBlocking,
      notProvenCount: notProven, requiresAccessCount: reqAccess,
      total: assertions.length, surfacesChecked: ["product copy"], notInspectable: [],
      suggestedCorrections: [], suggestedCorrection: null, deferred: [],
    } as unknown as Record<string, unknown>,
    ...over,
  } as StoredResultRow;
}

const A = (label: string, status: string, surfaces: string[] = ["product copy"]) =>
  ({ label, status, detail: `detail for ${label}`, surfacesChecked: surfaces });

test("[one-pager] MATERIALITY: unmet rows come before met ones, whatever their order in the result", () => {
  const row = storedRow([A("met one", "pass_evidenced"), A("unmet one", "not_proven"), A("met two", "pass_evidenced")]);
  const picked = selectMaterial(resolveStored(row)!, 3).map((m) => m.a.label);
  assert.equal(picked[0], "unmet one", `unmet must lead; got ${picked.join(", ")}`);
});

test("[one-pager] MATERIALITY: an undecidable row sorts after unmet and before met", () => {
  const row = storedRow([A("met", "pass_evidenced"), A("undecidable", "requires_store_access"), A("unmet", "not_proven")]);
  assert.deepEqual(selectMaterial(resolveStored(row)!, 3).map((m) => m.a.label), ["unmet", "undecidable", "met"]);
});

test("[one-pager] MATERIALITY: cheaper-to-check wins a tie, and the rule is deterministic", () => {
  const row = storedRow([
    A("policy row", "not_proven", ["shipping policy"]),
    A("page row", "not_proven", ["product copy"]),
    A("schema row", "not_proven", ["structured data"]),
  ]);
  const picked = selectMaterial(resolveStored(row)!, 3).map((m) => m.a.label);
  assert.deepEqual(picked, ["page row", "schema row", "policy row"]);
  // Deterministic: the same input must give the same order every time.
  assert.deepEqual(selectMaterial(resolveStored(row)!, 3).map((m) => m.a.label), picked);
});

test("[one-pager] the SELECTION RULE is printed on the artifact, not just implemented", () => {
  const row = storedRow([A("unmet", "not_proven")]);
  const page = renderOnePager(row, resolveStored(row)!, BASE);
  assert.ok(page.bodyHtml.includes(MATERIALITY_RULE.slice(0, 60)),
    "the ordering must be as auditable as the numbers — print the rule");
  // And the rule must DESCRIBE what the implementation does.
  assert.match(MATERIALITY_RULE, /unmet requirements first/i);
  assert.match(MATERIALITY_RULE, /peer gap/i);
  assert.match(MATERIALITY_RULE, /fewest surfaces/i);
});

test("[one-pager] NO HAND-TYPED FIGURE: every count moves when the stored result moves", () => {
  const small = storedRow([A("a", "not_proven"), A("b", "pass_evidenced")]);
  const big = storedRow([
    A("a", "not_proven"), A("b", "not_proven"), A("c", "not_proven"),
    A("d", "pass_evidenced"), A("e", "pass_evidenced"),
  ]);
  const s = renderOnePager(small, resolveStored(small)!, BASE).bodyHtml;
  const b = renderOnePager(big, resolveStored(big)!, BASE).bodyHtml;

  const facts = (h: string) => [...h.matchAll(/<dt>([^<]+)<\/dt><dd>(?:<strong>)?(\d+)/g)]
    .map((m) => `${m[1]}=${m[2]}`).sort().join(" ");
  assert.notEqual(facts(s), facts(b), "the fact table did not change with the data — a figure is hard-typed");
  assert.match(s, /<dt>Requirements<\/dt><dd>2</);
  assert.match(b, /<dt>Requirements<\/dt><dd>5</);
  assert.match(b, /<dt>Not stated<\/dt><dd><strong>3</);
});

test("[one-pager] a GENERAL-layer artifact invents no benchmark and quotes no error rate", () => {
  const row = storedRow([A("a", "not_proven"), A("b", "pass_evidenced")]);
  const html = renderOnePager(row, resolveStored(row)!, BASE).bodyHtml;
  assert.doesNotMatch(html, /\d+\.\d+\s?%/, "a general-layer one-pager must state no measured percentage");
  assert.doesNotMatch(html, /coffee stores/, "no peer sentence may appear without a peer measurement");
  assert.match(html, /general engine, not a published standard/);
});

test("[one-pager] the date is an ISO day, never pg's Date.toString() prefix", () => {
  const row = storedRow([A("a", "not_proven")]);
  const html = renderOnePager(row, resolveStored(row)!, BASE).bodyHtml;
  assert.match(html, /<dt>Tested<\/dt><dd>2020-02-02</);
  // The exact defect: `String(new Date(...)).slice(0,10)` yields "Mon Jul 27" — a day and
  // month with no year, on the one artifact whose whole value is being dated.
  assert.doesNotMatch(html, /(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d\d/);
});

test("[one-pager] it carries the permanent link and the method link, for a reader with no context", () => {
  const row = storedRow([A("a", "not_proven")]);
  const html = renderOnePager(row, resolveStored(row)!, BASE).bodyHtml;
  assert.ok(html.includes(`${BASE}/result/${row.token}`), "the citation URL must be on the artifact");
  assert.ok(html.includes(`${BASE}/methodology`));
  assert.match(html, /did not ask for this test/);
  assert.match(html, /statement about the page, not about the product/);
});
