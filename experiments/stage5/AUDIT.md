# STAGE 5 — PHASE 0E — Public-Data Feasibility Audit

Date: 2026-07-23 · Branch `feat/diagnostic-acquisition-stage5` (off tag
`agentic-instrument-mvp-v1`). Read-only probes of 3 real public Shopify stores
in the target category (deodorant/natural skincare), rate-limited ≥2 s/host,
descriptive UA. Stores are referred to here as **A/B/C** (real hosts stay in
the gitignored output; this committed file is anonymized).

## 1. Surfaces the public endpoints expose

`/products.json?limit=250` returned **HTTP 200 application/json** on all three
hosts (13–21 KB per page). Per-product fields present:

| Surface | Public `/products.json`? | Stage 2–4 name | Public disposition |
|---|---|---|---|
| title | ✅ | product_title | inspectable |
| body_html | ✅ (0–160 chars observed) | product_description | inspectable (HTML → strip) |
| variants (price, available, sku, options) | ✅ | product_variants | inspectable |
| options | ✅ | product_options | inspectable |
| tags, product_type, images | ✅ | (context) | inspectable |
| **metafields** | ❌ **NOT public** | product_metafields | **`not_inspectable`** |

**Honest degradation (Rule 4 + spec 4.3):** `product_metafields` is absent from
every public endpoint by Shopify's design. A public diagnostic must report it as
**"not inspectable from public data"** — NEVER as "missing" or "absent". The
Stage 2–4 deodorant contract listed `product_metafields` among `aluminum_free`'s
acceptable surfaces; on public data that surface is demoted to `not_inspectable`,
and the attribute stays inspectable through `product_description` + `structured_data`.

## 2. Product-page JSON-LD (structured_data)

`/products/<handle>` (HTML) contained **2 `application/ld+json` blocks with a
`"@type":"Product"`** on the test host. Retrievable, but the page is **heavy
(0.7–0.9 MB)** — parsing cost is one bounded fetch + a `<script type=…ld+json>`
regex + JSON.parse. Stage 5 fetches the product page ONLY when a contract needs
`structured_data` and robots permits, byte-capped; JSON-LD is parsed for
Product `name`/`description`/`offers` only.

## 3. Policy / FAQ reachability

`/policies/shipping-policy` returned **200** (also heavy HTML, ~0.7 MB). robots
does not disallow `/policies/*`. `/pages/*` (FAQ) is store-specific and NOT
standardized — treated as `not_inspectable` unless a known page path resolves.
Stage 5 fetches a policy page only when a contract's constraint needs
`shipping_policy`/`returns_policy` and robots permits; otherwise that surface is
`not_inspectable`.

## 4. Deterministic Shopify-host detection

Signal used (read-only, no auth): `GET /products.json?limit=1` returns **HTTP
200**, `content-type: application/json`, and a body that parses to an object with
a `products` **array**. This is Shopify-specific (the endpoint is a Shopify
storefront convention) and addressable. Secondary confirmation when available:
`x-shopify-*`/`powered-by` response headers or `cdn.shopify.com` asset hosts.
A domain that fails the `/products.json` probe is not added to the prospect list.

## 5. Rate-limit / error behavior observed

All three hosts: 200 on every allowed endpoint, 150–280 ms latency, no 403/429
at ≤1 req / 2 s. Stage 5's fetcher enforces: ≤1 req / 2 s per host, ≤10 requests
total per host, disk cache (no URL fetched twice), robots check before every
path, descriptive UA with a contact URL, skip-and-record on 403/429, and never
touches anything behind a password/login/checkout.

## Decision

**PROCEED.** Public product endpoints are broadly available and robots-permitted
on the category; the only Stage 2–4 surface lost is `product_metafields`
(handled by honest `not_inspectable` degradation, not failure). No abort
condition met.
