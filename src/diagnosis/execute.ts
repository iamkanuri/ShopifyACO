import { ENV } from "../server/env.js";
import { registerHandler } from "../queue/handlers.js";
import { crawlSeeds, originOf } from "../crawler/crawl.js";
import { validateUrl } from "../crawler/ssrf.js";
import { diagnose, findLosses, summarizeFindings, type Finding } from "./diagnose.js";
import { clearFindings, getDiagnosisObservations, savePage, saveFinding } from "../db/crawler.js";
import { getBenchmark } from "../db/benchmarks.js";
import { getStorefrontUrl } from "../db/catalog.js";
import type { CrawledPage } from "../crawler/crawl.js";
import { MOCK_COMPETITOR_URL, MOCK_MERCHANT_URL } from "../crawler/fixtures.js";

// ===========================================================================
// Phase 5 orchestrator: turn a completed benchmark run into evidence-backed
// findings. It crawls the merchant's own page + the competitor pages the
// assistants cited, extracts structured signals, diagnoses the gap, and persists
// findings. CRAWLER_MODE=mock runs the whole thing against fixtures at $0 with NO
// network; live crawling makes outbound HTTP requests and is therefore GATED —
// the queue handler/route default to mock and require an explicit live opt-in.
// (Crawling spends no API money; the gate is for the network access itself.)
// ===========================================================================

export interface DiagnoseRunOptions {
  runId: number;
  shopDomain: string | null;
  merchantBrand: string;
  benchmarkId?: number | null;
  /** Merchant product/store page to crawl. Falls back to the benchmark config. */
  merchantUrl?: string | null;
  /** Explicit competitor URLs; else derived from the AI citations on lost answers. */
  competitorUrls?: string[];
  /** mock (default) serves fixtures with no network. live makes HTTP requests. */
  mock?: boolean;
}

export interface DiagnoseRunResult {
  runId: number;
  mode: "mock" | "live";
  pagesCrawled: number;
  lossesAnalyzed: number;
  findings: number;
  evidenceBacked: number;
  hygiene: number;
  injectionFlagged: number;
  topIntervention: string | null;
}

function dedupeValidUrls(urls: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (validateUrl(u).ok) out.push(u);
    if (out.length >= cap) break;
  }
  return out;
}

export async function diagnoseRun(opts: DiagnoseRunOptions): Promise<DiagnoseRunResult> {
  const mock = opts.mock ?? ENV.crawler.mode === "mock";
  const observations = await getDiagnosisObservations(opts.runId);
  const losses = findLosses(observations, opts.merchantBrand);

  // Resolve which pages to crawl.
  let merchantUrl = opts.merchantUrl ?? null;
  if (!merchantUrl && opts.benchmarkId != null) {
    const bench = await getBenchmark(opts.benchmarkId);
    merchantUrl = bench?.config.brand.storeUrl ?? bench?.config.brand.products?.[0] ?? null;
  }
  // Last resort (live only): the connected shop's own storefront, from a synced product page —
  // so a form-based benchmark (no storeUrl in its config) still crawls the merchant side, not
  // just competitors. Mock uses its fixture below.
  if (!merchantUrl && !mock && opts.shopDomain) {
    merchantUrl = await getStorefrontUrl(opts.shopDomain);
  }
  let competitorUrls = opts.competitorUrls ?? [...new Set(losses.flatMap((l) => l.citations))];

  // Mock fallback so the pipeline is verifiable at $0 even when the (mock) engine
  // produced no real citations.
  if (mock) {
    if (!merchantUrl) merchantUrl = MOCK_MERCHANT_URL;
    if (competitorUrls.length === 0) competitorUrls = [MOCK_COMPETITOR_URL];
  }

  // Citations are unioned across every brand in a lost answer, so a merchant-owned
  // URL can appear there. Never crawl/label our own pages as a competitor.
  const merchantOrigin = merchantUrl ? originOf(merchantUrl) : null;
  if (merchantOrigin) competitorUrls = competitorUrls.filter((u) => originOf(u) !== merchantOrigin);

  const maxCompetitors = Math.max(1, ENV.crawler.maxPages - 1);
  competitorUrls = dedupeValidUrls(competitorUrls, maxCompetitors);

  // Crawl (bounded). Merchant + competitors crawled as separate seed sets so each
  // page keeps its role. crawlOne never throws (and re-validates each URL itself —
  // no need to pre-validate here). Failures land on the page row.
  const merchantPages = merchantUrl ? await crawlSeeds([merchantUrl], { maxDepth: 0 }) : [];
  // A competitor URL can 30x-redirect onto the merchant's own origin; drop any whose
  // FINAL origin is the merchant's so we never feed the merchant's page in as a rival.
  const competitorPages = (competitorUrls.length > 0 ? await crawlSeeds(competitorUrls, { maxDepth: 0 }) : [])
    .filter((p) => !merchantOrigin || originOf(p.finalUrl ?? p.url) !== merchantOrigin);

  const merchantPage: CrawledPage | null = merchantPages[0] ?? null;
  const competitorMap = new Map<string, CrawledPage>();
  for (const p of competitorPages) competitorMap.set(p.finalUrl ?? p.url, p);

  // Persist crawl artifacts (sanitized, untrusted). Best-effort + concurrent; never
  // blocks findings if the DB is briefly unavailable for one row.
  let injectionFlagged = 0;
  const persist = async (page: CrawledPage, role: "merchant" | "competitor", brand: string | null) => {
    if (page.injection.flagged) injectionFlagged++;
    try {
      await savePage({ shopDomain: opts.shopDomain, runId: opts.runId, role, brand }, page);
    } catch (err) {
      console.error("[diagnose] savePage failed:", (err as Error).message);
    }
  };
  await Promise.all([
    ...(merchantPage ? [persist(merchantPage, "merchant", opts.merchantBrand)] : []),
    // Best-effort brand label for a competitor page from its extracted product brand.
    ...competitorPages.map((p) => persist(p, "competitor", p.extracted?.product?.brand ?? null)),
  ]);

  // Diagnose + persist findings (replace prior findings for this run → idempotent).
  const findings: Finding[] = diagnose({
    merchantBrand: opts.merchantBrand,
    observations,
    merchantPage,
    competitorPages: competitorMap,
  });
  try {
    await clearFindings(opts.runId);
    for (const f of findings) await saveFinding(opts.shopDomain, opts.runId, opts.benchmarkId ?? null, f);
  } catch (err) {
    console.error("[diagnose] persist findings failed:", (err as Error).message);
  }

  const summary = summarizeFindings(findings);
  return {
    runId: opts.runId,
    mode: mock ? "mock" : "live",
    pagesCrawled: (merchantPage ? 1 : 0) + competitorPages.length,
    lossesAnalyzed: losses.length,
    findings: summary.total,
    evidenceBacked: summary.evidenceBacked,
    hygiene: summary.hygiene,
    injectionFlagged,
    topIntervention: summary.topIntervention,
  };
}

/** Register the queue handler so diagnoses can run on the worker. Defaults to mock;
 *  a live crawl requires payload.live === true (network access is opt-in). */
export function registerDiagnosisJobs(): void {
  registerHandler("evidence_diagnose", async (payload) => {
    const runId = Number(payload.runId);
    if (!Number.isInteger(runId)) throw new Error("evidence_diagnose: missing runId");
    const r = await diagnoseRun({
      runId,
      shopDomain: payload.shop ? String(payload.shop) : null,
      merchantBrand: String(payload.merchantBrand ?? ""),
      benchmarkId: payload.benchmarkId != null ? Number(payload.benchmarkId) : null,
      merchantUrl: payload.merchantUrl ? String(payload.merchantUrl) : null,
      competitorUrls: Array.isArray(payload.competitorUrls) ? (payload.competitorUrls as unknown[]).map(String) : undefined,
      mock: payload.live === true ? false : true,
    });
    return { ...r };
  });
}
