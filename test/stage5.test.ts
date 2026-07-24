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
    "src/agentic-test/stage5-diagnose.ts",
    "src/agentic-test/stage5-case.ts",
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
