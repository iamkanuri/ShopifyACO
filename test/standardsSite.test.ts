import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadPublishedStandards, standardsPageFor, standardJsonFor, standardsSitemapPaths,
  llmsTxt, renderFitness, findStandard, groundingOf, fitnessOf, measuredOf, esc,
  renderStandaloneDocument, FONT_LINKS,
} from "../src/server/standardsSite.js";
import { standardHash } from "../standards/hash.js";
import { lintStrings } from "../src/server/claimLinter.js";

// ===========================================================================
// PUBLISHING A STANDARD (v3.2 CP7).
//
// The rule these tests exist to enforce: EVERY PUBLISHED NUMBER IS GENERATED FROM
// THE ARTIFACT, NEVER HAND-COPIED. A site that disagrees with its own JSON is worse
// than an unpublished standard — the citation resolves to a page that says something
// the artifact does not, and the reader has no way to know which is wrong.
// ===========================================================================

const BASE = "https://lens.example";

test("every published standard loads, and its served hash is COMPUTED from the artifact", () => {
  const list = loadPublishedStandards();
  assert.ok(list.length >= 1, "no standards are published — the site would have nothing to show");
  for (const s of list) {
    // Not "the stored hash is echoed back": recomputed from the bytes on disk. If
    // someone edits standard.json without rehashing, this is where it surfaces.
    const recomputed = standardHash(JSON.parse(s.rawJson));
    assert.equal(s.hash, recomputed, `${s.slug}: served hash is not the artifact's hash`);
    assert.equal(s.hashOk, true, `${s.slug}: standard.json's stored standard_hash does not match its own bytes — run standards/rehash.ts`);
  }
});

test("the JSON route serves EVERY version's artifact BYTE-FOR-BYTE, so a citation resolves to what was hashed", () => {
  // ⚠️ PARAMETERISED OVER EVERY PUBLISHED VERSION (v3.3). This used to check v1.0 only,
  // which is the same "wired to nothing" hole v3.2 found when `standards/` was merged
  // without being added to any gate: publishing a second version would have added a
  // whole document nothing verified.
  const list = loadPublishedStandards();
  assert.ok(list.length >= 2, "only one version is published — the version-continuity paths below are untested");
  for (const s of list) {
    const served = standardJsonFor(`/standards/${s.slug}/${s.publicVersion}/standard.json`);
    assert.ok(served, `${s.slug} v${s.publicVersion}: the JSON path does not resolve`);
    const onDisk = fs.readFileSync(path.join(process.cwd(), s.dir, "standard.json"), "utf8");
    assert.equal(served!.json, onDisk, `${s.slug} v${s.publicVersion}: the served JSON is not the file on disk`);
    assert.equal(served!.hash, s.hash);
    // A re-serialised body would still parse but would hash differently, and every
    // citation made against the published hash would stop verifying.
    assert.equal(standardHash(JSON.parse(served!.json)), s.hash);
  }
});

test("every entry id in every version resolves to its own page", () => {
  let resolved = 0;
  for (const s of loadPublishedStandards()) {
    for (const e of s.doc.entries) {
      const page = standardsPageFor(`/standards/${s.slug}/${s.publicVersion}/${e.id}`, BASE);
      assert.ok(page, `entry ${e.id} does not resolve — a published id that 404s is a broken citation`);
      assert.ok(page!.bodyHtml.includes(e.id), `entry ${e.id}'s page does not carry its own id`);
      resolved++;
    }
  }
  assert.ok(resolved >= 80, `only ${resolved} entries resolved across all versions`);
});

test("A PRIOR VERSION'S ENTRY ID RESOLVES AT THE CURRENT VERSION", () => {
  // The id carries the version, so reissuing renames all 42 entries. Someone holding a
  // v1.0 citation who trims the URL to the current version must not get a 404 for a
  // question that is still there — `supersedes` is the chain that makes it resolve.
  const v10 = findStandard("coffee", "1.0")!;
  const v11 = findStandard("coffee", "1.1")!;
  let mapped = 0;
  for (const old of v10.doc.entries) {
    const page = standardsPageFor(`/standards/coffee/1.1/${old.id}`, BASE);
    assert.ok(page, `${old.id} does not resolve at v1.1 — a v1.0 citation trimmed to the current version 404s`);
    const successor = v11.doc.entries.find((e) => (e as { supersedes?: string }).supersedes === old.id)!;
    assert.ok(successor, `${old.id} has no v1.1 successor`);
    assert.ok(page!.bodyHtml.includes(successor.id), `${old.id} at v1.1 did not render its successor ${successor.id}`);
    assert.equal(page!.title, standardsPageFor(`/standards/coffee/1.1/${successor.id}`, BASE)!.title);
    mapped++;
  }
  assert.equal(mapped, v10.doc.entries.length);
  // And an id that belongs to NO version still 404s — the alias must not become a
  // fuzzy matcher that resolves anything shaped like an id.
  assert.equal(standardsPageFor("/standards/coffee/1.1/ALS-COFFEE-1.0-NOSUCH-001", BASE), null);
});

test("A SUPERSEDED VERSION KEEPS SERVING, UNCHANGED, WITH A NOTICE ADDED AT RENDER TIME", () => {
  const v10 = findStandard("coffee", "1.0")!;
  const page = standardsPageFor("/standards/coffee/1.0", BASE)!;
  assert.match(page.bodyHtml, /Superseded by v1\.1/, "a superseded version does not say so");
  assert.match(page.bodyHtml, /byte for byte/i, "the notice does not explain why nothing was edited");
  // THE NOTICE IS NOT IN THE ARTIFACT. If it were, the bytes would have changed and
  // every citation made against v1.0's hash would stop verifying — which is the exact
  // thing reissuing exists to avoid.
  //
  // ⚠️ ASSERTED ON THE HASH, NOT ON THE WORD. The first version of this checked that
  // `rawJson` does not contain "Superseded" and failed immediately — v1.0's own prose
  // uses the word about certification seals ("Superseded seals remain in circulation").
  // A bare-substring absence check on an ordinary English word finds ordinary English.
  // The property that actually matters is that the bytes are unchanged, so that is what
  // is checked, against the literal every citation resolves through.
  assert.equal(
    standardHash(JSON.parse(v10.rawJson)),
    "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5",
    "v1.0's bytes changed — the supersession notice, or something else, was written INTO the frozen artifact",
  );
  assert.ok(!v10.rawJson.includes("Superseded by v1.1"), "the rendered notice leaked into the artifact");
  assert.equal(v10.doc.status, "draft", "v1.0's own status was edited; it is frozen");
  // And its own wrong-about-itself posture is still published verbatim, because that is
  // what v1.1 exists to correct and hiding it would make the correction unverifiable.
  assert.match(page.bodyHtml, /is not published/, "v1.0's original posture was softened");
});

test("THE STANDARD IS NAVIGABLE — a table of contents, tier jump targets, and a per-entry anchor", () => {
  // ⚠️ WHAT THIS REPLACES. The published page was a giant H1, four sentences of
  // self-negation, a metadata card, and then 42 entries with nothing to navigate them
  // by. Legible in the literal sense and unusable in every other. A citation is written
  // as "your product pages fail CERT-002", so a reader following one has to land ON that
  // line — which needs an id on every row, not just a link to the top of the page.
  for (const s of loadPublishedStandards()) {
    const page = standardsPageFor(`/standards/${s.slug}/${s.publicVersion}`, BASE)!;
    assert.match(page.bodyHtml, /class="std-toc"/, `${s.publicVersion}: no table of contents`);
    assert.match(page.bodyHtml, /id="contents"/, `${s.publicVersion}: the contents heading has no anchor to return to`);
    const tiers = new Set(s.doc.entries.map((e) => e.tier));
    for (const t of tiers) {
      assert.ok(page.bodyHtml.includes(`id="tier-${t}"`), `${s.publicVersion}: tier ${t} has no jump target`);
      assert.ok(page.bodyHtml.includes(`href="#tier-${t}"`), `${s.publicVersion}: tier ${t} is not linked from the contents`);
    }
    for (const e of s.doc.entries) {
      assert.ok(page.bodyHtml.includes(`id="${e.id}"`), `${s.publicVersion}: ${e.id} has no anchor — #${e.id} would not scroll to it`);
      assert.ok(page.bodyHtml.includes(`href="#${e.id}"`), `${s.publicVersion}: ${e.id} is not reachable from the contents`);
    }
    // JS-FREE BY CONSTRUCTION. These pages never load the bundle, so any disclosure has
    // to be <details>, and its content has to be IN the document — a widget that hid
    // evidence from a crawler would defeat the point of server-rendering at all.
    assert.match(page.bodyHtml, /<details/, `${s.publicVersion}: no JS-free disclosure`);
    assert.doesNotMatch(page.bodyHtml, /onclick=|<script(?![^>]*application\/ld\+json)/i,
      `${s.publicVersion}: the standard page carries script — it must be readable with JavaScript off`);
  }
});

test("the standard page publishes EVERY tier, including the ones that do not run", () => {
  // The argument this encodes: sixteen questions saying "here is exactly what would
  // be required" is a stronger artifact than ten presented as complete. If a future
  // change quietly drops the blocked tier from the page, this fails.
  const s = findStandard("coffee", "1.0")!;
  const page = standardsPageFor("/standards/coffee/1.0", BASE)!;
  const tiers = new Set(s.doc.entries.map((e) => e.tier));
  assert.ok(tiers.size >= 4, "the artifact should carry four tiers");
  for (const t of tiers) {
    assert.ok(page.bodyHtml.includes(`std-tier-group`), "tier grouping is absent");
  }
  for (const label of ["Executable", "Blocked", "Advisory", "Not discriminating"]) {
    assert.ok(page.bodyHtml.includes(label), `the page does not publish the ${label} tier`);
  }
  // And every entry is linked from it, not just the executable ones.
  for (const e of s.doc.entries) {
    assert.ok(page.bodyHtml.includes(e.id), `${e.id} is not linked from the standard page`);
  }
});

test("an entry page publishes what does NOT count as evidence, and what a pass does NOT license", () => {
  const s = findStandard("coffee", "1.0")!;
  const withInsufficient = s.doc.entries.find((e) => (e.insufficient_evidence ?? []).length > 0)!;
  assert.ok(withInsufficient, "no entry carries insufficient_evidence — the artifact changed shape");
  const page = standardsPageFor(`/standards/coffee/1.0/${withInsufficient.id}`, BASE)!;
  assert.match(page.bodyHtml, /Explicitly insufficient evidence/);
  for (const ins of withInsufficient.insufficient_evidence!) {
    if (ins.form) {
      // Rendered from the artifact, so the page cannot disagree with the JSON.
      assert.ok(page.bodyHtml.includes(ins.form.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")),
        `insufficient-evidence form is missing from the page: ${ins.form}`);
    }
  }
});

test("the front matter states independently_applied: false in words a reader can act on", () => {
  const page = standardsPageFor("/standards/coffee/1.0", BASE)!;
  assert.match(page.bodyHtml, /Independently applied/);
  assert.match(page.bodyHtml, /no third party has applied it/i);
});

test("the document's OWN status and posture are published verbatim, not softened", () => {
  // ⚠️ THE ARTIFACT SAYS `status: "draft"` AND that it "is not published". Publishing
  // it under a heading that calls it finished would make the site's first claim about
  // itself a false one, on a site whose subject is claim discipline. So its own words
  // are rendered unedited, and this test fails if anyone quietly drops them.
  const s = findStandard("coffee", "1.0")!;
  const page = standardsPageFor("/standards/coffee/1.0", BASE)!;
  assert.ok(page.bodyHtml.includes(`Status: ${s.doc.status}`), "the document's own status is not published");
  const po = s.doc.posture;
  const statement = typeof po === "string" ? po : po?.statement;
  assert.ok(statement, "the artifact carries no posture statement");
  // A distinctive clause from the artifact, escaped the way the renderer escapes it.
  const needle = statement!.slice(0, 60).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  assert.ok(page.bodyHtml.includes(needle), "the posture statement is not published verbatim");
  assert.doesNotMatch(page.bodyHtml, /\[object Object\]/, "an object was rendered as a string");
});

test("GROUNDING ACTUALLY RENDERS — the defect a presence-only test could not see", () => {
  // ⚠️ WHY THIS TEST EXISTS. The renderer read `grounding.sources`; the artifact's key
  // is `grounding.citations`. Every grounding block rendered EMPTY — on all 42 entry
  // pages and on the whole grounding page — and the suite was green, because the tests
  // asserted only that the entry id and the insufficient-evidence forms were present.
  // A renderer reading a field that does not exist produces nothing, and nothing looks
  // exactly like a section that legitimately has nothing to show.
  //
  // So this asserts CONTENT FROM THE ARTIFACT, by count and by string.
  const s = findStandard("coffee", "1.0")!;
  const grounded = s.doc.entries.filter((e) => groundingOf(e).length > 0);
  assert.ok(grounded.length >= 20,
    `only ${grounded.length} of ${s.doc.entries.length} entries have grounding citations — either the artifact changed or groundingOf reads the wrong key`);

  for (const e of grounded) {
    const page = standardsPageFor(`/standards/coffee/1.0/${e.id}`, BASE)!;
    assert.match(page.bodyHtml, /Grounding/, `${e.id}: no grounding section`);
    for (const c of groundingOf(e)) {
      if (c.url) assert.ok(page.bodyHtml.includes(c.url.replace(/&/g, "&amp;")), `${e.id}: grounding url missing from the page: ${c.url}`);
    }
  }

  // And the whole-standard grounding page must carry every one of them.
  const gp = standardsPageFor("/standards/coffee/1.0/grounding", BASE)!;
  let urls = 0;
  for (const e of grounded) for (const c of groundingOf(e)) {
    if (!c.url) continue;
    urls++;
    assert.ok(gp.bodyHtml.includes(c.url.replace(/&/g, "&amp;")), `grounding page is missing ${c.url}`);
  }
  assert.ok(urls >= 30, `the grounding page carries only ${urls} sources — suspiciously few`);
  assert.ok(gp.bodyHtml.length > 5000, `the grounding page is ${gp.bodyHtml.length} bytes — it rendered empty once before`);
});

test("the measured bound comes from fitness.json and is NEVER invented when absent", () => {
  const s = findStandard("coffee", "1.0")!;
  const html = renderFitness(s);
  if (!s.fitness || !s.fitness.samples.length) {
    assert.match(html, /has not yet been fitness-measured/);
    assert.doesNotMatch(html, /\d+\.\d+%/, "a bound was rendered with no measurement behind it");
    return;
  }
  for (const x of s.fitness.samples) {
    // The exact figures, formatted from the file. Hand-editing the page to a nicer
    // number is the failure this test exists to prevent.
    assert.ok(html.includes(`${x.bound_95_cluster_icc02_pct.toFixed(2)}%`), `bound for ${x.name} is not the fitness.json value`);
    assert.ok(html.includes(String(x.pass_rows_audited)), `n for ${x.name} is not the fitness.json value`);
    assert.ok(html.includes(String(x.stores)), `store count for ${x.name} is not the fitness.json value`);
    assert.ok(html.includes(x.method.slice(0, 40).replace(/&/g, "&amp;")), `the method for ${x.name} is not published`);
  }
});

test("the sitemap carries every entry, and llms.txt points at the artifact", () => {
  const s = findStandard("coffee", "1.0")!;
  const paths = standardsSitemapPaths();
  assert.ok(paths.includes("/standards"));
  assert.ok(paths.includes("/standards/coffee/1.0"));
  assert.ok(paths.includes("/standards/coffee/1.0/standard.json"));
  for (const e of s.doc.entries) {
    assert.ok(paths.includes(`/standards/coffee/1.0/${e.id}`), `${e.id} is not in the sitemap`);
  }
  const txt = llmsTxt(BASE);
  assert.match(txt, /standard\.json/);
  assert.ok(txt.includes(s.hash), "llms.txt does not publish the content hash a citation resolves against");
  assert.match(txt, /we cannot test/i);
});

test("llms.txt publishes the CURRENT version's measured rate, and marks the superseded one", () => {
  // ⚠️ THE THIRD INSTANCE OF ONE DEFECT IN THIS SESSION, and the worst, because it was
  // INVERTED. `s.fitness` is v1.0's sidecar; v1.1 carries its measurement inside the
  // document. Reading `.fitness` directly made llms.txt advertise the SUPERSEDED version
  // as measured and the CURRENT one as having no published error rate — to exactly the
  // machine readers this file exists to serve. Nothing threw, and the file looked fine.
  const txt = llmsTxt(BASE);
  for (const s of loadPublishedStandards()) {
    const f = fitnessOf(s);
    assert.ok(f, `${s.publicVersion} publishes no measurement — then llms.txt cannot cite one`);
    for (const x of f!.samples) {
      assert.ok(txt.includes(`${x.bound_95_cluster_icc02_pct.toFixed(2)}%`),
        `llms.txt omits ${s.publicVersion}'s ${x.label} bound`);
    }
    assert.ok(txt.includes(s.hash), `llms.txt omits ${s.publicVersion}'s content hash`);
    if (s.supersededBy) {
      assert.match(txt, new RegExp(`SUPERSEDED by v${s.supersededBy.replace(".", "\\.")}`),
        `llms.txt does not tell a machine reader that v${s.publicVersion} is superseded — it would cite the wrong version`);
    }
  }
  // A floor must be labelled as one wherever it is published, or it gets compared with a
  // complete audit as a peer.
  assert.match(txt, /a FLOOR/, "llms.txt publishes the general bound without saying it is a floor");
  // And the result vocabulary is the product's own — `proven`, not `pass`. That one word
  // is what the two sites had drifted apart on.
  assert.match(txt, /reports proven, not proven, or requires store access/);
});

test("THE STANDALONE DOCUMENT LOADS THE SITE'S FONTS, not just its stylesheet", () => {
  // ⚠️ A DEFECT NOBODY COULD SEE, because a missing webfont degrades to a system font
  // rather than to an error. The fonts are loaded by a <link> in viewer/index.html;
  // there is no @import or @font-face anywhere in theme.css. The standalone shell copied
  // the STYLESHEET href and nothing else, so every published standard page rendered
  // --font-display all the way down to -apple-system, and the typography was being tuned
  // against a face that was never on the page.
  const page = standardsPageFor("/standards/coffee/1.1", BASE)!;
  const doc = renderStandaloneDocument(page, { cssHref: "/assets/x.css", brand: "AisleLens", base: BASE });
  assert.ok(doc.includes(FONT_LINKS), "the standalone document does not carry the font links");
  assert.ok(doc.includes('href="/assets/x.css"'), "the standalone document does not link the built stylesheet");

  // The pair must stay byte-identical to the SPA's own <link>, or the two surfaces
  // silently render in different faces.
  const spa = fs.readFileSync(path.join(process.cwd(), "viewer/index.html"), "utf8");
  const url = /https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/.exec(FONT_LINKS)?.[0];
  assert.ok(url, "FONT_LINKS carries no font URL");
  assert.ok(spa.includes(url!), `viewer/index.html requests a different font URL than the standalone document:\n  standalone: ${url}`);
});

test("a path that is not a published standard resolves to nothing rather than a blank page", () => {
  assert.equal(standardsPageFor("/standards/coffee/9.9", BASE), null);
  assert.equal(standardsPageFor("/standards/tea/1.0", BASE), null);
  assert.equal(standardsPageFor("/standards/coffee/1.0/NO-SUCH-ENTRY", BASE), null);
  assert.equal(standardsPageFor("/", BASE), null);
  // The draft under standards/accessory/ exists on disk and must NOT be published.
  assert.equal(standardsPageFor("/standards/accessory/0.1", BASE), null);
  assert.equal(standardJsonFor("/standards/accessory/0.1/standard.json"), null);
});

test("every string the standard pages render passes the REAL claim linter", () => {
  // Imported, never reimplemented. The site selling claim discipline has to pass its
  // own check, and the check has to be the same one the product runs on merchants.
  const pages = [standardsPageFor("/standards", BASE)!, standardsPageFor("/standards/coffee/1.0", BASE)!];
  const s = findStandard("coffee", "1.0")!;
  for (const e of s.doc.entries) pages.push(standardsPageFor(`/standards/coffee/1.0/${e.id}`, BASE)!);

  const offenders: string[] = [];
  for (const page of pages) {
    // Only OUR chrome is linted, not the artifact's own quoted prose: an entry that
    // documents why "guaranteed" is insufficient evidence must be allowed to contain
    // the word. The titles and descriptions are ours.
    const r = lintStrings([page.title, page.description]);
    if (!r.ok) offenders.push(`${page.canonical}: ${r.violations.map((v) => `${v.rule} "${v.excerpt}"`).join("; ")}`);
  }
  assert.deepEqual(offenders, [], `standard page chrome fails the claim linter:\n${offenders.join("\n")}`);
});

test("BANNED VOCABULARY never appears in the standard pages' own chrome", () => {
  // Banned permanently, because they describe the product this one replaced.
  const BANNED = /\b(score|scoring|ranking|share of voice|GEO|optimi[sz]e|boost|visibility)\b/i;
  // Banned until true.
  const UNTRUE = /\b(certified|certification|standards body|accredited|trusted by|guaranteed)\b/i;
  const pages = [standardsPageFor("/standards", BASE)!, standardsPageFor("/standards/coffee/1.0", BASE)!];
  for (const page of pages) {
    for (const s of [page.title, page.description]) {
      assert.doesNotMatch(s, BANNED, `banned vocabulary in page chrome: ${s}`);
      assert.doesNotMatch(s, UNTRUE, `unearned claim in page chrome: ${s}`);
    }
  }
});

test("NO PAGE ANYWHERE RENDERS \"[object Object]\"", () => {
  // ⚠️ TWO FIELDS DID. `posture` and `applicability` are objects in the artifact that
  // read like strings, and template interpolation converts silently — so nothing threw,
  // nothing failed, and a published page showed a reader a JavaScript diagnostic. A
  // third such field is a matter of time, so this is asserted over EVERY page rather
  // than over the two names already known to be wrong.
  const s = findStandard("coffee", "1.0")!;
  const paths = ["/standards", "/standards/coffee/1.0", "/standards/coffee/1.0/grounding",
    ...s.doc.entries.map((e) => `/standards/coffee/1.0/${e.id}`)];
  const bad: string[] = [];
  for (const path of paths) {
    const page = standardsPageFor(path, BASE)!;
    for (const [what, text] of [["body", page.bodyHtml], ["title", page.title], ["description", page.description]] as const) {
      if (text.includes("[object Object]")) bad.push(`${path} (${what})`);
      if (/\bundefined\b/.test(text)) bad.push(`${path} (${what}) renders the literal "undefined"`);
    }
  }
  assert.deepEqual(bad, [], `pages rendered a JavaScript value as prose:\n${bad.join("\n")}`);
});

test("MEASURED discrimination is published beside the prediction, and the three counts are DERIVED", () => {
  // Three numbers the brief for this session ran together, and they answer three
  // different questions:
  //   bands held         — how often the PREDICTION was right
  //   above band         — how many discriminate LESS than predicted
  //   carries information— how many MEASURED rates sit inside the 15-85% target band
  // "Above its predicted band" and "carries no information" are NOT the same claim:
  // FORMAT-001 measured 73.7% against a predicted 30-60% — above its band, and squarely
  // inside the band where an answer discriminates.
  const s = findStandard("coffee", "1.1")!;
  const page = standardsPageFor("/standards/coffee/1.1", BASE)!;
  const exec = s.doc.entries.filter((e) => e.tier === "executable");
  const measured = exec.map((e) => measuredOf(s, e)!).filter(Boolean);
  assert.equal(measured.length, exec.length, "an executable entry in a measured version has no measurement");

  for (const m of measured) {
    // BOTH numbers on the page, from the artifact.
    assert.ok(page.bodyHtml.includes(`${m.fail_pct.toFixed(1)}%`), `measured rate ${m.fail_pct} is not published`);
    assert.ok(page.bodyHtml.includes(esc(m.predicted_band ?? "")), `predicted band ${m.predicted_band} was dropped when the measurement landed`);
  }
  const held = measured.filter((m) => m.verdict === "held").length;
  const above = measured.filter((m) => m.verdict === "above_band").length;
  const carries = measured.filter((m) => m.fail_pct >= 15 && m.fail_pct <= 85).length;
  assert.ok(page.bodyHtml.includes(`<strong>${held} of ${measured.length}</strong> predictions held`), "the bands-held count is not derived");
  assert.ok(page.bodyHtml.includes(`<strong>${above} of ${measured.length}</strong>`), "the above-band count is not derived");
  assert.ok(page.bodyHtml.includes(`${carries} of ${measured.length} entries have a measured fail rate inside`), "the carries-information count is not derived");
  assert.notEqual(carries, held, "if these were equal, this test could not tell the two questions apart");
});

test("the defect classes are published, INCLUDING the one no guard addresses", () => {
  const s = findStandard("coffee", "1.1")!;
  const f = fitnessOf(s)!;
  const coffee = f.samples.find((x) => x.name === "coffee")!;
  const classes = (coffee.defect_classes ?? []).filter((c): c is Exclude<typeof c, string> => typeof c !== "string");
  assert.ok(classes.length >= 4, "fewer than four defect classes carried");
  const html = renderFitness(s);
  for (const c of classes) {
    assert.ok(html.includes(esc(c.klass)), `defect class not published: ${c.klass}`);
    assert.ok(html.includes(esc(c.example)), `defect class example not published: ${c.example}`);
  }
  // The counts must add up to the errors. A class list that accounts for fewer errors
  // than the sample records is a partial explanation presented as a complete one.
  assert.equal(classes.reduce((n, c) => n + c.count, 0), coffee.confirmed_false_positives);
  assert.ok(classes.some((c) => c.addressed_by_a_guard === false), "no class is flagged as unaddressed");
});

test("BOTH fitness shapes render — a v1.0 sidecar of STRINGS and a v1.1 document of OBJECTS", () => {
  // ⚠️ THE `grounding.sources` DEFECT, REPRODUCED VERBATIM ONE VERSION LATER. v1.0's
  // sidecar stores defect classes as prose STRINGS; grammar 1.1 stores them as objects.
  // A renderer written for the object shape read `c.klass` off a string, got `undefined`,
  // and published four table rows reading "undefined" on the v1.0 page. Nothing threw.
  // The blanket "no page renders undefined" assertion is what caught it — this test
  // pins the specific pair so it cannot come back.
  for (const s of loadPublishedStandards()) {
    const html = renderFitness(s);
    assert.doesNotMatch(html, /undefined/, `${s.publicVersion}: the fitness section rendered "undefined"`);
    assert.doesNotMatch(html, /\[object Object\]/, `${s.publicVersion}: the fitness section rendered an object as prose`);
    assert.ok(html.length > 800, `${s.publicVersion}: the fitness section is ${html.length} bytes — it rendered nearly empty`);
  }
});

test("THE IDENTIFIER WORKED EXAMPLE publishes real bytes from real stores", () => {
  // The one defect class an audit of RENDERED evidence cannot see, because the row
  // renders no quote. Eighteen false passes hid behind it in a sample whose full read
  // had reported zero, and correcting them moved a published bound from 0.83% to 7.80%.
  const page = standardsPageFor("/standards/coffee/1.1", BASE)!;
  const ex = JSON.parse(fs.readFileSync(path.join(process.cwd(), "fixtures/identifiers/worked-example.json"), "utf8")) as {
    honest: { host: string; value: string; excerpt: string };
    storeLocal: Array<{ host: string; value: string; excerpt: string }>;
  };
  assert.match(page.bodyHtml, /id="identifier-example"/, "the worked example is not on the page");
  for (const r of [ex.honest, ...ex.storeLocal]) {
    assert.ok(page.bodyHtml.includes(esc(r.host)), `${r.host} is not named`);
    assert.ok(page.bodyHtml.includes(esc(r.value)), `${r.host}'s identifier value is not published`);
    // THE BYTES. An example that paraphrases the evidence is the defect it describes.
    assert.ok(page.bodyHtml.includes(esc(r.excerpt)), `${r.host}'s captured excerpt is not published verbatim`);
  }
  assert.ok(ex.storeLocal.length >= 2, "one counter-example is an anecdote; the argument needs the contrast");
});

test("the applicability of an entry is published as its actual fields, not stringified", () => {
  const s = findStandard("coffee", "1.0")!;
  const e = s.doc.entries.find((x) => x.applicability && typeof x.applicability === "object")!;
  assert.ok(e, "no entry carries an object applicability — the artifact changed shape");
  const page = standardsPageFor(`/standards/coffee/1.0/${e.id}`, BASE)!;
  const app = e.applicability as { applies_when?: string; signal?: string };
  if (app.applies_when) assert.ok(page.bodyHtml.includes(app.applies_when), "applies_when is not published");
  if (app.signal) assert.ok(page.bodyHtml.includes(app.signal), "the applicability signal is not published");
});
