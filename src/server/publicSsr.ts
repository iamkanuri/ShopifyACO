// ===========================================================================
// THE PUBLIC MARKETING ROUTES, RENDERED INTO THE DOCUMENT (v3.2 CP6).
//
// Until now every route but `/index` returned meta tags and an empty
// `<div id="root">` to a fetch without JavaScript — on a site whose headline is
// "AI buyers treat your store like an API. We test it like one."
//
// ⚠️ THIS USES A DIFFERENT MECHANISM FROM THE STANDARD PAGES, AND THE DIFFERENCE IS
// THE WHOLE REASON BOTH EXIST. `/standards` is NOT a React route, so injecting its
// body into `#root` made React mount, match nothing, render NotFound and wipe it —
// a crawler saw the standard and a human saw "Page not found". Those pages are now
// standalone documents that never load the bundle.
//
// `/` and `/methodology` ARE React routes. Here the injection is correct and is what
// the brief asks for: the snapshot sits inside `#root` for a reader with no
// JavaScript, React mounts over it and takes the page for interaction. Same pattern
// as the Index SSR.
//
// ⚠️ THE COPY IS IMPORTED, NOT RETYPED. `viewer/src/copy.ts` is plain data and is the
// SAME module the React page renders from, so the server-rendered snapshot cannot
// drift from what a browser shows. A hand-written server copy of the marketing text
// is the "site disagrees with itself" defect one level down.
import { HERO, TAGLINE, STANDARDS_INDEX_URL, COFFEE_STANDARD_URL } from "../../viewer/src/copy.js";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const H = HERO as unknown as Record<string, string>;

/** The snapshot for a public marketing path, or null when the path is not one. */
export function publicSsrFor(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") {
    return `<main class="ssr-snapshot">
  <p>${esc(H.eyebrow)}</p>
  <h1>${esc(H.headline)}</h1>
  <p>${esc(H.sub)}</p>
  <p>${esc(H.micro ?? "")}</p>
  <p>
    <a href="${esc(COFFEE_STANDARD_URL)}">${esc(H.readStandard ?? "Read the standard")}</a> ·
    <a href="${esc(STANDARDS_INDEX_URL)}">All published standards</a> ·
    <a href="/methodology">Methodology</a> ·
    <a href="/demo">See an example test</a>
  </p>
</main>`;
  }
  if (p === "/methodology") {
    // Deliberately a SUMMARY plus links, not a duplicate of the page. The claim a
    // machine reader needs from this route is what the method is and where the
    // executable artifact lives; the artifact itself is the authority.
    return `<main class="ssr-snapshot">
  <h1>Methodology</h1>
  <p>${esc(TAGLINE)}</p>
  <p>A buying standard is the set of questions a competent buyer asks in a category, written down, versioned, and content-hashed so a result can cite the exact contract that produced it. Each requirement is reported as pass, not proven, or requires store access, with the evidence that decided it.</p>
  <p>We publish what we cannot test, and why: every standard states its blocked and advisory entries in full, alongside the ones that run.</p>
  <p>
    <a href="${esc(STANDARDS_INDEX_URL)}">Published standards</a> ·
    <a href="${esc(COFFEE_STANDARD_URL)}">Coffee Standard v1.0</a> ·
    <a href="${esc(COFFEE_STANDARD_URL)}/standard.json">The artifact as JSON</a> ·
    <a href="/llms.txt">llms.txt</a>
  </p>
</main>`;
  }
  return null;
}
