import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadPublishedStandards, standardsPageFor, standardJsonFor, standardsSitemapPaths,
  llmsTxt, renderFitness, findStandard, groundingOf, fitnessOf, measuredOf, predictionOf,
  esc, renderStandaloneDocument, FONT_LINKS, orderedTiers, currentOf, isCurrent,
  type PublishedStandard,
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

/** The hash every citation against a version resolves through. PINNED TO LITERALS, all
 *  of them: a recomputed hash compared with itself is the check this file's own comment
 *  calls worth nothing, and the point of freezing a version is that an edit to its bytes
 *  fails the build rather than silently invalidating every citation made against it. */
const FROZEN_HASHES: Record<string, string> = {
  "1.0": "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5",
  "1.1": "f8ec2780f60c38931913e5b6cd37506500c8462709209de7180ba6691d6137e7",
  "1.2": "fe199a864d3d4d565986851f9bfae9e108d55e4c86af18b1f8027f3d23486b58",
};

/** Every page a version publishes. Used by the blanket assertions, which have to cover
 *  EVERY page at EVERY version — the "[object Object]" and "undefined" defects were both
 *  found by a blanket check and would both have survived a spot check. */
function allPaths(s: PublishedStandard): string[] {
  const b = `/standards/${s.slug}/${s.publicVersion}`;
  return [b, `${b}/grounding`, ...s.doc.entries.map((e) => `${b}/${e.id}`)];
}

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

test("ALL THREE VERSIONS SERVE, and every entry id at every version resolves to its own page", () => {
  const list = loadPublishedStandards();
  assert.deepEqual(list.map((s) => `${s.slug}/${s.publicVersion}`), ["coffee/1.0", "coffee/1.1", "coffee/1.2"],
    "the published set changed — the version-continuity assertions below are written against it");
  let resolved = 0;
  for (const s of list) {
    assert.ok(standardsPageFor(`/standards/${s.slug}/${s.publicVersion}`, BASE), `${s.publicVersion} does not resolve`);
    assert.equal(s.doc.entries.length, 42, `${s.publicVersion} carries ${s.doc.entries.length} entries, not 42`);
    for (const e of s.doc.entries) {
      const page = standardsPageFor(`/standards/${s.slug}/${s.publicVersion}/${e.id}`, BASE);
      assert.ok(page, `entry ${e.id} does not resolve — a published id that 404s is a broken citation`);
      assert.ok(page!.bodyHtml.includes(e.id), `entry ${e.id}'s page does not carry its own id`);
      resolved++;
    }
  }
  assert.equal(resolved, 126, `${resolved} entries resolved, expected 42 x 3`);
});

test("A PRIOR VERSION'S ENTRY ID RESOLVES ACROSS THE WHOLE CHAIN, not one hop", () => {
  // ⚠️ THIS IS WHAT PUBLISHING A THIRD VERSION BROKE, AND THE ONE-HOP BUG WAS INVISIBLE
  // WHILE THERE WERE ONLY TWO. Each entry names only its IMMEDIATE predecessor in
  // `supersedes`, and the router did a single `find` — which is indistinguishable from
  // correct for v1.0 -> v1.1. Measured the moment v1.2 shipped: 42/42 v1.0 ids resolved
  // at v1.1 and 0/42 resolved at v1.2. Every version published makes it worse, which is
  // the opposite of what a stable citation is for.
  //
  // So this asserts every OLDER version's ids at every NEWER version, not just the pair.
  const list = loadPublishedStandards();
  let mapped = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const older = list[i]!, newer = list[j]!;
      for (const old of older.doc.entries) {
        const page = standardsPageFor(`/standards/coffee/${newer.publicVersion}/${old.id}`, BASE);
        assert.ok(page, `${old.id} does not resolve at v${newer.publicVersion} — a v${older.publicVersion} citation trimmed to a later version 404s`);
        // It must land on the SAME question, identified by the id suffix the chain preserves.
        const suffix = old.id.replace(/^ALS-COFFEE-[0-9.]+-/, "");
        const successor = newer.doc.entries.find((e) => e.id.endsWith(`-${suffix}`))!;
        assert.ok(successor, `${old.id} has no v${newer.publicVersion} successor`);
        assert.ok(page!.bodyHtml.includes(successor.id),
          `${old.id} at v${newer.publicVersion} did not render its successor ${successor.id}`);
        assert.equal(page!.title, standardsPageFor(`/standards/coffee/${newer.publicVersion}/${successor.id}`, BASE)!.title);
        mapped++;
      }
    }
  }
  assert.equal(mapped, 42 * 3, `${mapped} chained resolutions, expected 42 across each of the three ordered pairs`);

  // An id that belongs to NO version still 404s — the alias must not become a fuzzy
  // matcher that resolves anything shaped like an id.
  assert.equal(standardsPageFor("/standards/coffee/1.1/ALS-COFFEE-1.0-NOSUCH-001", BASE), null);
  assert.equal(standardsPageFor("/standards/coffee/1.2/ALS-COFFEE-1.0-NOSUCH-001", BASE), null);
  // And the walk is FORWARD ONLY. A v1.2 id asked of v1.0 must 404: that question did not
  // exist in that version, and answering it would make the version in a citation cosmetic.
  assert.equal(standardsPageFor("/standards/coffee/1.0/ALS-COFFEE-1.2-FORMAT-001", BASE), null);
  assert.equal(standardsPageFor("/standards/coffee/1.1/ALS-COFFEE-1.2-FORMAT-001", BASE), null);
});

test("EVERY SUPERSEDED VERSION KEEPS SERVING, UNCHANGED, WITH A NOTICE ADDED AT RENDER TIME", () => {
  for (const s of loadPublishedStandards()) {
    const page = standardsPageFor(`/standards/coffee/${s.publicVersion}`, BASE)!;
    // The bytes are frozen at EVERY version, current one included — a hash is what a
    // citation resolves through from the day it is published, not from the day it is
    // replaced.
    assert.equal(standardHash(JSON.parse(s.rawJson)), FROZEN_HASHES[s.publicVersion],
      `v${s.publicVersion}'s bytes changed — every citation made against its hash stops verifying`);
    if (!s.supersededBy) {
      assert.doesNotMatch(page.bodyHtml, /Superseded by v/, `v${s.publicVersion} is current and says it is superseded`);
      assert.equal(isCurrent(s), true);
      continue;
    }
    assert.match(page.bodyHtml, new RegExp(`Superseded by v${s.supersededBy.replace(".", "\\.")}`),
      `v${s.publicVersion} is superseded and does not say so`);
    assert.match(page.bodyHtml, /byte for byte/i, "the notice does not explain why nothing was edited");
    assert.ok(!s.rawJson.includes(`Superseded by v${s.supersededBy}`), `the rendered notice leaked into v${s.publicVersion}'s artifact`);
  }
  assert.equal(currentOf("coffee")!.publicVersion, "1.2", "the current version is not the last registry entry");
});

test("v1.0 IS STILL WRONG ABOUT ITSELF, VERBATIM — which is what the later versions correct", () => {
  const v10 = findStandard("coffee", "1.0")!;
  const page = standardsPageFor("/standards/coffee/1.0", BASE)!;
  assert.match(page.bodyHtml, /Superseded by v1\.1/, "a superseded version does not say so");
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

test("EVERY VERSION publishes EVERY tier it carries, and the counts are DERIVED from the entries", () => {
  // The argument this encodes: sixteen questions saying "here is exactly what would
  // be required" is a stronger artifact than ten presented as complete. If a future
  // change quietly drops a tier from the page, this fails.
  //
  // ⚠️ AND IT IS ASSERTED PER VERSION, BECAUSE A NEW TIER IS EXACTLY WHAT SLIPS THROUGH.
  // The renderer used to build its sections with `TIER_ORDER.filter(present)`, which
  // DELETES a tier the list has not heard of. Grammar 1.2 added `unbound`; under that
  // code its five entries would have vanished from the contents and from the body, and a
  // page with 37 of 42 entries looks exactly like a document that has 37.
  for (const s of loadPublishedStandards()) {
    const page = standardsPageFor(`/standards/coffee/${s.publicVersion}`, BASE)!;
    const tiers = orderedTiers(s.doc);
    // orderedTiers must account for EVERY entry — that is what makes it safe to render from.
    assert.equal(tiers.reduce((n, [, c]) => n + c, 0), s.doc.entries.length,
      `v${s.publicVersion}: orderedTiers drops entries — ${tiers.map(([t, c]) => `${t}:${c}`).join(" ")}`);
    assert.equal(new Set(s.doc.entries.map((e) => e.tier)).size, tiers.length,
      `v${s.publicVersion}: a tier present in the artifact is missing from the rendered order`);
    for (const [t, n] of tiers) {
      assert.ok(page.bodyHtml.includes(`id="tier-${t}"`), `v${s.publicVersion}: tier ${t} has no section`);
      assert.ok(page.bodyHtml.includes(`<strong>${n}</strong>`), `v${s.publicVersion}: the count for ${t} is not derived`);
    }
    for (const e of s.doc.entries) {
      assert.ok(page.bodyHtml.includes(e.id), `v${s.publicVersion}: ${e.id} is not linked from the standard page`);
    }
  }
  // The labels themselves, per version, so a rename is visible rather than silent.
  const v10 = standardsPageFor("/standards/coffee/1.0", BASE)!;
  for (const label of ["Executable", "Blocked", "Advisory", "Not discriminating"]) {
    assert.ok(v10.bodyHtml.includes(label), `v1.0 does not publish the ${label} tier`);
  }
  const v12 = standardsPageFor("/standards/coffee/1.2", BASE)!;
  for (const label of ["Executable", "Blocked", "Advisory", "Not yet bound"]) {
    assert.ok(v12.bodyHtml.includes(label), `v1.2 does not publish the ${label} tier`);
  }
  // v1.2 retired `not_discriminating` as a TIER — at grammar 1.2 it is a measured
  // VERDICT, and five entries that had it without any measurement became `unbound`.
  assert.equal(v12.bodyHtml.includes('id="tier-not_discriminating"'), false,
    "v1.2 renders a not_discriminating tier section; at 1.2 that tier is not occupied");
});

test("A TIER EXPLANATION MAY NOT CLAIM A MEASUREMENT THE ENTRIES UNDER IT DO NOT HAVE", () => {
  // ⚠️ CAUGHT IN THIS SESSION, IN A DRAFT OF THIS VERY CHANGE. `not_discriminating` means
  // something DIFFERENT at grammar 1.2 — a measured verdict rather than a band the author
  // guessed — so the tier explanation was rewritten to say "MEASURED: this question was
  // run against a real sample". That sentence renders ONLY at v1.0 and v1.1, where the
  // five entries in that tier had never been run at all; at 1.2 the tier is empty, which
  // is exactly why those five became `unbound`. The rewrite would have published a false
  // sentence on two frozen documents and been invisible: every test stayed green.
  //
  // The general property: a tier heading that asserts a measurement must be backed by
  // entries that carry one.
  for (const s of loadPublishedStandards()) {
    const page = standardsPageFor(`/standards/coffee/${s.publicVersion}`, BASE)!;
    for (const [tier] of orderedTiers(s.doc)) {
      const entries = s.doc.entries.filter((e) => e.tier === tier);
      if (entries.some((e) => measuredOf(s, e))) continue;      // measured — free to say so
      const start = page.bodyHtml.indexOf(`id="tier-${tier}"`);
      assert.ok(start > 0, `v${s.publicVersion}: tier ${tier} has no section`);
      // The tier's own explanation is the paragraph between its <h2> and its entry list.
      const head = page.bodyHtml.slice(start, page.bodyHtml.indexOf("<ul class=\"std-entry-list\"", start));
      assert.doesNotMatch(head, /\bmeasured\b|was run against a real sample/i,
        `v${s.publicVersion}: the ${tier} tier claims a measurement, and not one of its ${entries.length} entries carries one`);
    }
  }
  // And the converse at v1.2, where the tier IS a measured verdict: it must be unoccupied,
  // because grammar 1.2 rejects the tier without a measurement behind it.
  const v12 = findStandard("coffee", "1.2")!;
  assert.equal(v12.doc.entries.filter((e) => e.tier === "not_discriminating").length, 0);
});

test("THE `unbound` TIER READS AS OURS, and is distinct from both `blocked` and `advisory`", () => {
  // ⚠️ THE WHOLE POINT OF THE TIER. `blocked` says the ENGINE cannot; `advisory` says
  // PUBLIC DATA cannot; `unbound` says both can and THIS STANDARD has not written the
  // binding or run the adversarial pass. Rendering it as either of the other two blames a
  // limit that does not exist — which is precisely what grammar 1.2 added a tier to stop,
  // rather than reusing one and living with a false sentence in a published document.
  const s = findStandard("coffee", "1.2")!;
  const unbound = s.doc.entries.filter((e) => e.tier === "unbound");
  assert.equal(unbound.length, 5, "v1.2 should carry five unbound entries");
  const page = standardsPageFor("/standards/coffee/1.2", BASE)!;

  for (const e of unbound) {
    const reason = (e as { unbound_reason?: string }).unbound_reason;
    assert.ok(reason && reason.length > 40, `${e.id} occupies \`unbound\` without naming why`);
    // On the STANDARD page, so the tier is legible without a click.
    assert.ok(page.bodyHtml.includes(esc(reason!)), `${e.id}: unbound_reason is not published on the standard page`);
    // And on its own page, under a heading that says whose problem it is.
    const ep = standardsPageFor(`/standards/coffee/1.2/${e.id}`, BASE)!;
    assert.match(ep.bodyHtml, /Why this is not yet bound/, `${e.id}: no "why is this not run" section`);
    assert.ok(ep.bodyHtml.includes(esc(reason!)), `${e.id}: unbound_reason is not on its own page`);
    assert.ok(ep.bodyHtml.includes("std-tier-unbound"), `${e.id}: the tier is not marked on the page`);
    // An unbound entry was never run, so it must publish no rate at all.
    assert.equal(measuredOf(s, e), null, `${e.id} is unbound and carries a measurement`);
    assert.doesNotMatch(ep.bodyHtml, /Measured fail rate/, `${e.id} is unbound and publishes a fail rate`);
  }
  // The tier's own explanation must not be the blocked one, and must say the obstacle is ours.
  const idx = page.bodyHtml.indexOf('std-tier-unbound');
  assert.ok(idx > 0);
  assert.match(page.bodyHtml, /obstacle is unwritten work in this document/,
    "the unbound tier does not say the obstacle is ours");
  assert.doesNotMatch(page.bodyHtml.slice(idx, idx + 900), /the engine cannot yet/i,
    "the unbound tier is described with the blocked wording");
});

test("THE THREE-VALUED VERDICT RENDERS AS THREE THINGS, and `indeterminate` is neither decision", () => {
  // ⚠️ WHY THIS IS NOT A yes/no COLUMN. The 1.0/1.1 table derived "Discriminates: yes/no"
  // from the POINT ESTIMATE. At 1.2 the verdict is decided by the INTERVAL, and the two
  // disagree on SOURCE-001: 89% is outside the 15-85% band, so a point-estimate column
  // says "no", while the artifact's verdict is `indeterminate` — which is not "no". A
  // page disagreeing with its own JSON is the defect this whole file is built against.
  const s = findStandard("coffee", "1.2")!;
  const page = standardsPageFor("/standards/coffee/1.2", BASE)!;
  const measured = s.doc.entries.map((e) => measuredOf(s, e)).filter((m) => m !== null);
  assert.equal(measured.length, 10, "v1.2 should carry ten measured entries");

  const n = (v: string) => measured.filter((m) => m!.verdict === v).length;
  assert.equal(n("discriminating") + n("indeterminate") + n("not_discriminating"), 10,
    "a measured verdict is not one of the three values the grammar allows");
  assert.ok(n("indeterminate") >= 1, "no entry is indeterminate — then this test cannot tell the three apart");
  // DERIVED counts on the page, not typed.
  assert.ok(page.bodyHtml.includes(
    `<strong>${n("discriminating")} discriminating · ${n("indeterminate")} undecided · ${n("not_discriminating")} not discriminating</strong>`),
  "the verdict split is not derived from the entries");

  // Each verdict renders as a DIFFERENT string and carries a distinct class.
  for (const v of ["discriminating", "indeterminate", "not_discriminating"]) {
    assert.ok(page.bodyHtml.includes(`std-verdict-${v}`), `verdict ${v} has no distinct presentation`);
  }
  // `indeterminate` must not read as either decision.
  assert.match(page.bodyHtml, /RAN AND DECIDED NOTHING/, "`indeterminate` is not distinguished from a decision");
  assert.match(page.bodyHtml, /no difference detectable at this n/,
    "the page does not say what an undecided result means");

  // The interval, not just the rate, for every measured entry — and the artifact's own
  // numbers, formatted, never retyped.
  for (const m of measured) {
    assert.ok(m!.interval, `${m!.id} has no interval`);
    assert.ok(page.bodyHtml.includes(`${m!.interval!.lower_pct.toFixed(1)} – ${m!.interval!.upper_pct.toFixed(1)}%`),
      `${m!.id}: the 95% interval is not published`);
    assert.ok(page.bodyHtml.includes(`${m!.fail_pct.toFixed(1)}%`), `${m!.id}: the fail rate is not published`);
  }
  // NOTHING WAS RETIRED. Five entries returned a verdict that would license a retirement
  // and all five are still executable — the page has to say so, because a reader seeing
  // "not discriminating" five times will otherwise assume it was acted on.
  const notDisc = s.doc.entries.filter((e) => measuredOf(s, e)?.verdict === "not_discriminating");
  assert.equal(notDisc.length, 5);
  for (const e of notDisc) assert.equal(e.tier, "executable", `${e.id} was retired on a measured verdict alone`);
  assert.match(page.bodyHtml, /MAY NOT BE ACTED ON/, "a blocked retirement is not flagged on the page");
});

test("THE DENOMINATOR IS `n_adjudicated`, and a row the engine could not decide is not a pass", () => {
  // v1.1 published DELIV-001 at 45.0% over the rows it was ASKED. 26 of those 100 returned
  // `requires_store_access` — neither pass nor fail — so that reading counts an undecided
  // row as a pass. 45/74 = 60.8% is the same failures over the rows that were adjudicated.
  const s = findStandard("coffee", "1.2")!;
  const deliv = s.doc.entries.find((e) => e.id.endsWith("-DELIV-001"))!;
  const m = measuredOf(s, deliv)!;
  assert.equal(m.kind, "discrimination");
  assert.notEqual(m.adjudicated, m.asked, "DELIV-001 should have undecided rows excluded from its denominator");
  assert.equal(Math.round((m.fail_count! / m.adjudicated!) * 1000) / 10, Math.round(m.fail_pct * 10) / 10,
    "the published rate is not fail_count / n_adjudicated");
  const page = standardsPageFor("/standards/coffee/1.2", BASE)!;
  assert.ok(page.bodyHtml.includes(`${m.fail_count} / ${m.adjudicated}`), "the adjudicated denominator is not published");
  assert.ok(page.bodyHtml.includes(`${m.asked - m.adjudicated!} of ${m.asked} undecided by the engine, excluded`),
    "the page does not say how many rows were excluded, so the denominator looks arbitrary");
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

test("the sitemap carries EVERY version's routes and EVERY entry, and llms.txt points at the artifact", () => {
  const paths = standardsSitemapPaths();
  assert.ok(paths.includes("/standards"));
  for (const s of loadPublishedStandards()) {
    const b = `/standards/coffee/${s.publicVersion}`;
    for (const route of [b, `${b}/standard.json`, `${b}/grounding`]) {
      assert.ok(paths.includes(route), `${route} is not in the sitemap`);
    }
    for (const e of s.doc.entries) {
      assert.ok(paths.includes(`${b}/${e.id}`), `${e.id} is not in the sitemap`);
    }
  }
  // 3 versions x (1 standard + 1 json + 1 grounding + 42 entries) + /standards
  assert.equal(paths.length, 1 + 3 * 45, `the sitemap carries ${paths.length} standards paths`);
  assert.equal(new Set(paths).size, paths.length, "the sitemap repeats a path");
  // Every sitemap path must actually resolve — a listed URL that 404s is worse than an
  // unlisted one, and this is what caught the one-hop chain bug's blast radius.
  for (const path of paths) {
    if (path.endsWith("/standard.json")) {
      assert.ok(standardJsonFor(path), `sitemap lists ${path}, which does not serve JSON`);
    } else if (path !== "/standards") {
      assert.ok(standardsPageFor(path, BASE), `sitemap lists ${path}, which does not resolve`);
    }
  }
  const txt = llmsTxt(BASE);
  assert.match(txt, /standard\.json/);
  assert.match(txt, /we cannot test/i);
});

test("llms.txt: THE CURRENT VERSION IS THE ONE DESCRIBED AS MEASURED", () => {
  // ⚠️ THIS SHIPPED BACKWARDS ONCE, AND IT IS THE WORST FORM OF THE THREE-SHAPES DEFECT.
  // `s.fitness` is v1.0's SIDECAR; v1.1 keeps its measurement in `measured_fitness` and
  // v1.2 in `category_fitness`. Reading the raw field made llms.txt advertise the
  // SUPERSEDED version as measured and the CURRENT one as having no published error rate
  // at all — to exactly the machine readers this file exists to serve. Nothing threw and
  // the file looked fine, because an absent block renders as an absent line.
  const txt = llmsTxt(BASE);
  const list = loadPublishedStandards();
  const current = currentOf("coffee")!;

  // 1. The current version is named as current, and its bound is in the file.
  assert.ok(txt.includes(`CURRENT version of coffee`), "llms.txt never says which version to cite");
  const currentBlock = txt.slice(txt.indexOf(`/standards/coffee/${current.publicVersion})`));
  assert.ok(currentBlock.includes("CURRENT version of coffee"),
    "the CURRENT marker is not on the current version's block");
  const cf = fitnessOf(current);
  assert.ok(cf?.samples.length, "the current version publishes no measurement");
  for (const x of cf!.samples) {
    assert.ok(currentBlock.includes(`${x.bound_95_cluster_icc02_pct.toFixed(2)}%`),
      `llms.txt omits the CURRENT version's ${x.label} bound`);
    assert.ok(currentBlock.includes(`${x.point_estimate_pct.toFixed(2)}%`),
      `llms.txt omits the CURRENT version's ${x.label} point estimate`);
  }
  assert.doesNotMatch(currentBlock, /No fitness measurement is published/,
    "llms.txt tells a machine reader the CURRENT version is unmeasured — the exact inversion this test exists for");

  // 2. EVERY published version's bound appears, and every superseded one says so.
  for (const s of list) {
    const f = fitnessOf(s);
    assert.ok(f, `${s.publicVersion} publishes no measurement — then llms.txt cannot cite one`);
    for (const x of f!.samples) {
      assert.ok(txt.includes(`${x.bound_95_cluster_icc02_pct.toFixed(2)}%`),
        `llms.txt omits ${s.publicVersion}'s ${x.label} bound`);
    }
    assert.ok(txt.includes(s.hash), `llms.txt omits ${s.publicVersion}'s content hash`);
    assert.ok(txt.includes(FROZEN_HASHES[s.publicVersion]!), `llms.txt does not publish v${s.publicVersion}'s frozen hash`);
    if (s.supersededBy) {
      assert.match(txt, new RegExp(`SUPERSEDED by v${s.supersededBy.replace(".", "\\.")}`),
        `llms.txt does not tell a machine reader that v${s.publicVersion} is superseded — it would cite the wrong version`);
    }
  }
  // Exactly one CURRENT marker per slug: two would be as useless as none.
  assert.equal(txt.split("CURRENT version of coffee").length - 1, 1, "more than one version is marked current");
  assert.equal(txt.split("SUPERSEDED by v").length - 1, list.length - 1, "the superseded markers do not match the registry");

  // 3. THE GENERAL FIGURE IS LABELLED A FLOOR wherever it appears. A floor and a complete
  //    audit compared as peers is a bigger error than either number.
  assert.match(txt, /a FLOOR/, "llms.txt publishes the general bound without saying it is a floor");
  assert.ok(txt.includes("FLOOR, not a bound"),
    "the current version's limits do not carry the floor caveat for the general comparison");

  // 4. The three-valued verdict is spelled out for a machine reader, and `indeterminate`
  //    is explicitly not either decision.
  assert.match(txt, /indeterminate` means the measurement ran and decided nothing/,
    "llms.txt reports a three-valued verdict without saying what the third value means");
  assert.match(txt, /None has been retired/, "llms.txt implies a measured verdict was acted on");

  // 5. The result vocabulary is the product's own — `proven`, not `pass`. That one word is
  //    what the two sites had drifted apart on.
  assert.match(txt, /reports proven, not proven, or requires store access/);
  assert.doesNotMatch(txt, /\bundefined\b|\[object Object\]|NaN/, "llms.txt renders a JavaScript value");
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

test("THE STANDARDS INDEX LEADS WITH THE CURRENT VERSION, not the oldest", () => {
  // ⚠️ THE llms.txt INVERSION, IN HTML. A flat list of every version with nothing marking
  // which to cite puts the OLDEST first — the one whose posture is wrong about itself and
  // whose failure rates are predictions. Someone writing "your pages fail ALS-COFFEE-…"
  // from this page would pin a citation to a superseded document by reading top to bottom.
  const page = standardsPageFor("/standards", BASE)!;
  const current = currentOf("coffee")!;
  const older = loadPublishedStandards().filter((s) => s.slug === "coffee" && !isCurrent(s));

  const iCurrent = page.bodyHtml.indexOf(`/standards/coffee/${current.publicVersion}`);
  assert.ok(iCurrent > 0, "the current version is not linked from the index");
  for (const o of older) {
    const iOld = page.bodyHtml.indexOf(`/standards/coffee/${o.publicVersion}`);
    assert.ok(iOld > iCurrent, `v${o.publicVersion} is listed before the current v${current.publicVersion}`);
    assert.ok(page.bodyHtml.includes(`superseded by v${o.supersededBy}`),
      `v${o.publicVersion} is listed without saying it is superseded`);
  }
  assert.match(page.bodyHtml, /Current version — cite this one/, "the index never says which version to cite");
  // The bound on the index is the CURRENT version's, from the artifact.
  const b = fitnessOf(current)!.samples[0]!;
  assert.ok(page.bodyHtml.includes(`${b.bound_95_cluster_icc02_pct.toFixed(2)}%`),
    "the index publishes no measured bound for the current version");
  // Tier counts lead with what the document DOES, not with its largest tier.
  const first = orderedTiers(current.doc)[0]!;
  assert.equal(first[0], "executable");
  assert.ok(page.bodyHtml.includes(`${first[1]} Executable ·`), "the index leads the tier counts with the wrong tier");
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

test("NO PAGE AT ANY VERSION RENDERS \"[object Object]\", \"undefined\" or \"NaN\"", () => {
  // ⚠️ TWO FIELDS DID. `posture` and `applicability` are objects in the artifact that
  // read like strings, and template interpolation converts silently — so nothing threw,
  // nothing failed, and a published page showed a reader a JavaScript diagnostic. A
  // renderer written for grammar 1.1's object-shaped defect classes then read `c.klass`
  // off a v1.0 STRING and published four table rows reading "undefined".
  //
  // ⚠️ AND IT RUNS AT EVERY PUBLISHED VERSION, WHICH IS THE HALF THAT MATTERS NOW. Both
  // of those defects were introduced by a renderer meeting a shape it was not written
  // for, and a new grammar version is exactly that event. Scoping this to v1.0 would have
  // left grammar 1.2's five new field shapes checked by nothing.
  const paths = ["/standards", ...loadPublishedStandards().flatMap(allPaths)];
  assert.ok(paths.length >= 3 * 43, `only ${paths.length} pages are being checked — a version is missing`);
  const bad: string[] = [];
  for (const path of paths) {
    const page = standardsPageFor(path, BASE);
    if (!page) { bad.push(`${path} does not resolve`); continue; }
    for (const [what, text] of [["body", page.bodyHtml], ["title", page.title], ["description", page.description]] as const) {
      if (text.includes("[object Object]")) bad.push(`${path} (${what}) renders "[object Object]"`);
      if (/\bundefined\b/.test(text)) bad.push(`${path} (${what}) renders the literal "undefined"`);
      if (/\bNaN\b/.test(text)) bad.push(`${path} (${what}) renders NaN`);
    }
  }
  assert.deepEqual(bad, [], `pages rendered a JavaScript value as prose:\n${bad.join("\n")}`);
});

test("EVERY PAGE AT EVERY VERSION CLEARS A BYTE FLOOR — a presence check cannot see an empty section", () => {
  // ⚠️ THE LESSON FROM `grounding.sources`: eleven tests were green while every grounding
  // block on 42 entry pages and the whole grounding page rendered EMPTY, because they
  // asserted the presence of OTHER things. Grounding went from 309 bytes to 26,652 when
  // the field name was fixed. A floor is crude and it is the assertion that would have
  // caught it.
  for (const s of loadPublishedStandards()) {
    const std = standardsPageFor(`/standards/coffee/${s.publicVersion}`, BASE)!;
    assert.ok(std.bodyHtml.length > 25_000, `v${s.publicVersion}: the standard page is ${std.bodyHtml.length} bytes`);
    const gr = standardsPageFor(`/standards/coffee/${s.publicVersion}/grounding`, BASE)!;
    assert.ok(gr.bodyHtml.length > 20_000, `v${s.publicVersion}: the grounding page is ${gr.bodyHtml.length} bytes`);
    assert.ok(renderFitness(s).length > 2_000, `v${s.publicVersion}: the fitness section is ${renderFitness(s).length} bytes`);
    for (const e of s.doc.entries) {
      const ep = standardsPageFor(`/standards/coffee/${s.publicVersion}/${e.id}`, BASE)!;
      assert.ok(ep.bodyHtml.length > 1_500, `v${s.publicVersion}/${e.id}: the entry page is ${ep.bodyHtml.length} bytes`);
    }
  }
  // And the current version must be the LARGEST of the three: it carries everything the
  // others do plus intervals, biases, limits and every individual defect. If a reissue
  // ever shrinks the page, something stopped rendering.
  const sizes = loadPublishedStandards().map((s) => standardsPageFor(`/standards/coffee/${s.publicVersion}`, BASE)!.bodyHtml.length);
  assert.equal(Math.max(...sizes), sizes[sizes.length - 1],
    `the current version renders ${sizes[sizes.length - 1]} bytes against a maximum of ${Math.max(...sizes)} — a section stopped rendering`);
});

test("AN ABSENT PREDICTION IS OMITTED, NEVER RENDERED AS AN EMPTY BAND", () => {
  // ⚠️ THE BAND IS DELETED AT GRAMMAR 1.2 — it held 1 of 10 against this category's own
  // sample and every miss was HIGH. The old renderer printed "Predicted fail rate: not
  // stated (predicted, not yet measured)" whenever the field was missing, which on a
  // version that carries measurements and deliberately carries no prediction is a single
  // line that is false twice over.
  const v12 = findStandard("coffee", "1.2")!;
  for (const e of v12.doc.entries) {
    const pred = predictionOf(e)!;
    assert.ok(pred, `${e.id}: v1.2 should carry a discrimination_prediction`);
    assert.equal(pred.band, undefined, `${e.id}: a numeric band survived into v1.2`);
    assert.equal(pred.direction, "no_prediction",
      `${e.id}: a direction was derived from the refuted band, which inherits its error`);
    assert.ok(pred.reasoning, `${e.id}: the authored reasoning was dropped instead of preserved`);
    const page = standardsPageFor(`/standards/coffee/1.2/${e.id}`, BASE)!;
    assert.doesNotMatch(page.bodyHtml, /Predicted fail rate/, `${e.id}: an empty predicted band was rendered`);
    assert.doesNotMatch(page.bodyHtml, /not yet measured/, `${e.id}: the page claims a measurement state it cannot know`);
    // The reasoning IS still published — that is what makes the calibration checkable.
    assert.ok(page.bodyHtml.includes(esc(pred.reasoning!.slice(0, 60))), `${e.id}: the authored reasoning is not published`);
  }
  // And v1.0/v1.1, which DO carry bands, still publish them.
  for (const v of ["1.0", "1.1"]) {
    const s = findStandard("coffee", v)!;
    const withBand = s.doc.entries.filter((e) => predictionOf(e)?.band);
    assert.ok(withBand.length >= 40, `v${v}: only ${withBand.length} entries carry a band`);
    const page = standardsPageFor(`/standards/coffee/${v}/${withBand[0]!.id}`, BASE)!;
    assert.ok(page.bodyHtml.includes(esc(predictionOf(withBand[0]!)!.band!)), `v${v}: the band is not published`);
  }
});

test("A MEASURED ENTRY PAGE PUBLISHES ITS RATE — the version-scoped defect this file shipped", () => {
  // ⚠️ THE FOURTH LIVE INSTANCE, AND IT WAS IN PRODUCTION. `renderEntry` read
  // `s.fitness.entry_discrimination` directly — v1.0's SIDECAR — so every v1.1 entry page
  // rendered "Predicted fail rate: 30-60% (predicted, not yet measured)" for an entry the
  // same document records as measured at 73.7%. `measuredOf` existed the whole time and
  // was not called there. Nothing threw; the page looked complete.
  for (const s of loadPublishedStandards()) {
    const measured = s.doc.entries.map((e) => ({ e, m: measuredOf(s, e) })).filter((x) => x.m);
    assert.equal(measured.length, 10, `v${s.publicVersion}: expected ten measured entries, got ${measured.length}`);
    for (const { e, m } of measured) {
      const page = standardsPageFor(`/standards/coffee/${s.publicVersion}/${e.id}`, BASE)!;
      assert.match(page.bodyHtml, /Measured fail rate/, `v${s.publicVersion}/${e.id}: the measurement is not on its own page`);
      assert.ok(page.bodyHtml.includes(`${m!.fail_pct.toFixed(1)}%`), `v${s.publicVersion}/${e.id}: the rate is not the artifact's`);
      assert.doesNotMatch(page.bodyHtml, /not yet measured/, `v${s.publicVersion}/${e.id}: a measured entry says it is unmeasured`);
    }
  }
});

test("A DECLARED INSTRUMENT BIAS IS PUBLISHED, INCLUDING THE UNQUANTIFIED ONES", () => {
  // A 95% interval bounds SAMPLING error and nothing else. Two of v1.2's five
  // not-discriminating verdicts were measured with the bounded semantic tier disabled —
  // a bias pointing at the very band edge their intervals cleared, and unquantifiable,
  // because the audit read PASS rows only and no artifact bounds the false-NEGATIVE rate.
  // Both paths of that tier are declared SEPARATELY rather than netted: neither is
  // measured, so a single signed number would be a guess wearing a direction.
  const s = findStandard("coffee", "1.2")!;
  const withBias = s.doc.entries.map((e) => ({ e, m: measuredOf(s, e) }))
    .filter((x) => (x.m?.instrument_bias ?? []).length > 0);
  assert.ok(withBias.length >= 2, "no entry declares an instrument bias — the retirement gate could not fire");
  let unquantified = 0;
  for (const { e, m } of withBias) {
    const page = standardsPageFor(`/standards/coffee/1.2/${e.id}`, BASE)!;
    assert.match(page.bodyHtml, /Declared bias in the instrument/, `${e.id}: the declared bias is not published`);
    for (const b of m!.instrument_bias!) {
      assert.ok(page.bodyHtml.includes(esc(b.source!.slice(0, 60))), `${e.id}: a declared bias source is not published`);
      if (b.magnitude_pp === undefined) {
        unquantified++;
        assert.ok(page.bodyHtml.includes("UNQUANTIFIED"), `${e.id}: an unquantified bias is not labelled as one`);
      }
    }
  }
  assert.ok(unquantified >= 2, "no unquantified bias is published — an undeclared bias is not an absent one");
  // Directions pointing opposite ways must both appear; netting them would be a guess.
  const dirs = new Set(withBias.flatMap((x) => x.m!.instrument_bias!.map((b) => b.direction)));
  assert.ok(dirs.has("inflates_fail_rate") && dirs.has("deflates_fail_rate"),
    "the two paths of the disabled tier were netted into one direction");
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

test("`fitnessOf` ABSORBS ALL THREE SHAPES — sidecar, measured_fitness, category_fitness", () => {
  // ⚠️ THE FOURTH INSTANCE THIS FILE EXISTS TO PREVENT. Three grammars keep the same
  // measurement in three different places under three different shapes:
  //   v1.0 a sidecar fitness.json · v1.1 `measured_fitness` · v1.2 `category_fitness`,
  // and 1.2's bounds are NESTED under `bounds` rather than flat. A renderer reading the
  // wrong name produces NOTHING, and nothing looks exactly like a section with nothing to
  // show — which is how `grounding.sources` shipped, and how llms.txt once advertised the
  // superseded version as measured and the current one as unmeasured.
  //
  // So: every published version must produce a normalised measurement, and its numbers
  // must be the artifact's own.
  for (const s of loadPublishedStandards()) {
    const f = fitnessOf(s);
    assert.ok(f?.samples?.length, `v${s.publicVersion}: fitnessOf returned nothing — the page would say "not measured"`);
    for (const x of f!.samples) {
      assert.ok(Number.isFinite(x.point_estimate_pct), `v${s.publicVersion}/${x.name}: no point estimate`);
      assert.ok(Number.isFinite(x.bound_95_cluster_icc02_pct), `v${s.publicVersion}/${x.name}: no cluster bound`);
      assert.ok(x.pass_rows_audited > 0 && x.stores > 0, `v${s.publicVersion}/${x.name}: empty sample`);
    }
  }

  // The 1.2 block, against its own artifact — all FIVE bounds, not just the headline one.
  const v12 = findStandard("coffee", "1.2")!;
  const cf = (v12.doc as { category_fitness?: {
    bounds: { point_estimate_pct: number; naive_95_upper_pct: number; cluster_adjusted_95_upper_pct: number; icc: number; per_store_pct: number };
    pass_rows_audited: number; confirmed_false_positives: number; completion_state: string;
    limits?: string[]; defects?: Array<{ entry_id?: string }>; audit?: { borderline_count?: number };
    sample: { stores: number; products?: number };
  } }).category_fitness!;
  assert.ok(cf, "v1.2 carries no category_fitness — the grammar requires it");
  const norm = fitnessOf(v12)!.samples[0]!;
  assert.equal(norm.point_estimate_pct, cf.bounds.point_estimate_pct);
  assert.equal(norm.bound_95_naive_pct, cf.bounds.naive_95_upper_pct);
  assert.equal(norm.bound_95_cluster_icc02_pct, cf.bounds.cluster_adjusted_95_upper_pct);
  assert.equal(norm.icc, cf.bounds.icc);
  // `per_store_pct` was DROPPED by v1.1's in-document block and restored at 1.2. A bound
  // that exists in the artifact and not on the page is a silent omission.
  assert.equal(norm.per_store_pct, cf.bounds.per_store_pct);
  assert.equal(norm.completion_state, cf.completion_state);

  const html = renderFitness(v12);
  assert.ok(html.length > 5000, `the v1.2 fitness section is ${html.length} bytes — it rendered nearly empty`);
  for (const v of [cf.bounds.point_estimate_pct, cf.bounds.cluster_adjusted_95_upper_pct, cf.bounds.per_store_pct]) {
    assert.ok(html.includes(`${v.toFixed(2)}%`), `bound ${v} from category_fitness is not published`);
  }
  // A COMPLETION STATE, NEVER A BARE ZERO. "Didn't run" must not read as clean.
  assert.ok(html.includes(cf.completion_state), "the completion state is not published");
  assert.notEqual(cf.completion_state, "VERIFIED_CLEAN", "10 confirmed defects cannot be VERIFIED_CLEAN");
  // The limits are the artifact's own statement of what the number does NOT cover.
  assert.ok((cf.limits ?? []).length >= 4, "category_fitness carries too few limits to be honest about itself");
  for (const lim of cf.limits!) assert.ok(html.includes(esc(lim)), `limit not published verbatim: ${lim.slice(0, 60)}…`);
  // Every defect, individually, with the counts DERIVED from the list rather than beside it.
  assert.equal((cf.defects ?? []).length, cf.confirmed_false_positives,
    "the enumerated defects do not reconcile with the confirmed count");
  const byEntry = new Map<string, number>();
  for (const d of cf.defects!) byEntry.set(d.entry_id ?? "", (byEntry.get(d.entry_id ?? "") ?? 0) + 1);
  for (const [id, n] of byEntry) {
    assert.ok(html.includes(`${id.replace(/^ALS-COFFEE-[0-9.]+-/, "")} ${n}`), `per-entry defect count for ${id} is not derived`);
  }
  assert.ok(html.includes(`Every one of the ${cf.defects!.length} wrong passes`), "the defects are not enumerated");
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

// ===========================================================================
// THE SITE'S OWN LINKS POINT AT WHAT IT PUBLISHES TODAY.
//
// `viewer/src/copy.ts` cannot import `PUBLISHED` — the viewer bundle imports nothing
// from `src/`, which is the separation that keeps server-only secrets out of the
// client — so `COFFEE_STANDARD_URL` is a hand-written literal. It pointed at
// `/standards/coffee/1.1` on the day v1.2 was published, and NOTHING WAS FALSE: v1.1
// still serves its own bytes and renders a supersession notice, and the link text
// matched the URL it pointed at. That is precisely why no lint and no banned-word
// sweep could see it — the failure is a link that is merely STALE, and staleness has
// no vocabulary to grep for.
//
// This is the presence check that replaces the absence sweep: assert the literal
// against the registry, so the next reissue fails the build instead of quietly costing
// every reader a hop through a superseded page.
// ===========================================================================
test("the landing page's standard link points at the CURRENT version, not a superseded one", async () => {
  const copy = await import("../viewer/src/copy.js");
  const current = currentOf("coffee");
  assert.ok(current, "no current coffee standard — currentOf() returned nothing, which is not the same as the link being right");
  assert.equal(
    copy.COFFEE_STANDARD_URL, `/standards/coffee/${current.publicVersion}`,
    `viewer/src/copy.ts#COFFEE_STANDARD_URL is ${copy.COFFEE_STANDARD_URL} but the current published version is ` +
    `${current.publicVersion}. A superseded page still renders, so this rots silently — update the literal.`,
  );
  // And the link must actually resolve, not merely be well-formed.
  assert.ok(standardsPageFor(copy.COFFEE_STANDARD_URL, BASE), `${copy.COFFEE_STANDARD_URL} does not resolve to a page`);
});
