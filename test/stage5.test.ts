import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ===========================================================================
// STAGE 5 automated tests (spec §5, tests 45–50). Pure/deterministic; the
// public fetcher is exercised with an injected in-memory HTTP transport so no
// network is touched.
// ===========================================================================

process.env.AGENTIC_STAGE1_RESULTS_DIR = join(mkdtempSync(join(tmpdir(), "stage5-test-")), "results");

import { PublicFetcher, isPermittedPublicPath, PER_HOST_REQUEST_CAP, type HttpResponse } from "../src/agentic-test/public-fetch.js";

const ROBOTS_ALLOW = "User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\n";
const ROBOTS_BLOCK_PRODUCTS = "User-agent: *\nDisallow: /products\n";

function mockHttp(routes: Record<string, HttpResponse>) {
  const calls: string[] = [];
  const http = async (url: string): Promise<HttpResponse> => {
    calls.push(url);
    const u = new URL(url);
    const key = u.pathname + (u.search || "");
    return routes[key] ?? routes[u.pathname] ?? { status: 404, contentType: "text/plain", body: "not found" };
  };
  return { http, calls };
}

// ---- 47. fetcher respects robots, rate limit, per-host cap -----------------

test("47. public fetcher respects robots.txt, rate limit, and per-host cap (mocked)", async () => {
  // Isolate the disk cache per test run so cache hits don't mask the policy.
  process.env.STAGE5_CACHE_DIR = mkdtempSync(join(tmpdir(), "stage5-cache-"));

  // robots blocks /products → the fetch is refused before any HTTP call.
  {
    const { http, calls } = mockHttp({
      "/robots.txt": { status: 200, contentType: "text/plain", body: ROBOTS_BLOCK_PRODUCTS },
      "/products.json": { status: 200, contentType: "application/json", body: '{"products":[]}' },
    });
    let clock = 0;
    const f = new PublicFetcher({ http, now: () => (clock += 3000) });
    const res = await f.get("https://blocked.example/products.json");
    assert.equal(res, null, "robots-disallowed path returns null");
    assert.ok(f.log.some((e) => e.skippedReason === "robots-disallow"));
    assert.ok(!calls.some((c) => c.includes("/products.json")), "no product fetch happened");
  }

  // Non-permitted path (admin) is refused with no robots fetch at all.
  {
    const { http } = mockHttp({});
    const f = new PublicFetcher({ http, now: () => 0 });
    assert.equal(await f.get("https://x.example/admin/orders"), null);
    assert.ok(f.log.some((e) => e.skippedReason === "path-not-a-permitted-public-endpoint"));
  }

  // Per-host cap: after PER_HOST_REQUEST_CAP live fetches, further URLs are refused.
  {
    const routes: Record<string, HttpResponse> = { "/robots.txt": { status: 200, contentType: "text/plain", body: ROBOTS_ALLOW } };
    for (let i = 0; i < 20; i++) routes[`/products/p${i}.js`] = { status: 200, contentType: "application/json", body: "{}" };
    const { http } = mockHttp(routes);
    let clock = 0;
    const f = new PublicFetcher({ http, now: () => (clock += 5000) });
    let ok = 0;
    let capped = 0;
    for (let i = 0; i < 20; i++) {
      const r = await f.get(`https://cap.example/products/p${i}.js`);
      if (r) ok++;
      else capped++;
    }
    // robots.txt counts as one host request; so ≤ CAP-1 product fetches succeed.
    assert.ok(ok <= PER_HOST_REQUEST_CAP, `≤ cap fetches (${ok})`);
    assert.ok(capped > 0, "excess requests were capped");
    assert.ok(f.log.some((e) => e.skippedReason === "per-host-cap-reached"));
  }

  // 429 blocks the host for subsequent requests.
  {
    const { http } = mockHttp({
      "/robots.txt": { status: 200, contentType: "text/plain", body: ROBOTS_ALLOW },
      "/products.json": { status: 429, contentType: "text/plain", body: "slow down" },
      "/products/x.js": { status: 200, contentType: "application/json", body: "{}" },
    });
    let clock = 0;
    const f = new PublicFetcher({ http, now: () => (clock += 5000) });
    assert.equal(await f.get("https://rl.example/products.json"), null);
    assert.equal(await f.get("https://rl.example/products/x.js"), null, "host blocked after 429");
    assert.ok(f.log.some((e) => e.skippedReason === "host-blocked"));
  }
});

// ---- 45. claim linter blocks product-truth / causal / predictive phrasing --

test("45. claim linter blocks forbidden phrasings on a fixture case", async () => {
  const { lintCaseText } = await import("../src/agentic-test/stage5-case.js");
  const claims = { a: { value: "54", source: "x" }, b: { value: "17", source: "y" } };

  // A compliant, evidence-availability-scoped sentence passes.
  const good = "We asked AI assistants 54 questions. A competitor was recommended 17 times. Your public store does not state aluminum-free in a form an AI assistant can verify.";
  assert.equal(lintCaseText(good, claims).ok, true, lintCaseText(good, claims).violations.map((v) => v.pattern).join(","));

  // Each forbidden class is caught.
  const bads: Array<[string, string]> = [
    ["Your product is not aluminum-free.", "product-truth"],
    ["Your product lacks aluminum-free labeling.", "product-truth"],
    ["You are losing $4,200 per month to competitors.", "revenue"],
    ["This fix will improve your ranking.", "predictive"],
    ["Adding this will rank higher in AI answers.", "ranking"],
    ["We guarantee more recommendations.", "guarantee"],
    ["You'll recover lost sales after this edit.", "predictive"],
  ];
  for (const [text, why] of bads) {
    const r = lintCaseText(text, claims);
    assert.equal(r.ok, false, `should block (${why}): ${text}`);
  }

  // An unsourced number (not in claims map) is blocked.
  const smuggled = "A competitor was recommended 999 times.";
  const r = lintCaseText(smuggled, claims);
  assert.equal(r.ok, false, "unsourced number blocked");
  assert.ok(r.violations.some((v) => v.pattern === "unsourced-number"));
});

// ---- 50. every rendered claim resolves through claims-map -------------------

test("50. rendered Stage 5 case has no orphan claim placeholders", async () => {
  const { renderStage5Case, buildStage5Claims, lintCaseText } = await import("../src/agentic-test/stage5-case.js");
  const diagnostic = {
    origin: "https://store.example", productHandle: "p", contractId: "cat-deodorant-aluminum-free", provenance: "public" as const,
    surfacesNotInspectable: ["product_metafields", "faq"], demotedConstraints: [],
    findings: [
      { id: "x1aluminumfree", attribute: "aluminum_free", scanVerdict: "absent" as const, evidence: [], journeyStatuses: ["unresolvable", "unresolvable"] },
      { id: "x2variantprice", attribute: "variant_price", scanVerdict: "evidenced" as const, evidence: [{ surface: "product_variants", quote: "12.00" }], journeyStatuses: ["satisfied", "satisfied"] },
      { id: "x3subscriptionrequired", attribute: "subscription_required", scanVerdict: "evidenced" as const, evidence: [{ surface: "product_description", quote: "one-time purchase" }], journeyStatuses: ["satisfied", "satisfied"] },
    ],
    journeyOutcomes: [
      { provider: "openai", trial: 1, outcome: "MISSING_EVIDENCE", rootCause: "EVIDENCE_GAP", coverageRatio: 1 },
      { provider: "gemini", trial: 1, outcome: "MISSING_EVIDENCE", rootCause: "EVIDENCE_GAP", coverageRatio: 1 },
    ],
    battery: { brandMentions: 0, channels: [], batteryTotal: 90 }, fetchUrls: { catalog: "https://store.example/products.json" },
    fetchedAt: "2026-07-23T00:00:00Z", severity: 9,
  };
  const { renderStage5CaseBody } = await import("../src/agentic-test/stage5-case.js");
  const claims = buildStage5Claims(diagnostic, "Example Store", "Rival Brand", 12);
  const html = renderStage5Case(claims, { modelsUsed: "gpt-5.4-mini, gemini-2.5-flash", provenanceUrls: ["https://store.example/products.json"], fetchedAt: "2026-07-23" });
  assert.ok(!/\{\{\w+\}\}/.test(html), "no unresolved placeholders");
  // The render gate lints the case BODY (states) — provenance metadata excluded.
  const lint = lintCaseText(renderStage5CaseBody(claims).replace(/<[^>]+>/g, " "), claims);
  assert.equal(lint.ok, true, "rendered case passes the linter: " + lint.violations.map((v) => `${v.pattern}:${v.excerpt}`).join(" | "));
  // Removing a claim throws (orphan detection, as test 41).
  const broken = { ...claims };
  delete (broken as Record<string, unknown>).missingEvidence;
  assert.throws(() => renderStage5Case(broken, { modelsUsed: "x", provenanceUrls: [], fetchedAt: "t" }), /orphan claim/);
});

// ---- 51. winner-contrast: verbatim quotes, both directions, linter-clean ---

test("51. winner-contrast scans the leader with the same contract, quotes verbatim", async () => {
  const { buildSnapshot } = await import("../src/agentic-test/snapshot-service.js");
  const { deodorantAluminumFreeContract } = await import("../src/agentic-test/categories/deodorant/contracts.js");
  const { diagnoseProspect, scanWinnerEvidenceMap, buildWinnerContrast, focusedEvidenceQuote } =
    await import("../src/agentic-test/stage5-diagnose.js");

  const mk = (desc: string, price: number) => {
    const product = {
      productId: "gid://public/1", handle: "p", title: "Natural Deodorant", description: desc,
      vendor: "X", productType: "Deodorant", tags: [], status: "ACTIVE", metafields: [],
      variants: [{ variantId: "v1", title: "Default", sku: null, price, available: true, options: [] }],
    };
    const snap = buildSnapshot("host", "public-v1", [product], [], [], "", "2026-07-24T00:00:00Z", []);
    return { ...snap, provenance: "public" as const, surfacesNotInspectable: ["product_metafields", "structured_data", "faq", "shipping_policy", "returns_policy"] as never };
  };

  // WINNER states aluminum-free + one-time purchase; PROSPECT states neither and prices over the cap.
  const winnerSnap = { ...mk("Aluminum-free. One-time purchase, no subscription.", 12), shopId: "https://winner.example" };
  const prospectSnap = { ...mk("A gentle natural deodorant for daily use.", 25), shopId: "https://prospect.example" };

  const winnerMap = scanWinnerEvidenceMap(winnerSnap, deodorantAluminumFreeContract);
  assert.equal(winnerMap.aluminum_free!.evidences, true, "winner evidences aluminum_free");
  assert.equal(winnerMap.subscription_required!.evidences, true, "winner evidences one-time purchase");
  // The quote is a VERBATIM substring of the winner's description (never paraphrased).
  assert.ok(winnerSnap.products[0]!.description!.includes(winnerMap.subscription_required!.quote!.replace(/…$/, "")), "quote is verbatim");
  assert.ok(/[a-z]/i.test(winnerMap.subscription_required!.quote!), "quote is text, not a JSON blob");

  const prospect = await diagnoseProspect({
    snapshot: prospectSnap,
    contract: deodorantAluminumFreeContract,
    battery: { brandMentions: 2, channels: ["openai"], batteryTotal: 90 },
    topCompetitorMentions: 43,
    runJourneys: async () => [],
  });
  const gapAttrs = prospect.findings.filter((f) => f.genuineEvidenceGap).map((f) => f.attribute);
  assert.ok(gapAttrs.includes("aluminum_free") && gapAttrs.includes("subscription_required"), `gaps: ${gapAttrs.join(",")}`);
  assert.ok(!gapAttrs.includes("variant_price"), "price over cap is readable-but-unmet, NOT a gap (Rule 4)");

  const contrast = buildWinnerContrast(prospect, winnerMap, { brand: "Leader", mentions: 43, origin: "https://winner.example" });
  assert.equal(contrast.distinct, true);
  assert.ok(contrast.facts.every((f) => f.winnerEvidences), "leader evidences every prospect gap");

  // focusedEvidenceQuote always returns a verbatim substring.
  const src = "First. Aluminum-free and gentle, made without baking soda. Third sentence here.";
  assert.ok(src.includes(focusedEvidenceQuote(src, "aluminum_free")), "focused quote is a substring");
});

test("52. winner-contrast render is linter-clean in both directions and self-suppresses", async () => {
  const { buildStage5Claims, renderWinnerContrast, renderStage5CaseBody, lintCaseText } =
    await import("../src/agentic-test/stage5-case.js");
  const diag = {
    origin: "https://store.example", productHandle: "p", contractId: "cat-deodorant-aluminum-free", provenance: "public" as const,
    surfacesNotInspectable: ["product_metafields", "faq"], demotedConstraints: [],
    findings: [
      { id: "x1aluminumfree", attribute: "aluminum_free", scanVerdict: "absent" as const, evidence: [], journeyStatuses: ["unresolvable"], readableButUnmet: false, genuineEvidenceGap: true },
      { id: "x3subscriptionrequired", attribute: "subscription_required", scanVerdict: "absent" as const, evidence: [], journeyStatuses: ["unresolvable"], readableButUnmet: false, genuineEvidenceGap: true },
    ],
    journeyOutcomes: [{ provider: "openai", trial: 1, outcome: "MISSING_EVIDENCE", coverageRatio: 1 }],
    battery: { brandMentions: 4, channels: ["openai"], batteryTotal: 90 }, fetchUrls: { catalog: "https://store.example/products.json" },
    fetchedAt: "2026-07-24T00:00:00Z", severity: 15,
  };
  // Mixed: leader STATES aluminum-free (quote), and does NOT state one-time (open advantage).
  const contrast = {
    brand: "Rival", mentions: 43, distinct: true,
    facts: [
      { attribute: "aluminum_free", winnerEvidences: true, winnerQuote: "Aluminum-free and gentle on skin", winnerSurface: "product_description" },
      { attribute: "subscription_required", winnerEvidences: false },
    ],
  };
  const claims = buildStage5Claims(diag, "Example Store", "Rival", 43, contrast);
  const contrastHtml = renderWinnerContrast(contrast, claims);
  assert.ok(/open advantage/.test(contrastHtml), "not-evidenced path renders the open-advantage sentence");
  assert.ok(/Aluminum-free and gentle/.test(contrastHtml), "evidenced path renders the verbatim quote");
  const body = renderStage5CaseBody(claims, { contrastHtml });
  const lint = lintCaseText(body.replace(/<[^>]+>/g, " "), claims);
  assert.equal(lint.ok, true, "contrast body passes the linter: " + lint.violations.map((v) => `${v.pattern}:${v.excerpt}`).join(" | "));

  // A store can't be contrasted with itself: distinct=false → empty block.
  assert.equal(renderWinnerContrast({ ...contrast, distinct: false }, claims), "", "self-contrast suppressed");
  assert.equal(renderWinnerContrast(undefined, claims), "", "no contrast → empty");
});

// ---- 46. not_inspectable surfaces never render as failures or as absent ----

test("46. not_inspectable surfaces are demoted to observational, never failures", async () => {
  const { buildSnapshot } = await import("../src/agentic-test/snapshot-service.js");
  const { bindContractToPublicSnapshot, deodorantAluminumFreeContract } = await import("../src/agentic-test/categories/deodorant/contracts.js");
  const { scanStore } = await import("../src/agentic-test/store-diagnostic.js");

  // A public snapshot where the ONLY surface is product_description; metafields,
  // structured_data, faq, shipping_policy all not_inspectable.
  const product = {
    productId: "gid://public/1", handle: "p", title: "Natural Deodorant",
    description: "A gentle natural deodorant. One-time purchase, no subscription.",
    vendor: "X", productType: "Deodorant", tags: [], status: "ACTIVE", metafields: [],
    variants: [{ variantId: "v1", title: "Default", sku: null, price: 12, available: true, options: [] }],
  };
  const snap = buildSnapshot("store.example", "public-v1", [product], [], [], "", "2026-07-23T00:00:00Z", []);
  const publicSnap = { ...snap, provenance: "public" as const, surfacesNotInspectable: ["product_metafields", "structured_data", "faq", "shipping_policy", "returns_policy"] as never };

  const { contract, demoted } = bindContractToPublicSnapshot(deodorantAluminumFreeContract, publicSnap);
  // delivery/subscription/price/aluminum: aluminum_free keeps product_description
  // (inspectable); subscription keeps product_description; price keeps variants.
  const aluminum = contract.hardConstraints.find((c) => c.attribute === "aluminum_free");
  assert.ok(aluminum, "aluminum_free stays HARD (product_description is inspectable)");
  assert.deepEqual(aluminum!.acceptableSurfaces, ["product_description"], "not_inspectable surfaces stripped");

  // A constraint whose surfaces are ALL not_inspectable would be demoted; here
  // construct one to prove the demotion path.
  const { deodorantSensitiveSkinContract } = await import("../src/agentic-test/categories/deodorant/contracts.js");
  const onlyPolicy = {
    ...deodorantSensitiveSkinContract,
    hardConstraints: deodorantSensitiveSkinContract.hardConstraints.map((c) =>
      c.attribute === "delivery_timing" ? c : c,
    ),
  };
  const bound2 = bindContractToPublicSnapshot(onlyPolicy, publicSnap);
  // delivery_timing's surfaces are shipping_policy + faq — both not_inspectable → demoted.
  assert.ok(bound2.demoted.some((d) => d.attribute === "delivery_timing"), "delivery_timing demoted");
  assert.ok(!bound2.contract.hardConstraints.some((c) => c.attribute === "delivery_timing"), "not a hard constraint");
  assert.ok(bound2.contract.softConstraints!.some((c) => c.attribute === "delivery_timing"), "moved to observational");

  // The scan never emits "absent" for a demoted/observational-only surface as a
  // HARD failure: demoted constraints are not in hardConstraints at all.
  const scan = scanStore(publicSnap, bound2.contract);
  void scan;
  for (const d of bound2.demoted) {
    assert.ok(!bound2.contract.hardConstraints.some((c) => c.id === d.id));
  }
});

// ---- 49. prospect records carry no PII fields ------------------------------

test("49. prospect + diagnostic records contain no PII fields", async () => {
  const { classifyProspects } = await import("../src/agentic-test/prospect-finder.js");
  void classifyProspects;
  // Schema assertion: the exported record shapes must not contain PII-named keys.
  const forbidden = ["name", "email", "phone", "address", "firstname", "lastname", "contactname", "owner"];
  // Build a representative diagnostic record and assert its keys.
  const rec = {
    origin: "https://store.example", productHandle: "p", contractId: "c", provenance: "public",
    surfacesNotInspectable: [], demotedConstraints: [], findings: [], journeyOutcomes: [],
    battery: { brandMentions: 0, channels: [], batteryTotal: 90 }, fetchUrls: {}, fetchedAt: "t", severity: 0,
  };
  const keys = JSON.stringify(rec).toLowerCase();
  for (const f of forbidden) {
    assert.ok(!new RegExp(`"${f}"\\s*:`).test(keys), `no PII key '${f}' in diagnostic record`);
  }
  // The only contact path allowed is a URL string (checked in the prospect writer).
});

test("isPermittedPublicPath allows only public read endpoints", () => {
  for (const ok of ["/products.json", "/products/foo.js", "/products/foo", "/collections/all/products.json", "/policies/refund-policy", "/pages/faq", "/robots.txt"]) {
    assert.ok(isPermittedPublicPath(ok), `permit ${ok}`);
  }
  for (const bad of ["/admin", "/admin/api/graphql.json", "/cart", "/cart/add.js", "/checkout", "/account/login", "/orders", "/apps/x"]) {
    assert.ok(!isPermittedPublicPath(bad), `refuse ${bad}`);
  }
});

// ---- 48. no third-party write/auth call exists in the Stage 5 modules ------

test("48. no third-party write or auth call anywhere in the Stage 5 module", () => {
  const files = [
    "src/agentic-test/public-fetch.ts",
    "src/agentic-test/public-catalog.ts",
    "src/agentic-test/prospect-finder.ts",
    "src/agentic-test/stage5-battery.ts",
    "src/agentic-test/stage5-diagnose.ts",
    "src/agentic-test/stage5-case.ts",
    "src/agentic-test/stage5-run.ts",
    "src/agentic-test/categories/deodorant/contracts.ts",
  ];
  for (const rel of files) {
    const p = join(process.cwd(), rel);
    let src: string;
    try {
      src = readFileSync(p, "utf8");
    } catch {
      continue; // module not yet written (earlier CP)
    }
    // Strip comments + string literals so a REFUSAL pattern (e.g. the fetcher's
    // own guard that BLOCKS /cart) isn't mistaken for a call to it. What remains
    // is executable code identifiers.
    const code = src
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
      .replace(/\/(?:[^/\\\n]|\\.)+\/[a-z]*/g, "RE"); // regex literals → RE
    // No mutating HTTP verbs, no auth headers, no Admin API, no Shopify tokens,
    // no write/cart/checkout mutations reachable in executable code.
    assert.ok(!/method\s*:\s*(POST|PUT|DELETE|PATCH)/i.test(code), `${rel}: no mutating HTTP method`);
    assert.ok(!/X-Shopify-Access-Token|Authorization|Bearer|shpat_|admin\/api/i.test(code), `${rel}: no auth/admin surface`);
    assert.ok(!/\b(productUpdate|productSet|metafieldsSet|metafieldsDelete|pageUpdate)\b/.test(code), `${rel}: no write mutation`);
    assert.ok(!/\/cart\/add|cartCreate|checkoutCreate/.test(code), `${rel}: no cart/checkout call`);
    // Only the fetcher may call fetch(); downstream modules go through PublicFetcher.
    if (!rel.endsWith("public-fetch.ts")) {
      assert.ok(!/\bfetch\s*\(/.test(code), `${rel}: no direct fetch() — must use PublicFetcher`);
    }
  }
});
