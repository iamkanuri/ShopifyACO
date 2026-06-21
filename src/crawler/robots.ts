import { safeFetch } from "./fetch.js";
import { validateUrl } from "./ssrf.js";

// Minimal, polite robots.txt support. We parse Allow/Disallow for our own
// user-agent (falling back to '*') and honor the most-specific (longest) match —
// the de-facto rule modern crawlers use. Bounded fetch (the SSRF-safe fetcher),
// fail-OPEN only on transport errors (a missing robots.txt means "allowed"), and
// fail-CLOSED is never required because we already gate hosts via the SSRF guard.

export const CRAWLER_UA_TOKEN = "aislelensbot";

interface RobotsRule {
  path: string;
  allow: boolean;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  fetched: boolean; // false => no robots.txt (treat as allow-all)
}

/** Parse robots.txt text into the rule set that applies to our UA. */
export function parseRobots(text: string, uaToken = CRAWLER_UA_TOKEN): RobotsPolicy {
  const lines = text.split(/\r?\n/);
  // Group directives by the user-agent block they belong to.
  let activeAgents: string[] = [];
  const byAgent = new Map<string, RobotsRule[]>();
  let sawGroupStart = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (sawGroupStart) {
        activeAgents = [];
        sawGroupStart = false;
      }
      const agent = value.toLowerCase();
      activeAgents.push(agent);
      if (!byAgent.has(agent)) byAgent.set(agent, []);
    } else if (field === "allow" || field === "disallow") {
      sawGroupStart = true;
      for (const agent of activeAgents) {
        const list = byAgent.get(agent) ?? byAgent.set(agent, []).get(agent)!;
        // An empty Disallow value means "allow everything" — skip adding a rule.
        if (field === "disallow" && value === "") continue;
        list.push({ path: value, allow: field === "allow" });
      }
    }
  }

  const rules = byAgent.get(uaToken) ?? byAgent.get("*") ?? [];
  return { rules, fetched: true };
}

/** Is `pathname` allowed by the policy? Longest matching rule wins; Allow beats
 *  Disallow on an equal-length tie. No matching rule => allowed. */
export function isAllowedByRobots(policy: RobotsPolicy, pathname: string): boolean {
  if (!policy.fetched || policy.rules.length === 0) return true;
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (matchesPath(rule.path, pathname)) {
      if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
        best = rule;
      }
    }
  }
  return best ? best.allow : true;
}

/** robots.txt path matching with `*` wildcard and `$` end-anchor support. */
function matchesPath(pattern: string, pathname: string): boolean {
  if (pattern === "") return false;
  if (pattern === "/") return true;
  const hasEnd = pattern.endsWith("$");
  const core = hasEnd ? pattern.slice(0, -1) : pattern;
  const parts = core.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("^" + parts.join(".*") + (hasEnd ? "$" : ""));
  return re.test(pathname);
}

/** Fetch + parse a host's robots.txt. Returns an allow-all policy when there is
 *  no robots.txt or it can't be read. mockText short-circuits the network. */
export async function loadRobots(origin: string, mockText?: string): Promise<RobotsPolicy> {
  if (mockText !== undefined) return parseRobots(mockText);
  const robotsUrl = `${origin.replace(/\/$/, "")}/robots.txt`;
  if (!validateUrl(robotsUrl).ok) return { rules: [], fetched: false };
  try {
    const res = await safeFetch(robotsUrl, { maxBytes: 256_000, timeoutMs: 8_000, maxRedirects: 2 });
    if (res.status >= 200 && res.status < 300 && res.body) return parseRobots(res.body);
    return { rules: [], fetched: false }; // 4xx/5xx => no usable policy => allow
  } catch {
    return { rules: [], fetched: false };
  }
}
