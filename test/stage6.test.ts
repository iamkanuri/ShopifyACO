import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import type { AddressInfo } from "node:net";

// ===========================================================================
// STAGE 6.3 tests — hosted-case bundle + route. Pure helpers plus one real HTTP
// round-trip against the gated route. No network beyond localhost.
// ===========================================================================

import {
  newCaseToken, TOKEN_RE, loadTokenMap, tokenForSlug, installCtaHtml, installCtaText,
  appendCtaToHtml, linkMessage, linkMessageBody, bodyWordCount, writeHostedBundle, type LinkMessageInput,
} from "../src/agentic-test/hosted-case.js";

const MSG: LinkMessageInput = {
  storeName: "Example Store", competitorName: "Rival Brand", storeAppearances: "4", competitorMentions: "43",
  batteryTotal: "90", categoryLabel: "natural deodorant",
  oneLineFinding: "nothing on your product pages states it's a one-time purchase in a form AI assistants can verify, and shoppers ask for exactly that.",
  caseUrl: "https://lens.thirdocular.com/c/ab2c3d4e5f6g",
};

test("54. hosted-case tokens are unguessable 12-char base32 and stable per slug", () => {
  for (let i = 0; i < 50; i++) assert.ok(TOKEN_RE.test(newCaseToken()), "token matches [a-z2-7]{12}");
  // Uniqueness across a batch (60 bits entropy → no collisions expected).
  const seen = new Set(Array.from({ length: 200 }, () => newCaseToken()));
  assert.equal(seen.size, 200, "no token collisions in a batch of 200");
  // Stable per slug: same slug → same token across calls.
  const map = loadTokenMap(join(mkdtempSync(join(tmpdir(), "tok-")), "tokens.json"));
  const t1 = tokenForSlug(map, "store-alpha-com");
  const t2 = tokenForSlug(map, "store-alpha-com");
  const t3 = tokenForSlug(map, "store-beta-com");
  assert.equal(t1, t2, "same slug → same token");
  assert.notEqual(t1, t3, "different slug → different token");
});

test("55. link message is ≤120 words, personalized, and invites correction", () => {
  const body = linkMessageBody(MSG);
  assert.ok(bodyWordCount(MSG) <= 120, `body word count ${bodyWordCount(MSG)} ≤ 120`);
  const full = linkMessage(MSG);
  assert.ok(full.includes("Example Store") && full.includes("Rival Brand"), "names present");
  assert.ok(full.includes("4") && full.includes("43") && full.includes("90"), "real numbers present");
  assert.ok(full.includes(MSG.caseUrl), "case link present");
  assert.ok(/got something wrong/i.test(body), "correction invitation present");
  // No overselling: no ranking/revenue/guarantee promises.
  assert.ok(!/(rank|guarantee|revenue|\$\d)/i.test(body), "no ranking/revenue/guarantee claim");
});

test("56. install CTA is claim-linter clean (no product-truth / predictive / numbers)", async () => {
  const { lintCaseText } = await import("../src/agentic-test/stage5-case.js");
  const ctaText = installCtaHtml("https://lens.thirdocular.com").replace(/<[^>]+>/g, " ");
  const lint = lintCaseText(ctaText, {});
  assert.equal(lint.ok, true, "CTA passes the linter: " + lint.violations.map((v) => v.pattern).join(", "));
  assert.ok(installCtaText("https://x").includes("https://x"), "text CTA carries the url");
});

test("57. hosted bundle writes token dirs + noindex + robots, skips bad tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "hosted-"));
  const caseFile = join(dir, "case.html");
  writeFileSync(caseFile, "<!doctype html><html><body><div class='case'>hi</div></body></html>", "utf8");
  const good = newCaseToken();
  const res = writeHostedBundle(
    [{ token: good, caseHtmlPath: caseFile }, { token: "BAD", caseHtmlPath: caseFile }, { token: newCaseToken(), caseHtmlPath: join(dir, "missing.html") }],
    dir,
    { installUrl: "https://lens.thirdocular.com", hostedBaseUrl: "https://lens.thirdocular.com" },
  );
  assert.equal(res.written, 1, "only the one valid+existing entry is written");
  const page = readFileSync(join(dir, "c", good, "index.html"), "utf8");
  assert.ok(page.includes("install AisleLens"), "CTA appended");
  assert.ok(!existsSync(join(dir, "c", "BAD")), "invalid token skipped");
  assert.ok(readFileSync(join(dir, "robots.txt"), "utf8").includes("Disallow: /"), "robots disallows all");
  assert.ok(readFileSync(join(dir, "_headers"), "utf8").includes("noindex"), "_headers noindex");
  assert.ok(existsSync(join(dir, "README.md")), "deploy README written");
});

test("60. brand→domain resolver requires prefix/suffix alignment, not loose substring", async () => {
  const { resolveBrandDomain } = await import("../src/agentic-test/prospect-finder.js");
  const rec = (responseText: string, citations: string[]) => ({
    batchTag: "stage5" as const, channel: "openai", model: "m", promptId: "p", category: "c", repeat: 1,
    promptText: "", responseText, citations, groundingMode: "web_grounded", usage: {}, costUsd: 0, timestamp: "t",
  });

  // Coincidental substring must NOT resolve — the bug that named the wrong store.
  // "One" sits INSIDE these hosts (z·one·s, h·one·y) but at neither end. (Fake
  // domains: the real ones stay in the gitignored output.)
  assert.equal(resolveBrandDomain("One", [rec("Try One for great gear.", ["https://azoneshop.example/x"])]).domain, null, "'One' must not match a host that merely contains it");
  assert.equal(resolveBrandDomain("One", [rec("One is nice.", ["https://sweethoney.example/x"])]).domain, null, "'One' must not match 'h-one-y'");
  assert.equal(resolveBrandDomain("Cat", [rec("Cat toys here.", ["https://scattergoods.example/x"])]).domain, null, "'Cat' must not match 's-cat-ter'");

  // Real matches survive: prefix (brand starts the host) and suffix (host ends with brand).
  assert.equal(resolveBrandDomain("Brightleaf", [rec("Brightleaf is great.", ["https://brightleafgoods.example/p"])]).domain, "brightleafgoods.example", "prefix match kept");
  assert.equal(resolveBrandDomain("Wild", [rec("Wild deodorant.", ["https://wearewild.example/p"])]).domain, "wearewild.example", "suffix match kept");
  assert.equal(resolveBrandDomain("Freedom", [rec("Freedom deodorant.", ["https://freedomco.example/p"])]).domain, "freedomco.example", "prefix match kept");
});

test("59. one-line finding: evidence-availability, gap-capped, keeps message ≤120 words", async () => {
  const { oneLineFinding, lintProse } = await import("../src/agentic-test/stage5-case.js");

  // Single gap (deodorant).
  const single = oneLineFinding(["subscription_required"]);
  assert.match(single, /one-time purchase/);
  assert.equal(lintProse(single).ok, true, "single-gap finding is prose-clean");

  // Multi-gap (coffee) capped to 2 keeps the sentence tight; uncapped names all.
  const allGaps = ["single_origin", "subscription_required", "roast_date_disclosed"];
  const capped = oneLineFinding(allGaps, 2);
  assert.ok(capped.includes("single-origin") && capped.includes("one-time purchase"), "capped names the first two");
  assert.ok(!capped.includes("roast date"), "capped omits the third");
  assert.equal(lintProse(capped).ok, true, "multi-gap finding is prose-clean");

  // A capped multi-gap message body stays within the ≤120-word budget.
  const msg = {
    storeName: "Bean Box", competitorName: "Blue Bottle", storeAppearances: "3", competitorMentions: "37",
    batteryTotal: "90", categoryLabel: "coffee", oneLineFinding: capped,
    caseUrl: "https://lens.thirdocular.com/c/ab2c3d4e5f6g",
  };
  assert.ok(bodyWordCount(msg) <= 120, `capped coffee message body ${bodyWordCount(msg)} ≤ 120`);
  assert.equal(lintProse(linkMessageBody(msg)).ok, true, "coffee message body is prose-clean");
});

test("58. gated /c/:token route: 404 without flag, serves with noindex header when configured", async () => {
  const { registerHostedCaseRoutes } = await import("../src/agentic-test/hosted-case-route.js");
  const dir = mkdtempSync(join(tmpdir(), "hostedroute-"));
  const token = newCaseToken();
  mkdirSync(join(dir, "c", token), { recursive: true });
  writeFileSync(join(dir, "c", token, "index.html"), "<html><body>CASE</body></html>", "utf8");

  const app = express();
  registerHostedCaseRoutes(app);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const prevFlag = process.env.AGENTIC_INSTRUMENT_TEST_ENABLED;
  const prevDir = process.env.HOSTED_CASES_DIR;
  try {
    // Flag OFF → 404 even for a valid token.
    delete process.env.AGENTIC_INSTRUMENT_TEST_ENABLED;
    process.env.HOSTED_CASES_DIR = dir;
    assert.equal((await fetch(`${base}/c/${token}`)).status, 404, "flag off → 404");

    // Flag ON → serves the case with a noindex header.
    process.env.AGENTIC_INSTRUMENT_TEST_ENABLED = "true";
    const ok = await fetch(`${base}/c/${token}`);
    assert.equal(ok.status, 200, "flag on + known token → 200");
    assert.match(ok.headers.get("x-robots-tag") ?? "", /noindex/, "noindex header set");
    assert.match(await ok.text(), /CASE/, "serves the case body");

    // Unknown / malformed tokens → 404 (no traversal, no index).
    assert.equal((await fetch(`${base}/c/${newCaseToken()}`)).status, 404, "unknown token → 404");
    assert.equal((await fetch(`${base}/c/NOTATOKEN`)).status, 404, "malformed token → 404");
    assert.equal((await fetch(`${base}/c/`)).status, 404, "no index page at /c/");
  } finally {
    process.env.AGENTIC_INSTRUMENT_TEST_ENABLED = prevFlag;
    if (prevDir === undefined) delete process.env.HOSTED_CASES_DIR;
    else process.env.HOSTED_CASES_DIR = prevDir;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
