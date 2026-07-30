// CP-1 end-to-end against a REAL database and a REAL HTTP server.
//
// Two-sided throughout: every "it works" assertion is paired with a negative that must
// fail, because a route that 404s everything and a route that renders everything are
// indistinguishable if you only ever ask it questions you expect to succeed.
import "dotenv/config";
import { storePublicTest, newTestToken, getStoredResult, markResultShared } from "../../src/db/buyerTests.js";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:8787";
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);

const FROZEN = {
  ok: true,
  productUrl: "https://e2e-store.example/products/thing",
  storeName: "E2E Store",
  productName: "E2E Frozen Product",
  task: "e2e",
  assertions: [
    { label: "E2E row one", status: "pass_evidenced", detail: "E2E-FROZEN-DETAIL-ALPHA.",
      evidenceQuote: "E2E-FROZEN-QUOTE-BRAVO", evidenceSurface: "product copy", surfacesChecked: ["product copy"] },
    { label: "E2E row two", status: "not_proven", detail: "E2E-FROZEN-DETAIL-CHARLIE.", surfacesChecked: ["structured data"] },
  ],
  evidencedCount: 1, noBlockingCount: 0, notProvenCount: 1, requiresAccessCount: 0, total: 2,
  surfacesChecked: ["product copy"], notInspectable: [], suggestedCorrections: [],
  suggestedCorrection: null, deferred: [],
};

const token = newTestToken();
await storePublicTest(token, FROZEN.productUrl, "e2e-store.example", FROZEN, Date.now(), {
  kind: "general", engineVersion: "vE2E-TEST",
});

// 1. The row is readable through the RENDER path.
const row = await getStoredResult(token);
check("stored row is readable via getStoredResult", Boolean(row), token);
check("ran_at was recorded", Boolean(row?.ran_at), String(row?.ran_at));
check("engine_version was recorded", row?.engine_version === "vE2E-TEST", String(row?.engine_version));

// 2. RETENTION: expire the claim window and prove the result is STILL readable. This is
//    the whole CP-1 decision-3 claim, and it is the one that would silently regress.
const { pgQuery } = await import("../../src/db/pg.js");
await pgQuery(`update public_tests set expires_at = now() - interval '1 day' where token=$1`, [token]);
const afterExpiry = await getStoredResult(token);
check("RESULT SURVIVES the 7-day claim window expiring", Boolean(afterExpiry), "expires_at set to the past");
const { getPublicTest } = await import("../../src/db/buyerTests.js");
const claimAfterExpiry = await getPublicTest(token);
check("…while the CLAIM path correctly still refuses it (two-sided)", claimAfterExpiry === null,
  claimAfterExpiry ? "claim path returned a row — the windows were NOT separated" : "null, as required");

// 3. The HTTP route.
const res = await fetch(`${BASE}/result/${token}`);
const html = await res.text();
check("GET /result/:token → 200", res.status === 200, String(res.status));
check("renders the STORED detail sentence", html.includes("E2E-FROZEN-DETAIL-ALPHA."), "");
check("renders the STORED quote", html.includes("E2E-FROZEN-QUOTE-BRAVO"), "");
check("renders the STORED engine version", html.includes("vE2E-TEST"), "");
check("X-Robots-Tag is noindex, nofollow", res.headers.get("x-robots-tag") === "noindex, nofollow", String(res.headers.get("x-robots-tag")));
check("Referrer-Policy is same-origin", res.headers.get("referrer-policy") === "same-origin", String(res.headers.get("referrer-policy")));
check("Cache-Control is private, no-store", String(res.headers.get("cache-control")).includes("no-store"), String(res.headers.get("cache-control")));
check("UNSHARED ⇒ no og:image (a card is what makes a link travel)", !/property="og:image"/.test(html), "");
check("JS-OFF readable: no script tag beyond ld+json", !/<script(?![^>]*application\/ld\+json)/i.test(html), "");
check("JS-OFF readable: body clears a byte floor", html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length > 1500,
  String(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length));

// 4. Two-sided negatives: the route must REFUSE what it should refuse.
const bad = await fetch(`${BASE}/result/t_notavalidtoken0000`);
check("malformed token → 404 (not the SPA's 200)", bad.status === 404, String(bad.status));
const missing = await fetch(`${BASE}/result/t_00000000000000000000`);
check("unknown-but-well-formed token → 404", missing.status === 404, String(missing.status));
const spa = await fetch(`${BASE}/zz-no-such-path-v42`);
check("CANARY: an unknown path still falls through to the SPA with 200", spa.status === 200, String(spa.status));

// 5. Sharing is an act.
await markResultShared(token);
const shared = await fetch(`${BASE}/result/${token}`);
const sharedHtml = await shared.text();
check("SHARED ⇒ og:image now present", /property="og:image"/.test(sharedHtml), "");
check("SHARED ⇒ still noindex", shared.headers.get("x-robots-tag") === "noindex, nofollow", "");

// 6. Append-only lineage: a re-run mints a new row and links both ways.
const token2 = newTestToken();
await storePublicTest(token2, FROZEN.productUrl, "e2e-store.example",
  { ...FROZEN, productName: "E2E RERUN Product", evidencedCount: 2, notProvenCount: 0 },
  Date.now(), { kind: "general", engineVersion: "vE2E-TEST", rerunOf: token });
const oldAgain = await fetch(`${BASE}/result/${token}`).then((r) => r.text());
const newOne = await fetch(`${BASE}/result/${token2}`).then((r) => r.text());
check("the OLDER result still states its own verdict (never rewritten)", oldAgain.includes("E2E Frozen Product"), "");
check("the OLDER result links FORWARD to the newer one", oldAgain.includes(`/result/${token2}`), "");
check("the NEWER result links BACK", newOne.includes(`/result/${token}`), "");
check("the NEWER result carries its own different verdict", newOne.includes("E2E RERUN Product"), "");

// 7. Not in the sitemap.
const sitemap = await fetch(`${BASE}/sitemap.xml`).then((r) => r.text());
check("the result URL is absent from sitemap.xml", !sitemap.includes("/result/"), "");
check("CANARY: the sitemap is non-empty and does list /standards", sitemap.includes("/standards"), "");

const failed = results.filter(([, ok]) => !ok);
for (const [n, ok, d] of results) console.log(`${ok ? "  ok  " : "FAIL  "} ${n}${d ? `  [${d}]` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(failed.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN");
process.exit(failed.length ? 1 : 0);
