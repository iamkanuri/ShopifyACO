import { pgQuery } from "./pg.js";
import type { CrawledPage } from "../crawler/crawl.js";
import type { Finding } from "../diagnosis/diagnose.js";
import type { DiagnosisObservation } from "../diagnosis/diagnose.js";

// Persistence for Phase 5 crawl artifacts + findings. All stored content is
// untrusted (sanitized before storage); writes are shop-scoped. Upsert on
// (run_id, url) so re-crawling a run converges instead of duplicating.

export interface PersistedPageMeta {
  shopDomain: string | null;
  runId: number | null;
  role: "merchant" | "competitor";
  brand: string | null;
}

export async function savePage(meta: PersistedPageMeta, page: CrawledPage): Promise<void> {
  await pgQuery(
    `insert into crawl_pages
       (shop_domain, run_id, role, brand, url, final_url, origin, http_status, content_type, ok, error,
        bytes, truncated, title, canonical_url, robots_index, extracted, injection_flag, injection_terms, text_excerpt)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::jsonb,$20)
     on conflict (coalesce(run_id, 0), url) do update set
       role=excluded.role, brand=excluded.brand, final_url=excluded.final_url, origin=excluded.origin,
       http_status=excluded.http_status, content_type=excluded.content_type, ok=excluded.ok, error=excluded.error,
       bytes=excluded.bytes, truncated=excluded.truncated, title=excluded.title, canonical_url=excluded.canonical_url,
       robots_index=excluded.robots_index, extracted=excluded.extracted, injection_flag=excluded.injection_flag,
       injection_terms=excluded.injection_terms, text_excerpt=excluded.text_excerpt, fetched_at=now()`,
    [
      meta.shopDomain, meta.runId, meta.role, meta.brand, page.url, page.finalUrl, page.origin,
      page.status, page.contentType, page.ok, page.error, page.bytes, page.truncated, page.title,
      page.canonicalUrl, page.robotsIndex, JSON.stringify(page.extracted ?? {}), page.injection.flagged,
      JSON.stringify(page.injection.terms), page.textExcerpt,
    ],
  );
}

export async function saveFinding(shop: string | null, runId: number | null, benchmarkId: number | null, f: Finding): Promise<void> {
  await pgQuery(
    `insert into findings
       (shop_domain, run_id, benchmark_id, kind, signal, intent, prompt_text, engine, merchant_brand, winning_competitor,
        ai_answer_snippet, citations, merchant_gap, competitor_advantage, confidence_level, basis_n, limits,
        recommended_intervention, expected_mechanism)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19)`,
    [
      shop, runId, benchmarkId, f.kind, f.signal ?? null, f.intent, f.promptText, f.engine, f.merchantBrand, f.winningCompetitor,
      f.aiAnswerSnippet, JSON.stringify(f.citations), JSON.stringify(f.merchantGap), JSON.stringify(f.competitorAdvantage),
      f.confidenceLevel, f.basisN, f.limits, f.recommendedIntervention, f.expectedMechanism,
    ],
  );
}

/** Replace a run's findings (idempotent re-diagnosis). */
export async function clearFindings(runId: number): Promise<void> {
  await pgQuery("delete from findings where run_id=$1", [runId]);
}

export async function listFindings(shop: string, opts: { runId?: number; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  if (opts.runId != null) {
    const { rows } = await pgQuery(
      "select * from findings where shop_domain=$1 and run_id=$2 order by (kind='evidence_backed') desc, basis_n desc, created_at desc limit $3",
      [shop, opts.runId, limit],
    );
    return rows;
  }
  const { rows } = await pgQuery(
    "select * from findings where shop_domain=$1 order by created_at desc limit $2",
    [shop, limit],
  );
  return rows;
}

/** Count findings for a shop (optionally scoped to one run). */
export async function countFindings(shop: string, opts: { runId?: number } = {}): Promise<number> {
  const { rows } = await pgQuery<{ n: string }>(
    "select count(*)::int as n from findings where shop_domain=$1 and ($2::bigint is null or run_id=$2)",
    [shop, opts.runId ?? null],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function listCrawlPages(shop: string, runId: number): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery(
    `select role, brand, url, final_url, ok, http_status, error, robots_index, injection_flag, injection_terms,
            title, canonical_url, extracted, fetched_at
       from crawl_pages where shop_domain=$1 and run_id=$2 order by role, url`,
    [shop, runId],
  );
  return rows;
}

/** Observations enriched for diagnosis (citations + snippet + intent). */
export async function getDiagnosisObservations(runId: number): Promise<DiagnosisObservation[]> {
  const { rows } = await pgQuery<{
    response_id: string | null; engine: string; intent: string | null; prompt_text: string;
    target_brand: string; recommendation_status: string; rank: number | null; citations: unknown; evidence_snippet: string | null;
  }>(
    `select response_id, engine, intent, prompt_text, target_brand, recommendation_status, rank, citations, evidence_snippet
       from observations where run_id=$1`,
    [runId],
  );
  return rows.map((r) => ({
    responseId: r.response_id,
    engine: r.engine,
    intent: r.intent,
    promptText: r.prompt_text,
    targetBrand: r.target_brand,
    recommendationStatus: r.recommendation_status,
    rank: r.rank,
    citations: Array.isArray(r.citations) ? (r.citations as unknown[]).map(String) : [],
    evidenceSnippet: r.evidence_snippet,
  }));
}
