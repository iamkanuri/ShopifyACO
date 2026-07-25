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

/**
 * Artefacts that make a pre-rendered case UNSENDABLE (v2.4 CP3).
 *
 * The bundle generator does not live in this repository — the cases are rendered
 * artefacts dropped onto the volume — so the template guard cannot be applied at
 * render time. This is the last boundary that can refuse a broken page, and it is
 * the same posture `productTest.ts` takes when the claim linter trips: a result
 * that cannot meet the standard is NOT shown.
 *
 * That matters more here than for an ordinary 404. These pages go to a named
 * third-party merchant as outreach. A page that contradicts itself in front of a
 * prospect spends credibility that the whole product rests on, and unlike a wrong
 * Fail it is not recoverable by re-running anything.
 *
 * Measured on the real 12-case bundle: both rules fired on exactly the two broken
 * cases and on none of the other ten.
 */
export function caseDefects(html: string): string[] {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const defects: string[] = [];

  // 1. An EMPTY SET rendered as the literal word. The generator writes the string
  //    "none" into a list slot when the set is empty (it is stored that way in
  //    `claims-map.json`), so the page asks the merchant to "confirm the things
  //    shoppers asked for — none, and …". Checking the bare word rather than each
  //    known slot is deliberate: it catches slots nobody has enumerated yet, which
  //    is the whole failure mode. No legitimate case in the bundle contains it.
  const none = /\bnone\b/i.exec(text);
  if (none) {
    defects.push(`empty list rendered as the literal word "none": "…${text.slice(Math.max(0, none.index - 40), none.index + 20).trim()}…"`);
  }

  // 2. A SELF-CONTRADICTING count. "0 of 4 attempts could not confirm one or more
  //    requirements" immediately followed by the list of requirements the store does
  //    not state. Both halves are separately true — they come from two different
  //    measurements (journey outcomes vs. store-data adjudication) — but the sentence
  //    welds them into one claim that is false as composed.
  const count = /(\d+) of (\d+) attempts could not confirm/i.exec(text);
  const gaps = /does not state the following[^:]*:\s*(\S[^.]*)/i.exec(text);
  if (count && Number(count[1]) === 0 && gaps) {
    defects.push(`count says "${count[0]}" while the page lists unmet requirements: "${gaps[1]!.trim().slice(0, 60)}"`);
  }
  return defects;
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

  const html = readFileSync(file, "utf8");
  const defects = caseDefects(html);
  if (defects.length) {
    // Loud on OUR side, indistinguishable on theirs — the same 404 as every other
    // failure, so a recipient never sees a diagnostic about our own bug.
    console.error(`[hosted-case] REFUSING to serve ${token}: ${defects.join(" | ")}`);
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "private, no-store");
  // `same-origin`, NOT `no-referrer`. A Referrer-Policy governs requests this
  // document ORIGINATES, so `no-referrer` stripped the Referer from the recipient's
  // click through to /test — which made `referrer_class: "hosted_case"` structurally
  // impossible to record and every outreach arrival look like direct traffic. That
  // would have silently zeroed the one number this whole route exists to produce.
  // `same-origin` sends the referrer only to us; a third-party link from the page
  // still leaks nothing, which is what `no-referrer` was reaching for.
  res.setHeader("Referrer-Policy", "same-origin");

  // The only measurement of outreach that exists. Without it a send is a guess:
  // "no replies" cannot be told apart from "nobody opened it". Fire-and-forget —
  // a telemetry hiccup must never cost the recipient the page.
  void recordFunnelEvent({
    name: "case_viewed",
    caseToken: token,
    referrerClass: classifyReferrer(req.get("referer"), req.get("host")),
  });

  res.type("html").send(html);
}
