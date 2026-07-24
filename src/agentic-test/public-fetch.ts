import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isAllowedByRobots, parseRobots, type RobotsPolicy } from "../crawler/robots.js";

// ===========================================================================
// STAGE 5 — polite, read-only public fetcher for third-party Shopify stores.
// Rule 1/2 discipline is enforced HERE so nothing downstream can bypass it:
//   • only http(s) GET to public catalog/page endpoints; no auth headers ever;
//   • robots.txt checked before every path (fetched once per host, cached);
//   • ≤1 request / 2 s per host AND ≤10 requests total per host;
//   • every response cached to disk (no URL fetched twice, ever);
//   • descriptive UA with a contact URL;
//   • 403/429 → skip host + record; password/login/checkout paths refused.
// The HTTP transport is injectable so tests exercise the policy with no network.
// ===========================================================================

export const STAGE5_UA =
  "aislelensbot/0.1 (+https://lens.thirdocular.com/about; read-only public-catalog research diagnostic)";
export const PER_HOST_REQUEST_CAP = 10;
export const MIN_INTERVAL_MS = 2000;

/** Cache dir — env-overridable so tests isolate their disk cache. */
function cacheDir(): string {
  return process.env.STAGE5_CACHE_DIR ?? join(process.cwd(), "experiments", "stage5", "cache");
}

export interface HttpResponse {
  status: number;
  contentType: string;
  body: string;
  fromCache?: boolean;
}
export type HttpGet = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

/** Real transport (global fetch, follows redirects, byte-capped, timed out). */
export const realHttpGet: HttpGet = async (url, headers) => {
  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: text.slice(0, 3_000_000) };
};

/** Refuse anything that isn't a permitted PUBLIC read path (Rule 1). */
export function isPermittedPublicPath(pathname: string): boolean {
  if (/\/(admin|cart|checkout|checkouts|orders|account|customer|apps|services)\b/i.test(pathname)) return false;
  return (
    /^\/products\.json$/.test(pathname) ||
    /^\/products\/[^/]+\.js$/.test(pathname) ||
    /^\/products\/[^/]+$/.test(pathname) ||
    /^\/collections\/[^/]+\/products\.json$/.test(pathname) ||
    /^\/policies\/[^/]+$/.test(pathname) ||
    /^\/pages\/[^/]+$/.test(pathname) ||
    pathname === "/robots.txt"
  );
}

export interface FetchLogEntry {
  url: string;
  status: number;
  fromCache: boolean;
  skippedReason?: string;
  timestamp: string;
}

export class PublicFetcher {
  private readonly http: HttpGet;
  private readonly now: () => number;
  private readonly robotsByHost = new Map<string, RobotsPolicy>();
  private readonly countByHost = new Map<string, number>();
  private readonly lastFetchAtByHost = new Map<string, number>();
  private readonly blockedHosts = new Set<string>();
  readonly log: FetchLogEntry[] = [];

  constructor(opts: { http?: HttpGet; now?: () => number } = {}) {
    this.http = opts.http ?? realHttpGet;
    this.now = opts.now ?? Date.now;
  }

  private cacheKey(url: string): string {
    return join(cacheDir(), `${createHash("sha256").update(url).digest("hex").slice(0, 24)}.json`);
  }
  private readCache(url: string): HttpResponse | null {
    const f = this.cacheKey(url);
    if (!existsSync(f)) return null;
    try {
      return { ...(JSON.parse(readFileSync(f, "utf8")) as HttpResponse), fromCache: true };
    } catch {
      return null;
    }
  }
  private writeCache(url: string, res: HttpResponse): void {
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(this.cacheKey(url), JSON.stringify({ url, ...res }), "utf8");
  }

  private record(url: string, status: number, fromCache: boolean, skippedReason?: string): void {
    this.log.push({ url, status, fromCache, skippedReason, timestamp: new Date(this.now()).toISOString() });
  }

  private async loadRobots(origin: string, host: string): Promise<RobotsPolicy> {
    const cached = this.robotsByHost.get(host);
    if (cached) return cached;
    const robotsUrl = `${origin}/robots.txt`;
    const disk = this.readCache(robotsUrl);
    let policy: RobotsPolicy;
    if (disk) {
      policy = disk.status === 200 ? parseRobots(disk.body) : { rules: [], fetched: false };
    } else {
      await this.throttle(host);
      let res: HttpResponse;
      try {
        res = await this.http(robotsUrl, { "user-agent": STAGE5_UA });
      } catch {
        res = { status: 0, contentType: "", body: "" };
      }
      this.bump(host);
      this.writeCache(robotsUrl, res);
      policy = res.status === 200 ? parseRobots(res.body) : { rules: [], fetched: false };
    }
    this.robotsByHost.set(host, policy);
    return policy;
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastFetchAtByHost.get(host);
    if (last !== undefined) {
      const wait = MIN_INTERVAL_MS - (this.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    this.lastFetchAtByHost.set(host, this.now());
  }
  private bump(host: string): void {
    this.countByHost.set(host, (this.countByHost.get(host) ?? 0) + 1);
  }

  /** Fetch a public URL under full policy. Returns null when refused/skipped
   *  (reason recorded in the log). Cached URLs never count toward the host cap. */
  async get(url: string): Promise<HttpResponse | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      this.record(url, 0, false, "unparseable-url");
      return null;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      this.record(url, 0, false, "non-http-scheme");
      return null;
    }
    if (u.username || u.password) {
      this.record(url, 0, false, "url-credentials-refused");
      return null;
    }
    const host = u.hostname.toLowerCase();
    if (this.blockedHosts.has(host)) {
      this.record(url, 0, false, "host-blocked");
      return null;
    }
    if (!isPermittedPublicPath(u.pathname)) {
      this.record(url, 0, false, "path-not-a-permitted-public-endpoint");
      return null;
    }

    // Cache first — a cached URL is free (Rule 2: never fetch a URL twice).
    const disk = this.readCache(url);
    if (disk) {
      this.record(url, disk.status, true);
      return disk;
    }

    // robots.txt (except for robots.txt itself).
    if (u.pathname !== "/robots.txt") {
      const policy = await this.loadRobots(`${u.protocol}//${u.host}`, host);
      if (!isAllowedByRobots(policy, u.pathname)) {
        this.record(url, 0, false, "robots-disallow");
        return null;
      }
    }

    if ((this.countByHost.get(host) ?? 0) >= PER_HOST_REQUEST_CAP) {
      this.record(url, 0, false, "per-host-cap-reached");
      return null;
    }

    await this.throttle(host);
    let res: HttpResponse;
    try {
      res = await this.http(url, { "user-agent": STAGE5_UA, accept: "application/json,text/html,*/*" });
    } catch (err) {
      this.record(url, 0, false, `transport-error:${(err as Error).message.slice(0, 40)}`);
      return null;
    }
    this.bump(host);
    if (res.status === 403 || res.status === 429) {
      this.blockedHosts.add(host);
      this.record(url, res.status, false, "skip-host-on-403/429");
      return null;
    }
    this.writeCache(url, res);
    this.record(url, res.status, false);
    return res.status >= 200 && res.status < 300 ? res : null;
  }
}
