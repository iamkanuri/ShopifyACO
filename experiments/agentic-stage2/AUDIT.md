# AGENTIC INSTRUMENT TEST — STAGE 2 — Phase 0B Real-Store Path Audit

Date: 2026-07-21 · Branch: `feat/agentic-instrument-stage2` (off stage-1 head `0bd27a8`)
Status: **STOP — human action required before any experiment code runs** (decision below).

## 1. Can existing ingestion reach the real dev store with env credentials?

**No.** Verified empirically, read-only:

- The only Shopify credential in local `.env` is `SHOPIFY_APP_AUTOMATION_TOKEN`, an
  `atkn_…` **Shopify CLI/Partners automation token** (for `shopify app deploy`
  automation). It is not an Admin API access token: a read-only
  `{ shop { name } }` GraphQL probe against
  `https://ai-visibility-dev.myshopify.com/admin/api/2026-01/graphql.json`
  returned **HTTP 401 "Invalid API key or access token"**.
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` are not in local `.env` (they exist only
  in production), so the app's OAuth path cannot mint a dev-store token locally.
- The dev store's production offline token lives in the **production** database and
  is explicitly out of bounds (Stage 2 Rule 8 principle + `.env.prod.bak` is never
  to be exposed; Stage 1 established the local stack as the only experiment DB).

**Exact code path that WILL work once a token exists** (identical shape to Stage 1's
mock seed, proven by the repo's own `test/catalog.test.ts`):
`upsertShop(DEV_SHOP)` → `storeCredentials(DEV_SHOP, <token>)` →
`syncCatalog(DEV_SHOP)` (`src/catalog/sync.ts`), with `SHOPIFY_MODE=live` (default)
so `fetchProductsPage` (`src/catalog/source.ts`) pages the **real GraphQL Admin
API** into the local Supabase stack. **Missing item, precisely: a dev-store Admin
API access token (`shpat_…`) with the read-only `read_products` scope, provided as
`SHOPIFY_DEV_STORE_TOKEN` in `.env`.** Creation steps are in the handoff kit below.

## 2. Surfaces real ingestion actually captures

From `src/catalog/source.ts` `PRODUCTS_QUERY` + `src/catalog/normalize.ts` (verified
by reading the query; no pages/policy query exists anywhere in `src/` — grep for
`shippingPolicy|refundPolicy|pages(|read_content` returns nothing):

| Surface | Present in real ingestion? | Notes |
|---|---|---|
| product_title | ✅ | |
| product_description | ✅ | `descriptionHtml` → `stripHtml` plain text |
| product_variants | ✅ | id, title, sku, barcode, **price**, `availableForSale`, selectedOptions. ⚠️ `inventoryQuantity` is NOT queried — availability is the boolean only; F3 flips `available=false` (sufficient). |
| product_options | ✅ | via variant `selectedOptions` |
| product_metafields | ✅ | first 20, namespace/key/value/type |
| structured_data | ❌ absent | → **Appendix B F4 fallback**: skew a price-bearing metafield (see addendum below) |
| faq (pages) | ❌ absent | **no fallback documented for c4/c5/F2/F5 — see §4 conflict** |
| shipping_policy / returns_policy | ❌ absent | same conflict |

## 3. Does the dev store contain a usable Stage 2 product?

**Unknowable without credentials** (the 401 blocks any read). Judging from the
app's history the dev store has incidental test content, not the Stage 2 contract
content (2×2 variants w/ stock, subscription language, claim attribute, FAQ,
shipping-timing policy). The handoff therefore bundles the Appendix A seeding kit
with the token step — one human round-trip instead of two.

## 4. Contract-vs-reality conflict that must be surfaced (not improvised around)

Stage 2's contract assumes FAQ and shipping-policy text flows through catalog
ingestion (c5's `acceptableSurfaces` are ONLY `shipping_policy`/`faq`; F2's
mutation contradicts the FAQ; F5 removes policy sentences; Appendix A seeds
"Pages/Policies" and then says "the human runs the catalog sync"). **Reality: the
app's catalog ingestion has no pages/policies path at all** (§2), and building one
is explicitly banned ("not new ingestion code"). The store is also
password-protected, so the Phase-5 crawler cannot fetch its public pages either.
Without a resolution, c5 can never resolve → BASE cannot PASS → the gate fails
structurally, telling us nothing.

**Proposed resolution (awaiting human confirmation, mirroring the contract's own
Appendix C fixture-loader allowance):** the FAQ + shipping-policy text you seed in
Shopify admin is ALSO carried into the snapshot via a local fixture file read by a
fixture loader (permitted shape: "a fixture loader is permitted; new live-ingestion
code is not"). The file is pre-written at
`experiments/agentic-stage2/fixtures/store-pages.json` with the **exact Appendix A
text** — if you seed the admin pages with that text verbatim, nothing to edit; if
you change any wording in admin, mirror it in the fixture. Snapshot provenance will
mark these surfaces `source: seeded-fixture (ingestion has no pages/policies path)`
and the report will disclose it. Your "seeded" reply confirms this resolution.

## 5. Seed-kit addendum (deviation, with reason)

Appendix B's F4 fallback ("skew a price-bearing metafield") requires BASE to HAVE a
price-bearing metafield, which Appendix A does not seed. **Addendum: one extra
metafield on the primary product — namespace `custom`, key `price`, type
single-line text, value `$14.00`** (truthful; equals the variant price). F4 then
skews the snapshot copy to `$24.00` so two price surfaces disagree. Recorded here
and in the mutation manifest as the documented substitution.

## Decision (per Section 2 decision tree)

Ingestion **cannot reach** the dev store (missing credential) AND the catalog
content is unverifiable/likely unseeded AND the pages/policies conflict needs the
human's sign-off on the fixture resolution → **STOP. Hand the human the seeding
kit + token instructions; resume on "seeded".** No experiment code beyond this
audit is written in this turn (CP1 starts after resume).

---

# HANDOFF KIT (human actions — est. 20–30 min total)

## Step 1 — Create a read-only Admin API token for the dev store (~5 min)

1. Open **ai-visibility-dev.myshopify.com** admin → **Settings → Apps and sales
   channels → Develop apps** (enable custom app development if prompted).
2. **Create an app** — name it e.g. `aislelens-stage2-local-ingest`.
3. **Configure Admin API scopes**: check **`read_products`** ONLY (least
   privilege; the experiment never writes and with this scope cannot).
4. **Install app**, then reveal the **Admin API access token** (`shpat_…`) once.
5. Add to the repo's local `.env` (never committed):
   `SHOPIFY_DEV_STORE_TOKEN=shpat_…`

## Step 2 — Seed the dev store (Shopify admin, manual; ~15 min)

Content is deliberately realistic and truthful; write it EXACTLY as below.

**Product 1: "Cedar Hollow Natural Deodorant"** (primary)
- Description (rich text):
  "Small-batch deodorant made in Florida for people who read ingredient labels. Our aluminum-free formula uses arrowroot and magnesium hydroxide to keep you fresh through a Tampa summer, with no baking soda to irritate sensitive skin. Every stick is a one-time purchase, no subscription required, and we never auto-enroll you in anything. Glides on clear, no white marks on dark shirts. If cedar isn't your thing, the Unscented version has zero added fragrance."
- Options: **Scent** (Cedar & Sage, Unscented) × **Size** (2.5 oz, 1 oz Travel) →
  four variants, ALL priced **$14.00**, ALL in stock (inventory ≥ 5, tracked).
- Metafield 1: namespace `custom`, key `aluminum_free`, type boolean (or
  single-line text), value `true`.
- Metafield 2 (addendum, see audit §5): namespace `custom`, key `price`,
  single-line text, value `$14.00`.

**Product 2: "Harbor Lane Shave Soap"** (secondary)
- Description: "A 100% vegan shave soap with a sandalwood finish, whipped for a dense lather. Tallow-free and palm-free, $24 a puck, made to order weekly."
- One variant, **$24.00**, in stock.

**Pages/Policies** (seed in admin for store truthfulness; they reach the snapshot
via the pre-written fixture, since catalog ingestion has no pages path — audit §4):
- FAQ page (title "FAQ"): "Do you offer returns? Yes. Free returns within 30 days of delivery, no questions asked. Is this a subscription? No. Everything in the store is a one-time purchase. Are your deodorants aluminum-free? Yes, every formula we sell is aluminum-free and always will be."
- Shipping policy (Settings → Policies): "Orders placed before 2 PM ET ship the same day. Standard shipping arrives in 2 to 4 business days anywhere in the continental US. Tracking is emailed at fulfillment."

If you changed ANY wording above, mirror it in
`experiments/agentic-stage2/fixtures/store-pages.json`.

## Step 3 (OPTIONAL) — Wild probe capture (~5 min; skip freely)

Pick one real, public Shopify-hosted deodorant product that visibly claims
aluminum-free. Open `https://<store-domain>/products/<product-handle>.js` in a
browser, save the JSON verbatim to
`experiments/agentic-stage2/fixtures/wild-product.json`, and create
`experiments/agentic-stage2/fixtures/wild-meta.json` with `{ "sourceUrl": "…",
"captureDate": "…" }`. (The meta file will be gitignored; reports say only "wild
source".) If absent, WILD runs are skipped and noted.

## Step 4 — Resume

Reply **"seeded"** in this session. I will then: start Docker + the local Supabase
stack if down → verify the token read-only → run the real catalog sync through the
existing pipeline → verify the seeded content arrived → proceed with CP1.
