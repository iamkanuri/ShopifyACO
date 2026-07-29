import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintStrings, lintText } from "../src/server/claimLinter.js";
import { standardsSitemapPaths, standardsPageFor } from "../src/server/standardsSite.js";
import {
  COFFEE_STANDARD_URL,
  FAQ,
  HERO,
  PUBLIC_MARKETING_STRINGS,
  STANDARD_SECTION,
  STANDARDS_INDEX_URL,
  TAGLINE,
  TAGLINE_SHORT,
} from "../viewer/src/copy.js";
import * as copy from "../viewer/src/copy.js";

// ===========================================================================
// THE PUBLIC SITE PASSES ITS OWN CHECK.
//
// AisleLens refuses to show a merchant a result that fails the claim linter.
// A marketing page that would not survive the same linter is the product
// telling merchants to hold a standard it does not hold itself — so every
// rendered string on the public surfaces goes through the REAL linter
// (src/server/claimLinter.ts, imported, never reimplemented: a second copy of
// the rules is a second engine, and this repo has already paid for that once).
//
// The banned vocabulary is separate from the linter and stricter, because it
// is about POSITIONING rather than about overclaiming. Two lists:
//
//   • banned until true — words we would have to earn
//   • banned permanently — the vocabulary of the category this product is not
//     in. "score", "visibility" and "ranking" are load-bearing on the older
//     report and index routes and are deliberately NOT swept there; the scope
//     of this test is the public marketing surface only.
// ===========================================================================

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const BANNED_UNTIL_TRUE: Array<[RegExp, string]> = [
  [/\bcertif(y|ied|ication|ications)\b/i, "we certify nothing and no one certifies us"],
  [/\bstandards? body\b/i, "we publish a standard; we are not a standards body"],
  [/\baccredited?\b/i, "nobody has accredited anything here"],
  [/\btrusted by\b/i, "there is no roster to point at"],
  [/\bguarantee(s|d|ing)?\b/i, "nothing about an external AI system can be guaranteed"],
  [/\b\d[\d,]*\+?\s+(merchants?|stores?|customers?|users?|brands? trust)\b/i, "no user number until there is one worth stating"],
  [/\$\s?\d/, "no revenue number"],
];

const BANNED_PERMANENTLY: Array<[RegExp, string]> = [
  [/\bscor(e|es|ed|ing)\b/i, "we do not sell a score"],
  [/\brank(ing|ings)\b/i, "we do not sell a ranking"],
  [/\bvisibility\b/i, "visibility is the category this product is not in"],
  [/\bshare of voice\b/i, "same"],
  [/\bGEO\b/, "not our vocabulary"],
  [/\boptimi[sz](e|es|ed|ing|ation)\b/i, "we correct a specific failed assertion; we do not optimise"],
  [/\bboost(s|ed|ing)?\b/i, "we make no claim about lift"],
];

/** Future tense about the standards. The standard exists — Coffee Standard v1.0,
 *  42 entries, 10 executable, fixed at a content hash — so copy that promises it
 *  is copy that is out of date, and it reads as vapour to the exact reader who
 *  would value it most. */
const FUTURE_TENSE_ABOUT_STANDARDS =
  /\b(standards?|coffee standard)\b[^.]{0,80}\b(will|is coming|are coming|coming soon|in development|planned|we are (turning|building|working))\b|\b(will|is coming|are coming|coming soon|in development|planned|we are (turning|building|working))\b[^.]{0,80}\b(standards?)\b/i;

test("every public marketing string passes the REAL claim linter", () => {
  const result = lintStrings([...PUBLIC_MARKETING_STRINGS]);
  const detail = result.violations
    .map((v) => `  [${v.rule}] …${v.excerpt}…`)
    .join("\n");
  assert.ok(
    result.ok,
    "The public site must survive the same linter that gates every merchant-facing " +
      "result. A rule fired here means the marketing page is making a claim the " +
      "product itself would refuse to print.\n" + detail,
  );
});

test("the linter is actually reachable from this test (two-sided liveness)", () => {
  // A lint suite that silently lints nothing reports the same green as a clean
  // one. Prove the import works in BOTH directions before trusting the pass above.
  assert.equal(lintText("Every change is proposed, previewed and reversible.").ok, true);
  const dirty = lintText("This fix will get you recommended and boost your sales by $400 per month.");
  assert.equal(dirty.ok, false);
  assert.ok(dirty.violations.length >= 2, "expected the known-bad control to trip several rules");
  assert.ok(PUBLIC_MARKETING_STRINGS.length > 40, "the marketing string list looks truncated");
});

test("no banned vocabulary on the public marketing surface", () => {
  const offenders: string[] = [];
  for (const s of PUBLIC_MARKETING_STRINGS) {
    for (const [re, why] of [...BANNED_UNTIL_TRUE, ...BANNED_PERMANENTLY]) {
      const m = re.exec(s);
      if (m) offenders.push(`"${m[0]}" — ${why}\n     in: ${s.slice(0, 110)}…`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Banned vocabulary reached a public marketing string.\n  " + offenders.join("\n  "),
  );
});

test("the banned-vocabulary check is live (control strings must trip it)", () => {
  const controls = [
    "AisleLens is a certified standards body trusted by 400 merchants.",
    "Improve your AI visibility score and boost your ranking.",
  ];
  for (const c of controls) {
    const hit = [...BANNED_UNTIL_TRUE, ...BANNED_PERMANENTLY].some(([re]) => re.test(c));
    assert.ok(hit, `the banned-vocabulary list failed to catch its own control: "${c}"`);
  }
});

test("nothing on the public surface speaks about the standards in the future tense", () => {
  const offenders = PUBLIC_MARKETING_STRINGS.filter((s) => FUTURE_TENSE_ABOUT_STANDARDS.test(s));
  assert.deepEqual(
    offenders,
    [],
    "Coffee Standard v1.0 exists at a fixed version and content hash, 42 entries, " +
      "10 of them executable against a public product page, and it has been run " +
      "against real coffee storefronts. Copy that promises it instead of stating " +
      "it is out of date.\n  " + offenders.join("\n  "),
  );
});

test("the standard leads, and the line only this company can write is on the page", () => {
  assert.match(
    HERO.sub,
    /publishes versioned buying standards/,
    "the hero must lead with the standard — it is the thing nobody else has",
  );
  assert.equal(STANDARD_SECTION.pull, "We publish what we cannot test, and why.");
  assert.ok(
    PUBLIC_MARKETING_STRINGS.includes("We publish what we cannot test, and why."),
    "the line has to be in the linted set, not just in the component",
  );
});

test("the counts quoted on the page match the CURRENT standard, not a superseded one", () => {
  // The page states 42 entries and the tier split. Those are read off the document, and a
  // document that moves must move the page with it — a hand-copied number is exactly the
  // class of claim this product refuses to print.
  //
  // ⚠️ THIS TEST USED TO PIN v1.0 BY PATH, AND THAT IS WHY IT DID NOT CATCH THE DRIFT IT
  // EXISTS FOR. The four tier COUNTS are identical at v1.0 and v1.3, so pinning the old
  // document kept it green while the copy said "Coffee Standard v1.0" beside a link that
  // resolved to v1.3 — and, worse, while the copy described the fourth tier as "5 the
  // engine could run and deliberately does not", which is `not_discriminating`'s meaning
  // at v1.0 and the OPPOSITE of `unbound`'s at v1.3. A version-pinned fixture cannot see a
  // version-drift defect. The path is now derived from the same constant the page links to.
  const version = COFFEE_STANDARD_URL.split("/").pop()!;
  const doc = JSON.parse(read(`standards/coffee/v${version}/standard.json`)) as {
    entries: Array<{ tier: string }>;
  };
  const tiers: Record<string, number> = {};
  for (const e of doc.entries) tiers[e.tier] = (tiers[e.tier] ?? 0) + 1;

  const prose = [...STANDARD_SECTION.body, ...STANDARD_SECTION.after].join(" ");
  assert.equal(doc.entries.length, 42, "entry count moved");
  assert.equal(tiers.executable, 10, "executable count moved");
  assert.equal(tiers.blocked, 16, "blocked count moved");
  assert.equal(tiers.advisory, 11, "advisory count moved");
  // The fourth tier is `unbound` at grammar 1.2 and was `not_discriminating` at 1.0. Assert
  // whichever this document actually carries, and that the page describes the right one.
  const fourth = tiers.unbound !== undefined ? "unbound" : "not_discriminating";
  assert.equal(tiers[fourth], 5, `${fourth} count moved`);
  for (const n of ["42", "en of the 42", "16 should be executable", "11 are real buyer questions"]) {
    assert.ok(prose.includes(n), `the standard section no longer states "${n}"`);
  }
  if (fourth === "unbound") {
    assert.match(prose, /unbound/i, "the page does not describe the fourth tier as unbound, which is what this document carries");
    assert.doesNotMatch(prose, /deliberately does not/,
      "the page still uses `not_discriminating`'s wording for a tier this document calls `unbound` — the two mean opposite things");
  }
});

test("the coffee bound is published on the STANDARD page, and no percentage reaches the marketing copy", () => {
  // ⚠️ THIS TEST WAS INVERTED, AND THAT IS THE POINT OF IT. It previously asserted
  // that NO coffee sample existed and that the copy said so. The v3.2 audit measured
  // one, the test failed exactly as designed, and the copy was updated rather than
  // the assertion deleted. What it enforces now is the invariant that outlives the
  // pending state: the category number lives on the standard's own page next to its
  // method and its n, and the marketing surface never carries a bare percentage.
  const fitness = JSON.parse(read("standards/coffee/v1.0/fitness.json")) as {
    samples: Array<{ name: string; bound_95_cluster_icc02_pct: number; pass_rows_audited: number; method: string }>;
  };
  const coffee = fitness.samples.find((s) => s.name === "coffee");
  assert.ok(coffee, "the coffee fitness sample has disappeared — the copy claims it exists");
  assert.ok(coffee!.method.length > 80, "a published bound must carry its method");

  // The standard page publishes the sample's OWN cluster-adjusted bound, from the file.
  const page = standardsPageFor("/standards/coffee/1.0", "https://lens.example")!;
  assert.ok(page.bodyHtml.includes(`${coffee!.bound_95_cluster_icc02_pct.toFixed(2)}%`),
    "the standard page does not publish the coffee sample's own cluster-adjusted bound");
  assert.ok(page.bodyHtml.includes(String(coffee!.pass_rows_audited)),
    "the standard page does not publish the n behind the bound");

  // ⚠️ AND THE MARKETING COPY STILL CARRIES NO BARE PERCENTAGE. A number without its
  // method and its n is the thing this whole project exists not to publish, and a
  // landing page is the worst possible place for one.
  const offenders = PUBLIC_MARKETING_STRINGS.filter((s) => /\d+(\.\d+)?\s?%/.test(s));
  assert.deepEqual(offenders, [],
    "A percentage reached the public copy. Bounds are category-specific and only mean " +
    "anything beside their method and n — link to the standard page instead.");
});
test("the tagline constants are byte-identical across server, client fallback and copy.ts", () => {
  const server = read("src/server/index.ts");
  const config = read("viewer/src/config.tsx");
  assert.ok(
    server.includes(JSON.stringify(TAGLINE).slice(1, -1)) || server.includes(TAGLINE),
    "src/server/index.ts TAGLINE has drifted from viewer/src/copy.ts TAGLINE. The " +
      "server one becomes the meta description and the default share card; a drift " +
      "means the page and the link preview say different things.",
  );
  assert.ok(
    config.includes(TAGLINE_SHORT),
    "viewer/src/config.tsx tagline fallback has drifted from TAGLINE_SHORT",
  );
});

test("the FAQ answers the standard question first", () => {
  assert.match(FAQ[0][0], /buying standard/i, "the first FAQ entry defines the standard");
});

test('"publishes" is checkable — the URLs the copy points at are really served', () => {
  // The claim that leads the page is that the standard is public. A reader who
  // clicks and gets a 404 has been told something untrue, so the link targets
  // are asserted against the routes the server actually renders rather than
  // against a hand-typed path.
  const paths = new Set(standardsSitemapPaths());
  for (const url of [STANDARDS_INDEX_URL, COFFEE_STANDARD_URL]) {
    assert.ok(
      paths.has(url),
      `The public copy links to ${url}, which src/server/standardsSite.ts does not serve. ` +
        "Leading with \"we publish\" and shipping a dead link is the one failure mode " +
        "this positioning cannot survive.",
    );
  }
});

// ---- v3.2 CP6: the three titles must tell ONE story -------------------------
test("<title>, og:title and twitter:title are byte-identical", () => {
  // ⚠️ THEY USED TO TELL THREE DIFFERENT STORIES: <title> and twitter:title said
  // "AI Commerce QA for Shopify" while og:title carried "AI buyers treat your store
  // like an API." A search result and a shared link then described different
  // products, and nothing in the build could notice.
  const html = readFileSync(join(process.cwd(), "viewer/index.html"), "utf8");
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const og = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const tw = /<meta name="twitter:title" content="([^"]*)"/.exec(html)?.[1];
  assert.ok(title && og && tw, "one of the three title tags is missing from viewer/index.html");
  assert.equal(og, title, `og:title differs from <title>:\n  title: ${title}\n  og   : ${og}`);
  assert.equal(tw, title, `twitter:title differs from <title>:\n  title: ${title}\n  tw   : ${tw}`);
});

// ===========================================================================
// THE TWO SITES DESCRIBE THE SAME PRODUCT (v3.3 CP-D).
//
// thirdocular.com carries a product block describing AisleLens, from a different
// repository, on a different host, on a different deploy. It has already drifted once:
// the parent site went on selling "Who AI recommends instead of you, and how to fix it"
// for weeks after this site stopped being that product.
//
// ⚠️ v3.2 AUDITED BOTH SITES AND PASSED THEM. Every check it ran was an ABSENCE sweep —
// zero banned vocabulary, zero retired palette, zero crimson — and an absence check
// cannot see a paragraph that sells the wrong product. It can only see words that are
// gone. The replacement is a PRESENCE check over shared content, in both directions:
//
//   • this half asserts the payload `GET /api/brand.json` serves IS the constants;
//   • the other half lives in ThirdOcular/scripts/check-copy.mjs, which fetches that
//     endpoint at build time and refuses to deploy on a mismatch — including a mismatch
//     it cannot verify, because a gate that cannot check must not pass.
//
// When the drift was measured on 2026-07-27 the two sites differed by THREE CHARACTERS
// across two spans: `pass` where this site says `proven`, and two curly apostrophes
// where the constant has ASCII. "One word" is what a reader notices; three characters is
// what a byte comparison finds, and that gap is the whole argument for the gate.
// ===========================================================================

test("the shared product description is served EXACTLY as the constant defines it", async () => {
  const { PRODUCT_DESCRIPTION, PRODUCT_CAPABILITIES, PRODUCT_KIND } = await import("../viewer/src/copy.js");
  // Read from the route's own source rather than duplicating the payload shape here: a
  // test that rebuilds the object it is checking asserts nothing about the server.
  const index = readFileSync(join(process.cwd(), "src/server/index.ts"), "utf8");
  assert.match(index, /app\.get\("\/api\/brand\.json"/, "the shared-copy endpoint is not registered");
  for (const [field, value] of [
    ["description", PRODUCT_DESCRIPTION],
    ["capabilities", PRODUCT_CAPABILITIES],
    ["kind", PRODUCT_KIND],
  ] as const) {
    // ⚠️ NOT a template literal with an escape in it. This line was first written
    // through a shell heredoc, which ate one backslash: `\\s` reached the file as `\s`,
    // and inside a template literal JavaScript resolved that to a plain `s`. The pattern
    // silently became `description:s*PRODUCT_…` and the test failed against a file that
    // plainly contained the text. Same class as the `\b` that landed in this repo as a
    // literal 0x08. A plain string concat has no escape to eat.
    assert.match(index, new RegExp(`${field}:` + String.raw`\s*PRODUCT_[A-Z]+`),
      `/api/brand.json builds \`${field}\` from something other than the constant — a hand-written server copy is the drift this endpoint exists to prevent`);
    assert.ok(value.length > 20, `${field} is too short to be the product description`);
  }
  // The constants are ASCII-apostrophe and single-em-dash, which is what the other repo
  // must reproduce byte-for-byte. A curly apostrophe here would make the gate unsatisfiable
  // by an editor that autocorrects, and the drift would look like a mystery.
  assert.doesNotMatch(PRODUCT_DESCRIPTION, /[\u2018\u2019]/,
    "the canonical description uses a curly apostrophe — the other site cannot match it reliably");
  assert.doesNotMatch(PRODUCT_CAPABILITIES, /[\u2018\u2019]/);
  // And it says `proven`, which is this product's own vocabulary — the exact word the
  // two sites disagreed on.
  assert.match(PRODUCT_DESCRIPTION, /proven, not proven, or requires store access/,
    "the shared description does not use this product's own result vocabulary");
});

// ===========================================================================
// v4.1 — NO UN-INTERPOLATED TEMPLATE EXPRESSION MAY REACH A PUBLIC STRING.
//
// Caught in the act: replacing a hand-typed "v1.0" with `${COFFEE_STANDARD_VERSION}`
// inside a DOUBLE-QUOTED string produced a landing-page paragraph that would have rendered
// the literal characters `${COFFEE_STANDARD_VERSION}` to every visitor. TypeScript is
// silent — it is a valid string — and the type is still `string`, so nothing downstream
// notices. The only reason it did not ship is that the value was read back before commit.
//
// This is the same family as the `[object Object]` defect the standards site shipped three
// times: a template failure that produces plausible-looking output instead of throwing.
// ===========================================================================
test("[copy] no public string contains an un-interpolated ${…} expression", () => {
  const offenders: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string") {
      if (/\$\{[A-Za-z_]/.test(v)) offenders.push(`${path}: ${v.slice(0, 120)}`);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`);
    }
  };
  walk(copy, "copy");
  assert.deepEqual(offenders, [], `a template expression was written inside a quoted string:\n${offenders.join("\n")}`);
});

test("[copy] the standard's version label is DERIVED and agrees with its own href", () => {
  // A stale version label carries no banned word and no false token — it is a true
  // sentence about an older document beside a link to a newer one, which is exactly why
  // four of them survived every lint in this repo until v4.1.
  const fromUrl = `v${copy.COFFEE_STANDARD_URL.split("/").pop()}`;
  assert.equal(copy.COFFEE_STANDARD_VERSION, fromUrl);
  const stringsWithAVersion = [
    copy.HERO.readStandard, copy.HERO_TEST.head, copy.HERO_TEST.ariaLabel,
    ...copy.STANDARD_SECTION.body,
  ].filter((s) => /Coffee Standard v\d/.test(s));
  assert.ok(stringsWithAVersion.length >= 3, "no versioned strings found — this assertion has stopped covering anything");
  for (const s of stringsWithAVersion) {
    const m = /Coffee Standard (v[\d.]+)/.exec(s)!;
    assert.equal(m[1], copy.COFFEE_STANDARD_VERSION, `a hand-typed version label survived: ${s.slice(0, 90)}`);
  }
});

test("[copy] the landing page states NO measured figure", () => {
  // The viewer bundle imports nothing from `src/` and cannot reach the fitness sidecar, so
  // any measurement typed here is a literal that goes false the next time the audit
  // improves. Two such paragraphs were LIVE until v4.1 — "162 requirements … Ten of those
  // passes were wrong" against an artifact reading 160 and 7, and "507 rows … found
  // eighteen" against 483 and 11. Structural counts (42 entries, the tier split) are read
  // off the published standard and are fine; RATES and AUDIT COUNTS are not.
  const banned = [/\b\d+(\.\d+)?%/, /\b(162|507|488|483)\b/];
  const prose = [...copy.STANDARD_SECTION.body, ...copy.STANDARD_SECTION.after];
  for (const s of prose) {
    for (const re of banned) {
      assert.ok(!re.test(s), `a measured figure reached landing copy that cannot derive it: ${s.slice(0, 120)}`);
    }
  }
});
