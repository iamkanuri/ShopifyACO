// Normalize the source URLs an engine cites for an answer. Pure + dependency-free. The
// crawler (Phase 5) re-validates every URL for SSRF before fetching, so this only has to
// produce a clean, de-duped, http(s)-only, bounded list — never a trust decision.

const DEFAULT_CAP = 25;

/** Keep only http(s) URLs, trimmed + de-duped, capped to a sane maximum. */
export function dedupeHttpUrls(urls: Array<string | undefined | null>, cap = DEFAULT_CAP): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    const t = u.trim();
    if (!/^https?:\/\//i.test(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}
