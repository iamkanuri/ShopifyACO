import type { Config, PromptEngineResult } from "../types.js";
import { detOf, detScore, grounded } from "./util.js";
import { engineLabel } from "../engines/labels.js";

// ---------------------------------------------------------------------------
// Cited-source analysis — the "AI trust graph". Aggregates the source URLs assistants CITED while
// answering, conditioned on OUTCOME (all answers / the answers you lost / per engine). This is
// OBSERVED, never causal: we report "the assistant cited this source while answering" with n=, never
// "the citation caused the win". Pure + dependency-free. Absent citations (old runs) → empty report.
// ---------------------------------------------------------------------------

// Common MULTI-PART public suffixes (second-level ccTLDs). We reduce a host to its REGISTRABLE domain,
// not a naive "last two labels" (which would mis-merge every example.co.uk into "co.uk"). The full
// Public Suffix List is huge and would be a dependency; this curated set covers the ccTLDs that
// realistically show up in shopping-answer citations. A suffix NOT in this set falls back to last-two.
const MULTI_PART_SUFFIXES = new Set<string>([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "gov.au", "edu.au", "id.au",
  "co.nz", "org.nz", "net.nz", "govt.nz", "ac.nz",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "com.jp",
  "co.kr", "or.kr", "ne.kr",
  "co.in", "net.in", "org.in", "gov.in", "ac.in", "firm.in",
  "com.br", "net.br", "org.br", "gov.br", "com.mx", "com.ar", "com.co", "com.pe", "com.uy",
  "com.cn", "net.cn", "org.cn", "gov.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.ph",
  "com.tr", "com.ua", "com.sa", "com.eg", "com.ng", "com.pk", "com.bd", "com.vn",
  "co.za", "org.za", "co.il", "co.id", "co.th", "co.ke",
]);

/**
 * A URL → its registrable domain (e.g. "https://www.blog.example.co.uk/p?x=1" → "example.co.uk").
 * Pure, dependency-free. Handles: http(s) only, www/subdomain stripping, paths, query strings, ports,
 * trailing dots, and common multi-part TLDs. Returns null for non-http(s), IPs, localhost, or garbage.
 */
export function registrableDomain(url: string): string | null {
  const raw = (url ?? "").trim();
  if (!raw) return null;

  // Reject non-http(s) schemes (mailto:, tel:, ftp:, javascript:, data:) — including the colon-only
  // forms that have no "//". A leading word with NO dot before ':' is a scheme; a word WITH a dot is a
  // host:port ("example.com:8443"), not a scheme, so we don't reject those.
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !scheme.includes(".") && scheme !== "http" && scheme !== "https") return null;

  let host: string;
  try {
    const hasHttp = /^https?:\/\//i.test(raw);
    const u = new URL(hasHttp ? raw : "http://" + raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase().replace(/\.$/, ""); // hostname drops port/path/query; strip trailing dot
  } catch {
    return null;
  }
  if (!host) return null;
  // Bare IPs are not a registrable domain — keep as-is so distinct IPs aren't merged (rare in citations).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return host;
  host = host.replace(/^www\./, "");
  if (!host.includes(".")) return null; // localhost / single-label host — not a real source
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host; // already registrable (example.com)
  const lastTwo = labels.slice(-2).join(".");
  // Multi-part suffix (co.uk) → registrable domain is the last THREE labels (example.co.uk).
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

export interface CitedSource {
  domain: string;
  /** Number of ANSWERS (in this bucket) that cited this domain — deduped per answer. */
  count: number;
  /** Up to a few example prompts where it was cited. */
  examplePrompts: string[];
}

export interface CitedSourceBucket {
  /** Number of answers IN THIS BUCKET that carried ≥1 citation (the honest denominator for `count`). */
  n: number;
  sources: CitedSource[];
}

export interface CitedSourcesReport {
  /** Across all grounded answers with citations. */
  overall: CitedSourceBucket;
  /** Only the answers the merchant LOST (a competitor out-ranked them) — where third-party proof decides it. */
  onLostAnswers: CitedSourceBucket;
  /** Per engine (friendly label), for "which assistant leans on which sources". */
  byEngine: Record<string, CitedSourceBucket>;
}

interface AnswerCitations {
  prompt: string;
  engine: string;
  domains: string[]; // registrable domains cited in this answer (may repeat pre-dedupe)
  lost: boolean;
}

/** Reduce a set of answers to a ranked domain bucket, counting each domain once per answer + n=. */
function bucket(answers: AnswerCitations[], exampleCap = 3): CitedSourceBucket {
  const acc = new Map<string, { count: number; prompts: Set<string> }>();
  let n = 0;
  for (const a of answers) {
    const uniqueDomains = [...new Set(a.domains)];
    if (uniqueDomains.length === 0) continue;
    n += 1;
    for (const d of uniqueDomains) {
      const e = acc.get(d) ?? { count: 0, prompts: new Set<string>() };
      e.count += 1;
      if (e.prompts.size < exampleCap) e.prompts.add(a.prompt);
      acc.set(d, e);
    }
  }
  const sources = [...acc.entries()]
    .map(([domain, e]) => ({ domain, count: e.count, examplePrompts: [...e.prompts] }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
  return { n, sources };
}

/** Build the cited-source report for a run. `results` is the persisted PromptEngineResult[]. */
export function analyzeCitedSources(results: PromptEngineResult[], cfg: Config): CitedSourcesReport {
  const ok = grounded(results);
  const answers: AnswerCitations[] = ok.map((r) => {
    const ownScore = detScore(detOf(r, cfg.brand.name));
    const lost = cfg.competitors.some((c) => detScore(detOf(r, c.name)) > ownScore);
    const domains = (r.citations ?? [])
      .map((u) => registrableDomain(u))
      .filter((d): d is string => Boolean(d));
    return { prompt: r.prompt, engine: r.engine, domains, lost };
  });

  const byEngine: Record<string, CitedSourceBucket> = {};
  for (const eng of new Set(answers.map((a) => a.engine))) {
    const b = bucket(answers.filter((a) => a.engine === eng));
    if (b.sources.length) byEngine[engineLabel(eng)] = b;
  }

  return {
    overall: bucket(answers),
    onLostAnswers: bucket(answers.filter((a) => a.lost)),
    byEngine,
  };
}
