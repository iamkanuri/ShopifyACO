// Pure, dependency-free AI-referrer classification (Phase 10). Given a session's
// referrer URL and/or utm_source, decide whether it came from an AI assistant and
// which one. This is the SERVER-AUTHORITATIVE classifier (the storefront pixel does a
// minimal client-side check to decide whether to beacon at all; the server re-derives
// the source so the logic can be updated without redeploying the pixel).
//
// DELIBERATELY CONSERVATIVE to avoid false positives: plain google.com / bing.com are
// ORGANIC search, not AI — only the assistant subdomains (gemini.google.com,
// copilot.microsoft.com, …) count. Attribution is directional, so a miss is far better
// than mislabeling normal search traffic as "AI-referred".

export type AiSource = "ChatGPT" | "Perplexity" | "Gemini" | "Copilot" | "Claude";

// Registrable domains / exact hosts that identify each assistant. A referrer host
// matches a pattern when it equals the pattern or is a subdomain of it.
const HOST_SOURCES: Array<{ source: AiSource; hosts: string[] }> = [
  { source: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com", "openai.com"] },
  { source: "Perplexity", hosts: ["perplexity.ai"] },
  { source: "Gemini", hosts: ["gemini.google.com", "bard.google.com"] },
  { source: "Copilot", hosts: ["copilot.microsoft.com"] },
  { source: "Claude", hosts: ["claude.ai"] },
];

// utm_source values (lower-cased) that explicitly tag AI traffic.
const UTM_SOURCES: Record<string, AiSource> = {
  chatgpt: "ChatGPT", openai: "ChatGPT", "chat.openai.com": "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini", bard: "Gemini", googleai: "Gemini",
  copilot: "Copilot", "bing-copilot": "Copilot",
  claude: "Claude", "claude.ai": "Claude",
};

/** Extract a lower-cased host from a URL-ish string. Returns null if unparseable
 *  or not http(s). Tolerates a bare host (no scheme). */
export function referrerHost(referrer: string | undefined | null): string | null {
  if (!referrer || typeof referrer !== "string") return null;
  const raw = referrer.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase() || null;
  } catch {
    // Bare host fallback ("chatgpt.com" or "chatgpt.com/path").
    const host = raw.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0]!.toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
  }
}

const hostMatches = (host: string, pattern: string): boolean =>
  host === pattern || host.endsWith("." + pattern);

export interface AiClassification {
  isAi: boolean;
  source: AiSource | null;
  referrerHost: string | null;
}

/** Classify a session's origin. The referrer host wins; utm_source is the fallback
 *  (and the only signal when the referrer was stripped, which AI assistants often do). */
export function classifyAiReferrer(input: { referrer?: string | null; utmSource?: string | null }): AiClassification {
  const host = referrerHost(input.referrer);
  if (host) {
    for (const { source, hosts } of HOST_SOURCES) {
      if (hosts.some((h) => hostMatches(host, h))) return { isAi: true, source, referrerHost: host };
    }
  }
  const utm = input.utmSource?.trim().toLowerCase();
  if (utm && UTM_SOURCES[utm]) return { isAi: true, source: UTM_SOURCES[utm], referrerHost: host };
  return { isAi: false, source: null, referrerHost: host };
}
