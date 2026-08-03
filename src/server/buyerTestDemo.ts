// ===========================================================================
// THE EXAMPLE TEST (v3.3 CP-A) — a REAL result, on a REAL store, run offline.
//
// WHAT THIS REPLACES. `/demo` used to render the retired instrument: an "AI buyer
// readiness score" of 20/100, a recommendation rate, a share-of-voice leaderboard
// and a strongest-competitor card, on a FICTIONAL skincare brand — under chrome
// that says the product executes published buying standards. The proof surface was
// showing a product we do not sell, which is the worst coherence defect a site can
// have: the one page whose whole job is to show what the product delivers.
//
// WHY A REAL, NAMED STORE. Checkable evidence is the entire product claim. A reader
// who can open klatchcoffee.com, find the sentence we quote, and confirm we did not
// invent it is the strongest asset this page has. A fictional store makes the
// evidence unverifiable, and anonymising a real one is worse than either — the
// sentences are searchable, so the anonymity would be fake.
//
// HOW IT IS CHOSEN, and this is a gate rather than a preference: the store is drawn
// from the v3.2 coffee fitness audit, where every `pass_evidenced` row of a
// 100-product sample was read individually against its FULL untruncated evidence.
// EVERY passing row of this product was adjudicated `true_pass` — no confirmed false
// positive, no borderline. `experiments/v3-3/build_fixture.mjs` ABORTS if that stops
// being true, so the fixture cannot quietly become one of the ten known defects.
//
// WHY IT RUNS THE ENGINE RATHER THAN SERVING A STORED ANSWER. A stored answer drifts:
// change the matcher and the published Example test keeps showing yesterday's verdict
// while claiming to be what the product does today. So this replays the frozen
// capture through the REAL `runProductTest`, with only the transport swapped — the
// same discipline as experiments/v2-9/replay.ts and v3-2/run_standard.ts. Nothing
// here reimplements the requirement library, the evaluator, the quote gate or the
// applicability sidecar. `test/buyerTestDemo.test.ts` pins every row, so a matcher
// change that moves this page fails the suite loudly instead of publishing silently.
//
// COST: $0 and no network, ever. The capture is bytes on disk.
//
// ⚠️ THE SURFACE ATTRIBUTION IS THE POINT OF THE ROW, NOT DECORATION. v3.2's audit
// found rows that credit a variant-option value to "product copy" — truthful, and
// useless as a receipt, because a merchant looking in their product description will
// not find it. Every row here names the surface AND the URL that surface was read
// from, and the delivery row says `shipping policy` with the policy URL, because that
// surface sits next to the v2.8 policy-chrome false positive and precise attribution
// is exactly what stops the next one.
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  runProductTest, fetchPublicProduct, attachShippingPolicy,
  type ProductTestResult, type Assertion, type PublicProduct,
} from "./productTest.js";
import { SURFACE_LABEL, presentableQuote, type QuotableSurface, type EvidenceSentence } from "./testEvidence.js";
import { __resetCaches } from "./productTestCache.js";
import { compileStandard, duplicateLabels, type Standard } from "../../standards/compile.js";
import { hashMatches } from "../../standards/hash.js";
import { applyApplicability, type Sidecar, type ApplicabilityReport } from "../../standards/applicability.js";
import { findStandard, esc, fitnessOf, shortName, currentOf, type PublishedStandard, type StandardEntry, type SitePage } from "./standardsSite.js";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..",
);

/** The one product the public Example test names. A LIST of one, so adding a second
 *  category later is a data change rather than a rewrite — and so the choice of what
 *  is published is visible in one place, the way `PUBLISHED` is in standardsSite.ts. */
const DEMO = {
  host: "klatchcoffee.com",
  standardSlug: "coffee",
  // THE CURRENT VERSION, not the one the audit happened to run under. A result cites the
  // exact contract it executed, so an Example test pinned to a superseded version would
  // send every reader who follows an entry link into a document with a supersession
  // notice on it — which is exactly where this pin had drifted to: it said "the current
  // version" and named v1.1, two reissues behind, because the comment states the rule and
  // nothing enforced it. `test/buyerTestDemo.test.ts` now asserts it against `currentOf`.
  // Every reissue since has asked byte-identical questions with byte-identical assertions
  // and evidence rules — `standards/__tests__/version.test.ts` asserts that entry by entry
  // — so the result is the same result; only the ids it cites move forward.
  standardVersion: "1.3",
  standardDir: "standards/coffee/v1.3",
  fixtureDir: "fixtures/buyer-test",
} as const;

// ---- the frozen capture ------------------------------------------------------

interface Recorded { status: number; contentType: string | null; body: string; finalUrl?: string }
interface Capture { host: string; url: string; capturedAt: string; responses: Record<string, Recorded> }
interface AuditRow { label: string; verdict: string; why: string }
interface AuditSidecar { host: string; sample: string; source: string; auditedRows: AuditRow[] }

/** Which URL each quotable surface was read from. The product page for everything the
 *  product node carries; the policy page for the one surface fetched separately. */
function surfaceUrl(p: PublicProduct, surface: QuotableSurface, productUrl: string): string {
  return surface === "shipping_policy" ? `${p.origin}/policies/shipping-policy` : productUrl;
}

// ---- the resolved row --------------------------------------------------------

export interface DemoRow {
  /** The standard entry this row executes, e.g. ALS-COFFEE-1.0-WEIGHT-001. Null only
   *  if the label could not be traced back, which is itself reported rather than hidden. */
  entryId: string | null;
  /** The buyer's own question, from the standard — not the engine's internal label. */
  question: string | null;
  label: string;
  /** The requirement kind the standard compiled to. Carried because it decides what
   *  counts as this row's receipt: a `variant_option` row is settled by the option
   *  list, a `claim` row by a sentence. */
  kind: string | null;
  status: Assertion["status"];
  detail: string;
  surfacesChecked: string[];
  evidenceSurface: string | null;
  evidenceUrl: string | null;
  /** The UNTRUNCATED sentence, recovered from the product's own evidence index by
   *  re-deriving `presentableQuote` over it — the real function, never a re-implementation.
   *  Null when it could not be matched exactly, which the page states rather than
   *  quietly showing the 180-character cut as if it were whole. */
  fullSentence: string | null;
  quote: string | null;
  wasTruncated: boolean;
  /** For the option rows: the store's whole published option list, which is the receipt
   *  for a pass AND for an absence — a reader can check all four grind rows against it. */
  optionValues: string[] | null;
  /** What WOULD have satisfied this requirement, from the standard's own accepted list. */
  acceptedEvidence: Array<{ surface?: string; form?: string; example?: string }>;
  /** Our adjudication of this row in the v3.2 audit, when it has one. */
  audit: AuditRow | null;
}

export interface DemoResult {
  host: string;
  productUrl: string;
  storeName: string | null;
  productName: string | null;
  capturedAt: string;
  fetchTier: string | null;
  policyStatus: string | null;
  robotsStatus: string | null;
  degraded: boolean;
  standard: PublishedStandard;
  standardHash: string;
  contractVersion: string | null;
  applicability: ApplicabilityReport;
  rows: DemoRow[];
  counts: { pass: number; notProven: number; requiresAccess: number; total: number };
  audit: AuditSidecar;
  raw: ProductTestResult;
}

/** The inverse of SURFACE_LABEL. Injective by construction — asserted below, because a
 *  future duplicate label would silently attribute evidence to the wrong surface. */
const SURFACE_KEY: Record<string, QuotableSurface> = (() => {
  const out: Record<string, QuotableSurface> = {};
  for (const [k, v] of Object.entries(SURFACE_LABEL) as Array<[QuotableSurface, string]>) {
    if (out[v]) throw new Error(`SURFACE_LABEL is not injective: "${v}" maps from two surfaces`);
    out[v] = k;
  }
  return out;
})();

/**
 * Recover the untruncated sentence behind a rendered quote.
 *
 * The engine persists the ≤180-character presentable quote, not the sentence it came
 * from, and it is not this session's business to change that — `Assertion` lives in a
 * matcher file. So the sentence is found by running the REAL `presentableQuote` over
 * every evidence sentence on the same surface and taking the one that reproduces the
 * quote exactly. Exact, not fuzzy: a prefix match would attribute the wrong sentence
 * whenever two share an opening, and a wrong receipt is worse than none.
 *
 * ⚠️ A SECOND, EQUALLY EXACT LEG WAS ADDED AT v4.0 CP-1b, AND WITHOUT IT THIS FUNCTION
 * WOULD HAVE SILENTLY STOPPED RESOLVING. P-22's fix lets `presentableQuote` slide its
 * window so the rendered quote always contains the term the row proves, which means a
 * quote can now be `…middle of the sentence…` rather than a head cut — and the plain
 * `presentableQuote(ev.text)` call above reproduces only the head. The row would still
 * render; `fullSentence` would just go null, and the page would say the sentence could
 * not be matched. That is the flattering-direction failure this repo keeps recording:
 * a degradation that looks like an honest "not available".
 *
 * The second leg stays EXACT in the sense that matters: the quote's body, stripped of
 * the ellipses the renderer added, must be a literal substring of the cleaned sentence,
 * and it must match exactly ONE sentence on that surface. Ambiguity returns null rather
 * than guessing, for the same reason the prefix match was rejected.
 */
function resolveFull(evidence: EvidenceSentence[], a: Assertion): { sentence: string; truncated: boolean } | null {
  if (!a.evidenceQuote || !a.evidenceSurface) return null;
  const key = SURFACE_KEY[a.evidenceSurface];
  if (!key) return null;
  const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
  const onSurface = evidence.filter((ev) => ev.surface === key);

  for (const ev of onSurface) {
    if (presentableQuote(ev.text) === a.evidenceQuote) {
      return { sentence: ev.text, truncated: clean(ev.text) !== a.evidenceQuote };
    }
  }
  // Windowed quote: strip the renderer's own ellipses and require a unique containing
  // sentence. `body` is never empty for a real quote, and an empty body would match
  // every sentence — refuse rather than resolve on nothing.
  const body = a.evidenceQuote.replace(/^…/, "").replace(/…$/, "");
  if (!body || body === a.evidenceQuote) return null;
  const hits = onSurface.filter((ev) => clean(ev.text).includes(body));
  if (hits.length !== 1) return null;
  return { sentence: hits[0]!.text, truncated: clean(hits[0]!.text) !== a.evidenceQuote };
}

let cache: DemoResult | null = null;

/** Test seam — the module caches the run, and a test that changes the engine needs to
 *  ask again rather than be served the previous answer. */
export function __resetDemoCache(): void { cache = null; }

/**
 * Run the Example test. Replay only — this function cannot reach the network, because
 * the transport it passes down throws on any URL the frozen capture does not hold.
 */
export async function runDemo(): Promise<DemoResult> {
  if (cache) return cache;

  const fixturePath = path.join(repoRoot, DEMO.fixtureDir, `${DEMO.host}.json.gz`);
  const capture = JSON.parse(zlib.gunzipSync(fs.readFileSync(fixturePath)).toString("utf8")) as Capture;
  const audit = JSON.parse(
    fs.readFileSync(path.join(repoRoot, DEMO.fixtureDir, `${DEMO.host}.audit.json`), "utf8"),
  ) as AuditSidecar;

  const published = findStandard(DEMO.standardSlug, DEMO.standardVersion);
  if (!published) throw new Error(`the Example test cites ${DEMO.standardSlug} v${DEMO.standardVersion}, which is not published`);
  // ⚠️ THE PIN'S OWN RULE, ENFORCED WHERE IT IS STATED. `DEMO.standardVersion` said "the
  // current version" in a comment and named a version two reissues behind, because a
  // superseded document keeps serving — nothing is broken, the page merely cites stale
  // ids and sends every reader who follows one into a supersession notice. Staleness has
  // no vocabulary to grep for; it needs a check against the registry.
  const current = currentOf(DEMO.standardSlug);
  if (current && current.publicVersion !== DEMO.standardVersion) {
    throw new Error(
      `the Example test is pinned to ${DEMO.standardSlug} v${DEMO.standardVersion} but v${current.publicVersion} is current. ` +
      `Every entry link on the page would land on a superseded document. Update DEMO.standardVersion and DEMO.standardDir.`);
  }
  const standard = JSON.parse(published.rawJson) as Standard;
  const h = hashMatches(standard);
  if (!h.ok) throw new Error("standard hash mismatch — a result that cannot name the exact text it tested against is not citable");

  const sidecar = JSON.parse(
    fs.readFileSync(path.join(repoRoot, DEMO.standardDir, "applicability.json"), "utf8"),
  ) as Sidecar;

  const report = compileStandard(standard);
  if (report.errors.length) throw new Error(`incomplete compile: ${report.errors.join("; ")}`);
  const dupes = duplicateLabels(report.requirements);
  if (dupes.length) throw new Error(`duplicate requirement labels collide: ${dupes.join(", ")}`);

  // The replay transport. A miss THROWS rather than returning a 404, because a silent
  // 404 becomes an honest-looking "we could not read this surface" row — a fabricated
  // finding about a real store, which is the one thing this page must never produce.
  const replay = async (url: string): Promise<Recorded> => {
    const r = capture.responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url} is not in the frozen capture`);
    return r;
  };
  // ⚠️ THE SEMANTIC TIER IS PINNED OFF, AND WITHOUT THIS THE PUBLISHED EXAMPLE TEST WAS
  // NEITHER A REPLAY NOR ADJUDICATED. Found by measurement at v4.3, on the landing page
  // that reads this same run: the hero showed "5 proven · 5 not proven" on one server
  // boot and "6 proven · 4 not proven" on the next, from the identical commit and the
  // identical frozen capture.
  //
  // The mechanism. `judgeClaims` is gated only on an OpenAI key existing and
  // `PRODUCT_TEST_SEMANTIC !== "0"` — both true in production — so every fresh run of
  // this page made a LIVE, SAMPLED model call whose grants flip `claim` rows from
  // not_proven to pass_evidenced. Nothing about that is visible on the page.
  //
  // TWO THINGS IT BROKE, AND THE SECOND IS THE SERIOUS ONE.
  //
  // 1. It is not a replay. The whole argument for running the engine over a frozen
  //    capture, stated forty lines above, is that a stored answer drifts. A live model
  //    call reintroduces exactly that drift, from a source the capture does not cover —
  //    so the "real result on a real store" was a sample, and two visitors could be shown
  //    different verdicts about klatchcoffee.com on the same commit.
  //
  // 2. It produced a FALSE PASS, on the one page whose selection gate is that every
  //    passing row was individually adjudicated `true_pass`. Measured on the server:
  //    ALS-COFFEE-1.3-SOURCE-001 — "Is this coffee from one place, or is it a blend?" —
  //    came back pass_evidenced quoting "Discover Ethiopia Yirgacheffe Supernatural;
  //    bursting with flavor notes", a sentence that names the product and states nothing
  //    about origin. The audit sidecar adjudicated 5 rows; the tier made 6 passes, so the
  //    sixth was an unadjudicated pass — and on inspection, a wrong one. `single-origin`
  //    read into a sentence that does not state it is a defect class this project has
  //    already confirmed twice in the coffee sample.
  //
  // So the tier is disabled HERE, at the call site, rather than anywhere in the engine.
  // No matcher moves, `ENGINE_VERSION` does not move, and every other caller is
  // untouched. What this page shows is now exactly what the v3.2 audit read.
  //
  // ⚠️ THE SAME TIER IS STILL LIVE ON `/test` AND ON EVERY STANDARD RUN, and that is
  // deliberately NOT fixed here — it is filed as a proposal, because it needs a
  // measurement of how often it grants and how often the grant is wrong, and this session
  // is scoped to a landing page. Where work implies a change elsewhere, write it down.
  const deps = { fetchUrl: replay, sleep: async () => {}, semantic: { disabled: true } };

  __resetCaches();
  const pre = await fetchPublicProduct(capture.url, deps);
  const p0 = pre.product;
  // The merchant's own product_type, as the standard's `category_signals` names first.
  // v3.2 CP2 made this survive the page tier, which is why G-10 can classify at all.
  const applicability = applyApplicability(report.requirements, sidecar, {
    title: p0?.title ?? null,
    ldCategory: null,
    breadcrumb: null,
    hasProductSchema: p0?.extracted?.signals?.productSchema ?? undefined,
    optionValues: p0?.optionValues ?? [],
    productType: p0?.productType ?? null,
  });
  if (applicability.state === "INCOMPLETE") {
    throw new Error(`the standard does not apply to the demo product: ${applicability.blockedBy}`);
  }

  __resetCaches();
  const raw = await runProductTest(capture.url, {
    ...deps,
    force: true,
    requirements: applicability.requirements,
    standard: { id: standard.standard_id, version: String(standard.version), hash: h.computed },
  });
  if (!raw.ok) throw new Error(`the Example test did not produce a result: ${raw.error ?? "unknown"}`);

  // Re-derive the FULL evidence index, including the shipping policy, so the page can
  // quote whole sentences. Same three-pass shape as run_standard.ts: `runProductTest`
  // owns its own fetch, and threading a pre-fetched product into it would create a
  // second code path for the thing being demonstrated.
  __resetCaches();
  const re = await fetchPublicProduct(capture.url, deps);
  const product = re.product && re.ctx ? await attachShippingPolicy(re.product, re.ctx) : re.product;
  const evidence = product?.evidence ?? [];

  const byLabel = new Map(report.requirements.map((r) => [r.label, r]));
  const entryById = new Map(published.doc.entries.map((e) => [e.id, e]));
  const auditByLabel = new Map(audit.auditedRows.map((r) => [r.label, r]));

  const rows: DemoRow[] = raw.assertions.map((a) => {
    const req = byLabel.get(a.label) ?? null;
    const entryId = req?.id ?? null;
    const entry: StandardEntry | undefined = entryId ? entryById.get(entryId) : undefined;
    const full = resolveFull(evidence, a);
    const key = a.evidenceSurface ? SURFACE_KEY[a.evidenceSurface] : undefined;
    return {
      entryId,
      question: entry?.question ?? null,
      label: a.label,
      kind: req?.kind ?? null,
      status: a.status,
      detail: a.detail,
      surfacesChecked: a.surfacesChecked,
      evidenceSurface: a.evidenceSurface ?? null,
      evidenceUrl: key && product ? surfaceUrl(product, key, capture.url) : null,
      fullSentence: full?.sentence ?? null,
      quote: a.evidenceQuote ?? null,
      wasTruncated: full?.truncated ?? false,
      // The option list is the receipt for every row DECIDED on the variant list — the
      // three grind rows that pass and the one that does not — and for any row whose
      // evidence really came from there.
      //
      // ⚠️ Keyed on the requirement KIND, not on `surfacesChecked`. A claim row lists
      // "variant options" among the surfaces it looked at, so keying on that attached
      // the whole option list to the organic, fair-trade and single-origin rows as
      // though it were their receipt. Showing a reader evidence that did not decide the
      // row is the same defect as attributing a variant value to "product copy", just
      // pointed the other way.
      optionValues: req?.kind === "variant_option" || a.evidenceSurface === "variant options"
        ? (product?.optionValues ?? null)
        : null,
      acceptedEvidence: entry?.accepted_evidence ?? [],
      audit: auditByLabel.get(a.label) ?? null,
    };
  });

  cache = {
    host: capture.host,
    productUrl: capture.url,
    storeName: raw.storeName,
    productName: raw.productName,
    capturedAt: capture.capturedAt,
    fetchTier: raw.fetchTier ?? null,
    policyStatus: raw.policyStatus ?? null,
    robotsStatus: raw.robotsStatus ?? null,
    degraded: raw.degraded === true,
    standard: published,
    standardHash: h.computed,
    contractVersion: raw.contractVersion ?? null,
    applicability,
    rows,
    counts: {
      pass: raw.evidencedCount + raw.noBlockingCount,
      notProven: raw.notProvenCount,
      requiresAccess: raw.requiresAccessCount,
      total: raw.total,
    },
    audit,
    raw,
  };
  return cache;
}

// ---- rendering ---------------------------------------------------------------

const p = (s: unknown) => `<p>${esc(s)}</p>`;

const STATUS_LABEL: Record<string, string> = {
  pass_evidenced: "Proven",
  pass_no_blocking: "No blocking evidence",
  not_proven: "Not proven",
  requires_store_access: "Requires store access",
};
const STATUS_MEANS: Record<string, string> = {
  pass_evidenced: "The store publishes a statement that settles this, and the sentence is quoted below.",
  pass_no_blocking: "Nothing on the page contradicts this. That is an inference, not proof, and it is labelled as one.",
  not_proven: "We read every surface named below and found nothing that settles it. That is a statement about what this page publishes — NOT that the claim is false, and not that the product lacks the property.",
  requires_store_access: "The surface that would settle this could not be read from public data at all. Reported as unchecked rather than as a result.",
};

/** The published false-positive bound for this category, READ FROM `fitness.json`.
 *  Never a literal: the whole argument of this section is that we publish our own
 *  error rate beside our own output, and a hand-typed rate would be the one number on
 *  the page that nobody measured. */
function boundSection(d: DemoResult): string {
  // ⚠️ `fitnessOf`, NOT `.fitness`. v1.0 keeps its measurement in a sidecar; v1.1 carries
  // it inside the document (grammar 1.1). Reading `.fitness` directly worked while the
  // demo cited v1.0 and, the moment it was pointed at v1.1, silently produced the
  // "not yet fitness-measured" branch — a page confidently announcing that no error rate
  // has been published, on the session whose entire point is publishing one. Nothing
  // threw. `fitnessOf` normalises the two shapes so no caller has to know which it has.
  const sample = fitnessOf(d.standard)?.samples?.find((x) => x.name === "coffee") ?? null;
  if (!sample) {
    return `<section class="bt-bound"><h2>How often is this engine wrong?</h2>${p(
      "No fitness measurement is published for this category yet, so no bound is stated. An unmeasured bound would be a guess presented as a number.",
    )}</section>`;
  }
  // COUNTED, never typed. The sentence "all of this page's passing rows were audited
  // and found correct" is the strongest claim on the page, so both numbers in it are
  // derived and the sentence changes shape if they ever disagree.
  const audited = d.audit.auditedRows.length;
  const correct = d.audit.auditedRows.filter((r) => r.verdict === "true_pass").length;
  const covered = audited === d.counts.pass && correct === audited;
  const ownRows = covered
    ? `All ${d.counts.pass} of this page's proven rows were among the ${sample.pass_rows_audited} read in that audit, and all ${correct} were adjudicated correct.`
    : `Of this page's ${d.counts.pass} proven rows, ${audited} appear in that audit and ${correct} of those were adjudicated correct. The rest are not covered by it, and this page does not claim otherwise.`;

  return `<section class="bt-bound" id="error-rate">
  <h2>How often is this engine wrong?</h2>
  ${p(`Published, because a test result you cannot calibrate is a number without a unit. ${esc(shortName(d.standard.doc))} v${esc(String(d.standard.doc.version))} was executed against ${sample.products_evaluated ?? sample.stores} real coffee products across ${sample.stores} storefronts, and every one of the ${sample.pass_rows_audited} requirements it reported as proven was read individually against the store's full page text. ${sample.confirmed_false_positives} of those passes were wrong.`)}
  <dl class="bt-bound-figures">
    <div><dt>Passing rows audited</dt><dd>${sample.pass_rows_audited}</dd></div>
    <div><dt>Confirmed wrong</dt><dd>${sample.confirmed_false_positives}</dd></div>
    <div><dt>Point estimate</dt><dd>${sample.point_estimate_pct.toFixed(2)}%</dd></div>
    <div><dt>95% upper bound</dt><dd><strong>${sample.bound_95_cluster_icc02_pct.toFixed(2)}%</strong></dd></div>
  </dl>
  <p class="bt-limit"><strong>Read that bound carefully.</strong> It is the rate at which <em>this engine</em> reports a requirement as proven when the evidence does not support it, measured while executing this standard on this category. It is not the standard's error rate, and it is not a claim about ${esc(DEMO.host)}. ${esc(ownRows)}</p>
  ${p(`The bound is cluster-adjusted at ICC 0.2 because passing rows are not independent: rows from one store share that store's copy conventions. The four defect classes behind those ${sample.confirmed_false_positives} errors are named in full on the standard's own page.`)}
  <p class="bt-note"><a href="/standards/${esc(DEMO.standardSlug)}/${esc(DEMO.standardVersion)}#measured-error">The measurement, its method and its limits →</a></p>
</section>`;
}

function rowHtml(d: DemoResult, r: DemoRow): string {
  const href = r.entryId ? `/standards/${DEMO.standardSlug}/${DEMO.standardVersion}/${encodeURIComponent(r.entryId)}` : null;
  const cite = href
    ? `<a class="bt-entry" href="${esc(href)}"><code>${esc(r.entryId)}</code></a>`
    : `<span class="bt-entry bt-entry-missing">no standard entry — the engine could not trace this row back to a published id</span>`;

  // The receipt. Order matters: the untruncated sentence first, then what it was cut
  // to, then the surface and the URL it was read from.
  const receipt: string[] = [];
  if (r.fullSentence) {
    receipt.push(`<blockquote class="bt-quote">${esc(r.fullSentence)}</blockquote>`);
    if (r.wasTruncated) {
      receipt.push(`<p class="bt-note">The result page shows this cut to 180 characters (<code>${esc(r.quote)}</code>). The whole sentence is above — a receipt a merchant cannot read in full is not a receipt.</p>`);
    }
  } else if (r.quote) {
    receipt.push(`<blockquote class="bt-quote">${esc(r.quote)}</blockquote>`);
    receipt.push(`<p class="bt-note">This is the rendered quote. The full sentence behind it could not be matched back to a single evidence sentence, so it is shown as-is rather than presented as complete.</p>`);
  }
  if (r.optionValues?.length) {
    // <details>, because the same option list is the receipt for four rows and a
    // reader should be able to skim. It is JS-free and its contents are in the
    // document, so a crawler and a JS-off reader both get the full list — a
    // disclosure widget that HID evidence would defeat the purpose of the page.
    receipt.push(`<details class="bt-options"><summary>The store's ${r.optionValues.length} published option values, in full</summary><ul>${
      r.optionValues.map((v) => `<li><code>${esc(v)}</code></li>`).join("")
    }</ul></details>`);
  }
  if (r.evidenceSurface) {
    receipt.push(`<p class="bt-surface">Read from <strong>${esc(r.evidenceSurface)}</strong> at <a href="${esc(r.evidenceUrl ?? d.productUrl)}" rel="nofollow noopener">${esc(r.evidenceUrl ?? d.productUrl)}</a></p>`);
  }

  const wouldSatisfy = r.status === "not_proven" && r.acceptedEvidence.length
    ? `<div class="bt-would"><h4>What would have satisfied it</h4><ul>${
      r.acceptedEvidence.map((x) =>
        `<li><strong>${esc(x.surface ?? "any product surface")}</strong> — ${esc(x.form ?? "")}${
          x.example ? ` <span class="bt-eg">e.g. ${esc(x.example)}</span>` : ""}</li>`).join("")
    }</ul><p class="bt-note">Taken from the standard entry, published before this test ran. The bar was not set after seeing the answer.</p></div>`
    : "";

  const auditLine = r.audit
    ? `<p class="bt-audit"><strong>Audited:</strong> this row was read individually in the v3.2 coffee measurement and adjudicated <em>${esc(r.audit.verdict.replace(/_/g, " "))}</em> — ${esc(r.audit.why)}</p>`
    : "";

  return `<section class="bt-row bt-${esc(r.status)}" id="${esc(r.entryId ?? r.label.replace(/\W+/g, "-"))}">
  <p class="bt-status">${esc(STATUS_LABEL[r.status] ?? r.status)}</p>
  <h3>${esc(r.question ?? r.label)}</h3>
  <p class="bt-cite">${cite} · <span class="bt-label">${esc(r.label)}</span></p>
  ${p(r.detail)}
  ${receipt.join("")}
  ${wouldSatisfy}
  ${auditLine}
  <p class="bt-checked">Surfaces checked: ${esc(r.surfacesChecked.join(", "))}${
    // ⚠️ NOT A COSMETIC NOTE. The engine computes `surfacesChecked` from the product
    // node, and the shipping policy is fetched afterwards — so a row proven from the
    // policy page names a surface that is absent from its own checked list. That is
    // the engine's real output and this session must not edit it (it lives in a
    // matcher file). Publishing the discrepancy is the honest alternative to hiding
    // it, and it is exactly the attribution precision this row exists to demonstrate.
    r.evidenceSurface && !r.surfacesChecked.includes(r.evidenceSurface)
      ? `. <span class="bt-note">The evidence came from <strong>${esc(r.evidenceSurface)}</strong>, which is fetched separately from the product page and so does not appear in that list.</span>`
      : ""
  }</p>
</section>`;
}

export function renderDemo(d: DemoResult, base: string): SitePage {
  const canonical = `${base}/demo`;
  const snapshotDay = d.capturedAt.slice(0, 10);
  const stdHref = `/standards/${DEMO.standardSlug}/${DEMO.standardVersion}`;

  const summary = `${d.counts.pass} proven · ${d.counts.notProven} not proven${
    d.counts.requiresAccess ? ` · ${d.counts.requiresAccess} requires store access` : ""}`;

  return {
    title: `Example test — ${d.productName ?? d.host} against ${d.standard.doc.standard_id} v${d.standard.doc.version}`,
    description: `A real buyer test: ${d.standard.doc.standard_id} v${d.standard.doc.version} executed against a live coffee product page at ${d.host}. ${d.counts.total} requirements, ${summary}, each with the exact evidence sentence and the surface it was read from.`,
    canonical,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "TechArticle",
      headline: `Example buyer test — ${d.productName ?? d.host}`,
      url: canonical,
      about: { "@type": "CreativeWork", name: d.standard.doc.title, version: d.standard.doc.version },
    })}</script>`,
    bodyHtml: `<div class="bt-doc">
  <nav class="std-crumb"><a href="/">Home</a> / <a href="/standards">Standards</a></nav>
  <p class="bt-kicker">Example test</p>
  <h1>${esc(d.standard.doc.standard_id)} v${esc(d.standard.doc.version)}, executed against a real coffee product page</h1>

  <aside class="bt-provenance" role="note">
    <dl>
      <div><dt>Store</dt><dd><a href="${esc(d.productUrl)}" rel="nofollow noopener">${esc(d.storeName ?? d.host)}</a></dd></div>
      <div><dt>Product</dt><dd>${esc(d.productName ?? "—")}</dd></div>
      <div><dt>Page tested</dt><dd><a href="${esc(d.productUrl)}" rel="nofollow noopener">${esc(d.productUrl)}</a></dd></div>
      <div><dt>Page captured</dt><dd><time datetime="${esc(d.capturedAt)}">${esc(snapshotDay)}</time></dd></div>
      <div><dt>Standard</dt><dd><a href="${esc(stdHref)}">${esc(d.standard.doc.standard_id)} v${esc(d.standard.doc.version)}</a></dd></div>
      <div><dt>Content hash</dt><dd><code>${esc(d.standardHash)}</code></dd></div>
      ${d.contractVersion ? `<div><dt>Contract</dt><dd><code>${esc(d.contractVersion)}</code></dd></div>` : ""}
      <div><dt>Result</dt><dd><strong>${esc(summary)}</strong></dd></div>
    </dl>
    <p>This is a real result, not an illustration. It re-runs from a frozen capture of that page taken on ${esc(snapshotDay)}, so it costs nothing, never re-fetches, and returns the same answer every time. The store did not ask for this and has no involvement in it. Every sentence quoted below is the store's own — open the page and check.</p>
    <p class="bt-limit"><strong>What a "not proven" row is not.</strong> It means this page did not publish a statement that settles that requirement in a form a machine buyer could read. It is not a claim that the product lacks the property, and it is not a criticism of the coffee.</p>
  </aside>

  <section class="bt-scope">
    <h2>What was asked, and why exactly these ${d.rows.length}</h2>
    ${p(`The questions come from the published standard, not from us guessing what matters. ${esc(shortName(d.standard.doc))} v${esc(String(d.standard.doc.version))} carries ${d.standard.doc.entries.length} entries; ${d.applicability.requirements.length} of them both are executable against a public product page and apply to this product. The applicability rules were written before this test ran and are published beside the standard.`)}
    ${(() => {
      const skipped = d.applicability.decisions.filter((x) => !x.asked);
      return skipped.length
        ? `<p>${skipped.length} executable entr${skipped.length === 1 ? "y was" : "ies were"} not asked, each with its reason: ${
          esc(skipped.map((x) => `${x.entry} — ${x.detail ?? x.reason}`).join("; "))}. A list that drops entries silently is worse than one that runs them all: the reader cannot tell passing from not being asked.</p>`
        : `<p>No executable entry was excluded — all ${d.applicability.requirements.length} applied to this product, and all ${d.applicability.requirements.length} were asked.</p>`;
    })()}
    ${p(`Read from: ${d.raw.surfacesChecked.join(", ")}. Not publicly inspectable: ${d.raw.notInspectable.join(", ")}.`)}
  </section>

  <section class="bt-verdicts">
    <h2>What each verdict means</h2>
    ${p("Four states, and only one of them is a claim about the product. The distinction between “we could not read this” and “you do not publish this” is the difference between a finding and an accusation, and only one of them is ever true.")}
    <dl class="bt-legend">${
      // Only the states this result actually produced, each explained in the engine's
      // own terms. Listing states that did not occur would pad the page with a
      // vocabulary lesson instead of describing the result in front of the reader.
      [...new Set(d.rows.map((r) => r.status))]
        .map((s) => `<div><dt>${esc(STATUS_LABEL[s] ?? s)} <code>${esc(s)}</code></dt><dd>${esc(STATUS_MEANS[s] ?? "")}</dd></div>`)
        .join("")
    }</dl>
  </section>

  <section class="bt-rows">
    <h2>The ${d.rows.length} requirements</h2>
    ${d.rows.map((r) => rowHtml(d, r)).join("")}
  </section>

  ${boundSection(d)}

  <section class="bt-repro">
    <h2>Reproduce it</h2>
    ${p(`The capture is committed to this project as ${DEMO.fixtureDir}/${DEMO.host}.json.gz — the raw HTTP responses exactly as the store served them, so the sentences above can be checked against their source without fetching anything. The result is produced by the same engine that runs a merchant's own test, with the network swapped for that file.`)}
    <p class="bt-note"><a href="${esc(stdHref)}">Read the standard</a> · <a href="${esc(stdHref)}/standard.json">The standard as JSON</a> · <a href="/methodology">How this is built and measured</a></p>
  </section>
</div>`,
  };
}

/** The rendered page for `/demo`, or null when the path is not it. */
export async function demoPageFor(pathname: string, base: string): Promise<SitePage | null> {
  const p2 = pathname.replace(/\/+$/, "") || "/";
  if (p2 !== "/demo") return null;
  return renderDemo(await runDemo(), base);
}
