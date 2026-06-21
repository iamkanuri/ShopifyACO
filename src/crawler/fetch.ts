import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { isPublicIp, pickPublicAddress, SsrfError, validateUrl } from "./ssrf.js";

// ===========================================================================
// Bounded, SSRF-safe HTTP(S) fetcher. Built on node:http/https (NOT global fetch)
// specifically so we can install a validating DNS `lookup` hook that PINS the
// socket to an address we classified as public — defeating DNS-rebinding TOCTOU.
//
// Hard limits enforced on every request:
//   • scheme http/https only, validated again on each redirect hop
//   • per-request timeout, total byte cap (socket destroyed when exceeded)
//   • bounded redirects, each re-validated through the SSRF guard
//   • content-type allowlist (we only parse text/HTML/JSON/XML)
// Nothing here trusts the response; callers treat all returned text as untrusted.
// ===========================================================================

export interface FetchLimits {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const DEFAULT_LIMITS: FetchLimits = {
  maxBytes: 2_500_000, // 2.5 MB — generous for a product page, bounded for safety
  timeoutMs: 10_000,
  maxRedirects: 4,
};

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: number;
}

const USER_AGENT = "AisleLensBot/1.0 (+https://lens.thirdocular.com/about/bot)";
const ACCEPT = "text/html,application/xhtml+xml,application/ld+json;q=0.9,application/json;q=0.8,*/*;q=0.5";

const ALLOWED_CONTENT_TYPES = [
  /^text\/html/i,
  /^application\/xhtml\+xml/i,
  /^application\/(ld\+)?json/i,
  /^text\/plain/i,
  /^application\/xml/i,
  /^text\/xml/i,
];

export function isAllowedContentType(ct: string | null | undefined): boolean {
  if (!ct) return true; // missing content-type: allow, but we still byte-cap
  return ALLOWED_CONTENT_TYPES.some((re) => re.test(ct));
}

/** DNS lookup that only ever returns a PUBLIC address. Installed on the socket so
 *  the connection is pinned to a vetted IP (DNS-rebinding safe). Mirrors Node's
 *  `lookup(hostname, options, callback)` contract. */
const validatingLookup: LookupFunction = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void): void => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = (Array.isArray(addresses) ? addresses : []).map((a) => ({ address: a.address, family: a.family }));
    const chosen = pickPublicAddress(list);
    if (!chosen) return callback(new SsrfError(`refusing to connect: '${hostname}' has no public IP`));
    // Honor an explicit { all:true } consumer (defensive — Node core passes all:false here).
    if (options && (options as dns.LookupAllOptions).all) {
      return callback(null, [{ address: chosen.address, family: chosen.family }]);
    }
    callback(null, chosen.address, chosen.family);
  });
}) as unknown as LookupFunction;

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

interface SingleResponse {
  status: number;
  contentType: string | null;
  location: string | null;
  body: string;
  bytes: number;
  truncated: boolean;
}

function fetchOnce(target: URL, limits: FetchLimits): Promise<SingleResponse> {
  const mod = target.protocol === "https:" ? https : http;
  return new Promise<SingleResponse>((resolve, reject) => {
    // Single-settle guard: every path (end, truncation, redirect, premature close,
    // error, timeout) must settle the promise exactly once. Without this, a graceful
    // mid-body socket close fires only 'close' (no 'end'/'error') and the promise
    // would hang.
    let settled = false;
    const finish = (v: SingleResponse) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const fail = (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };

    const req = mod.request(
      target,
      {
        method: "GET",
        lookup: validatingLookup,
        headers: { "user-agent": USER_AGENT, accept: ACCEPT, "accept-encoding": "identity" },
        // Defense in depth: even with the lookup hook, reject if Node hands us a
        // socket on a non-public peer (e.g. a hosts-file override).
      },
      (res) => {
        const peer = res.socket.remoteAddress;
        const peerFam = peer ? (peer.includes(":") ? 6 : 4) : 0;
        if (peer && !isPublicIp(peer, peerFam)) {
          res.destroy();
          fail(new SsrfError(`connected to non-public peer ${peer}`));
          return;
        }

        const status = res.statusCode ?? 0;
        const contentType = (res.headers["content-type"] as string | undefined) ?? null;
        const location = (res.headers["location"] as string | undefined) ?? null;

        // Redirects: don't read a body, surface Location to the caller.
        if (REDIRECT_CODES.has(status) && location) {
          res.destroy();
          finish({ status, contentType, location, body: "", bytes: 0, truncated: false });
          return;
        }
        // Refuse to buffer content types we don't parse.
        if (!isAllowedContentType(contentType)) {
          res.destroy();
          finish({ status, contentType, location: null, body: "", bytes: 0, truncated: false });
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        let truncated = false;
        const body = () => ({ status, contentType, location: null, body: Buffer.concat(chunks).toString("utf8"), bytes, truncated });
        res.on("data", (c: Buffer) => {
          bytes += c.length;
          if (bytes > limits.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, Math.max(0, c.length - (bytes - limits.maxBytes))));
            res.destroy(); // stop reading; we have enough
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => finish(body()));
        // Premature/graceful close (no 'end'): settle with whatever we have rather
        // than hang. Mark truncated so callers know the body may be incomplete.
        res.on("close", () => {
          if (!truncated && bytes > 0) truncated = true;
          finish(body());
        });
        res.on("error", fail);
      },
    );

    req.setTimeout(limits.timeoutMs, () => req.destroy(new Error(`request timed out after ${limits.timeoutMs}ms`)));
    req.on("error", fail);
    req.end();
  });
}

/** Fetch a URL safely, following (and re-validating) up to `maxRedirects` hops.
 *  Every hop passes through validateUrl + the pinned lookup; the body is byte-
 *  capped and content-type-gated. Throws SsrfError/Error on refusal or transport
 *  failure. Callers treat the returned body as fully untrusted. */
export async function safeFetch(rawUrl: string, limits: FetchLimits = DEFAULT_LIMITS): Promise<FetchResult> {
  let current = rawUrl;
  let redirects = 0;
  for (;;) {
    const check = validateUrl(current);
    if (!check.ok || !check.url) throw new SsrfError(`blocked URL: ${check.reason}`);
    const res = await fetchOnce(check.url, limits);

    if (REDIRECT_CODES.has(res.status) && res.location) {
      if (redirects >= limits.maxRedirects) throw new SsrfError(`too many redirects (>${limits.maxRedirects})`);
      // Resolve relative Location against the current URL, then re-validate fresh.
      let next: string;
      try {
        next = new URL(res.location, check.url).toString();
      } catch {
        throw new SsrfError("invalid redirect Location");
      }
      redirects++;
      current = next;
      continue;
    }

    return {
      requestedUrl: rawUrl,
      finalUrl: check.url.toString(),
      status: res.status,
      contentType: res.contentType,
      body: res.body,
      bytes: res.bytes,
      truncated: res.truncated,
      redirects,
    };
  }
}
