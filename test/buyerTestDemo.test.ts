import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { runDemo, renderDemo, demoPageFor, __resetDemoCache } from "../src/server/buyerTestDemo.js";
import { fitnessOf, esc } from "../src/server/standardsSite.js";
import { lintStrings } from "../src/server/claimLinter.js";

// ===========================================================================
// THE EXAMPLE TEST (v3.3 CP-A).
//
// /demo is the PROOF SURFACE — the one page whose whole job is to show what the product
// actually delivers. Until this session it showed something else entirely: a fictional
// skincare brand's "AI buyer readiness score" of 20/100, a recommendation rate, a
// share-of-voice leaderboard and a strongest-competitor card, under chrome saying the
// product executes published buying standards. It now shows a real Coffee Standard
// result on a real coffee product page, replayed from a committed frozen capture.
//
// WHY THIS FILE PINS EVERY ROW. The page RUNS the engine rather than serving a stored
// answer, so it is always the truth of the current matcher — and that cuts both ways: a
// matcher change would silently move what a public page claims about a real, named
// business. Pinning the ten rows means such a change fails here, loudly, instead of
// being published. If one of these assertions fails, the engine's answer about
// klatchcoffee.com has changed and someone has to decide whether the new answer is
// right, not just update the number.
// ===========================================================================

const BASE = "https://lens.example";

/** The result the v3.2 coffee audit adjudicated, row by row. Written out rather than
 *  computed, because computing it from the same run it is checking would assert nothing.
 *
 *  ⚠️ THE IDS MOVED TO v1.3 AND NOT ONE STATUS DID, which is the only reason the rename
 *  was safe to make. Re-pinning a list of ids is a mechanical edit; re-pinning a list of
 *  STATUSES is a decision about what a public page says about a named business. The two
 *  were checked separately: the ten statuses were read off the current engine before the
 *  ids were touched and are byte-identical to the v1.1 pins. */
const EXPECTED: Array<[string, string]> = [
  ["ALS-COFFEE-1.3-FORMAT-001", "pass_evidenced"],
  ["ALS-COFFEE-1.3-FORMAT-002", "not_proven"],
  ["ALS-COFFEE-1.3-GRIND-001", "pass_evidenced"],
  ["ALS-COFFEE-1.3-GRIND-002", "pass_evidenced"],
  ["ALS-COFFEE-1.3-WEIGHT-001", "pass_evidenced"],
  ["ALS-COFFEE-1.3-CERT-001", "not_proven"],
  ["ALS-COFFEE-1.3-CERT-002", "not_proven"],
  ["ALS-COFFEE-1.3-SOURCE-001", "not_proven"],
  ["ALS-COFFEE-1.3-IDENT-001", "not_proven"],
  ["ALS-COFFEE-1.3-DELIV-001", "pass_evidenced"],
];

test("the Example test is a REAL result — every row pinned, from the frozen capture", async () => {
  __resetDemoCache();
  const d = await runDemo();
  assert.equal(d.host, "klatchcoffee.com");
  assert.equal(d.productUrl, "https://klatchcoffee.com/products/ethiopia-yirgacheffe-supernatural");
  assert.equal(d.storeName, "Klatch Coffee");
  assert.equal(d.productName, "Ethiopia Yirgacheffe Supernatural");
  assert.equal(d.raw.ok, true);
  assert.equal(d.degraded, false, "a degraded run is a partial read, not a result to publish");
  assert.equal(d.applicability.state, "APPLIED");
  assert.equal(d.applicability.decisions.filter((x) => !x.asked).length, 0, "an entry stopped applying to the demo product");

  assert.deepEqual(d.rows.map((r) => [r.entryId, r.status]), EXPECTED,
    "the engine's answer about klatchcoffee.com has CHANGED. This page names a real business; decide whether the new answer is right before updating this list.");
  assert.deepEqual(d.counts, { pass: 5, notProven: 5, requiresAccess: 0, total: 10 });
});

test("every row cites a standard entry, and the question is the BUYER'S, not the engine's label", async () => {
  const d = await runDemo();
  for (const r of d.rows) {
    assert.ok(r.entryId, `${r.label} traces to no published entry id — the citation would not resolve`);
    assert.ok(r.question, `${r.entryId} renders no buyer question`);
    assert.notEqual(r.question, r.label, `${r.entryId} shows the engine's internal label where the buyer's question belongs`);
  }
});

test("THE RECEIPT IS UNTRUNCATED, and names the surface it actually came from", async () => {
  const d = await runDemo();
  const proven = d.rows.filter((r) => r.status === "pass_evidenced");
  assert.equal(proven.length, 5);

  // Every proven row must have SOMETHING checkable: a full sentence, or the option list
  // that decided it. A pass with no receipt is the defect this page exists to disprove.
  for (const r of proven) {
    const hasReceipt = Boolean(r.fullSentence) || Boolean(r.optionValues?.length);
    assert.ok(hasReceipt, `${r.entryId} passed with nothing a merchant can check`);
    assert.ok(r.evidenceSurface, `${r.entryId} passed without naming the surface`);
    assert.ok(r.evidenceUrl, `${r.entryId} passed without naming the URL its surface was read from`);
  }

  // ⚠️ THE DELIVERY ROW'S ATTRIBUTION IS THE POINT, not a detail. Its evidence comes
  // from the SHIPPING POLICY PAGE, fetched separately from the product page — a surface
  // sitting right next to the v2.8 policy-chrome false positive, where the word
  // "Organic" in a store's SEO title was credited as a product claim. v3.2's audit found
  // rows attributing variant-option values to "product copy": truthful, and useless as a
  // receipt, because the merchant looks in their description and finds nothing.
  const deliv = d.rows.find((r) => r.entryId === "ALS-COFFEE-1.3-DELIV-001")!;
  assert.equal(deliv.evidenceSurface, "shipping policy",
    "the delivery row must name the shipping policy, not product copy");
  assert.equal(deliv.evidenceUrl, "https://www.klatchcoffee.com/policies/shipping-policy",
    "the delivery row must name the policy PAGE it was read from");
  assert.ok(deliv.fullSentence, "the delivery row has no untruncated sentence");
  assert.ok(deliv.wasTruncated, "the delivery quote is not truncated — then this page cannot demonstrate showing the whole one");
  assert.ok(deliv.fullSentence!.length > (deliv.quote ?? "").length,
    "the 'untruncated' sentence is no longer than the truncated quote");
  assert.match(deliv.fullSentence!, /2-3 business days/);

  // The weight row's receipt is a VARIANT OPTION and says so — not "product copy".
  const weight = d.rows.find((r) => r.entryId === "ALS-COFFEE-1.3-WEIGHT-001")!;
  assert.equal(weight.evidenceSurface, "variant options");
  assert.equal(weight.fullSentence, "2 lb bag.");
});

test("a not_proven row says what WOULD have satisfied it, from the standard", async () => {
  const d = await runDemo();
  for (const r of d.rows.filter((x) => x.status === "not_proven")) {
    assert.ok(r.acceptedEvidence.length > 0,
      `${r.entryId} says the store did not prove it and does not say what would have`);
  }
});

test("the OPTION LIST is attached only to rows it actually decided", async () => {
  // A claim row lists "variant options" among the surfaces it LOOKED at, so keying the
  // receipt on `surfacesChecked` attached the store's whole option list to the organic,
  // fair-trade and single-origin rows as though it were their evidence. Showing a reader
  // evidence that did not decide the row is the same defect as attributing a variant
  // value to "product copy", pointed the other way.
  const d = await runDemo();
  for (const r of d.rows) {
    const decidedByOptions = r.kind === "variant_option" || r.evidenceSurface === "variant options";
    assert.equal(Boolean(r.optionValues?.length), decidedByOptions,
      `${r.entryId} (${r.kind}) ${r.optionValues?.length ? "shows" : "hides"} the option list and should not`);
  }
});

test("EVERY NUMBER ON THE PAGE TRACES TO THE RUN OR THE ARTIFACT — no hardcoded figure", async () => {
  const d = await runDemo();
  const page = renderDemo(d, BASE);
  const sample = fitnessOf(d.standard)!.samples.find((x) => x.name === "coffee")!;

  // The result line, the entry count, and the bound: all derived.
  assert.ok(page.bodyHtml.includes(`${d.counts.pass} proven · ${d.counts.notProven} not proven`));
  assert.ok(page.bodyHtml.includes(`The ${d.rows.length} requirements`));
  assert.ok(page.bodyHtml.includes(`${sample.bound_95_cluster_icc02_pct.toFixed(2)}%`), "the bound is not the artifact's value");
  assert.ok(page.bodyHtml.includes(String(sample.pass_rows_audited)), "the audited-row count is not the artifact's value");
  assert.ok(page.bodyHtml.includes(String(sample.confirmed_false_positives)), "the confirmed-error count is not the artifact's value");
  assert.ok(page.bodyHtml.includes(d.standardHash), "the standard's content hash is not published");
  assert.ok(page.bodyHtml.includes(d.capturedAt.slice(0, 10)), "the snapshot date is not published");

  // ⚠️ THE BOUND IS THE ENGINE'S RATE, NOT A CLAIM ABOUT THIS STORE. Publishing your own
  // error rate beside your own output is the thing no competitor does, and it becomes a
  // libel risk the moment the page lets a reader read it as being about the merchant.
  assert.match(page.bodyHtml, /rate at which <em>this engine<\/em> reports a requirement as proven when the evidence does not support it/);
  assert.match(page.bodyHtml, /not a claim about klatchcoffee\.com/);

  // The audited-rows sentence is COUNTED from the sidecar, not typed.
  const audited = d.audit.auditedRows.length;
  assert.equal(audited, d.counts.pass, "the audit sidecar does not cover every proven row");
  // `esc` because the sentence is escaped into the page — "page's" becomes "page&#39;s",
  // and a raw-string comparison would fail on the apostrophe rather than on the number.
  assert.ok(page.bodyHtml.includes(esc(`All ${d.counts.pass} of this page's proven rows`)),
    "the coverage sentence is not derived from the counts");

  // No stray literals from the retired product.
  assert.doesNotMatch(page.bodyHtml, /Sennen|The Ordinary|CeraVe|readiness score|share of voice/i,
    "the retired fixture's vocabulary survives on the proof surface");
  assert.doesNotMatch(page.bodyHtml, /\[object Object\]/);
  assert.doesNotMatch(page.bodyHtml, /\bundefined\b/);
});

test("every entry-id link on the page RESOLVES", async () => {
  // A citation that 404s is worse than no citation. The demo links each row to its
  // entry; those hrefs are checked against the real router, not eyeballed.
  const { standardsPageFor } = await import("../src/server/standardsSite.js");
  const d = await runDemo();
  const page = renderDemo(d, BASE);
  const hrefs = [...page.bodyHtml.matchAll(/href="(\/standards\/[^"]+)"/g)].map((m) => m[1]!);
  assert.ok(hrefs.length >= d.rows.length, `only ${hrefs.length} standard links for ${d.rows.length} rows`);
  for (const h of new Set(hrefs)) {
    if (h.endsWith("standard.json")) continue;      // served as JSON, not HTML
    const target = h.split("#")[0]!;
    assert.ok(standardsPageFor(target, BASE), `the demo links ${target}, which does not resolve`);
  }
});

test("the page is a DOCUMENT: it renders without the app, and carries no script", async () => {
  const page = (await demoPageFor("/demo", BASE))!;
  assert.ok(page, "/demo does not resolve");
  assert.equal(await demoPageFor("/demos", BASE), null);
  assert.equal(await demoPageFor("/", BASE), null);
  // JS-off by construction: the standalone shell loads no bundle, so there is nothing to
  // mount and nothing to wipe. v3.2 shipped the inverse — a crawler saw the standard and
  // a human saw "Page not found" — by injecting a document into the SPA's #root.
  assert.doesNotMatch(page.bodyHtml, /<script(?![^>]*application\/ld\+json)/i);
  assert.doesNotMatch(page.bodyHtml, /onclick=|onload=/i);
  // And it is substantial: a text extractor must get a result, not an empty shell.
  const text = page.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.ok(text.length > 6000, `the Example test renders ${text.length} chars of text — before this session /demo rendered 0`);
});

test("THE FIXTURE IS A FAITHFUL RECORD, and the audit sidecar is clean", () => {
  // The page quotes this store's own sentences, so the bytes behind those quotes are
  // committed. A fixture that had been edited would make the receipts unverifiable.
  const gz = fs.readFileSync(path.join(process.cwd(), "fixtures/buyer-test/klatchcoffee.com.json.gz"));
  const capture = JSON.parse(zlib.gunzipSync(gz).toString("utf8")) as {
    host: string; url: string; capturedAt: string; responses: Record<string, { status: number; body: string }>;
  };
  assert.equal(capture.host, "klatchcoffee.com");
  assert.equal(Object.keys(capture.responses).length, 5, "the fixture carries responses the engine does not request, or is missing one it does");
  for (const [url, r] of Object.entries(capture.responses)) {
    assert.equal(r.status, 200, `${url} was not a 200 when captured`);
    assert.ok(r.body.length > 0, `${url} captured an empty body`);
  }

  // ⚠️ THE GATE ON WHICH STORE MAY BE NAMED. Every passing row of this product was
  // adjudicated in the v3.2 audit and every one came back `true_pass`. A demo whose
  // receipt is one of the ten known false positives would be the worst page this site
  // could publish, so this is asserted rather than remembered.
  const audit = JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures/buyer-test/klatchcoffee.com.audit.json"), "utf8")) as {
    auditedRows: Array<{ label: string; verdict: string; why: string }>;
  };
  assert.equal(audit.auditedRows.length, 5);
  for (const r of audit.auditedRows) {
    assert.equal(r.verdict, "true_pass", `${r.label} is adjudicated ${r.verdict} — this store must not be the one the site names`);
    assert.ok(r.why.length > 20, `${r.label}'s adjudication has no reasoning`);
  }
});

// ===========================================================================
// THE EXAMPLE TEST IS A REPLAY, NOT A SAMPLE (v4.3).
//
// ⚠️ AN ASSERTION THAT CANNOT FIRE IN THE ENVIRONMENT IT RUNS IN IS NOT A GUARD, AND
// THIS FILE ALREADY HAD ONE. The test above at "EVERY NUMBER ON THE PAGE TRACES TO THE
// RUN" asserts `audited === d.counts.pass` — every proven row is an adjudicated row —
// which is precisely the invariant the defect below broke. It stayed green through the
// entire period the defect was live, because `ENV.keys.openai` is UNSET when the suite
// runs, so the semantic tier returns empty and the extra pass never appears here.
//
// THE DEFECT, MEASURED. `judgeClaims` is gated only on an OpenAI key existing and
// `PRODUCT_TEST_SEMANTIC !== "0"` — both true in production. So every fresh boot of the
// server made a live, sampled model call during this run. Two boots on the identical
// commit and the identical frozen capture produced "5 proven · 5 not proven" and
// "6 proven · 4 not proven", and the sixth pass was ALS-COFFEE-1.3-SOURCE-001 —
// "Is this coffee from one place, or is it a blend?" — evidenced by "Discover Ethiopia
// Yirgacheffe Supernatural; bursting with flavor notes", a sentence that names the
// product and says nothing about origin. A false pass, on the page whose entire gate is
// that every pass was individually adjudicated.
//
// So the OUTCOME assertion is kept and the MECHANISM is asserted here as well, at the
// source level, where it is reachable without a key. This is the same shape as the v2.5
// finding that a semantic aboutness gate "could close no corpus case and could not be
// reached by the mutation proof": when a tier is invisible offline, the only assertion
// that bites offline is one about the call site.
// ===========================================================================
test("the Example test PINS THE SEMANTIC TIER OFF — it is a replay, not a sampled call", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/server/buyerTestDemo.ts"), "utf8");

  // The deps object handed to the replay must disable the tier. Matched on the shape
  // rather than on an exact line so a reformat does not fail it, and anchored to `deps`
  // so a `disabled: true` somewhere else in the file cannot satisfy it.
  // ⚠️ NOT `[^}]*`. The deps object contains `async () => {}`, so a character class that
  // cannot cross a closing brace stops at the arrow function and never reaches the
  // `semantic` key — the first version of this assertion failed against a file that
  // plainly contained the text. Matched within one line instead (no `s` flag).
  const depsLine = /const deps = \{.*semantic:\s*\{\s*disabled:\s*true\s*\}.*\};/.exec(src);
  assert.ok(
    depsLine,
    "src/server/buyerTestDemo.ts no longer disables the semantic tier for the replay.\n" +
      "Without it this page makes a LIVE, SAMPLED model call on every fresh run: two boots on " +
      "the same commit and the same frozen capture returned 5 proven and 6 proven, and the extra " +
      "pass was a single-origin claim read out of a sentence that states no origin. The published " +
      "Example test would stop being a replay and stop being adjudicated at the same moment.",
  );

  // Anti-vacuity: the regex must be reading the real call site, not matching a comment.
  // If `runProductTest` stops receiving this deps object the assertion above is decorative.
  assert.match(
    src, /runProductTest\(capture\.url, \{\s*\.\.\.deps,/,
    "the replay deps object is no longer spread into runProductTest — the pin above proves nothing",
  );
});

test("THE EXAMPLE TEST CITES THE CURRENT VERSION, and its version label is DERIVED", async () => {
  // ⚠️ THE PIN SAID "the current version" IN A COMMENT AND NAMED v1.1, two reissues
  // behind. Nothing was false — a superseded document keeps serving its own bytes and
  // renders a supersession notice — so no lint, no banned-word sweep and no hash pin
  // could see it. Beside it, two paragraphs said "Coffee Standard v1.0" in a page whose
  // every entry link pointed at v1.1: a hardcoded version label disagreeing with the
  // artifact it describes, which is the defect v3.4 found one surface over.
  const { currentOf } = await import("../src/server/standardsSite.js");
  const d = await runDemo();
  const current = currentOf("coffee")!;
  assert.equal(String(d.standard.doc.version), current.publicVersion,
    "the Example test executes a superseded version — every entry link lands on a supersession notice");
  const page = renderDemo(d, BASE);
  assert.ok(page.bodyHtml.includes(`/standards/coffee/${current.publicVersion}`), "the page does not link the current version");
  // No OTHER coffee version may be linked from the page: a stale href is the whole defect.
  for (const v of ["1.0", "1.1", "1.2"]) {
    assert.ok(!page.bodyHtml.includes(`/standards/coffee/${v}`), `the Example test still links /standards/coffee/${v}`);
  }
  // And no hardcoded version label anywhere in the prose that disagrees with the artifact.
  const stale = /Coffee Standard v(?!1\.3\b)[0-9.]+/.exec(page.bodyHtml);
  assert.equal(stale, null, `the page names a version that is not the one it executed: ${stale?.[0]}`);
});

test("the page's own chrome passes the REAL claim linter", () => {
  // Imported, never reimplemented: the site selling claim discipline has to pass the
  // same check the product runs on merchants.
  const r = lintStrings([
    "Example test",
    "ALS-COFFEE v1.3, executed against a real coffee product page",
    "How often is this engine wrong?",
    "What a “not proven” row is not.",
    "Reproduce it",
  ]);
  assert.deepEqual(r.violations, [], `the Example test's chrome fails the claim linter: ${JSON.stringify(r.violations)}`);

});
