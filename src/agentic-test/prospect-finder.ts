import { extractBrandCandidates } from "./compiler.js";
import type { Stage5ProbeRecord } from "./stage5-battery.js";
import { PublicFetcher } from "./public-fetch.js";
import { fetchShopifyCatalog } from "./public-catalog.js";

// ===========================================================================
// STAGE 5 prospect extraction (spec 4.2). Deterministic, citation-only:
//   1. brand mention counts (reuse the Stage 3 extractor + its fixes);
//   2. resolve brands → domains from cited URLs in the SAME responses that
//      named them (no search-engine calls, no guessing);
//   3. detect Shopify hosting per domain (public /products.json probe);
//   4. WINNERS (frequently recommended, Shopify-hosted) vs CANDIDATE PROSPECTS
//      (Shopify-hosted, rarely/never recommended where peers are).
// Absence from a battery is WEAK evidence on its own — the diagnostic is what
// turns it into a finding (stated in the report).
// ===========================================================================

const RETAILER_HOSTS = new Set([
  "amazon.com", "target.com", "walmart.com", "etsy.com", "ebay.com", "reddit.com", "youtube.com",
  "google.com", "sephora.com", "ulta.com", "cvs.com", "walgreens.com", "costco.com", "instagram.com",
  "tiktok.com", "facebook.com", "pinterest.com", "wikipedia.org", "nytimes.com", "goodhousekeeping.com",
  "womenshealthmag.com", "healthline.com", "byrdie.com", "allure.com", "vogue.com", "cosmopolitan.com",
]);

export interface BrandDomain {
  brand: string;
  mentions: number;
  channels: string[];
  /** Best-guess own-domain from cited URLs in responses that named the brand. */
  domain: string | null;
  domainEvidenceUrl: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve a brand to its own domain using ONLY citations in responses that
 *  named it: pick the most-cited non-retailer host whose registrable name
 *  contains (or is contained by) the brand's normalized name. */
export function resolveBrandDomain(brand: string, records: Stage5ProbeRecord[]): { domain: string | null; evidenceUrl: string | null } {
  const key = norm(brand);
  if (key.length < 3) return { domain: null, evidenceUrl: null };
  const hostCounts = new Map<string, { n: number; url: string }>();
  const brandRe = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  for (const r of records) {
    if (!brandRe.test(r.responseText)) continue;
    for (const u of r.citations) {
      try {
        const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
        if (RETAILER_HOSTS.has(host)) continue;
        const hk = norm(host.split(".").slice(0, -1).join("")); // drop TLD
        if (!(hk.includes(key) || key.includes(hk))) continue;
        const e = hostCounts.get(host) ?? { n: 0, url: u };
        e.n++;
        hostCounts.set(host, e);
      } catch {
        /* opaque redirect URL — skip */
      }
    }
  }
  const best = [...hostCounts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return best ? { domain: best[0], evidenceUrl: best[1].url } : { domain: null, evidenceUrl: null };
}

export function extractBrandDomains(records: Stage5ProbeRecord[], extraStopwords: readonly string[] = []): BrandDomain[] {
  // The Stage 3 extractor expects {responseText, channel, citations}.
  const brands = extractBrandCandidates(records, extraStopwords);
  return brands.map((b) => {
    const { domain, evidenceUrl } = resolveBrandDomain(b.name, records);
    return { brand: b.name, mentions: b.count, channels: b.channels, domain, domainEvidenceUrl: evidenceUrl };
  });
}

export interface ProspectClassification {
  winners: Array<BrandDomain & { origin: string }>;
  candidates: Array<BrandDomain & { origin: string }>;
  skipped: Array<{ brand: string; reason: string }>;
}

/** Probe each resolved domain for Shopify hosting, then split into WINNERS
 *  (top-mentioned, Shopify) vs CANDIDATES (Shopify, low mention rank). */
export async function classifyProspects(
  fetcher: PublicFetcher,
  brands: BrandDomain[],
  opts: { winnerRankCutoff?: number } = {},
): Promise<ProspectClassification> {
  const cutoff = opts.winnerRankCutoff ?? 3;
  const winners: ProspectClassification["winners"] = [];
  const candidates: ProspectClassification["candidates"] = [];
  const skipped: ProspectClassification["skipped"] = [];

  const withDomain = brands.filter((b) => b.domain);
  for (const b of brands.filter((x) => !x.domain)) skipped.push({ brand: b.brand, reason: "no own-domain resolvable from citations" });

  let rank = 0;
  for (const b of withDomain) {
    rank++;
    const origin = `https://${b.domain}`;
    const cat = await fetchShopifyCatalog(fetcher, origin);
    if (!cat.isShopify) {
      skipped.push({ brand: b.brand, reason: "domain not Shopify-hosted (no public /products.json)" });
      continue;
    }
    const entry = { ...b, origin };
    if (rank <= cutoff && b.mentions >= 3) winners.push(entry);
    else candidates.push(entry);
  }
  return { winners, candidates, skipped };
}
