import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { publicSsrFor } from "../src/server/publicSsr.js";
import { heroArtifact, heroArtifactScript, __resetHeroArtifact } from "../src/server/heroArtifact.js";
import { peerSentence } from "../viewer/src/peerSentence.js";
import * as copy from "../viewer/src/copy.js";

// ===========================================================================
// THE v4.3 LANDING PAGE — EVERY FIGURE COMES FROM AN ARTIFACT.
//
// The page names a real store and publishes real verdicts about it. Three failure
// modes have to be closed, and each one has shipped in this repo before in a
// different costume:
//
//   1. A HAND-TYPED FIGURE. Two paragraphs were live until v4.1 reading "162
//      requirements … ten of those passes were wrong" against an artifact reading
//      160 and 7, and "507 rows … found eighteen" against 483 and 11. The viewer
//      bundle cannot reach the artifact, so anything typed there goes false the
//      next time the audit improves and nothing notices.
//
//   2. A JOIN THAT FINDS NOTHING. v4.1's peer benchmark rendered on 0 of 10 rows
//      for a full release because the two sides joined on a display label. Nothing
//      threw and no test failed, because a join that finds nothing looks exactly
//      like a standard that has published no measurement.
//
//   3. A PLACEHOLDER STANDING IN FOR A MISSING ARTIFACT. A hero that invents a
//      plausible result when the real one failed to load looks completely normal,
//      which is precisely why it must not exist.
//
// The assertions below are written against the RENDERED OUTPUT, not against the
// data structure, because a presence-only assertion cannot see an empty section —
// the `grounding.sources` defect rendered 42 entry pages blank with eleven tests
// green, all of them asserting the presence of other things.
// ===========================================================================

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("[v4.3] the landing snapshot renders the artifact's OWN values, not a fixture", async () => {
  __resetHeroArtifact();
  const a = await heroArtifact();
  const html = publicSsrFor("/", a);
  assert.ok(html, "the landing route produced no snapshot at all");

  // The store, the product and the provenance.
  assert.ok(html!.includes(a.host), "the snapshot does not name the store it reports on");
  assert.ok(html!.includes(a.productUrl), "the snapshot does not link the product page it tested");
  assert.ok(html!.includes(a.standard.hash), "the snapshot does not publish the content hash the result ran under");
  assert.ok(html!.includes(a.standard.title), "the snapshot does not name the standard");

  // The counts, as numbers the artifact produced.
  assert.ok(
    html!.includes(`${a.counts.pass} proven`),
    `the snapshot does not state the artifact's own pass count (${a.counts.pass})`,
  );
  assert.ok(
    html!.includes(`${a.counts.notProven} not proven`),
    `the snapshot does not state the artifact's own not-proven count (${a.counts.notProven})`,
  );

  // EVERY row, with its entry id. A page that renders four of ten rows and stops is
  // selecting for effect, which is the one thing "nothing selected for effect" forbids.
  for (const r of a.rows) {
    assert.ok(r.entryId, "a row reached the page with no entry id — every row must be citable");
    assert.ok(html!.includes(r.entryId!), `the snapshot omits row ${r.entryId}`);
    assert.ok(html!.includes(r.question), `the snapshot omits the buyer question for ${r.entryId}`);
  }
});

test("[v4.3] the peer line reaches EVERY row, and never says 'of 100' unless it was 100", async () => {
  // ⚠️ THE JOIN. v4.1 shipped this feature joining on a display label; it matched 0 of 10
  // rows and rendered nowhere for a release. So the count is asserted exactly, and the
  // pre-fix number (0) is named so a regression cannot read as "no measurement published".
  __resetHeroArtifact();
  const a = await heroArtifact();
  const withPeer = a.rows.filter((r) => r.peer);
  assert.equal(
    withPeer.length, a.rows.length,
    `${withPeer.length} of ${a.rows.length} rows carry a peer rate. v4.1 shipped 0 of 10 — a join ` +
      "that finds nothing looks exactly like a standard that has published no measurement.",
  );

  const html = publicSsrFor("/", a)!;
  for (const r of a.rows) {
    const passed = r.state === "proven" || r.state === "neutral";
    const sentence = peerSentence(r.peer!, passed);
    // The escaped form is what reaches the document (the apostrophe in "don't").
    const escaped = sentence.replace(/'/g, "&#39;");
    assert.ok(
      html.includes(sentence) || html.includes(escaped),
      `the peer sentence for ${r.entryId} is not rendered:\n  ${sentence}`,
    );
  }

  // ⚠️ THE OF-100 TRAP. Five of the ten measured coffee entries were asked of fewer than
  // 100 products, and DELIV-001 could only be DECIDED on 74 of the 100 it was asked.
  // A page that says "of 100 coffee stores" is false for half of them.
  const denominators = new Set(a.rows.map((r) => r.peer!.adjudicated));
  assert.ok(
    denominators.size > 1,
    `every row reports the same denominator (${[...denominators]}) — either the sample changed or ` +
      "the peer records have collapsed onto one value, which is how the of-100 trap looks from here",
  );

  // ⚠️ CHECKED BY EXTRACTING WHAT THE PAGE ACTUALLY RENDERS, NOT BY SEARCHING FOR A
  // SENTENCE BUILT FROM ONE ROW'S NUMBERS. The first version of this assertion built
  // "`${p.failed} of 100 …`" per row and searched for it, and it FAILED against a
  // correct page: two rows share a `failed` count of 92, one adjudicated on 99 and one
  // on 100, so the string built from the 99-row's numbers was found in the 100-row's
  // sentence. A substring search over a page with repeated numbers cannot attribute
  // what it finds. The pairs the page renders are read out and checked against the
  // pairs the artifact holds — which catches a fabricated denominator in either
  // direction, including one no row has at all.
  const rendered = [...html.matchAll(/(\d+) of (?:the )?(\d+) coffee stores/g)]
    .map((m) => `${m[1]}/${m[2]}`);
  const real = new Set(a.rows.map((r) => `${r.peer!.failed}/${r.peer!.adjudicated}`));
  const fabricated = rendered.filter((p) => !real.has(p));
  assert.deepEqual(
    fabricated, [],
    `the page renders peer pairs no row holds: ${fabricated.join(", ")}.\n` +
      `Real pairs: ${[...real].join(", ")}. Five of the ten measured coffee entries were asked ` +
      "of fewer than 100 products, so a sentence saying \"of 100\" is false for half of them.",
  );
  assert.equal(
    rendered.length, a.rows.length,
    `${rendered.length} peer sentences rendered for ${a.rows.length} rows`,
  );
  // And the undecided case names both numbers rather than silently counting an
  // undecided row as a pass — v1.1 published 45% where the adjudicated reading is 60.8%.
  const undecided = a.rows.find((r) => r.peer!.undecided > 0);
  assert.ok(undecided, "no row has undecided peers — this assertion has stopped covering the case it exists for");
  assert.ok(
    html.includes(`of ${undecided!.peer!.asked} asked`),
    "a row whose peers include undecided stores does not name the asked denominator beside the decided one",
  );
});

test("[v4.3] NO artifact ⇒ NO section. A missing result never becomes a placeholder", () => {
  const html = publicSsrFor("/", null);
  assert.ok(html, "the landing route must still render its authored copy without an artifact");
  // The sections that exist only to show real data must be ABSENT, not empty-with-a-heading.
  assert.ok(
    !html!.includes(copy.REAL_EXAMPLE.heading),
    "the real-example heading rendered with no artifact behind it — a heading over nothing " +
      "reads as a section that legitimately has nothing to show",
  );
  assert.ok(
    !html!.includes(copy.BEFORE_AFTER.heading),
    "the before/after heading rendered with no artifact behind it",
  );
  // …while the authored argument survives, so a fixture problem never blanks the page.
  // Compared against the ESCAPED form: the headline contains an apostrophe ("clients'"),
  // which `esc()` writes as `&#39;`, and a raw comparison fails on a page that is correct.
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  assert.ok(html!.includes(esc(copy.DELIVERABLES.heading)), "the authored sections vanished too");
  assert.ok(html!.includes(esc(copy.HERO.headline)), "the headline vanished");
});

test("[v4.3] no [object Object], undefined or NaN reaches the rendered landing page", async () => {
  // Template interpolation converts without throwing. `[object Object]` reached published
  // pages three times in this repo, and `undefined` printed in four table rows — each time
  // looking exactly like a section with nothing to show.
  __resetHeroArtifact();
  const html = publicSsrFor("/", await heroArtifact())!;
  for (const bad of ["[object Object]", "undefined", "NaN"]) {
    assert.ok(!html.includes(bad), `the landing snapshot contains ${bad}`);
  }
  // A byte floor, because an empty <div id="root"> also returns 200. Measured before it
  // was written down: the snapshot is ~19k characters of body text.
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.ok(text.length > 9000, `the snapshot is only ${text.length} characters — sections are missing`);
});

test("[v4.3] the serialised artifact cannot break out of its script element", async () => {
  __resetHeroArtifact();
  const script = heroArtifactScript(await heroArtifact());
  const body = script.slice(script.indexOf(">") + 1, script.lastIndexOf("<"));
  assert.ok(!/[<>]/.test(body), "a raw angle bracket survived into the JSON payload");
  assert.doesNotThrow(() => JSON.parse(body), "the serialised payload does not parse");

  // Two-sided: the escape must actually be doing something, or this test passes on a
  // payload that never contained an angle bracket in the first place.
  const withTag = heroArtifactScript({
    ...(await heroArtifact()),
    storeName: "</script><img src=x>",
  });
  assert.ok(!withTag.includes("</script><img"), "a closing script tag in the data was not escaped");
  assert.equal(
    (withTag.match(/<\/script>/g) ?? []).length, 1,
    "the payload emitted more than one closing script tag — the block can be terminated early",
  );
});

test("[v4.3] NO measured figure is typed anywhere in the landing copy module", () => {
  // ⚠️ WIDENED FROM STANDARD_SECTION TO THE WHOLE MODULE. The earlier version of this rule
  // checked two arrays by name. v4.3 adds eight new copy blocks, and a rule that enumerates
  // its own inputs stops covering anything the moment a section is added — which is the
  // shape that let a stale version label survive in four places until v4.1.
  //
  // Structural counts read off the published standard (42 entries, the tier split) are
  // fine and are asserted elsewhere. RATES, AUDIT COUNTS and SAMPLE SIZES are not: the
  // viewer bundle imports nothing from `src/` and cannot derive them.
  const BANNED: Array<[RegExp, string]> = [
    [/\b\d+(\.\d+)?\s?%/, "a percentage — bounds are category-specific and mean nothing without their method and n"],
    [/\b(162|507|488|483|509|338|172)\b/, "an audit or sample count this module cannot derive"],
    [/\bof (100|99|76|74) (coffee )?stores\b/i, "a peer denominator — these come from the artifact, per row"],
  ];
  const offenders: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      for (const [re, why] of BANNED) {
        const m = re.exec(v);
        if (m) offenders.push(`${path}: "${m[0]}" — ${why}\n     in: ${v.slice(0, 100)}…`);
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`);
    }
  };
  walk(copy, "copy");
  assert.deepEqual(offenders, [], `a measured figure was typed into copy.ts:\n${offenders.join("\n")}`);

  // Anti-vacuity: the walker must be reaching the new blocks, not just the old ones.
  let strings = 0;
  const count = (v: unknown): void => {
    if (typeof v === "string") { strings++; return; }
    if (Array.isArray(v)) { v.forEach(count); return; }
    if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(count);
  };
  count(copy);
  assert.ok(strings > 120, `the walker only saw ${strings} strings — it is not reading the module`);
});

test("[v4.3] the landing page renders NO number the artifact did not produce", async () => {
  // The strongest form of the rule, executed against the rendered page rather than the
  // source: every standalone integer in the snapshot must be traceable to the artifact,
  // to a structural count of the published standard, or to an allowed literal.
  __resetHeroArtifact();
  const a = await heroArtifact();
  const html = publicSsrFor("/", a)!;
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    // ⚠️ THE CAPTURE TIMESTAMP IS STRIPPED, AND IT IS NOT A LOOSENING. It is an ISO
    // instant printed straight from the artifact — 2026-07-27T04:53:11.912Z — and its
    // colon-delimited fields read as free-standing integers to any scan of this kind.
    // The first run of this assertion reported "53" as an unexplained figure, which is
    // an instrument artefact, not a claim. The timestamp itself IS derived, and the
    // assertion above already proves the page carries the artifact's own `capturedAt`.
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, " ");

  const fromArtifact = new Set<string>([
    String(a.counts.pass), String(a.counts.notProven), String(a.counts.requiresAccess), String(a.counts.total),
    ...a.rows.flatMap((r) => r.peer ? [String(r.peer.adjudicated), String(r.peer.failed), String(r.peer.asked)] : []),
  ]);
  // Structural counts of the standard, asserted against the document itself in
  // siteCopy.test.ts; the deliverable/step ordinals the page emits; the copyright year;
  // and the ILLUSTRATIVE buyer task in the FAQ ("250 g of single-origin whole bean under
  // £20"), which is a worked example of what a buying task looks like rather than a
  // measurement of anything — the distinction this whole test exists to police.
  const structural = new Set([
    "42", "32", "16", "11", "10", "5", "1", "2", "3", "4", "6", "0", "2026", "1.3",
    "250", "20",
  ]);

  const numbers = [...text.matchAll(/(?<![\w.\-/])(\d{1,4})(?![\w.\-/])/g)].map((m) => m[1]!);
  const unexplained = [...new Set(numbers)].filter((n) => !fromArtifact.has(n) && !structural.has(n));
  assert.deepEqual(
    unexplained, [],
    "these numbers are rendered on the landing page and trace to neither the artifact nor a " +
      `structural count of the published standard:\n  ${unexplained.join(", ")}\n` +
      "Every figure on this page must be derived. A typed one goes false the next time the " +
      "audit improves, and nothing notices.",
  );
  assert.ok(numbers.length > 20, `only ${numbers.length} numbers found in the rendered page — the scan is not reading it`);
});

test("[v4.3] the React page and the JS-off snapshot render the SAME sections", () => {
  // They render from one copy module so they cannot drift in WORDING. This asserts they
  // do not drift in WHAT IS PRESENT — a section added to one and not the other hands a
  // machine reader a different argument from the one a human gets, and no lint can see it.
  const page = readFileSync(join(ROOT, "viewer/src/pages/LandingPage.tsx"), "utf8");
  const ssr = readFileSync(join(ROOT, "src/server/publicSsr.ts"), "utf8");
  const SECTIONS = [
    "DELIVERABLES", "WORKFLOW", "TEST_EXPLAINED", "REAL_EXAMPLE",
    "BEFORE_AFTER", "CATEGORY_BREAK", "ENGINE_VALIDATION", "STANDARD_SECTION", "PILOT",
    "CREDIBILITY", "FAQ", "HERO_ARTIFACT",
  ];
  const missing = SECTIONS.filter((s) => !(page.includes(s) && ssr.includes(s)));
  assert.deepEqual(
    missing, [],
    `these copy blocks are rendered by one surface and not the other: ${missing.join(", ")}. ` +
      "A reader with JavaScript and a reader without must get the same argument.",
  );
});

test("[v4.3] every href the landing page emits is a route that exists", () => {
  // "Publishes" is checkable, and so is a nav link. A footer or a CTA pointing at a route
  // nobody serves is the one failure this positioning cannot survive.
  const page = readFileSync(join(ROOT, "viewer/src/pages/LandingPage.tsx"), "utf8");
  const app = readFileSync(join(ROOT, "viewer/src/App.tsx"), "utf8");
  const REAL = [
    "/", "/test", "/demo", "/methodology", "/privacy", "/terms", "/support",
    "/standards", "/data-deletion", "/thanks", "/scan", "/index", "/report",
  ];
  const offenders: string[] = [];
  for (const src of [page, app]) {
    for (const m of src.matchAll(/href="(\/[^"{}]*)"/g)) {
      const href = m[1]!;
      if (!REAL.some((r) => href === r || href.startsWith(`${r}/`) || href.startsWith(`${r}#`))) {
        offenders.push(href);
      }
    }
  }
  assert.deepEqual(offenders, [], `these hrefs point at routes this server does not serve: ${offenders.join(", ")}`);

  // And no Blog — there isn't one. Asserted across every public component, because the
  // concepts this page was drawn from both put one in the footer.
  const viewerSrc = join(ROOT, "viewer", "src");
  const blog: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (/href="\/blog|>\s*Blog\s*</.test(readFileSync(full, "utf8"))) blog.push(e.name);
    }
  };
  walk(viewerSrc);
  assert.deepEqual(blog, [], `a Blog link appears in ${blog.join(", ")} — there is no blog`);
});
