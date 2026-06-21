import { ENV } from "../server/env.js";
import { DEFAULT_LIMITS, type FetchLimits, type FetchResult, isAllowedContentType, safeFetch } from "./fetch.js";
import { validateUrl } from "./ssrf.js";
import { detectInjection, htmlToText, type InjectionScan, sanitizeHtml, truncate } from "./sanitize.js";
import { extractPage, type ExtractedPage } from "./extract.js";
import { isAllowedByRobots, loadRobots, type RobotsPolicy } from "./robots.js";
import { mockFetch, mockRobots } from "./fixtures.js";

// ===========================================================================
// Bounded crawl orchestration. Given seed URLs (a merchant product page + the
// competitor pages the AI engines actually cited), fetch each safely, sanitize,
// extract structured signals, and scan for prompt injection. Strictly bounded:
// per-crawl page cap, depth cap, same-origin link-following only, dedupe, and
// robots.txt respect. CRAWLER_MODE=mock serves fixtures so the whole thing runs
// at $0 with no network. Live crawling hits the network and is gated by callers.
// ===========================================================================

export interface CrawledPage {
  url: string;
  finalUrl: string | null;
  origin: string | null;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  error: string | null;
  bytes: number;
  truncated: boolean;
  title: string | null;
  canonicalUrl: string | null;
  robotsIndex: boolean | null;
  extracted: ExtractedPage | null;
  injection: InjectionScan;
  textExcerpt: string | null;
  /** Same-origin links discovered (only populated when depth-crawling). */
  links: string[];
}

export interface CrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  respectRobots?: boolean;
  limits?: FetchLimits;
  /** Restrict discovered links to these origins (defaults to the seeds' origins). */
  sameOriginOnly?: boolean;
}

function originOf(u: string): string | null {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Mode-aware single fetch: fixtures under mock, the SSRF-safe fetcher under live. */
async function fetchPage(url: string, limits: FetchLimits): Promise<FetchResult> {
  if (ENV.crawler.mode === "mock") {
    const r = mockFetch(url);
    return {
      requestedUrl: url, finalUrl: url, status: r.status, contentType: r.contentType,
      body: r.body, bytes: Buffer.byteLength(r.body), truncated: false, redirects: 0,
    };
  }
  return safeFetch(url, limits);
}

async function robotsFor(origin: string, respect: boolean): Promise<RobotsPolicy> {
  if (!respect) return { rules: [], fetched: false };
  if (ENV.crawler.mode === "mock") {
    const text = mockRobots(origin);
    return text ? (await loadRobots(origin, text)) : { rules: [], fetched: false };
  }
  return loadRobots(origin);
}

/** Untrusted-text injection scan over everything a human/LLM would read. */
function scanVisible(extracted: ExtractedPage | null, textExcerpt: string | null): InjectionScan {
  const parts: string[] = [];
  if (textExcerpt) parts.push(textExcerpt);
  if (extracted) {
    if (extracted.title) parts.push(extracted.title);
    if (extracted.metaDescription) parts.push(extracted.metaDescription);
    parts.push(...extracted.headings.h1, ...extracted.headings.h2);
    for (const f of extracted.faqs) parts.push(f.q, f.a);
    if (extracted.product?.name) parts.push(extracted.product.name);
  }
  return detectInjection(parts.join("\n"));
}

function extractSameOriginLinks(html: string, baseUrl: string, allowedOrigins: Set<string>): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.size < 50) {
    let abs: string;
    try {
      abs = new URL(m[1]!, baseUrl).toString();
    } catch {
      continue;
    }
    const o = originOf(abs);
    if (o && allowedOrigins.has(o) && validateUrl(abs).ok) out.add(abs);
  }
  return [...out];
}

/** Crawl one URL into a CrawledPage. Never throws — failures are captured on the
 *  page (ok:false, error). Honors robots unless `policy` says allowed/absent. */
export async function crawlOne(url: string, opts: { limits: FetchLimits; policy?: RobotsPolicy; allowedOrigins?: Set<string> }): Promise<CrawledPage> {
  const base: CrawledPage = {
    url, finalUrl: null, origin: originOf(url), ok: false, status: null, contentType: null,
    error: null, bytes: 0, truncated: false, title: null, canonicalUrl: null, robotsIndex: null,
    extracted: null, injection: { flagged: false, terms: [] }, textExcerpt: null, links: [],
  };

  const check = validateUrl(url);
  if (!check.ok || !check.url) return { ...base, error: `blocked: ${check.reason}` };

  if (opts.policy && !isAllowedByRobots(opts.policy, check.url.pathname)) {
    return { ...base, error: "disallowed by robots.txt" };
  }

  try {
    const res = await fetchPage(url, opts.limits);
    base.finalUrl = res.finalUrl;
    base.origin = originOf(res.finalUrl) ?? base.origin;
    base.status = res.status;
    base.contentType = res.contentType;
    base.bytes = res.bytes;
    base.truncated = res.truncated;

    if (res.status < 200 || res.status >= 300) return { ...base, error: `HTTP ${res.status}` };
    if (!isAllowedContentType(res.contentType) || !res.body) return { ...base, ok: false, error: "unsupported or empty body" };

    // Extraction reads RAW html (JSON.parse is inert); the stored excerpt is sanitized.
    const extracted = extractPage(res.body);
    const textExcerpt = truncate(htmlToText(sanitizeHtml(res.body)), 4000);
    const injection = scanVisible(extracted, textExcerpt);
    const links = opts.allowedOrigins ? extractSameOriginLinks(res.body, res.finalUrl, opts.allowedOrigins) : [];

    return {
      ...base,
      ok: true,
      title: extracted.title,
      canonicalUrl: extracted.canonicalUrl,
      robotsIndex: extracted.robotsIndex,
      extracted,
      injection,
      textExcerpt,
      links,
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

/** Crawl a set of seed URLs with a hard page budget. Optional same-origin BFS up
 *  to maxDepth. Robots policies are fetched once per origin and cached. */
export async function crawlSeeds(seeds: string[], opts: CrawlOptions = {}): Promise<CrawledPage[]> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? ENV.crawler.maxPages, 50));
  const maxDepth = Math.max(0, Math.min(opts.maxDepth ?? ENV.crawler.maxDepth, 3));
  const respectRobots = opts.respectRobots ?? ENV.crawler.respectRobots;
  const limits = opts.limits ?? { maxBytes: ENV.crawler.maxBytes, timeoutMs: ENV.crawler.timeoutMs, maxRedirects: ENV.crawler.maxRedirects };

  const seedOrigins = new Set(seeds.map(originOf).filter((o): o is string => Boolean(o)));
  const allowedOrigins = opts.sameOriginOnly === false ? undefined : seedOrigins;

  const robotsCache = new Map<string, RobotsPolicy>();
  const seen = new Set<string>();
  const pages: CrawledPage[] = [];
  let frontier: Array<{ url: string; depth: number }> = seeds.map((u) => ({ url: u, depth: 0 }));

  while (frontier.length > 0 && pages.length < maxPages) {
    const { url, depth } = frontier.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const origin = originOf(url);
    let policy: RobotsPolicy | undefined;
    if (origin) {
      policy = robotsCache.get(origin);
      if (!policy) {
        policy = await robotsFor(origin, respectRobots);
        robotsCache.set(origin, policy);
      }
    }

    const page = await crawlOne(url, { limits, policy, allowedOrigins: depth < maxDepth ? allowedOrigins : undefined });
    pages.push(page);

    if (page.ok && depth < maxDepth) {
      for (const link of page.links) {
        if (!seen.has(link) && pages.length + frontier.length < maxPages) {
          frontier.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }
  return pages;
}

export { DEFAULT_LIMITS };
