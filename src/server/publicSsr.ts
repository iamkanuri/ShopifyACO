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
  STANDARD_SECTION, CATEGORY_BREAK, DEMONSTRATION, FAQ, FOOTER,
  CREDIBILITY, DELIVERABLES, WORKFLOW, TEST_EXPLAINED, REAL_EXAMPLE, BEFORE_AFTER,
  ENGINE_VALIDATION, PILOT, RESULT_GLYPH, HERO_ARTIFACT,
} from "../../viewer/src/copy.js";
import { peerSentence } from "../../viewer/src/peerSentence.js";
import type { HeroArtifact } from "../../viewer/src/heroArtifact.js";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const H = HERO as unknown as Record<string, string>;

/**
 * The real result, rendered for a reader with no JavaScript.
 *
 * ⚠️ IT IS RENDERED, NOT SUMMARISED. The JSON block the React page reads is invisible to
 * a crawler, a JS-off reader and a text browser, and this is the section that carries the
 * page's whole proof. v3.3 measured a no-JS fetch of `/demo` returning 0 characters of
 * body text while `/standards` returned 15,000 — a proof surface that proved nothing to
 * exactly the machine readers this product is about. Passing `null` renders nothing at
 * all rather than a placeholder: a snapshot that invents a plausible result when the
 * artifact is missing would be indistinguishable from a correct one.
 */
function heroArtifactHtml(a: HeroArtifact | null): string {
  if (!a) return "";
  const rows = a.rows.map((r) => {
    const passed = r.state === "proven" || r.state === "neutral";
    const cite = r.entryId
      ? `<a href="${esc(r.entryUrl)}">${esc(r.entryId)}</a>`
      : "(no published entry id)";
    return `<li>
        <p><strong>${esc(RESULT_GLYPH[r.state])} ${esc(r.question)}</strong></p>
        <p>${esc(r.detail)}</p>
        ${r.quote ? `<blockquote>${esc(r.quote)}</blockquote><p>Read from: ${esc(r.surface)}${r.surfaceUrl ? ` — <a href="${esc(r.surfaceUrl)}">${esc(r.surfaceUrl)}</a>` : ""}</p>` : ""}
        ${r.peer ? `<p>${esc(peerSentence(r.peer, passed))}</p>` : ""}
        <p>Entry: ${cite}</p>
      </li>`;
  }).join("\n      ");
  return `<section>
    <h2>${esc(REAL_EXAMPLE.heading)}</h2>
    <p>${esc(REAL_EXAMPLE.lead)}</p>
    <p>${esc(HERO_ARTIFACT.kicker)}: ${esc(a.storeName ?? a.host)} — ${esc(a.productName ?? "")}
       (<a href="${esc(a.productUrl)}">${esc(a.productUrl)}</a>)</p>
    <p>Standard: <a href="${esc(a.standard.url)}">${esc(a.standard.title)}</a> ·
       content hash <code>${esc(a.standard.hash)}</code> · captured ${esc(a.capturedAt)}</p>
    <p>${esc(a.counts.pass)} proven · ${esc(a.counts.notProven)} not proven ·
       ${esc(a.counts.requiresAccess)} requires store access · ${esc(a.counts.total)} requirements asked</p>
    <p>${esc(HERO_ARTIFACT.note)}</p>
    <p>${esc(HERO_ARTIFACT.legend)}</p>
    <ol>
      ${rows}
    </ol>
    <p>${esc(REAL_EXAMPLE.peerNote)}</p>
    <p><a href="${esc(a.demoUrl)}">${esc(HERO_ARTIFACT.more)}</a></p>
  </section>`;
}

/** The before/after CONTRACT — same standard, same hash, same entry; only the store's
 *  text moves. The "after" sentence is the standard's OWN published accepted-evidence
 *  example, and it is labeled illustrative. Nothing here is presented as a client result. */
function beforeAfterHtml(a: HeroArtifact | null): string {
  const row = a?.rows.find((r) => r.state === "unproven" && r.acceptedExample);
  if (!a || !row) return "";
  return `<section>
    <h2>${esc(BEFORE_AFTER.heading)}</h2>
    <p>${esc(BEFORE_AFTER.lead)}</p>
    <p>${esc(BEFORE_AFTER.invariant)} ${esc(a.standard.title)}, content hash
       <code>${esc(a.standard.hash)}</code>, entry <a href="${esc(row.entryUrl)}">${esc(row.entryId)}</a>,
       question &ldquo;${esc(row.question)}&rdquo;.</p>
    <p><strong>${esc(BEFORE_AFTER.beforeLabel)}:</strong> ${esc(RESULT_GLYPH.unproven)} not proven — ${esc(row.detail)}</p>
    <p><strong>${esc(BEFORE_AFTER.afterLabel)}:</strong> ${esc(RESULT_GLYPH.proven)} proven — the page states
       ${row.acceptedForm ? `${esc(row.acceptedForm)}, for example ` : ""}&ldquo;${esc(row.acceptedExample)}&rdquo;.</p>
    <p>${esc(BEFORE_AFTER.illustrative)}</p>
    <h3>${esc(DEMONSTRATION.heading)}</h3>
    <ul>${DEMONSTRATION.lines.map(([k, v]) => `<li><strong>${esc(k)}</strong> ${esc(v)}</li>`).join("")}</ul>
    <p>${esc(DEMONSTRATION.label)}</p>
  </section>`;
}

/** The snapshot for a public marketing path, or null when the path is not one.
 *
 *  `artifact` is the real pinned result. It is a PARAMETER rather than an await inside
 *  this function so the module stays pure and synchronous — the same reason the copy is
 *  imported rather than retyped: this file has to be trivially testable, and a snapshot
 *  that reaches for I/O is a snapshot that can fail on the landing page. */
export function publicSsrFor(pathname: string, artifact: HeroArtifact | null = null): string | null {
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
    // ⚠️ THE ORDER HERE IS THE ORDER ON THE PAGE, AND THAT IS NOT COSMETIC. v4.3
    // re-sequences the landing page for an agency principal — value first, rigor after —
    // and a snapshot that kept the old order would hand a machine reader a different
    // argument from the one a human gets. The section set below is section-for-section
    // the same as viewer/src/pages/LandingPage.tsx; both render from these constants, so
    // neither can drift in WORDING, and the shared order is what stops them drifting in
    // EMPHASIS.
    return `<main class="ssr-snapshot">
  <p>${esc(H.eyebrow)}</p>
  <h1>${esc(H.headline)}</h1>
  <p>${esc(H.sub)}</p>
  <p>${esc(H.micro ?? "")}</p>
  <ul>${CREDIBILITY.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <p>
    <a href="/test">${esc(H.cta ?? "Run a real test")}</a> ·
    <a href="${esc(EXAMPLE_TEST_URL)}">${esc(H.ctaSecondary ?? "See a complete example")}</a> ·
    <a href="${esc(COFFEE_STANDARD_URL)}">${esc(H.readStandard ?? "Read the standard")}</a> ·
    <a href="${esc(STANDARDS_INDEX_URL)}">All published standards</a> ·
    <a href="/methodology">Methodology</a>
  </p>

  <section>
    <h2>${esc(DELIVERABLES.heading)}</h2>
    <p>${esc(DELIVERABLES.lead)}</p>
    <dl>${DELIVERABLES.items.map(([t, b]) => `<dt>${esc(t)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
  </section>

  <section>
    <h2>${esc(WORKFLOW.heading)}</h2>
    <p>${esc(WORKFLOW.lead)}</p>
    <ol>${WORKFLOW.steps.map(([t, b]) => `<li><strong>${esc(t)}</strong> ${esc(b)}</li>`).join("")}</ol>
  </section>

  <section>
    <h2>${esc(TEST_EXPLAINED.heading)}</h2>
    <p>${esc(TEST_EXPLAINED.lead)}</p>
    <dl>${TEST_EXPLAINED.surfaces.map(([t, b]) => `<dt>${esc(t)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
    <p><strong>${esc(TEST_EXPLAINED.stops.lead)}</strong> ${esc(TEST_EXPLAINED.stops.body)}</p>
  </section>

  ${heroArtifactHtml(artifact)}

  ${beforeAfterHtml(artifact)}

  <section>
    <h2>${esc(CATEGORY_BREAK.heading)}</h2>
    <table>
      <thead><tr>${CATEGORY_BREAK.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${CATEGORY_BREAK.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
    <p><strong>${esc(CATEGORY_BREAK.pull)}</strong></p>
  </section>

  <section>
    <h2>${esc(ENGINE_VALIDATION.heading)}</h2>
    ${ENGINE_VALIDATION.body.map((b) => `<p>${esc(b)}</p>`).join("\n    ")}
    <p><strong>${esc(ENGINE_VALIDATION.pull)}</strong></p>
  </section>

  <section>
    <h2>${esc(STANDARD_SECTION.heading)}</h2>
    ${STANDARD_SECTION.body.map((b) => `<p>${esc(b)}</p>`).join("\n    ")}
    <p><strong>${esc(STANDARD_SECTION.pull)}</strong></p>
    ${STANDARD_SECTION.after.map((b) => `<p>${esc(b)}</p>`).join("\n    ")}
  </section>

  <section>
    <h2>${esc(PILOT.heading)}</h2>
    <p>${esc(PILOT.body)}</p>
    <p><a href="/test">${esc(PILOT.primary)}</a></p>
    <p>${esc(PILOT.fine)}</p>
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
