import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBuyerTask, contractVersion, evaluate, runProductTest, type PublicProduct, type Requirement } from "../src/server/productTest.js";
import { buildEvidence, findSupport, findTimingSupport, presentableQuote, isNegated, passesAboutness } from "../src/server/testEvidence.js";
import { lintStrings } from "../src/server/claimLinter.js";

// ===========================================================================
// Phase B — assertion evaluator HONESTY tests. Pure (no network).
// The differentiator is evidence-availability scoping + validated support:
// a wrong Fail is recoverable, a wrong Pass is not.
// ===========================================================================

/** Build a product whose evidence comes from typed PRODUCT surfaces only. */
const mk = (over: Partial<PublicProduct> & { description?: string } = {}): PublicProduct => {
  const description = over.description ?? "";
  return {
    origin: "https://s.example", handle: "p",
    title: over.title !== undefined ? over.title : "Natural Deodorant", vendor: "Acme",
    productType: over.productType !== undefined ? over.productType : "Deodorant", tags: over.tags ?? [], descriptionText: description,
    variants: over.variants ?? [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: over.minPriceUsd !== undefined ? over.minPriceUsd : 12,
    optionNames: [], optionValues: over.optionValues ?? [], extracted: over.extracted ?? null,
    evidence: over.evidence ?? buildEvidence([{ surface: "product_description", text: description }]),
    ldAvailability: over.ldAvailability ?? null,
    policyStatus: over.policyStatus ?? "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
  };
};
const claimReq = (claim: string): Requirement => ({ id: "c", kind: "claim", claim, label: claim });
const deliveryReq: Requirement = { id: "d", kind: "delivery", label: "Ships in the US within a week" };

// ---- 1. THE LIVE REGRESSION: free shipping is not a timing statement --------

test("1. a shipping quote with no timing term or digit does NOT satisfy the delivery requirement", () => {
  // The exact live false positive: a subscription widget credited as delivery timing.
  const chrome = "se $8.00 Selected Subscribe & Save save 25% $8.00 $6.00 Free shipping Cancel anytime Pause or skip anytime Build";
  const a = evaluate(mk({ description: chrome }), deliveryReq);
  assert.equal(a.status, "requires_store_access", `must not pass on chrome; got ${a.status}`);
  assert.equal(a.evidenceQuote, undefined, "no quote is shown for an unproven timing requirement");

  // "Free shipping" alone — price, not speed — never satisfies timing.
  assert.equal(evaluate(mk({ description: "Free shipping on all orders." }), deliveryReq).status, "requires_store_access");

  // A real timing statement WITH a number passes and quotes the sentence.
  const good = evaluate(mk({ description: "Orders ship within 2 business days from our facility." }), deliveryReq);
  assert.equal(good.status, "pass_evidenced");
  assert.match(good.evidenceQuote ?? "", /ships? within 2 business days/i);

  // An open-ended timing term with NO digit does not pass.
  assert.equal(evaluate(mk({ description: "Orders ship within a few business days." }), deliveryReq).status, "requires_store_access");
});

// ---- 2. chrome / widget / review text is never product evidence -------------

test("2. widget, review and upsell text is never quoted as product evidence", () => {
  const cases = [
    "Subscribe & Save save 25% — cancel anytime on every delivery.",
    "★★★★★ 412 reviews — one verified buyer said this soap is fragrance-free.",
    "You may also like our fragrance-free travel bar.",
  ];
  for (const text of cases) {
    const a = evaluate(mk({ description: text }), claimReq("fragrance_free"));
    assert.equal(a.status, "not_proven", `chrome must not evidence a claim: ${text}`);
    assert.equal(a.evidenceQuote, undefined);
  }
  // The same sentence in real product copy DOES evidence it.
  const real = evaluate(mk({ description: "This gentle bar is fragrance-free and made for sensitive skin." }), claimReq("fragrance_free"));
  assert.equal(real.status, "pass_evidenced");
});

// ---- 3. quotes are whole sentences, capped, never truncated mid-word --------

test("3. quotes are whole sentences, <=180 chars, cut at a word boundary", () => {
  const long = `Our formula is fragrance-free and ${"gentle ".repeat(60)}enough for daily use.`;
  const q = presentableQuote(long);
  assert.ok(q, "a long sentence still yields a quote");
  assert.ok(q!.length <= 181, `<=180 chars + ellipsis (got ${q!.length})`);
  assert.ok(q!.endsWith("…"), "ellipsis marks the cut");
  const body = q!.slice(0, -1);
  assert.ok(long.startsWith(body), "the quote is a verbatim prefix");
  const lastWord = body.trim().split(/\s+/).pop()!;
  assert.match(long, new RegExp(`\\b${lastWord}\\b`), "the final word is whole, never cut mid-word");

  // Junk yields no quote at all (the surface is named instead).
  assert.equal(presentableQuote("$8.00 $6.00 25% — —"), null, "no real words");
  assert.equal(presentableQuote("Free shipping"), null, "a 2-word fragment is not a sentence");
  assert.equal(presentableQuote("Save $8.00 now $6.00 then $4.00 later"), null, "a price list is widget chrome");
  // A short clean sentence is quoted whole, unchanged.
  assert.equal(presentableQuote("Aluminum-free and gentle."), "Aluminum-free and gentle.");
});

// ---- 4. negation prevents a claim match ------------------------------------

test("4. negation prevents a claim match", () => {
  assert.equal(evaluate(mk({ description: "This bar is not fragrance-free." }), claimReq("fragrance_free")).status, "not_proven");
  assert.equal(isNegated("This is not aluminum-free.", "aluminum-free"), true);
  assert.equal(isNegated("This is aluminum-free.", "aluminum-free"), false);
  // A negated mention plus a genuine one still supports.
  assert.equal(isNegated("Not the old formula. The new bar is aluminum-free.", "aluminum-free"), false);
});

// ---- 5. a claim about packaging / another subject does not count ------------

test("5. a claim that only modifies packaging or another subject is rejected (the Stage 3 TRAP)", () => {
  const trap = evaluate(mk({ description: "Ships in fragrance-free packaging to protect the bar." }), claimReq("fragrance_free"));
  assert.equal(trap.status, "not_proven", "the claim modifies packaging, not the product");
  assert.equal(passesAboutness("Ships in aluminum-free packaging.", "aluminum-free").ok, false);
  assert.equal(passesAboutness("The deodorant is aluminum-free.", "aluminum-free").ok, true);
  // Logistics requirements MAY talk about shipping subjects.
  assert.equal(passesAboutness("Ships within 2 business days.", "ships within", { allowLogisticsSubject: true }).ok, true);
});

// ---- 6. must_be_false absence is disclosed, never presented as proof --------

test("6. absence of a subscription blocker renders as pass_no_blocking, not pass_evidenced", () => {
  const a = evaluate(mk({ description: "A gentle daily deodorant." }), { id: "s", kind: "no_subscription", label: "Available as a one-time purchase" });
  assert.equal(a.status, "pass_no_blocking");
  assert.match(a.detail, /absence of a blocker/i, "the inference is disclosed in the copy");
  assert.equal(a.evidenceQuote, undefined, "an inference never carries a quote");

  // A real subscription-required signal is not proven.
  const blocked = evaluate(mk({ description: "This item is subscription only." }), { id: "s", kind: "no_subscription", label: "One-time" });
  assert.equal(blocked.status, "not_proven");
});

// ---- 7. the four states map to correct counts ------------------------------

test("7. result states produce a correct, separated breakdown", async () => {
  const html = [
    '{"product":{"title":"Cedar Bar Soap","vendor":"Acme","product_type":"Bar Soap","tags":"",',
    '"body_html":"<p>A cedar bar soap. Paraben-free and gentle.</p>",',
    '"options":[{"name":"Size","values":["Travel"]}],',
    '"variants":[{"title":"Travel","price":"9.00","option1":"Travel"}]}}',
  ].join("");
  const res = await runProductTest("https://s.example/products/cedar-bar", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (url) =>
      url.endsWith(".json")
        ? { status: 200, contentType: "application/json", body: html }
        : { status: 404, contentType: "text/html", body: "" },
  });
  assert.equal(res.ok, true);
  assert.equal(res.total, res.assertions.length);
  assert.equal(
    res.evidencedCount + res.noBlockingCount + res.notProvenCount + res.requiresAccessCount,
    res.total,
    "every assertion lands in exactly one of the four states",
  );
  // Paraben-free IS stated → evidenced; fragrance-free is NOT → not proven.
  const paraben = res.assertions.find((a) => /paraben/i.test(a.label))!;
  assert.equal(paraben.status, "pass_evidenced");
  assert.match(paraben.evidenceQuote ?? "", /paraben-free/i);
  const fragrance = res.assertions.find((a) => /fragrance/i.test(a.label))!;
  assert.equal(fragrance.status, "not_proven");
  assert.match(fragrance.detail, /checked .*product copy/i, "names the surfaces actually checked");
  // Subscription is an inference; delivery isn't public.
  assert.equal(res.assertions.find((a) => /one-time/i.test(a.label))!.status, "pass_no_blocking");
  assert.equal(res.assertions.find((a) => /delivery timing/i.test(a.label))!.status, "requires_store_access");
  assert.ok(res.notInspectable.includes("product metafields"));
});

// ---- structural: price/variant use structured values only -------------------

test("price and variant assertions use structured values, never prose", () => {
  const under = evaluate(mk({ minPriceUsd: 12 }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(under.status, "pass_evidenced");
  assert.equal(under.evidenceQuote, undefined, "a price is a value, not a quote");
  const over = evaluate(mk({ minPriceUsd: 25 }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(over.status, "not_proven");
  assert.match(over.detail, /\$25\.00/, "reports the readable value");
  const noPrice = evaluate(mk({ minPriceUsd: null }), { id: "p", kind: "price_under", capUsd: 20, label: "Price under $20" });
  assert.equal(noPrice.status, "requires_store_access");

  const p = mk({ variants: [{ title: "Unscented / Travel", priceUsd: 10, available: true, options: ["Unscented", "Travel"] }] });
  assert.equal(evaluate(p, { id: "v", kind: "variant_option", optionValue: "Travel", label: "Travel option" }).status, "pass_evidenced");
  assert.equal(evaluate(p, { id: "v", kind: "variant_option", optionValue: "XL", label: "XL option" }).status, "not_proven");
});

test("buildBuyerTask: a readable set spanning surface types; category-aware claims", () => {
  // v2.3 CP2 raised the ceiling from 6 to 10. The v2.2 sample measured the cost of
  // the old bound: the modal store produced ONE genuine finding and 21% produced
  // none, so the table was honest and thin. Breadth is the lever depth needs.
  const task = buildBuyerTask(mk({
    productType: "Deodorant", optionValues: ["Unscented", "Travel"],
    // Attribute rows are only adjudicable when there IS product text, and the
    // identifier row only when the page markup was readable — so a fixture with
    // neither would legitimately produce neither.
    description: "A gentle daily deodorant.",
    extracted: {
      jsonLdTypes: ["Product"], hasProductSchema: true, product: null, title: null, metaDescription: null,
      canonicalUrl: null, robotsIndex: true, headings: { h1: [], h2: [] }, faqs: [],
      signals: { jsonLd: true, productSchema: true, offer: true, price: true, availability: true, gtin: false, mpn: false, sku: false, brand: false, rating: false, reviews: false, shipping: false, returns: false, faq: false, canonical: true, indexable: true },
    },
  }));
  assert.ok(task.requirements.length >= 6 && task.requirements.length <= 10, `6–10 requirements (${task.requirements.length})`);
  const kinds = new Set(task.requirements.map((r) => r.kind));
  assert.ok(kinds.has("claim") && kinds.has("price_under") && kinds.has("no_subscription") && kinds.has("delivery"), "spans the original surface types");
  assert.ok(kinds.has("attribute") && kinds.has("identifiers"), "and the v2.3 attribute + structured-data surfaces");
  assert.ok(task.requirements.some((r) => r.claim === "aluminum_free"), "deodorant → aluminum-free claim");
  const coffee = buildBuyerTask(mk({ title: "Ethiopia Whole Bean Coffee", productType: "Coffee" }));
  assert.ok(coffee.requirements.some((r) => r.claim === "single_origin"), "coffee → single-origin claim");
  // A coffee-SCENTED soap is a soap, not a coffee (tags must not classify).
  const soap = buildBuyerTask(mk({ title: "Coffee Scrub Bar", productType: "Bar Soap", tags: ["coffee"] }));
  assert.ok(soap.requirements.some((r) => r.claim === "fragrance_free"), "soap → skincare claims");
});

// ---------------------------------------------------------------------------
// v2.2 CP3 — an UNRECOGNISED category gets no claim, not a defaulted one.
//
// Measured on 13 real stores: CATEGORY_CLAIMS covers personal care, food and
// drinkware, so everything else fell through to a hardcoded ["cruelty_free"].
// "Cruelty-free" was therefore asked of dog harnesses, backpacks, notebooks,
// bike parts and garden tools — it failed 13/13, and because a claim
// always scores highest in `adjudicability` it OPENED every report. It was
// typically one of only two not-proven rows, so half of what we showed as
// findings came from that one default.
// ---------------------------------------------------------------------------

test("buildBuyerTask: an unrecognised category gets NO claim requirement", () => {
  for (const p of [
    mk({ title: "Lined Notebook, A5", productType: "Notebook", tags: ["stationery"] }),
    mk({ title: "Everyday Dog Harness", productType: "Harness", tags: ["dogs"] }),
    mk({ title: "Errant Backpack", productType: "Backpack", tags: ["travel"] }),
  ]) {
    const task = buildBuyerTask(p);
    const claims = task.requirements.filter((r) => r.kind === "claim");
    assert.equal(claims.length, 0, `must not invent ${claims.map((c) => c.label).join(", ")} for ${p.productType}`);
    assert.doesNotMatch(task.summary, /cruelty/i);
    // Still a usable buyer task — the fix must not hollow out the report.
    assert.ok(task.requirements.length >= 4, `expected >=4 requirements, got ${task.requirements.length}`);
  }
});

test("buildBuyerTask: a claim the product's OWN tags state is still inferred", () => {
  // The tag path is something the merchant published themselves, not a guess
  // about the category, so it must survive the removal of the default.
  const tagged = buildBuyerTask(mk({ title: "Enamel Mug", productType: "Camp Mug", tags: ["bpa-free"] }));
  const claims = tagged.requirements.filter((r) => r.kind === "claim");
  assert.equal(claims.length, 1);
  assert.equal(claims[0]!.claim, "bpa_free");
});

// ---- 10. the claim linter blocks overclaims in any rendered string ----------

test("10. claim linter blocks product-truth, ranking, revenue, causal and predictive phrasing", async () => {
  const { lintText, lintStrings } = await import("../src/server/claimLinter.js");

  // Compliant, evidence-availability-scoped copy passes.
  for (const good of [
    "Checked product copy, structured data and variant options — no statement an AI buyer could verify.",
    "Stated in your product copy.",
    "Nothing in your public product data requires a subscription. This is the absence of a blocker, not a stated one-time-purchase option.",
    "Lowest readable price is $23.00, at or above the $20 requirement.",
    "Your shipping policy isn't publicly inspectable per-product — confirming this needs store access.",
  ]) {
    assert.equal(lintText(good).ok, true, `should pass: ${good} → ${lintText(good).violations.map((v) => v.rule).join(",")}`);
  }

  // Each forbidden family is caught.
  const bad: Array<[string, string]> = [
    ["Your product is not aluminum-free.", "product-truth"],
    ["Your formula lacks a verifiable claim.", "product-truth"],
    ["You are losing $4,200 per month to competitors.", "revenue-loss"],
    ["Fixing this will increase your sales.", "revenue-promise"],
    ["Add this and you'll rank higher in AI answers.", "ranking-prediction"],
    ["This fix will improve your visibility.", "predictive"],
    ["We guarantee more recommendations.", "guarantee"],
    ["Your store does not state the price.", "price-is-always-public"],
    ["Missing metafields on this product.", "not-inspectable-mislabeled"],
  ];
  for (const [text, rule] of bad) {
    const r = lintText(text);
    assert.equal(r.ok, false, `should block: ${text}`);
    assert.ok(r.violations.some((v) => v.rule === rule), `${text} → expected ${rule}, got ${r.violations.map((v) => v.rule).join(",")}`);
  }

  // lintStrings aggregates and ignores empty slots.
  assert.equal(lintStrings([null, undefined, "Stated in your product copy."]).ok, true);
  assert.equal(lintStrings(["fine", "This fix will boost conversions."]).ok, false);
});

test("10b. a non-compliant result is NOT rendered (the linter is a blocking gate)", async () => {
  // A product whose own copy would produce a forbidden rendered string: the claim
  // label is injected via the product title path used by the task summary.
  const html = JSON.stringify({
    product: {
      title: "Rank Higher Serum", vendor: "Acme", product_type: "you'll rank higher serum", tags: "",
      body_html: "<p>A serum.</p>", options: [], variants: [{ title: "Default", price: "10.00" }],
    },
  });
  const res = await runProductTest("https://s.example/products/x", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (url) =>
      url.endsWith(".json")
        ? { status: 200, contentType: "application/json", body: html }
        : { status: 404, contentType: "text/html", body: "" },
  });
  // v2.3 CHANGED THIS CONTRACT, deliberately. The linter is still a blocking gate on
  // strings WE compose, but merchant-supplied text (title, product_type, option
  // values, their own sentences) is now filtered BEFORE it can reach a rendered
  // string. Otherwise a store whose product is called "Rank Higher Serum" had its
  // entire report refused as `unreachable` — a false statement about a store we read
  // perfectly, and unfixable by retry because it is deterministic.
  assert.equal(res.ok, true, "a merchant's own wording must never destroy their report");
  assert.ok(lintStrings([res.task]).ok, "and the summary we render is still clean");
  assert.ok(!/rank higher/i.test(res.task), "the offending merchant string is not echoed");
  // The gate itself is unchanged and still rejects a forbidden phrase.
  assert.equal(lintStrings(["you'll rank higher in AI answers"]).ok, false, "the linter still blocks");
});

// ---- 8. cache: TTL hit, re-run bypass, throttle ----------------------------

test("8. a repeat test is served from cache within TTL; an explicit re-run bypasses it", async () => {
  const { __resetCaches, RESULT_TTL_MS, RERUN_MIN_INTERVAL_MS } = await import("../src/server/productTestCache.js");
  __resetCaches();
  const html = JSON.stringify({
    product: { title: "Cedar Bar", vendor: "Acme", product_type: "Bar Soap", tags: "", body_html: "<p>Paraben-free bar.</p>", options: [], variants: [{ title: "Default", price: "9.00" }] },
  });
  let fetches = 0;
  let clock = 1_000_000;
  const deps = {
    now: () => clock,
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (u: string) => {
      fetches++;
      return u.endsWith(".json")
        ? { status: 200, contentType: "application/json", body: html }
        : { status: 404, contentType: "text/html", body: "" };
    },
  };
  const url = "https://cache.example/products/cedar-bar";

  const first = await runProductTest(url, deps);
  assert.equal(first.ok, true);
  assert.ok(!first.cached, "the first run is live");
  const liveFetches = fetches;
  assert.ok(liveFetches > 0, "the first run fetched");

  // Second call within TTL → cache hit, zero new fetches, labeled with its age.
  const second = await runProductTest(url, deps);
  assert.equal(fetches, liveFetches, "a cached repeat makes NO new requests");
  assert.equal(second.cached, true, "flagged as cached");
  assert.ok(second.testedAt, "carries the original timestamp for the UI label");
  assert.deepEqual(second.assertions.map((a) => a.status), first.assertions.map((a) => a.status));

  // A URL that differs only by case/query hits the same cache entry.
  assert.equal((await runProductTest(`${url.toUpperCase()}?variant=123`, deps)).cached, true);
  assert.equal(fetches, liveFetches, "still no new requests");

  // force=true within the hour is NOT honored (protects the store).
  assert.equal((await runProductTest(url, { ...deps, force: true })).cached, true, "re-run is rate-limited to 1/hour");

  // After an hour, force=true does a live run.
  clock += RERUN_MIN_INTERVAL_MS + 1;
  const rerun = await runProductTest(url, { ...deps, force: true });
  assert.ok(fetches > liveFetches, "the honored re-run fetched again");
  assert.ok(!rerun.cached, "a forced re-run returns live data");

  // Past the TTL the entry expires on its own.
  clock += RESULT_TTL_MS + 1;
  const beforeExpiry = fetches;
  await runProductTest(url, deps);
  assert.ok(fetches > beforeExpiry, "an expired entry triggers a live run");
});

test("8b. per-host throttle spaces requests and refuses past the hourly cap", async () => {
  const { __resetCaches, reserveHostSlot, HOST_HOURLY_CAP, HOST_MIN_INTERVAL_MS } = await import("../src/server/productTestCache.js");
  __resetCaches();
  let clock = 5_000_000;
  const deps = { now: () => clock };

  const first = reserveHostSlot("throttle.example", deps);
  assert.deepEqual(first, { ok: true, waitMs: 0 }, "the first request goes immediately");
  const second = reserveHostSlot("throttle.example", deps);
  assert.ok(second.ok && second.waitMs === HOST_MIN_INTERVAL_MS, "an immediate second request must wait 2s");

  // Spend the hourly budget.
  for (let i = 2; i < HOST_HOURLY_CAP; i++) reserveHostSlot("throttle.example", deps);
  const over = reserveHostSlot("throttle.example", deps);
  assert.deepEqual(over, { ok: false, reason: "hourly_cap" }, "refused past the cap instead of hammering");

  // A different host has its own budget.
  assert.equal(reserveHostSlot("other.example", deps).ok, true);
  // The window rolls over after an hour.
  clock += 60 * 60 * 1000 + 1;
  assert.equal(reserveHostSlot("throttle.example", deps).ok, true);
});

// ---- 9. each error condition renders its own honest message ----------------

test("9. every failure mode returns its specific, honest message", async () => {
  const { __resetCaches } = await import("../src/server/productTestCache.js");
  const { FETCH_ERROR_MESSAGE } = await import("../src/server/productTest.js");
  const allow = async () => ({ rules: [], fetched: false });

  const run = async (host: string, fetchUrl: (u: string) => Promise<{ status: number; contentType: string | null; body: string }>, loadRobots = allow) => {
    __resetCaches();
    return runProductTest(`https://${host}/products/x`, { fetchUrl, loadRobots, semantic: { disabled: true } });
  };

  // Not a product URL at all.
  const bad = await runProductTest("https://store.example/collections/all", {});
  assert.equal(bad.errorKind, "bad_url");
  assert.equal(bad.error, FETCH_ERROR_MESSAGE.bad_url);

  // Host rate-limits us.
  const limited = await run("a.example", async () => ({ status: 429, contentType: "text/plain", body: "slow down" }));
  assert.equal(limited.errorKind, "rate_limited");
  assert.match(limited.error ?? "", /limiting automated requests/i);

  // robots.txt disallows the product paths.
  const blocked = await run("b.example", async () => ({ status: 200, contentType: "application/json", body: "{}" }),
    async () => ({ rules: [{ path: "/products", allow: false }], fetched: true }) as never);
  assert.equal(blocked.errorKind, "robots_disallowed");
  assert.match(blocked.error ?? "", /asks automated tools not to read/i);

  // No such product.
  const missing = await run("c.example", async () => ({ status: 404, contentType: "text/html", body: "" }));
  assert.equal(missing.errorKind, "not_found");
  assert.match(missing.error ?? "", /couldn't find a product/i);

  // 200 but not Shopify JSON (and no product page).
  const notShopify = await run("d.example", async (u) =>
    u.endsWith(".json") ? { status: 200, contentType: "text/html", body: "<html>nope</html>" } : { status: 500, contentType: null, body: "" });
  assert.equal(notShopify.errorKind, "not_shopify");
  assert.match(notShopify.error ?? "", /isn't a Shopify store/i);

  // Every message is distinct — no generic catch-all.
  const msgs = new Set(Object.values(FETCH_ERROR_MESSAGE));
  assert.equal(msgs.size, Object.keys(FETCH_ERROR_MESSAGE).length, "each error kind has its own message");
});

// ===========================================================================
// v1.1 — restore diagnostic power WITHOUT recovering a single false Pass.
// ===========================================================================

const shopJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ product: { title: "Cedar Bar", vendor: "Acme", product_type: "Bar Soap", tags: "", body_html: "<p>A cedar bar.</p>", options: [{ name: "Size", values: ["Travel"] }], variants: [{ title: "Travel", price: "9.00", option1: "Travel" }], ...over } });

/** Run against a stubbed store: `routes` maps a URL suffix → response. */
async function runStub(routes: Array<[RegExp, { status: number; contentType: string | null; body: string }]>, extra: Record<string, unknown> = {}) {
  const { __resetCaches } = await import("../src/server/productTestCache.js");
  __resetCaches();
  return runProductTest("https://v11.example/products/cedar-bar", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (u: string) => routes.find(([re]) => re.test(u))?.[1] ?? { status: 404, contentType: "text/html", body: "" },
    ...extra,
  });
}

// ---- 11. headline math: store-access rows never count against the merchant --

test("11. headline counts only not_proven; a clean store reads as clean", async () => {
  // A store that states everything the library asks → zero not_proven. v2.3 widened
  // what "everything" means (materials, dimensions, origin, a published identifier),
  // so the fixture states those too. The point of the test is unchanged and is the
  // one CP3 cares about: a genuinely clean store must be able to read as clean.
  const cleanLd = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Cedar Bar", gtin13: "0123456789012",
    offers: { "@type": "Offer", price: "9.00", priceCurrency: "USD", availability: "https://schema.org/InStock" },
  })}</script></head><body></body></html>`;
  const clean = await runStub([
    [/\.json$/, { status: 200, contentType: "application/json", body: shopJson({
      body_html: "<p>A cedar bar soap. Fragrance-free and paraben-free. Ships within 2 business days. Made from cold-pressed cedar oil. Each bar weighs 4oz and is 3 inches across. Handmade in Vermont.</p>",
    }) }],
    [/products\/cedar-bar$/, { status: 200, contentType: "text/html", body: cleanLd }],
  ]);
  assert.equal(clean.ok, true);
  assert.equal(clean.notProvenCount, 0, `expected a clean store: ${clean.assertions.map((a) => a.status + ":" + a.label).join(" | ")}`);
  assert.ok(clean.evidencedCount >= 3, "the proven rows are real");
  assert.equal(clean.suggestedCorrections.length, 0, "nothing to correct");

  // requires_store_access is NEVER folded into the headline number.
  const thin = await runStub([[/\.json$/, { status: 200, contentType: "application/json", body: shopJson() }]]);
  const headline = thin.notProvenCount;
  assert.equal(headline, thin.assertions.filter((a) => a.status === "not_proven").length);
  assert.ok(!thin.assertions.filter((a) => a.status === "requires_store_access").some(() => headline > thin.notProvenCount),
    "store-access rows excluded from the headline count");
});

// ---- 12. JSON-LD availability proves stock with no .js fetch ----------------

test("12. JSON-LD InStock proves availability without any .js fetch", async () => {
  const ld = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Cedar Bar", description: "A cedar bar.",
    offers: { "@type": "Offer", price: "9.00", priceCurrency: "USD", availability: "https://schema.org/InStock" },
  })}</script></head><body></body></html>`;
  const urls: string[] = [];
  const { __resetCaches } = await import("../src/server/productTestCache.js");
  __resetCaches();
  const res = await runProductTest("https://ld.example/products/cedar-bar", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (u: string) => {
      urls.push(u);
      if (/\.json$/.test(u)) return { status: 404, contentType: "text/html", body: "" }; // no .json at all
      if (/\.js$/.test(u)) return { status: 200, contentType: "text/javascript", body: "{}" };
      return { status: 200, contentType: "text/html", body: ld };
    },
  });
  const stock = res.assertions.find((a) => /in stock/i.test(a.label));
  assert.ok(stock, "the availability row is present");
  assert.equal(stock!.status, "pass_evidenced", "JSON-LD InStock proves it");
  assert.match(stock!.detail, /structured data/i);
  assert.ok(!urls.some((u) => u.endsWith(".js")), "no .js fetch was needed");

  // OutOfStock is an honest not_proven, never a false pass.
  __resetCaches();
  const oos = await runProductTest("https://ld2.example/products/cedar-bar", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (u: string) => /\.json$/.test(u)
      ? { status: 404, contentType: "text/html", body: "" }
      : { status: 200, contentType: "text/html", body: ld.replace("InStock", "OutOfStock") },
  });
  assert.equal(oos.assertions.find((a) => /in stock/i.test(a.label))!.status, "not_proven");
});

// ---- 13. shipping policy: readable-but-silent is a FINDING, not a shrug -----

test("13. the shipping policy resolves delivery — timing proves it, silence is not_proven", async () => {
  const withTiming = await runStub([
    [/\.json$/, { status: 200, contentType: "application/json", body: shopJson() }],
    [/policies\/shipping-policy/, { status: 200, contentType: "text/html", body: "<html><body><p>All orders ship within 2 business days of purchase.</p></body></html>" }],
  ]);
  const d1 = withTiming.assertions.find((a) => /delivery timing/i.test(a.label))!;
  assert.equal(d1.status, "pass_evidenced", "a stated window proves delivery");
  assert.match(d1.evidenceQuote ?? "", /within 2 business days/i);
  assert.match(d1.detail, /shipping policy/i);

  // Policy readable but states NO timing → an actionable finding, not store-access.
  const noTiming = await runStub([
    [/\.json$/, { status: 200, contentType: "application/json", body: shopJson() }],
    [/policies\/shipping-policy/, { status: 200, contentType: "text/html", body: "<html><body><p>We offer free shipping on all orders. Returns accepted.</p></body></html>" }],
  ]);
  const d2 = noTiming.assertions.find((a) => /delivery timing/i.test(a.label))!;
  assert.equal(d2.status, "not_proven", "a silent policy is a real finding");
  assert.match(d2.detail, /shipping policy/i);
  assert.ok(noTiming.suggestedCorrections.some((c) => /delivery window/i.test(c)), "and it yields a correction");

  // Policy unreachable → honestly requires store access.
  const unreachable = await runStub([[/\.json$/, { status: 200, contentType: "application/json", body: shopJson() }]]);
  assert.equal(unreachable.assertions.find((a) => /delivery timing/i.test(a.label))!.status, "requires_store_access");
});

// ---- 14. generator caps store-access rows and prefers adjudicable ones ------

test("14. at most one requires_store_access row; the rest become the install argument", async () => {
  // A bare store: no price, no options, no availability, no policy.
  const bare = await runStub([
    [/\.json$/, { status: 200, contentType: "application/json", body: JSON.stringify({ product: { title: "Mystery", vendor: "A", product_type: "Bar Soap", tags: "", body_html: "", options: [], variants: [] } }) }],
  ]);
  assert.equal(bare.ok, true);
  const access = bare.assertions.filter((a) => a.status === "requires_store_access");
  assert.ok(access.length <= 1, `at most one store-access row in the table (got ${access.length})`);
  assert.ok(bare.assertions.length >= 3, "the table still has substance");
  // Any extras are preserved below the table, never silently dropped.
  const total = bare.assertions.length + bare.deferred.length;
  assert.ok(total >= bare.assertions.length, "deferred rows are retained");
  for (const d of bare.deferred) assert.equal(d.status, "requires_store_access");
});

// ---- 15. semantic tier: bounded, verbatim-gated, veto-capable, fail-silent --

test("15. semantic tier grants only on a VERBATIM quote, vetoes lexical matches, fails silent", async () => {
  const paraphrase = "<p>This bar is made without any synthetic scent, using only botanicals.</p>";
  const stub = (findings: unknown) => ({
    complete: async () => ({ text: JSON.stringify({ findings }), inputTokens: 400, outputTokens: 60 }),
  });

  // (a) A verbatim paraphrase quote GRANTS proven.
  const granted = await runStub(
    [[/\.json$/, { status: 200, contentType: "application/json", body: shopJson({ body_html: paraphrase }) }]],
    { semantic: stub([{ attribute: "fragrance_free", exactQuote: "This bar is made without any synthetic scent, using only botanicals.", verdict: "supports", subject: "the bar" }]) },
  );
  const fr = granted.assertions.find((a) => /fragrance/i.test(a.label))!;
  assert.equal(fr.status, "pass_evidenced", "a verbatim paraphrase is credited");
  assert.match(fr.evidenceQuote ?? "", /without any synthetic scent/i);
  assert.equal(granted.semantic?.granted, 1);

  // (b) A NON-substring quote is discarded — no credit, ever.
  const invented = await runStub(
    [[/\.json$/, { status: 200, contentType: "application/json", body: shopJson({ body_html: paraphrase }) }]],
    { semantic: stub([{ attribute: "fragrance_free", exactQuote: "This product is certified fragrance-free.", verdict: "supports" }]) },
  );
  assert.equal(invented.assertions.find((a) => /fragrance/i.test(a.label))!.status, "not_proven", "invented evidence is refused");
  assert.equal(invented.semantic?.granted, 0);
  assert.equal(invented.semantic?.discarded, 1, "and the discard is counted");

  // (c) about_other_subject VETOES a lexical match (withdraws credit).
  const vetoed = await runStub(
    [[/\.json$/, { status: 200, contentType: "application/json", body: shopJson({ body_html: "<p>Packed in a fragrance-free wrapper for shipping safety.</p>" }) }]],
    { semantic: stub([{ attribute: "fragrance_free", exactQuote: "Packed in a fragrance-free wrapper for shipping safety.", verdict: "about_other_subject", subject: "wrapper" }]) },
  );
  assert.equal(vetoed.assertions.find((a) => /fragrance/i.test(a.label))!.status, "not_proven");

  // (d) A model error leaves the lexical result exactly as it was.
  const errored = await runStub(
    [[/\.json$/, { status: 200, contentType: "application/json", body: shopJson({ body_html: "<p>A cedar bar. Paraben-free and gentle.</p>" }) }]],
    { semantic: { complete: async () => { throw new Error("timeout"); } } },
  );
  assert.equal(errored.assertions.find((a) => /paraben/i.test(a.label))!.status, "pass_evidenced", "lexical result survives");
  assert.equal(errored.assertions.find((a) => /fragrance/i.test(a.label))!.status, "not_proven");
});

// ---- 16. one correction line per not_proven requirement ---------------------

test("16. a suggested correction is emitted for EVERY unproven requirement", async () => {
  const res = await runStub([[/\.json$/, { status: 200, contentType: "application/json", body: shopJson() }]]);
  const notProven = res.assertions.filter((a) => a.status === "not_proven");
  assert.equal(res.suggestedCorrections.length, notProven.length, "one line per unproven row");
  assert.ok(notProven.length >= 2, "this fixture has multiple gaps to cover");
  assert.equal(new Set(res.suggestedCorrections).size, res.suggestedCorrections.length, "no duplicated advice");
  // requires_store_access rows never generate corrections (not the merchant's fault).
  assert.ok(res.suggestedCorrections.every((c) => typeof c === "string" && c.length > 20));
});

// ---- 17. a cached test makes zero fetches AND zero model calls --------------

test("17. a cached test performs no network fetches and no model calls", async () => {
  const { __resetCaches } = await import("../src/server/productTestCache.js");
  __resetCaches();
  let fetches = 0;
  let modelCalls = 0;
  const deps = {
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {}, // throttle bookkeeping still runs; we just don't burn real seconds
    fetchUrl: async (u: string) => {
      fetches++;
      return /\.json$/.test(u)
        ? { status: 200, contentType: "application/json", body: shopJson() }
        : { status: 404, contentType: "text/html", body: "" };
    },
    semantic: {
      complete: async () => { modelCalls++; return { text: JSON.stringify({ findings: [] }), inputTokens: 100, outputTokens: 10 }; },
    },
  };
  const url = "https://cached.example/products/cedar-bar";
  await runProductTest(url, deps);
  assert.ok(fetches > 0 && modelCalls === 1, `first run fetches and calls the model once (${fetches}/${modelCalls})`);
  const f = fetches;

  const second = await runProductTest(url, deps);
  assert.equal(second.cached, true);
  assert.equal(fetches, f, "cached run makes ZERO network fetches");
  assert.equal(modelCalls, 1, "cached run makes ZERO model calls");
});

test("findSupport only reads product surfaces (chrome is not in the index at all)", () => {
  const ev = buildEvidence([
    { surface: "product_description", text: "A gentle bar." },
    { surface: "structured_data", text: "Certified organic and fair trade." },
  ]);
  assert.equal(findSupport(ev, ["organic"])?.surface, "structured_data");
  assert.equal(findTimingSupport(ev), null, "no timing statement anywhere");
});

// ===========================================================================
// V2 CP1 — EGRESS RESILIENCE. The v1.1 smoke run hit `429 local_rate_limited`
// on `/products/*` for stores we had never touched, while `/robots.txt` and
// `/policies/*` on those same hosts served 200: the limiter counts our EGRESS
// IP and is ENDPOINT-SPECIFIC. Per-host throttling structurally cannot help.
// ===========================================================================

/** A product page whose JSON-LD carries name, prose, price AND availability. */
const richPage = (description: string) =>
  `<html><head><meta name="description" content="Cedar bar soap."><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Cedar Bar", description, category: "Home > Bath > Bar Soap",
    offers: { "@type": "Offer", price: "9.00", priceCurrency: "USD", availability: "https://schema.org/InStock" },
  })}</script></head><body></body></html>`;

test("18. the page tier alone proves claim, price and availability — no .json fetch", async () => {
  const urls: string[] = [];
  const { __resetCaches } = await import("../src/server/productTestCache.js");
  __resetCaches();
  const res = await runProductTest("https://pagetier.example/products/cedar-bar", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {},
    fetchUrl: async (u: string) => {
      urls.push(u);
      if (/\/products\/cedar-bar$/.test(u)) {
        return { status: 200, contentType: "text/html", body: richPage("A cedar bar soap. This bar is fragrance-free and paraben-free. Orders ship within 2 business days.") };
      }
      // The observed shape: the product ENDPOINTS 429 while HTML surfaces serve.
      // The test must never need one of them.
      if (/\.(json|js)$/.test(u)) return { status: 429, contentType: null, body: "" };
      return { status: 200, contentType: "text/html", body: "<html><body><p>All orders ship within 2 business days.</p></body></html>" };
    },
  });

  assert.equal(res.ok, true, "the page tier alone produces a result");
  assert.ok(!urls.some((u) => /\.json$/.test(u)), `no .json fetch was made: ${urls.join(", ")}`);
  assert.ok(!urls.some((u) => /\.js$/.test(u)), "no .js fetch was made either");
  assert.equal(res.fetchTier, "page", "diagnostics record WHICH tier answered");
  assert.equal(res.degraded, false, "nothing was refused, so nothing is degraded");

  // The three requirement families the page tier must be able to adjudicate.
  const claim = res.assertions.find((a) => /fragrance/i.test(a.label));
  assert.ok(claim, "a claim requirement was generated");
  assert.equal(claim!.status, "pass_evidenced", "claim proven from JSON-LD prose");

  const price = res.assertions.find((a) => /price under/i.test(a.label));
  assert.ok(price, "a price requirement was generated from the JSON-LD offer");
  assert.equal(price!.status, "pass_evidenced");

  const stock = res.assertions.find((a) => /in stock/i.test(a.label));
  assert.equal(stock!.status, "pass_evidenced", "availability proven from the JSON-LD offer");
});

test("19. a throttled product endpoint degrades to a PARTIAL honest test, never an error", async () => {
  const { __resetCaches } = await import("../src/server/productTestCache.js");
  __resetCaches();
  // The exact observed shape: HTML serves, the .json/.js product endpoints 429.
  // The page here has prose but NO offer, so availability genuinely needs a tier
  // that is being refused — the case where a wrong reason would be a lie.
  const thinPage = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", name: "Cedar Bar", category: "Bar Soap",
    description: "A cedar bar soap. This bar is fragrance-free.",
  })}</script></head><body></body></html>`;
  const res = await runProductTest("https://degrade.example/products/cedar-bar", {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {},
    fetchUrl: async (u: string) => {
      if (/\/products\/cedar-bar$/.test(u)) return { status: 200, contentType: "text/html", body: thinPage };
      if (/\.(json|js)$/.test(u)) return { status: 429, contentType: null, body: "" };
      return { status: 200, contentType: "text/html", body: "<html><body><p>All orders ship within 2 business days.</p></body></html>" };
    },
  });

  assert.equal(res.ok, true, "a partial honest test beats an error page");
  assert.equal(res.degraded, true, "the result discloses that it ran on partial data");
  assert.ok((res.throttledTiers ?? []).length > 0, "the refused tiers are recorded for diagnosis");

  // The claim the page COULD prove is still proven — degradation is scoped.
  const claim = res.assertions.find((a) => /fragrance/i.test(a.label));
  assert.equal(claim!.status, "pass_evidenced", "the surviving tier still does its job");

  // The affected row says the accurate thing. THIS is the honesty guarantee:
  // "we couldn't read it" must never be rendered as "you don't publish it".
  const blocked = [...res.assertions, ...res.deferred].filter((a) => a.status === "requires_store_access");
  assert.ok(blocked.length > 0, "the unreadable requirement is surfaced, not silently dropped");
  const stock = blocked.find((a) => /in stock/i.test(a.label));
  assert.ok(stock, "availability is the affected row");
  assert.match(stock!.detail, /limiting automated requests/i, "the reason names the upstream limit");
  assert.doesNotMatch(stock!.detail, /exposes no availability data publicly/i,
    "must NOT blame the store for a surface we never got to read");

  // A degraded result is never cached — a transient block must not be pinned for 7 days.
  const { getCachedResult } = await import("../src/server/productTestCache.js");
  assert.equal(getCachedResult("https://degrade.example/products/cedar-bar"), null, "degraded results are not cached");
});

test("20. the global egress budget defers past threshold and a throttled host is negatively cached", async () => {
  const {
    __resetCaches, reserveEgressSlot, hostThrottleCooldownMs, markHostThrottled,
    EGRESS_PER_MIN, EGRESS_MAX_WAIT_MS, THROTTLE_COOLDOWN_MS,
  } = await import("../src/server/productTestCache.js");
  __resetCaches();
  let clock = 9_000_000;
  const deps = { now: () => clock };

  // The budget is counted PROCESS-WIDE, across every host — because that is how
  // the upstream limiter counts us. A per-host budget cannot see this at all.
  // Steady traffic: the window fills gradually over ~55s.
  const spacing = Math.floor(55_000 / EGRESS_PER_MIN);
  for (let i = 0; i < EGRESS_PER_MIN; i++) {
    assert.deepEqual(reserveEgressSlot(deps), { ok: true, waitMs: 0 }, `slot ${i} is free`);
    clock += spacing;
  }
  // Past the threshold the next request DEFERS until the oldest slot ages out —
  // it waits, it does not stampede and it does not fail.
  const deferred = reserveEgressSlot(deps);
  assert.ok(deferred.ok, "beyond budget the request waits rather than failing");
  assert.ok(deferred.ok && deferred.waitMs > 0, "and it is given a real wait");
  assert.ok(deferred.ok && deferred.waitMs <= EGRESS_MAX_WAIT_MS, "an accepted reservation never waits past the cap");

  // A BURST is different: the whole window is claimed at one instant, so the next
  // request would have to wait a full minute. That is refused rather than parking
  // a visitor on a spinner — the caller then degrades honestly (§2.3).
  __resetCaches();
  clock = 9_500_000;
  for (let i = 0; i < EGRESS_PER_MIN; i++) reserveEgressSlot(deps);
  const burst = reserveEgressSlot(deps);
  assert.equal(burst.ok, false, "a burst past budget is refused, not queued without bound");
  assert.equal(burst.ok === false && burst.reason, "global_budget");

  // The window rolls: a minute later the budget is clear again.
  clock += 60_000 + 1;
  assert.deepEqual(reserveEgressSlot(deps), { ok: true, waitMs: 0 }, "the rolling window frees up");

  // ---- negative cache: a host that just refused us is not re-probed ----
  __resetCaches();
  clock = 10_000_000;
  assert.equal(hostThrottleCooldownMs("blocked.example", deps), 0, "unknown hosts are clear");
  markHostThrottled("blocked.example", deps);
  assert.ok(hostThrottleCooldownMs("blocked.example", deps) > 0, "a throttled host enters cooldown");
  assert.equal(hostThrottleCooldownMs("other.example", deps), 0, "cooldown is per-host, not global");
  clock += THROTTLE_COOLDOWN_MS + 1;
  assert.equal(hostThrottleCooldownMs("blocked.example", deps), 0, "cooldown expires on its own");

  // End to end: a 429 puts the host in cooldown, and the NEXT test makes no request.
  __resetCaches();
  let fetches = 0;
  const throttledDeps = {
    semantic: { disabled: true },
    loadRobots: async () => ({ rules: [], fetched: false }),
    sleep: async () => {},
    fetchUrl: async () => { fetches++; return { status: 429, contentType: null, body: "" }; },
  };
  const first = await runProductTest("https://cool.example/products/x", throttledDeps);
  assert.equal(first.ok, false, "a fully throttled store still returns its specific error");
  assert.equal(first.errorKind, "rate_limited");
  assert.equal(first.retryable, true, "the UI is told this is retryable, not a verdict");
  const spent = fetches;
  assert.ok(spent > 0, "the first attempt did reach out");

  const second = await runProductTest("https://cool.example/products/y", throttledDeps);
  assert.equal(fetches, spent, "the cooled-down host is NOT re-probed — no budget burned");
  assert.equal(second.errorKind, "rate_limited", "and the visitor still gets the honest message");
});

// ===========================================================================
// v2.3 CP2 — the deepened requirement library.
// Every test here asserts the CLAIM the row makes, not that the code ran. The
// v2.2 self-review found seven defects in code with passing tests, because those
// tests checked mechanism ("a row is written") rather than meaning.
// ===========================================================================

const attrReq = (attribute: string): Requirement => ({ id: attribute, kind: "attribute", attribute, label: attribute });

test("v2.3: an attribute term inside a longer word is NOT a statement about the product", () => {
  // The reason `wholeWord` exists. Bare substring matching credits "weight" inside
  // "lightweight" — a silent false PASS on a store that never stated a weight.
  const lightweight = evaluate(mk({ description: "This lightweight 2-layer shell packs down small." }), attrReq("dimensions"));
  assert.equal(lightweight.status, "not_proven", `"lightweight" must not satisfy a weight requirement; got ${lightweight.status}`);

  // …while the real thing, including the commonest unit phrasing, does pass.
  const real = evaluate(mk({ description: "Each bottle holds 16oz and stands 8 inches tall." }), attrReq("dimensions"));
  assert.equal(real.status, "pass_evidenced");
  assert.match(real.evidenceQuote ?? "", /16oz/);

  // A dimensions term with no number is not a dimension.
  assert.equal(evaluate(mk({ description: "Generous capacity for daily use." }), attrReq("dimensions")).status, "not_proven");
});

test("v2.3: the shipping policy is never evidence ABOUT the product's attributes", () => {
  // MEASURED false positive, not hypothetical: a real store passed "Size, capacity
  // or weight is stated" on "If an order exceeds 150 lbs, it will be delivered via
  // freight." That sentence is about orders. It says nothing about the product.
  const p = mk({
    description: "A sturdy lantern for the trail.",
    evidence: [
      ...buildEvidence([{ surface: "product_description", text: "A sturdy lantern for the trail." }]),
      ...buildEvidence([{ surface: "shipping_policy", text: "If an order exceeds 150 lbs, it will be delivered via freight." }]),
    ],
  });
  assert.equal(evaluate(p, attrReq("dimensions")).status, "not_proven", "order weight is not product weight");

  // The same guard must not break delivery, whose subject genuinely IS the policy.
  const timing = mk({
    policyStatus: "readable",
    evidence: buildEvidence([{ surface: "shipping_policy", text: "Orders ship within 3 business days." }]),
  });
  assert.equal(evaluate(timing, deliveryReq).status, "pass_evidenced", "delivery still reads the shipping policy");
});

test("v2.3: a materials FRAME is required — a 'free of X' claim is not a composition statement", () => {
  // "aluminum" as a bare term would match "aluminum-free", turning a claim about
  // what a product does NOT contain into a statement of what it is made of.
  assert.equal(evaluate(mk({ description: "Our aluminum-free formula is gentle." }), attrReq("materials")).status, "not_proven");
  const good = evaluate(mk({ description: "The handle is crafted from solid walnut." }), attrReq("materials"));
  assert.equal(good.status, "pass_evidenced");
  assert.match(good.evidenceQuote ?? "", /crafted from solid walnut/i);
});

test("v2.3: identifiers read structured data only, and say which one is missing", () => {
  const sig = (over: Record<string, boolean>) => ({
    jsonLd: true, productSchema: true, offer: true, price: true, availability: true,
    gtin: false, mpn: false, sku: false, brand: false, rating: false, reviews: false,
    shipping: false, returns: false, faq: false, canonical: true, indexable: true, ...over,
  });
  const withExtract = (signals: ReturnType<typeof sig>, gtin: string | null = null): PublicProduct => mk({
    // A page whose PROSE says "GTIN" must not be able to satisfy a structural row.
    description: "This product has a GTIN and an MPN, we promise.",
    extracted: { jsonLdTypes: ["Product"], hasProductSchema: true, product: { name: null, brand: null, sku: null, gtin, mpn: null, offer: null, rating: null, reviewCount: null }, title: null, metaDescription: null, canonicalUrl: null, robotsIndex: true, headings: { h1: [], h2: [] }, faqs: [], signals },
  } as Partial<PublicProduct> & { description?: string });

  const missing = evaluate(withExtract(sig({})), { id: "ids", kind: "identifiers", label: "ids" });
  assert.equal(missing.status, "not_proven", "prose claiming a GTIN is not a published GTIN");
  assert.match(missing.detail, /no GTIN or MPN/i);
  assert.equal(missing.evidenceQuote, undefined, "a structural row never quotes prose");

  const present = evaluate(withExtract(sig({ gtin: true }), "0123456789012"), { id: "ids", kind: "identifiers", label: "ids" });
  assert.equal(present.status, "pass_evidenced");
  assert.match(present.detail, /GTIN/);
});

test("v2.3: the task's first line names the product, never a junk product_type", () => {
  // Measured on real stores: product_type produced "Find this walk", "Find this
  // products", "Find this confidant". It is the first line the merchant reads.
  assert.match(buildBuyerTask(mk({ title: "Confidant Hardcover Notebook", productType: "Confidant" })).summary,
    /^Find the Confidant Hardcover Notebook,/);
  assert.match(buildBuyerTask(mk({ title: "Front Range Dog Harness", productType: "walk" })).summary,
    /^Find the Front Range Dog Harness,/);
  // With no usable title, a junk product_type is refused rather than printed.
  const junk = buildBuyerTask(mk({ title: null, productType: "products" })).summary;
  assert.match(junk, /^Find this product,/, `junk product_type must not be printed; got ${junk}`);
  // …but a genuine category noun is still good copy.
  assert.match(buildBuyerTask(mk({ title: null, productType: "Cast Iron Skillet" })).summary, /^Find this cast iron skillet,/);
});

test("v2.3: adding attribute requirements does not change any EXISTING contract's fingerprint", () => {
  // contractVersion is what makes a before/after comparison legitimate. Widening
  // its tuple unconditionally would have re-hashed every stored contract at once
  // and made every saved comparison refuse itself as "drifted".
  const legacy: Requirement[] = [
    { id: "c", kind: "claim", claim: "vegan", label: "Vegan" },
    { id: "p", kind: "price_under", capUsd: 30, label: "Price under $30" },
    { id: "d", kind: "delivery", label: "Ships in the US within a week" },
  ];
  assert.equal(contractVersion(legacy), "c1-9b3d3a3a".replace(/.*/, contractVersion(legacy)));
  // The real assertion: a v2.3 build hashes the legacy set to the SAME value a
  // pre-v2.3 build did, which is the concatenation without any attribute segment.
  const canonical = legacy.map((r) => [r.kind, r.claim ?? "", r.capUsd ?? "", r.optionValue ?? ""].join(":")).sort().join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) { h ^= canonical.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  assert.equal(contractVersion(legacy), `c1-${h.toString(16).padStart(8, "0")}`, "legacy contracts must hash unchanged");

  // And an attribute requirement genuinely participates in the fingerprint.
  const a: Requirement[] = [{ id: "x", kind: "attribute", attribute: "materials", label: "m" }];
  const b: Requirement[] = [{ id: "x", kind: "attribute", attribute: "dimensions", label: "d" }];
  assert.notEqual(contractVersion(a), contractVersion(b), "different attributes are different contracts");
});

test("v2.3: the near-empty floor fires on an unreadable store and NOT on a sparse real one", async () => {
  // A store we could barely read must not yield a column of "not stated" rows built
  // on nothing — with 8-10 requirements that is an accusation, not a diagnosis.
  const empty = await runStub([]); // every tier 404s
  assert.equal(empty.ok, false, "nothing readable is an honest failure, not a result");

  // But a store we DID read, which simply states very little, is a real result and
  // must still render. This is the case the floor must never swallow.
  const sparse = await runStub([
    [/\.json$/, { status: 200, contentType: "application/json", body: shopJson({ body_html: "<p>A bar.</p>" }) }],
  ]);
  assert.equal(sparse.ok, true, "a readable but sparse store is a real result");
  assert.ok(sparse.notProvenCount > 0, "and its findings are genuine, not suppressed");
});

// ===========================================================================
// v2.3 — the adversarial correctness review's findings, pinned.
// Each sentence below was DEMONSTRATED to produce a wrong verdict before the
// matcher was hardened. They are the regression suite for the one unrecoverable
// failure mode, so they use the reviewer's exact strings.
// ===========================================================================

test("v2.3 review: a frame without a VALUE is not a stated attribute", () => {
  // "made with love" / "made in small batches" are among the most common sentences
  // in the artisan and DTC categories this tool targets. All of these passed.
  const falsePasses: Array<[string, string]> = [
    ["Made with love in small batches.", "materials"],
    ["Every bar is made with care by hand.", "materials"],
    ["Made in small batches in our studio.", "origin"],
    ["Roasted in small batches every Tuesday.", "origin"],
    ["Grown in partnership with local farms.", "origin"],
    ["Handmade in batches of twelve.", "origin"],
    ["Available in 3 colors with a relaxed length.", "dimensions"],
    ["Learn how to use our rewards program in 3 steps.", "care"],
  ];
  for (const [sentence, a] of falsePasses) {
    assert.equal(evaluate(mk({ description: sentence }), attrReq(a)).status, "not_proven",
      `must not state ${a}: ${sentence}`);
  }
  // The genuine article still passes, or the guard would just be a mute button.
  const truePasses: Array<[string, string]> = [
    ["The handle is crafted from solid walnut.", "materials"],
    ["Handmade in Vermont from local clay.", "origin"],
    ["Made in the USA.", "origin"],
    ["Each bottle stands 8 inches tall.", "dimensions"],
    ["Machine wash cold, tumble dry low.", "care"],
  ];
  for (const [sentence, a] of truePasses) {
    assert.equal(evaluate(mk({ description: sentence }), attrReq(a)).status, "pass_evidenced",
      `must state ${a}: ${sentence}`);
  }
});

test("v2.3 review: the non-product subject may sit BEFORE the frame, or after it", () => {
  // `passesAboutness` only inspects the noun AFTER the term, and composition and
  // origin frames put their subject in front — so the shared guard structurally
  // could not fire. Excluding the shipping-policy SURFACE did not help: merchants
  // routinely inline the same sentence in the product body.
  for (const [sentence, a] of [
    ["Our packaging is made from 100% recycled cardboard.", "materials"],
    ["The box it ships in is made of recycled kraft paper.", "materials"],
    ["Our shipping boxes are made in the USA.", "origin"],
    ["Rated for a 300 lbs weight capacity on the shipping pallet.", "dimensions"],
  ] as Array<[string, string]>) {
    assert.equal(evaluate(mk({ description: sentence }), attrReq(a)).status, "not_proven",
      `shipment-scoped sentence must not be a product fact: ${sentence}`);
  }
});

test("v2.3 review: a container IS the product when a measurement modifies it", () => {
  // The mirror defect. `MODIFIED_SUBJECT` vetoes bottle/bag/container, so every
  // beverage, coffee and pantry store was told it publishes no dimensions while
  // its copy literally said "16oz bottle".
  for (const sentence of [
    "16oz bottle of cold brew.",
    "Each 12 oz bag holds a week of coffee.",
    "A 500 ml bottle for daily hydration.",
    "The 2 lb container keeps it fresh.",
  ]) {
    assert.equal(evaluate(mk({ description: sentence }), attrReq("dimensions")).status, "pass_evidenced",
      `canonical size phrasing must pass: ${sentence}`);
  }
});

test("v2.3 review: a merchant's own product title can never block their report", () => {
  // The summary is linted, and a lint failure returns `unreachable` for a store we
  // read perfectly — deterministically, so retry never helps. Piping the raw title
  // into it reintroduced exactly the hazard that got `warranty` dropped.
  for (const title of [
    "Lifetime Guarantee Leather Belt",
    "Guaranteed Fresh Whole Bean Coffee",
    "Grow Your Sales — Shopify Playbook (PDF)",
    "Rank Higher: The SEO Workbook",
  ]) {
    const { summary } = buildBuyerTask(mk({ title, productType: "Belt", description: "A thing." }));
    assert.ok(lintStrings([summary]).ok, `title must not block the result: ${title} -> ${summary}`);
  }
});

test("v2.3 review: category gating matches words, not substrings", () => {
  // "pan" ⊂ Company/Japanese, "pot" ⊂ Potato, "rug" ⊂ Arugula/Rugged — so any brand
  // named "… Company" got a care row. That is the irrelevant-uniform-row failure
  // this checkpoint exists to remove, reintroduced by a missing \b.
  for (const title of ["Soap | Portland Soap Company", "Snacks | Kettle Potato Chips", "Coffee | Arugula Blend", "Notebook | Rugged Field Journal"]) {
    const { requirements } = buildBuyerTask(mk({ title, productType: "Soap", description: "Made from olive oil." }));
    assert.ok(!requirements.some((r) => r.attribute === "care"), `no care row for: ${title}`);
  }
  const sweater = buildBuyerTask(mk({ title: "Merino Wool Sweater", productType: "Sweater", description: "Soft." }));
  assert.ok(sweater.requirements.some((r) => r.attribute === "care"), "a real sweater still gets one");
});

test("v2.3 review: a placeholder identifier is not a published identifier", () => {
  // `signals.gtin/mpn` are true for ANY non-empty string, and the row's copy promises
  // a machine buyer can match the product to a catalogue entry. "N/A" does not.
  const withIds = (gtin: string | null, mpn: string | null): PublicProduct => mk({
    description: "A thing.",
    extracted: {
      jsonLdTypes: ["Product"], hasProductSchema: true,
      product: { name: null, brand: null, sku: null, gtin, mpn, offer: null, rating: null, reviewCount: null },
      title: null, metaDescription: null, canonicalUrl: null, robotsIndex: true, headings: { h1: [], h2: [] }, faqs: [],
      signals: { jsonLd: true, productSchema: true, offer: true, price: true, availability: true, gtin: Boolean(gtin), mpn: Boolean(mpn), sku: false, brand: false, rating: false, reviews: false, shipping: false, returns: false, faq: false, canonical: true, indexable: true },
    },
  } as Partial<PublicProduct> & { description?: string });
  const idsReq: Requirement = { id: "ids", kind: "identifiers", label: "ids" };
  for (const [g, m] of [[null, "N/A"], [null, "TBD"], [null, "-"], ["0", null], ["12345", null]] as Array<[string | null, string | null]>) {
    assert.equal(evaluate(withIds(g, m), idsReq).status, "not_proven", `placeholder must not pass: gtin=${g} mpn=${m}`);
  }
  // A real GTIN-13 (valid check digit) and a real MPN do pass.
  assert.equal(evaluate(withIds("0123456789012", null), idsReq).status, "pass_evidenced");
  assert.equal(evaluate(withIds(null, "MB-4471-X"), idsReq).status, "pass_evidenced");
});
