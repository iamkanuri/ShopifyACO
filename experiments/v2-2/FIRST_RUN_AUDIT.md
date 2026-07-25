# CP6 — the merchant's first five minutes

**Date:** 2026-07-25 · **Method:** code trace of the whole path plus DB-level reproduction of
each trap against the local stack. **Not** a live install: see §0.

> *"Instrumenting a broken funnel just measures the breakage precisely."* Everything below is
> state that is fine for an established install and **wrong on a fresh one**.

---

## 0. What could and could not be exercised, plainly

The dev store **`ai-visibility-dev-m2su2ozk.myshopify.com`** has a `shops` row (`status: active`)
but **no row in `shop_credentials`** — the offline token was deleted during the v2.1 CP3 cleanup,
exactly as `CP3_LIVE_WALK.md` records. Without a decryptable token nothing authenticated can run
locally: no catalog sync, no `rereadProduct`, no live first-run walk.

Re-establishing it means re-running OAuth against the dev store, which needs Partner-dashboard
credentials and a public callback — **owner actions, not something this session should initiate.**

So: the path was traced in code and every trap below was **reproduced at the database and unit
level** (`test/reconcileFirstRun.db.test.ts`, `test/fixes.test.ts`), which is where each one
actually lives. The two findings that need a real install to confirm are marked ⚠️.

---

## 1. The path, step by step

| # | Step | What the merchant sees | Status |
|---|---|---|---|
| 1 | Lands on `/test`, pastes a product URL | Buyer Test table in ~5–11 s (median 7.3 s measured, CP3) | ✅ |
| 2 | Clicks **"Connect Shopify to confirm, fix, and rerun"** | Opens the App Store listing in a new tab | ✅ (now instrumented, §3) |
| 3 | Installs from the App Store | Shopify managed install — **no call reaches us** (rule 2.3.1) | ✅ |
| 4 | First framed load of `/app` | App Bridge session token → `POST /api/shopify/token` → offline token → shop row | ✅ |
| 5 | The Tests screen mounts, calls `POST /app/api/buyer-tests/claim` | *"We couldn't find a recent public test to import for this store."* | ❌ **F1** |
| 6 | Falls back to an empty app | No products, no tests | ❌ **F2** |

---

## 2. Findings

### F1 — ⚠️ The host-match reconciliation cannot fire on a fresh install (the headline)

**The whole V2 "carry your test through install" promise fails for the merchant it was built for.**

`claimTestHandler` assembles candidate hosts as `[shop, getStorefrontUrl(shop)]`.
`getStorefrontUrl` reads `products.online_url` — and **nothing enqueues a catalog sync on
install**, so on a fresh install the `products` table is empty and it returns `null`. The only
candidate left is the `.myshopify.com` domain.

But a merchant tests their **real storefront** (`theirbrand.com`), so `public_tests.store_host`
is the custom domain and never the `.myshopify.com` one. **The two sets cannot intersect.**

It is not a bug in the matcher — the matcher is correct, and now has tests proving it handles
`www.`, case, and never re-binds another shop's test. The bug is that **the one input it needs
does not exist yet at the moment it is called.** And it only bites on the App Store path, which
rule 2.3.1 makes the *only* path a real merchant takes; our own OAuth redirect carries an exact
token and works fine, which is why this survived: every walkthrough to date used the token path.

`DEPLOY.md` described this fallback as *"built and unit-safe"*. It was built and had **no test at
all**. There are now five (`test/reconcileFirstRun.db.test.ts`), including one that pins this
defect so the fix has an executable definition of done.

**The fix** (scoped, not applied — it needs a live Shopify call and a mock, and shipping that
untested at the end of a long session is how bugs get deployed): resolve the storefront host from
Shopify at install time — `{ shop { myshopifyDomain primaryDomain { host } } }` — and persist it
on `shops`. That single value makes the fallback work and also removes the dependency on a synced
catalog. `claimPublicTestByHost` already accepts a host list, so the change is one query, one
column, and the call site.

### F2 — Nothing triggers a catalog sync on install

A freshly installed shop has an empty `products` table until someone POSTs
`/app/api/catalog/sync` or a product webhook happens to fire. Everything downstream degrades:
`getStorefrontUrl` → null (causing **F1**), the authenticated Buyer Test has no product to match,
and Fix Studio's product picker is empty.

Compounding it: with the job queue dormant (`JOB_QUEUE_ENABLED` unset — the production default)
`triggerSyncHandler` runs the sync **inline inside the HTTP request**, with no timeout guard. So
the obvious fix — "sync on install" — must go through the queue or it turns the first screen into
a long blocking request. That is the trap the brief predicted ("a slow first sync blocking the
first screen"), and it is why F1's fix should resolve the domain from the Shopify API rather than
by forcing a sync.

### F3 — A stale catalog row produced a body proposal that would have replaced the whole description ✅ FIXED

`products.description_html` is NULL on every row synced before migration `0027`, while
`products.description` still holds the stripped text. `proposeClaimStatement` read
`p.descriptionHtml ?? ""` and **could not tell "the body is empty" from "we never captured the
body"** — so for a stale row it proposed the confirmed sentence **as the entire body**.

Apply's conflict guard caught it every time (`"" !== "<the real body>"`), so nothing was ever
destroyed. But the brief's framing — *"that refusal is the guard working correctly, but it looks
like a bug"* — undersold it: the guard was catching a **wrong proposal**, not an unlucky one.

**Fixed three ways:** the proposer refuses when the raw body is unknown-but-non-empty; the propose
route first re-reads that one product and mirrors it back into the catalog (self-healing, no
merchant action); and if it still cannot be resolved the merchant gets a distinct, actionable
message — *"We hold an out-of-date copy of this product's description, so we won't propose a
change to it… Sync your catalog and try again"* — instead of the previous
*"your description already states this"*, **which would have been false.** Regression tests in
`test/fixes.test.ts`, mutation-verified.

### F4 — Fix Studio's product picker has no empty state

`GeneratePanel` calls `getCatalog()` with no limit (first 50 products, alphabetical) and renders
**no message at all** when the catalog is empty — just a dead dropdown and a disabled button.
On a fresh install that is the *only* thing the screen shows. **Not fixed** (UI-only, and F2 is
the real cause). Logged.

### F5 — `install_completed` had no measurement at all ✅ FIXED

There was no way to tell "nobody installs" from "installs happen and reconciliation fails" — the
two have completely different fixes, and F1 means the second is what is actually happening.
`completeInstall` now records `install_completed` with a `reconciled` flag.

That flag is deliberately a **read-only probe** (`hasMatchablePublicTest`), not a claim. Claiming
at install would set `public_tests.shop_domain`, which would make the very next call —
`claimTestHandler` on the first `/app` load — report *"nothing to import"* and break the landing
it exists to guarantee. The probe answers the narrower, honest question: *was a prior test
matchable at install time.* Tested (`hasMatchablePublicTest probes without claiming`).

---

## 3. What is now honest that was not

- **The install click is measured.** It leaves for a Shopify-owned surface and hits no route of
  ours, so it was invisible; a `sendBeacon` now records it with the originating test token.
  Without it, "nobody clicked" and "clicking doesn't convert" were indistinguishable.
- **A mistyped case link 404s instead of silently serving the homepage.** Found by running the
  route, not by reading it: `/c/<bad-token>` returned HTTP 200 and the marketing site, because
  the SPA catch-all only defers `/api` paths. A broken outreach link would have looked like it
  worked.
- **Refusals explain themselves.** F3's message names the cause and the action.

## 4. Not fixed, deliberately

| # | Why |
|---|---|
| F1 | Needs a live Shopify query + mock parity + tests. Pinned by a failing-by-design test; the fix is one query, one column, one call site. |
| F2 | Correct fix is queue-based; doing it inline is worse than not doing it. |
| F4 | UI-only, and F2 is the cause. |
| Task noun | *"Find this **walk**"* / *"**confidant**"* — the merchant's own `product_type`. Cosmetic but it is the first line they read (CP3 §8). |
