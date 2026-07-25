import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Request, Response } from "express";
import { ENV } from "./env.js";
import { recordFunnelEvent, classifyReferrer } from "../db/funnel.js";

// ===========================================================================
// HOSTED OUTREACH CASES — GET /c/:token (v2.2 CP4).
//
// Serves ONE pre-rendered diagnostic case from HOSTED_CASES_DIR. Unlisted:
// `noindex, nofollow`, no index page, no cross-links, no directory listing, and
// an unguessable token so the set cannot be walked.
//
// GATED BY ABSENCE OF CONFIG, which is the honest posture: with HOSTED_CASES_DIR
// unset every token 404s, so the route is inert until a human deliberately puts
// the bundle on the volume and sets the variable. There is no code flag to forget.
//
// The bundle is NEVER committed. Each case describes a REAL third-party store by
// name, so it is deployed onto the Railway volume and kept out of git (.gitignore
// covers experiments/*). See DEPLOY.md §"Hosted outreach cases".
//
// Ported from prior art on branch `feat/send-engine-stage6` (commit 43e0e5d),
// which was never merged — contrary to DEPLOY.md, which described the route as
// present-but-inert. Changes made in the port: the dead
// AGENTIC_INSTRUMENT_TEST_ENABLED flag is dropped (it does not exist on main),
// `case_viewed` telemetry is wired, and a per-IP limit is added because the
// `/api` rate limiter does not match `/c/*`.
// ===========================================================================

/** Base32-ish, 12 chars: the shape the bundle generator mints. No dots, no
 *  separators, so it can never escape its directory even before the resolve check. */
export const CASE_TOKEN_RE = /^[a-z2-7]{12}$/;

/** Resolve a token to its file, or null. Pure + exported so the traversal
 *  defense is directly testable without an HTTP server or a real directory. */
export function resolveCaseFile(dir: string | undefined, token: string): string | null {
  if (!dir) return null;
  if (!CASE_TOKEN_RE.test(token)) return null;
  const root = resolve(join(dir, "c"));
  const file = resolve(join(root, token, "index.html"));
  // Belt-and-braces: the regex already forbids traversal, but a misconfigured
  // dir (a symlink, a UNC path) should not be able to widen it either.
  if (!file.startsWith(root + sep)) return null;
  return file;
}

export function hostedCaseHandler(req: Request, res: Response): void {
  const token = String(req.params.token ?? "");
  const file = resolveCaseFile(ENV.hostedCasesDir, token);
  // One indistinguishable 404 for "route off", "bad token" and "no such case", so a
  // prober cannot tell whether a given token exists.
  if (!file || !existsSync(file)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");

  // The only measurement of outreach that exists. Without it a send is a guess:
  // "no replies" cannot be told apart from "nobody opened it". Fire-and-forget —
  // a telemetry hiccup must never cost the recipient the page.
  void recordFunnelEvent({
    name: "case_viewed",
    caseToken: token,
    referrerClass: classifyReferrer(req.get("referer"), req.get("host")),
  });

  res.type("html").send(readFileSync(file, "utf8"));
}
