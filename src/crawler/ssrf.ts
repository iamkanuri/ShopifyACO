import net from "node:net";

// ===========================================================================
// SSRF GUARD — the primary threat model of the Phase 5 crawler.
//
// The crawler fetches arbitrary merchant- and competitor-supplied URLs. Without
// this guard a hostile URL could make our server reach internal services: cloud
// metadata (169.254.169.254 / fd00:ec2::254), localhost, RFC1918 networks, etc.
//
// Defense (pure, dependency-free, exhaustively unit-tested):
//   1. scheme allowlist (http/https only) — blocks file:, gopher:, data:, ftp:…
//   2. no embedded credentials (user:pass@host)
//   3. port allowlist (default/80/443) — blocks 169.254.169.254:9000 style abuse
//   4. literal-host blocklist (localhost, *.internal/.local, cloud metadata names)
//   5. IP classification: every IPv4/IPv6 address that is loopback, private,
//      link-local, CGNAT, multicast, reserved, or an IPv4-mapped/embedded form of
//      any of those is rejected.
//
// validateUrl() runs BEFORE a connection is attempted (and again on every redirect
// hop). pickPublicAddress() is used by the fetcher's DNS lookup hook so the socket
// is PINNED to an address we validated — closing the DNS-rebinding window where a
// name resolves public on our check and private at connect time.
// ===========================================================================

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
// "" = the scheme default port (80/443). Anything else is refused.
const ALLOWED_PORTS = new Set(["", "80", "443"]);

// Hostnames we refuse outright regardless of how they resolve.
const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".lan", ".home", ".corp", ".intranet"];
const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "metadata.google.internal", // GCP metadata
  "metadata",
  "instance-data", // AWS metadata convenience name
]);

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  url?: URL;
}

/** Validate a URL string for crawl safety. Pure — does NOT resolve DNS. */
export function validateUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return { ok: false, reason: `scheme '${u.protocol}' not allowed` };
  if (u.username || u.password) return { ok: false, reason: "credentials in URL not allowed" };
  if (!ALLOWED_PORTS.has(u.port)) return { ok: false, reason: `port '${u.port}' not allowed` };

  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "empty host" };
  if (BLOCKED_HOST_EXACT.has(host)) return { ok: false, reason: `blocked host '${host}'` };
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: `blocked host suffix on '${host}'` };

  // WHATWG URL keeps IPv6 literals bracketed ("[::1]"); strip for classification.
  const ipHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  // If the host is an IP literal, classify it now (DNS will never run for it).
  const fam = net.isIP(ipHost);
  if (fam !== 0 && !isPublicIp(ipHost, fam)) return { ok: false, reason: `non-public IP literal '${ipHost}'` };

  return { ok: true, url: u };
}

// ---- IPv4 -----------------------------------------------------------------

function ip4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (o > 255) return null;
    n = (n * 256 + o) >>> 0;
  }
  return n >>> 0;
}

// [network, prefix] CIDRs that must never be reached. Covers loopback, private,
// link-local (incl. 169.254.169.254 metadata), CGNAT, documentation/benchmark
// ranges, multicast and reserved space.
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved (incl. 255.255.255.255 broadcast)
];

function inCidr4(ipInt: number, network: string, prefix: number): boolean {
  const netInt = ip4ToInt(network);
  if (netInt === null) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) >>> 0 === (netInt & mask) >>> 0;
}

function isPublicIp4(ip: string): boolean {
  const n = ip4ToInt(ip);
  if (n === null) return false;
  return !BLOCKED_V4.some(([network, prefix]) => inCidr4(n, network, prefix));
}

// ---- IPv6 -----------------------------------------------------------------

/** Expand an (already net.isIPv6-valid) address to 16 bytes. Handles `::`
 *  compression and a trailing embedded IPv4 (e.g. ::ffff:1.2.3.4). */
function ip6ToBytes(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // Strip a zone id (fe80::1%eth0) — irrelevant to classification.
  const pct = s.indexOf("%");
  if (pct >= 0) s = s.slice(0, pct);

  // A trailing dotted-quad becomes the final two 16-bit groups.
  let tailGroups: string[] = [];
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = s.slice(lastColon + 1);
    const v4int = ip4ToInt(v4);
    if (v4int === null) return null;
    tailGroups = [
      (((v4int >>> 16) & 0xffff)).toString(16),
      ((v4int & 0xffff)).toString(16),
    ];
    s = s.slice(0, lastColon + 1); // keep the trailing ':' so split logic works
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const splitGroups = (part: string) => (part ? part.split(":").filter((x) => x !== "") : []);
  const head = splitGroups(halves[0] ?? "").concat(halves.length === 2 ? [] : tailGroups);
  let tail: string[] = [];
  if (halves.length === 2) tail = splitGroups(halves[1] ?? "").concat(tailGroups);

  const groups: string[] = [];
  if (halves.length === 2) {
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) return null;
    groups.push(...head, ...Array(missing).fill("0"), ...tail);
  } else {
    groups.push(...head);
  }
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >>> 8) & 0xff, v & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isPublicIp6(ip: string): boolean {
  const b = ip6ToBytes(ip);
  if (!b) return false;
  const at = (i: number): number => b[i] ?? 0; // b is length-16; total access for TS
  const v4Tail = `${at(12)}.${at(13)}.${at(14)}.${at(15)}`;

  const allZeroFrom = (start: number, end: number) => b.slice(start, end).every((x) => x === 0);

  // Unspecified ::  and loopback ::1
  if (allZeroFrom(0, 16)) return false;
  if (allZeroFrom(0, 15) && at(15) === 1) return false;

  // IPv4-mapped ::ffff:a.b.c.d  and IPv4-compatible ::a.b.c.d (deprecated) →
  // classify the embedded v4 so 127.0.0.1 etc. can't sneak in via v6 syntax.
  if (allZeroFrom(0, 10) && at(10) === 0xff && at(11) === 0xff) return isPublicIp4(v4Tail);
  if (allZeroFrom(0, 12) && !(at(12) === 0 && at(13) === 0 && at(14) === 0 && at(15) <= 1)) return isPublicIp4(v4Tail);

  // NAT64 64:ff9b::/96 → embedded v4
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b && allZeroFrom(4, 12)) return isPublicIp4(v4Tail);
  // 6to4 2002::/16 embeds a v4 in bytes 2..5
  if (at(0) === 0x20 && at(1) === 0x02) return isPublicIp4(`${at(2)}.${at(3)}.${at(4)}.${at(5)}`);

  // Unique-local fc00::/7
  if ((at(0) & 0xfe) === 0xfc) return false;
  // Link-local fe80::/10
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return false;
  // Deprecated site-local fec0::/10
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0xc0) return false;
  // Multicast ff00::/8 (includes link-local-multicast, metadata-ish ranges)
  if (at(0) === 0xff) return false;

  return true;
}

/** True only if `addr` is a globally-routable public IP. family is 4 or 6
 *  (net.isIP result). Anything unrecognized is treated as NOT public. */
export function isPublicIp(addr: string, family: number): boolean {
  if (family === 4) return isPublicIp4(addr);
  if (family === 6) return isPublicIp6(addr);
  return false;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** From a set of DNS-resolved addresses, return the first that is public, or null.
 *  Used by the fetcher's lookup hook to PIN the socket to a validated IP — so even
 *  if a name resolves to both public and private records (DNS rebinding), we only
 *  ever connect to an address that passed classification. */
export function pickPublicAddress(addrs: ResolvedAddress[]): ResolvedAddress | null {
  for (const a of addrs) {
    if (isPublicIp(a.address, a.family)) return a;
  }
  return null;
}
