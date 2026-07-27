import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadPublishedStandards, standardsPageFor, standardJsonFor, standardsSitemapPaths,
  llmsTxt, renderFitness, findStandard, groundingOf,
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

test("the JSON route serves the artifact BYTE-FOR-BYTE, so a citation resolves to what was hashed", () => {
  const s = findStandard("coffee", "1.0")!;
  const served = standardJsonFor("/standards/coffee/1.0/standard.json");
  assert.ok(served, "the JSON path does not resolve");
  const onDisk = fs.readFileSync(path.join(process.cwd(), "standards/coffee/v1.0/standard.json"), "utf8");
  assert.equal(served!.json, onDisk, "the served JSON is not the file on disk");
  assert.equal(served!.hash, s.hash);
  // A re-serialised body would still parse but would hash differently, and every
  // citation made against the published hash would stop verifying.
  assert.equal(standardHash(JSON.parse(served!.json)), s.hash);
});

test("every entry id resolves to its own page, and the count matches the artifact", () => {
  const s = findStandard("coffee", "1.0")!;
  let resolved = 0;
  for (const e of s.doc.entries) {
    const page = standardsPageFor(`/standards/coffee/1.0/${e.id}`, BASE);
    assert.ok(page, `entry ${e.id} does not resolve — a published id that 404s is a broken citation`);
    assert.ok(page!.bodyHtml.includes(e.id), `entry ${e.id}'s page does not carry its own id`);
    resolved++;
  }
  assert.equal(resolved, s.doc.entries.length);
  assert.ok(resolved >= 40, `only ${resolved} entries — the coffee standard has 42`);
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

test("the applicability of an entry is published as its actual fields, not stringified", () => {
  const s = findStandard("coffee", "1.0")!;
  const e = s.doc.entries.find((x) => x.applicability && typeof x.applicability === "object")!;
  assert.ok(e, "no entry carries an object applicability — the artifact changed shape");
  const page = standardsPageFor(`/standards/coffee/1.0/${e.id}`, BASE)!;
  const app = e.applicability as { applies_when?: string; signal?: string };
  if (app.applies_when) assert.ok(page.bodyHtml.includes(app.applies_when), "applies_when is not published");
  if (app.signal) assert.ok(page.bodyHtml.includes(app.signal), "the applicability signal is not published");
});
