import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintStrings, lintText } from "../src/server/claimLinter.js";
import { standardsSitemapPaths } from "../src/server/standardsSite.js";
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

test("the counts quoted on the page match standards/coffee/v1.0/standard.json", () => {
  // The page states 42 entries, 10 executable, 16 blocked, 11 advisory and 5
  // non-discriminating. Those are read off the document, and a document that
  // moves must move the page with it — a hand-copied number is exactly the
  // class of claim this product refuses to print.
  const doc = JSON.parse(read("standards/coffee/v1.0/standard.json")) as {
    entries: Array<{ tier: string }>;
  };
  const tiers: Record<string, number> = {};
  for (const e of doc.entries) tiers[e.tier] = (tiers[e.tier] ?? 0) + 1;

  const prose = [...STANDARD_SECTION.body, ...STANDARD_SECTION.after].join(" ");
  assert.equal(doc.entries.length, 42, "entry count moved");
  assert.equal(tiers.executable, 10, "executable count moved");
  assert.equal(tiers.blocked, 16, "blocked count moved");
  assert.equal(tiers.advisory, 11, "advisory count moved");
  assert.equal(tiers.not_discriminating, 5, "not_discriminating count moved");
  for (const n of ["42", "en of the 42", "16 should be executable", "11 are real buyer questions", "5 the engine could run"]) {
    assert.ok(prose.includes(n), `the standard section no longer states "${n}"`);
  }
});

test("no fitness number is quoted on the page while the coffee sample is pending", () => {
  // standards/coffee/v1.0/fitness.json is explicit: if a sample is absent the
  // site says so rather than inventing one, and the general-sample bound is NOT
  // an estimate of what a coffee roaster experiences. So the marketing surface
  // carries no percentage at all.
  const fitness = JSON.parse(read("standards/coffee/v1.0/fitness.json")) as {
    samples: Array<{ name: string }>;
    pending?: Record<string, string>;
  };
  const hasCoffeeSample = fitness.samples.some((s) => s.name === "coffee");
  assert.equal(
    hasCoffeeSample,
    false,
    "A coffee fitness sample now exists. The landing copy currently says the " +
      "category measurement has not landed — update it, and quote the sample's " +
      "own cluster-adjusted bound rather than the general one.",
  );
  const offenders = PUBLIC_MARKETING_STRINGS.filter((s) => /\d+(\.\d+)?\s?%/.test(s));
  assert.deepEqual(
    offenders,
    [],
    "A percentage reached the public copy. The only percentages this product has " +
      "are fitness bounds, they are category-specific, and the coffee one has not " +
      "landed — a general-sample bound printed here would be the wrong instrument.\n  " +
      offenders.join("\n  "),
  );
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
