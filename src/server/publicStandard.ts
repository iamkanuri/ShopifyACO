// ===========================================================================
// RUN A PUBLISHED STANDARD AGAINST A LIVE PUBLIC PRODUCT URL (v4.1).
//
// THE GAP THIS CLOSES, stated plainly because it was the product's central confusion:
// `/test` has never run a published standard. It runs `buildBuyerTask`'s GENERATED
// requirements, so its response carries no `standard` and no `contractVersion` — for a
// coffee product exactly as for a bath mat. Coffee Standard v1.3 was executed only by
// `/demo`, against a frozen capture of one store. Meanwhile the landing page told every
// visitor that AisleLens "executes a published buying standard against the page", and the
// button beside that sentence delivered the general engine. The builder of this product
// could not say which layer ran on a non-coffee store, which means no visitor could.
//
// ⚠️ THIS IS PLUMBING, NOT A MATCHER CHANGE. Every seam already existed and none is
// touched: `RunOptions.requirements` and `RunOptions.standard` (G-09), `compileStandard`,
// and `applyApplicability` (G-10). `src/server/productTest.ts` is not modified — the engine
// is forbidden from importing `standards/`, so the wiring has to live here, on the server
// side of that boundary, exactly as `buyerTestDemo.ts` already does.
//
// ⚠️ THE APPLICABILITY REFUSAL IS THE PRODUCT, NOT AN ERROR PATH. When the standard does
// not cover a product, saying so precisely — and naming which signal decided it — is the
// honest answer and the one that teaches a reader what a published standard IS. It is
// returned as a RESULT, never thrown, and `unknown_category` is kept distinct from
// `out_of_category`: "we could not classify this page" and "this is not coffee" are
// different sentences and only one of them is about the merchant.
//
// ⚠️ COST, stated rather than discovered later. This runs TWO fetch sequences: one to
// classify (the standard cannot be applied to a product nobody has read) and one inside
// `runProductTest`. A pinned run also bypasses the 7-day result cache in BOTH directions
// by design — the cache is keyed on URL alone, so without that a conformance result would
// be served to the public funnel and vice versa. So this path is never free and never
// cached, which is why it is an explicit action a visitor takes rather than something that
// happens on every test.
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import {
  fetchPublicProduct, runProductTest,
  type ProductTestResult, type RunOptions,
} from "./productTest.js";
import { compileStandard, duplicateLabels, type Standard } from "../../standards/compile.js";
import { hashMatches } from "../../standards/hash.js";
import { applyApplicability, type Sidecar, type ApplicabilityReport } from "../../standards/applicability.js";
import { currentOf, measuredOf, type PublishedStandard } from "./standardsSite.js";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..",
);

/** What one entry's peer line says, DERIVED from the published measurement. */
export interface PeerRate {
  entryId: string;
  label: string;
  /** Rows the measured sample could actually decide. NOT always 100 — see below. */
  adjudicated: number;
  /** How many of those the sample's stores FAILED. */
  failed: number;
  /** …and passed. `adjudicated - failed`, computed here so it cannot drift. */
  passed: number;
  failPct: number;
  /**
   * ⚠️ ROWS THE ENGINE COULD NOT DECIDE, EXCLUDED FROM THE DENOMINATOR. On DELIV-001 the
   * sample asked 100 products and could decide 74; counting the other 26 as passes is a
   * different measurement and this repo has published both by accident before. When this
   * is non-zero the sentence must say "of the N we could decide", never "of 100".
   */
  undecided: number;
  asked: number;
}

export interface StandardRunResult {
  ok: boolean;
  /** The URL as given. */
  productUrl: string;
  /** Set when the standard could not be applied — the honest refusal, not an error. */
  notApplicable?: {
    verdict: string;
    signal: string;
    text: string | null;
    detail: string;
    /** Which entries were skipped and why, so "nothing ran" is never silent. */
    skipped: Array<{ entry: string; reason: string; detail: string }>;
  };
  error?: string;
  errorKind?: string;
  retryable?: boolean;
  /** The identity a citation resolves through. */
  standard?: { id: string; version: string; hash: string; slug: string; url: string; title: string };
  /** Per-entry citation URLs, so every row is checkable. */
  entryUrls?: Record<string, string>;
  peers?: PeerRate[];
  result?: ProductTestResult;
  ranAt?: string;
}

/** Load the current published standard for a slug, with its sidecar and compiled rows. */
function loadStandard(slug: string): {
  published: PublishedStandard; standard: Standard; sidecar: Sidecar;
  requirements: ReturnType<typeof compileStandard>["requirements"]; hash: string;
} {
  const published = currentOf(slug);
  if (!published) throw new Error(`no published standard for '${slug}'`);
  const standard = JSON.parse(published.rawJson) as Standard;
  const h = hashMatches(standard);
  // A result that cannot name the exact text it tested against is not citable, which is
  // the entire proposition. Refuse rather than run.
  if (!h.ok) throw new Error("standard hash mismatch — refusing to run a contract that cannot be cited");
  const sidecar = JSON.parse(
    fs.readFileSync(path.join(repoRoot, published.dir, "applicability.json"), "utf8"),
  ) as Sidecar;
  const report = compileStandard(standard);
  if (report.errors.length) throw new Error(`incomplete compile: ${report.errors.join("; ")}`);
  const dupes = duplicateLabels(report.requirements);
  if (dupes.length) throw new Error(`duplicate requirement labels collide: ${dupes.join(", ")}`);
  return { published, standard, sidecar, requirements: report.requirements, hash: h.computed };
}

/**
 * The peer line, derived per entry from the PUBLISHED measurement.
 *
 * ⚠️ `measuredOf`, NEVER the raw field. v1.3 carries IDENT-001's rate in its sidecar and
 * the rest inside the document, and reading `standard.json` directly publishes the
 * superseded number for that one entry (94.7% where the current record is 97.4%). This is
 * the fourth distinct place in this codebase where reading a raw measurement field instead
 * of the normaliser produced a confidently wrong page.
 *
 * ⚠️ AND THE DENOMINATOR IS NOT ALWAYS 100. Five of the ten measured entries were asked of
 * fewer than 100 products, each for a recorded reason (24 products publish no Product
 * schema, so IDENT-001 was asked of 76; one is pre-portioned, so the FORMAT and GRIND
 * entries were asked of 99). A peer sentence that says "of 100 coffee stores" is false for
 * half of them.
 */
export function peerRatesFor(
  published: PublishedStandard,
  requirementIds: string[],
): PeerRate[] {
  const byId = new Map(published.doc.entries.map((e) => [e.id, e]));
  const out: PeerRate[] = [];
  for (const id of requirementIds) {
    const entry = byId.get(id);
    if (!entry) continue;
    const m = measuredOf(published, entry);
    if (!m || m.fail_count === undefined) continue;
    const adjudicated = m.adjudicated ?? m.asked;
    out.push({
      entryId: id,
      label: entry.question ?? entry.id,
      adjudicated,
      failed: m.fail_count,
      passed: adjudicated - m.fail_count,
      failPct: m.fail_pct,
      undecided: m.asked - adjudicated,
      asked: m.asked,
    });
  }
  return out;
}

/**
 * Run the current published standard for `slug` against a live product URL.
 *
 * Never throws for a merchant-caused condition: a fetch failure, an out-of-category
 * product and an unclassifiable page all come back as data.
 */
export async function runStandardTest(
  url: string,
  slug = "coffee",
  deps: RunOptions = {},
): Promise<StandardRunResult> {
  let loaded: ReturnType<typeof loadStandard>;
  try {
    loaded = loadStandard(slug);
  } catch (e) {
    // A broken artifact is OUR fault and must not read as a finding about the store.
    return { ok: false, productUrl: url, error: (e as Error).message, errorKind: "standard_unavailable" };
  }
  const { published, standard, sidecar, requirements, hash } = loaded;

  // ---- pass 1: read the product, so the standard can be applied to something ----
  const pre = await fetchPublicProduct(url, deps);
  if (!pre.product) {
    return {
      ok: false, productUrl: url,
      error: pre.error?.message, errorKind: pre.error?.kind,
      retryable: pre.error?.kind === "rate_limited" || pre.error?.kind === "unreachable",
    };
  }
  const p = pre.product;

  const applicability: ApplicabilityReport = applyApplicability(requirements, sidecar, {
    title: p.title ?? null,
    ldCategory: null,
    breadcrumb: null,
    hasProductSchema: p.extracted?.signals?.productSchema ?? undefined,
    optionValues: p.optionValues ?? [],
    productType: p.productType ?? null,
  });

  const base = {
    productUrl: url,
    standard: {
      id: standard.standard_id, version: String(standard.version), hash,
      slug, url: `/standards/${slug}/${published.publicVersion}`,
      title: String(standard.title ?? ""),
    },
  };

  if (applicability.state === "INCOMPLETE") {
    // ⚠️ NOT AN ERROR. "This standard does not cover this product" is a true, useful
    // answer, and it is the one that explains what a published standard is for.
    const c = applicability.classification;
    return {
      ...base, ok: false,
      notApplicable: {
        verdict: c.verdict, signal: c.signal, text: c.text ?? null,
        detail: applicability.blockedBy ?? "no entry in this standard applies to this product",
        skipped: applicability.decisions.filter((d) => !d.asked)
          .map((d) => ({ entry: d.entry, reason: d.reason ?? "", detail: d.detail ?? "" })),
      },
    };
  }

  // ---- pass 2: the pinned run ----
  const result = await runProductTest(url, {
    ...deps,
    requirements: applicability.requirements,
    standard: { id: standard.standard_id, version: String(standard.version), hash },
  });
  if (!result.ok) {
    return {
      ...base, ok: false, error: result.error, errorKind: result.errorKind,
      retryable: result.retryable,
    };
  }

  const askedIds = applicability.requirements.map((r) => r.id);
  const entryUrls: Record<string, string> = {};
  for (const id of askedIds) entryUrls[id] = `${base.standard.url}/${encodeURIComponent(id)}`;

  return {
    ...base, ok: true, result,
    entryUrls,
    peers: peerRatesFor(published, askedIds),
    ranAt: new Date().toISOString(),
  };
}
