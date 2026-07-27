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
import {
  HERO, TAGLINE, PRODUCT_DESCRIPTION, STANDARDS_INDEX_URL, COFFEE_STANDARD_URL, EXAMPLE_TEST_URL,
  STANDARD_SECTION, CATEGORY_BREAK, HOW_IT_WORKS, DEMONSTRATION, FAQ, FOOTER,
} from "../../viewer/src/copy.js";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const H = HERO as unknown as Record<string, string>;

/** The snapshot for a public marketing path, or null when the path is not one. */
export function publicSsrFor(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") {
    // ⚠️ MEASURED, NOT GUESSED. A no-JS fetch of the landing page returned 569
    // characters of body text — the hero, and nothing else — out of a page with six
    // sections. Identical for all eight user agents probed, including GPTBot,
    // ChatGPT-User, PerplexityBot and Googlebot, so this was not a crawler being
    // treated differently; it was all anyone got. On a site whose headline is "AI
    // buyers treat your store like an API", the argument for what this product is
    // reached no machine reader at all: not the standard section, not the category
    // break, not how testing works, not one FAQ answer.
    //
    // Every string below is IMPORTED from viewer/src/copy.ts — the same module the
    // React page renders from — so this snapshot cannot drift from what a browser
    // shows. Retyping any of it would be the "site disagrees with itself" defect one
    // level down.
    return `<main class="ssr-snapshot">
  <p>${esc(H.eyebrow)}</p>
  <h1>${esc(H.headline)}</h1>
  <p>${esc(H.sub)}</p>
  <p>${esc(H.micro ?? "")}</p>
  <p>
    <a href="${esc(COFFEE_STANDARD_URL)}">${esc(H.readStandard ?? "Read the standard")}</a> ·
    <a href="${esc(STANDARDS_INDEX_URL)}">All published standards</a> ·
    <a href="/methodology">Methodology</a> ·
    <a href="${esc(EXAMPLE_TEST_URL)}">${esc(H.seeExample ?? "See an example test")}</a>
  </p>

  <section>
    <h2>${esc(STANDARD_SECTION.heading)}</h2>
    ${STANDARD_SECTION.body.map((b) => `<p>${esc(b)}</p>`).join("\n    ")}
    <p><strong>${esc(STANDARD_SECTION.pull)}</strong></p>
    ${STANDARD_SECTION.after.map((b) => `<p>${esc(b)}</p>`).join("\n    ")}
  </section>

  <section>
    <h2>${esc(CATEGORY_BREAK.heading)}</h2>
    <table>
      <thead><tr>${CATEGORY_BREAK.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${CATEGORY_BREAK.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
    <p><strong>${esc(CATEGORY_BREAK.pull)}</strong></p>
  </section>

  <section>
    <h2>${esc(HOW_IT_WORKS.heading)}</h2>
    <ol>${HOW_IT_WORKS.steps.map(([, title, body]) => `<li><strong>${esc(title)}</strong> ${esc(body)}</li>`).join("")}</ol>
    <p><strong>${esc(HOW_IT_WORKS.note.lead)}</strong> ${esc(HOW_IT_WORKS.note.body)}</p>
  </section>

  <section>
    <h2>${esc(DEMONSTRATION.heading)}</h2>
    <ul>${DEMONSTRATION.lines.map(([k, v]) => `<li><strong>${esc(k)}</strong> ${esc(v)}</li>`).join("")}</ul>
    <p>${esc(DEMONSTRATION.label)}</p>
  </section>

  <section>
    <h2>Questions</h2>
    <dl>${FAQ.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join("")}</dl>
  </section>

  <p>${esc(FOOTER.fine)}</p>
</main>`;
  }
  if (p === "/methodology") {
    // Deliberately a SUMMARY plus links, not a duplicate of the page. The claim a
    // machine reader needs from this route is what the method is and where the
    // executable artifact lives; the artifact itself is the authority.
    // ⚠️ THIS PARAGRAPH SAID "reported as PASS, not proven, or requires store access"
    // — the identical one-word drift that v3.3 CP-D found between this site and
    // thirdocular.com, sitting on our own methodology page the whole time. It is
    // `proven`. The shared constant now carries the sentence for both sites; this one is
    // a summary in the same vocabulary, and using the wrong word here while gating the
    // other site on the right one would be the joke telling itself.
    return `<main class="ssr-snapshot">
  <h1>Methodology</h1>
  <p>${esc(TAGLINE)}</p>
  <p>${esc(PRODUCT_DESCRIPTION)}</p>
  <p>A buying standard is fixed at a version and a content hash, so a result can cite the exact contract that produced it and that citation still resolves a year later. A superseded version keeps serving its original bytes forever; a new version says what changed and names the entry each of its own entries continues.</p>
  <p>We publish what we cannot test, and why: every standard states its blocked and advisory entries in full, alongside the ones that run — and it publishes the measured rate at which the engine executing it gets a requirement wrong, with the method, the sample, and the defect classes behind it.</p>
  <p>
    <a href="${esc(STANDARDS_INDEX_URL)}">Published standards</a> ·
    <a href="${esc(COFFEE_STANDARD_URL)}">Coffee Standard v${esc(COFFEE_STANDARD_URL.split("/").pop() ?? "")}</a> ·
    <a href="${esc(COFFEE_STANDARD_URL)}/standard.json">The artifact as JSON</a> ·
    <a href="${esc(COFFEE_STANDARD_URL)}#measured-error">The measured error rate</a> ·
    <a href="${esc(EXAMPLE_TEST_URL)}">A real result on a real store</a> ·
    <a href="/llms.txt">llms.txt</a>
  </p>
</main>`;
  }
  return null;
}
