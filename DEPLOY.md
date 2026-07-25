# DEPLOY.md — ShopifyACO (Railway, single service)

---

# ▶ RELEASE (pending): v2.3 — close the install loop, and add depth that discriminates

**Branch:** `feat/v2-3-depth` · **Base:** `main` @ `50eb90a` (v2.2, deployed 2026-07-25)
**Migration:** `0029_shop_storefront_host` (additive, one nullable column)

## X.1 What it carries

- **The install loop now closes on the App Store path** (`FIRST_RUN_AUDIT.md` §F1).
  The storefront host is resolved from Shopify at install (`{ shop { myshopifyDomain
  primaryDomain { host } } }`) and persisted on `shops.storefront_host`, so host-match
  reconciliation no longer depends on a catalog sync that never ran. Mirrored in the mock
  client with a *different* primary host, so the whole path runs at $0 and actually proves
  something. A catalog sync is now enqueued on install — **through the queue, never
  awaited**, because inline is what `triggerSyncHandler` does when the queue is dormant.
- **Three telemetry corrections** that all distorted the same number: `reconciled` now
  counts the OAuth-token path (the one that works today), `callbackHandler` no longer
  re-emits `install_completed` on re-consent, and the probe stays read-only.
- **Requirement depth, measured** — new `attribute` (materials, dimensions, origin, care)
  and `identifiers` (GTIN/MPN) rows; table ceiling 6 → 10. Measured offline against 7 real
  captured storefronts: **median findings 1 → 3, thin-result rate 21% → 0%, and 7 distinct
  failing SETS across 7 stores.** Every shipped requirement sits inside the 15–85%
  discrimination band. See `experiments/v2-3/RESULT_QUALITY_2.md`.
- **First-impression fixes:** the task line now names the product (`product_type` produced
  *"Find this walk"*, *"Find this confidant"* on real stores); the delivery row is
  "Delivery timing is stated" (the old label overreached quotes about *processing* time);
  and a floor below which the tool says it could not read enough, rather than emitting a
  column of "not stated" rows built on nothing.

## X.2 What this release deliberately does NOT ship

- **`warranty`** was built, measured in-band (0.71), and **removed**. Its terms collide
  with the claim linter's `guarantee` rule, and the linter lints `evidenceQuote` — so a
  store whose copy said "30-day money-back guarantee" would have had its whole report
  blocked and returned as `unreachable`. Evidence sentences are now pre-filtered through
  the linter so merchant wording can never do that.

## X.3 Merge + push (run these yourself)

```bash
git fetch origin
git rev-parse origin/main                 # must equal 50eb90a…; if not, STOP and rebase
git checkout main && git merge --ff-only feat/v2-3-depth
git push origin main                      # Railway auto-builds + deploys
```

## X.4 Railway variables — none required

## X.5 Post-deploy verification

1. `/healthz` → `commit` matches the pushed SHA. **This also proves migration `0029`
   applied** — `railway.json` runs `npm run migrate && npm start` and `migrate.ts` exits 1
   on failure, so a failed migration fails the deploy.
2. Run one Buyer Test at `/test`. Expect **8–10 rows**, a first line that names the
   product, and **every green Proven row's quote plainly supporting its label**.
   *If any Pass isn't supported by its quote, roll back — that is the one unrecoverable
   failure mode.*
3. `/c/aaaaaaaaaaaa` → `404`; `/api/admin/funnel` → `401`.

## X.6 Rollback

`main` advanced by fast-forward, so there is **no merge commit** and `-m 1` does not apply:

```bash
# Fastest: Railway → Deployments → the 50eb90a deploy → Redeploy.
# Or by range:
git revert --no-edit 50eb90a..<the-sha-you-pushed>
git push origin main
```

Migration `0029` is additive (one nullable column), so reverting the code is complete and
safe — the column simply stops being written. No down-migration exists or is needed.

---

# ▶ RELEASE: v2.2 — instrument the funnel ✅ SHIPPED 2026-07-25, commit `50eb90a`

**Branch:** `feat/v2-2-instrument` · **Base:** `main` @ `87ffcb3`
**Status:** merged fast-forward `87ffcb3 → 50eb90a` and deployed. `/healthz` confirms the
commit, which is also proof migration `0028` applied.

> **Post-deploy note.** Steps 1, 3 and 4 of §W.4 passed from outside. Step 2 passed: a live
> Buyer Test on a stationery product returned **no Cruelty-free row**. Step 5 (reading
> `GET /api/admin/funnel`) is **not verified** — it needs `FUNNEL_ADMIN_ENABLED=1` set on
> the Railway service, which is an owner action. Until someone sets it, the funnel is
> recording but unread.

## W.1 What it carries

- **Funnel instrumentation** (migration `0028_funnel_events`) — `test_requested`,
  `test_completed`, `test_failed`, `install_clicked`, `install_completed`, `case_viewed`.
  Typed columns; **no URL, email, IP or shop domain reaches the table.** Two separate
  guarantees, because the first draft only had the weaker one: the schema has no column *named*
  for such a value (asserted against `information_schema`), **and** `toDomain` — the single
  boundary every host crosses — rejects full URLs, IP literals, over-long hosts and the
  `myshopify.com` bucket (asserted by value). The self-review found the schema check alone was
  the wrong question and IPs were getting through. Read surface: `GET /api/admin/funnel` (admin
  session **and** `FUNNEL_ADMIN_ENABLED=1`; 404 when unlit).
- **Hosted outreach cases** — `GET /c/:token`, inert unless `HOSTED_CASES_DIR` is set. See §V2.2b.
- **Egress cause split** — `throttleSource` / `robotsStatus` / `policyStatus` on
  `ProductTestResult`, so an upstream 429, our own budget, and our negative cache stop being
  the same `rate_limited`. Recorded per test; **our own throttles are excluded from the
  reported rate.**
- **A result-quality fix with a measured justification** — `inferClaims` no longer defaults to
  `cruelty_free` for unrecognised categories. It was asked of 13/13 real stores, failed 13/13,
  and opened every report. See `experiments/v2-2/RESULT_QUALITY.md`.
- **A body-proposal safety fix** — a pre-`0027` catalog row (raw HTML unknown, stripped text
  present) no longer yields a proposal that would replace the merchant's whole description; the
  propose route self-heals by re-reading that one product. See §V2.6 and
  `experiments/v2-2/FIRST_RUN_AUDIT.md`.

## W.2 Merge + push (run these yourself)

```bash
git fetch origin
git rev-parse origin/main                 # must equal 87ffcb3…; if not, STOP and rebase
git checkout main && git merge --ff-only feat/v2-2-instrument
git push origin main                      # Railway auto-builds + deploys
```

## W.3 Railway variables — none required

Every new variable has a working default. Optionally set `FUNNEL_ADMIN_ENABLED=1` to read the
funnel. Leave `HOSTED_CASES_DIR` unset until the case bundle is on the volume (§V2.2b).

## W.4 Post-deploy verification

1. `/healthz` → `commit` matches the pushed SHA. **This also proves migration `0028` applied** —
   `railway.json` runs `npm run migrate && npm start`, so a failed migration fails the deploy.
2. Run one Buyer Test at `/test`. It must return a table with **no "Cruelty-free" row** unless
   the product is genuinely in a category that asks for it.
3. `curl -s -o /dev/null -w '%{http_code}' https://lens.thirdocular.com/api/admin/funnel` → `401`
   (unauthenticated). With `FUNNEL_ADMIN_ENABLED=1` + an admin session it renders plain text.
4. `curl -s -o /dev/null -w '%{http_code}' https://lens.thirdocular.com/c/aaaaaaaaaaaa` → `404`.
5. Confirm the funnel recorded the test from step 2 (`tests requested` / `tests completed` ≥ 1).

## W.4b Adversarial self-review

The diff was reviewed against itself by five independent lenses, each finding handed to a
separate agent told to refute it. It found **seven defects in code that already had passing
tests** — none of them crashes, all of them metrics that would have read fine and meant nothing.
Six are fixed here (the throttle rate's denominator, a structurally-impossible referrer class,
install-click noise from five non-funnel CTAs, cache hits skewing duration percentiles, IP
literals and unbounded values reaching the `domain` column). Full record, including what was
deliberately left: `experiments/v2-2/SELF_REVIEW.md`.

The review did not complete — it hit a usage limit during the verify phase, and the correctness
lens never returned. Treat it as a real pass, not an exhaustive one.

## W.5 What is NOT fixed in this release

- **The host-match reconciliation still cannot fire on a fresh App Store install** — the
  storefront host is unknown until a catalog sync, and nothing syncs on install. Pinned by a
  test; fix scoped in `experiments/v2-2/FIRST_RUN_AUDIT.md` §F1. This is the highest-value
  open item.
- Nothing enqueues a catalog sync on install (§F2). Fix Studio's picker has no empty state (§F4).
- The concurrency threshold is still unmeasured — it cannot be probed from an external client
  without measuring our own rate limiter. See `EGRESS_DECISION.md` §5.2.

---

# ▶ RELEASE: V2 — close the funnel

**Branch:** `feat/v2-1-production-truth` · **Base:** `main` @ `fb30a2e` (what production runs)
**Carries:** everything in the release below (repositioning + Buyer Test + v1.1), PLUS
CP1 egress resilience · CP2 post-install continuity · CP3 the authenticated loop ·
CP4 the score→test reframe · **v2.1 CP0: the merge of the 9 production commits the V2
branch was missing.**

> ⚠️ **Why the branch name changed.** `feat/v2-close-the-funnel` was cut from a **stale local
> `main`** (`252d4ee`, 2026-07-06) and was **9 commits behind deployed production** (`fb30a2e`,
> confirmed via `GET /healthz`). Shipping it would have reverted the dynamic OG share cards,
> honesty batches 1–2, the Fix Studio "agrees with the Shopify admin" fix, the substitution
> reframe, the losing-brand demo, and the Index honest CTA. `feat/v2-1-production-truth` is that
> branch with `main` merged in and 8 textual + 1 semantic conflict resolved. **Verify before you
> push:** `git merge-base --is-ancestor origin/main feat/v2-1-production-truth` must exit `0`.

Nothing is deployed until you run the push below.

## V2.1 Merge + push (run these yourself)

```bash
git fetch origin                                     # do NOT trust a stale local main
git merge-base --is-ancestor origin/main feat/v2-1-production-truth && echo "FF OK"
git checkout main
git merge --ff-only origin/main                      # bring local main up to production first
git merge --ff-only feat/v2-1-production-truth        # must fast-forward; if it refuses, STOP
git push origin main                                  # Railway auto-builds + deploys
```

`npm run migrate` runs at startup on Railway and applies **`0026_buyer_tests.sql`**
(additive + idempotent: `public_tests`, `buyer_tests`, `buyer_test_runs`,
`requirement_confirmations`, plus `oauth_states.test_token` and two nullable
`fix_proposals` columns). Nothing existing is altered, so a code rollback is safe
without a down-migration.

> **Renumbered from `0025` → `0026` in v2.1 CP0.** It collided with
> `0025_finding_crawl_mode.sql`, which is **already applied in production**. Tracking is by
> filename so the collision would not have errored — it would just have left two `0025`s and a
> non-deterministic-looking order on a fresh database. Both files are idempotent, so the rename
> re-applies harmlessly anywhere the old name was already recorded (verified locally: migrate
> applied `0026` after `0025_finding_crawl_mode`, exit 0).

## V2.2 Railway variables

All optional — every one has a working default. Set only if you need to tune.

| Variable | Default | Why |
|---|---|---|
| `PRODUCT_TEST_EGRESS_PER_MIN` | `20` | process-wide Shopify fetch budget across ALL hosts |
| `PRODUCT_TEST_EGRESS_CONCURRENCY` | `2` | max simultaneous outbound product fetches |
| `PRODUCT_TEST_EGRESS_MAX_WAIT_MS` | `10000` | past this a request is refused, not parked on a spinner |
| `PRODUCT_TEST_SEMANTIC` | *unset* | `0` kills the semantic tier without a redeploy |
| `FUNNEL_EVENTS` | *unset* (= on) | `0` stops writing `funnel_events` without a redeploy |
| `FUNNEL_ADMIN_ENABLED` | *unset* (= off) | `1` lights `GET /api/admin/funnel` (also needs an admin session) |
| `HOSTED_CASES_DIR` | *unset* (= off) | path to the outreach-case bundle; unset ⇒ every `/c/:token` 404s |

## V2.2b Hosted outreach cases — putting the bundle on the volume

`GET /c/:token` serves one pre-rendered case from `HOSTED_CASES_DIR`. **With that variable
unset the route 404s everything**, which is the correct posture until the links are meant to be
live. There is no code flag to remember.

**The bundle is never committed.** Each case names a real third-party store, so it lives on the
Railway volume and is excluded by `.gitignore` (`experiments/*`). Do not `git add -f` it.

Layout the route expects — one directory per token, `index.html` inside:

```
$HOSTED_CASES_DIR/
└── c/
    ├── <token>/index.html
    └── <token>/index.html
```

Tokens are 12 chars of `[a-z2-7]` (60 bits). Anything else 404s before touching the disk.

**Deploy the bundle (one-off):**

1. Railway → the `web` service → **Volume** is already mounted at `DATA_DIR` (e.g. `/data`).
2. Upload the bundle to `/data/hosted` (Railway shell, or `railway run` + `scp`/`rsync`), so the
   cases land at `/data/hosted/c/<token>/index.html`.
3. Set `HOSTED_CASES_DIR=/data/hosted` on the **web** service. Railway restarts it.
4. Verify: `curl -sI https://lens.thirdocular.com/c/<token>` → `200` with
   `X-Robots-Tag: noindex, nofollow`; `curl -s -o /dev/null -w '%{http_code}'` on an unknown
   token, on `/c/`, and on `/c` → `404` each.

**Adding a case later needs no redeploy** — copy one more `c/<token>/index.html` into the same
directory. The route reads from disk per request; nothing is cached in the process.

**Turning it off** is unsetting `HOSTED_CASES_DIR` (restart). Existing links then 404 — they do
not fall through to the marketing site.

## V2.3 Post-deploy verification (in order)

0. **Hard refresh the site** (Ctrl/Cmd-Shift-R on `/`, `/test`, `/index`). The viewer bundle is
   content-hashed but `index.html` is not — a cached shell can serve the OLD bundle and make a
   good deploy look broken. Do this BEFORE judging anything below.
1. **`/healthz`** → `ok:true`, `commit` matches the SHA you pushed.
2. **Migration applied**: deploy logs show `applying: 0026_buyer_tests.sql` (or
   `already applied` on a re-deploy). `0025_finding_crawl_mode.sql` should report
   `already applied` — it is already in production. If the migration failed, the app still
   boots — the Buyer Test keeps working, but install continuity and saved tests will 500.
   Check first.
3. **Public test still works**: run one at `/test` on a real Shopify product URL.
   Confirm the assertion table renders and every green **Proven** row shows a quote
   that plainly supports it. *If any Pass isn't plainly supported by its quote, roll
   back — that is the one unrecoverable failure mode.*
4. **Egress telemetry**: `product_test` log lines now carry `tier`, `throttled`,
   `degraded`. Watch the throttle rate for 24h against the §5 escalation thresholds —
   this is the first production read on whether the funnel has a capacity ceiling.
5. **Install continuity** (needs a dev store): run a public test on that store's own
   product, install, and confirm the first authenticated screen is **Tests** showing
   that test — not a dashboard. If the test doesn't appear, the host-match fallback
   didn't fire; check `public_tests.store_host` against the shop's storefront host.
6. **`/app` is Tests**, `/app/overview` still reaches the old dashboard, and
   `/app/tests/:id` renders the assertion table + Confirm + Proposed changes.
7. **Page title + OG image on each public surface.** View source and confirm `<title>` and
   `og:image` are the server-substituted values, not the `__BRAND_NAME__` placeholders:
   - `/` → title carries **AisleLens**; description is the QA reposition copy
     ("executable shopping tests…"), not the old "See if AI shoppers recommend your store".
   - `/report/<id>` → title `<brand> — AI Visibility Report, <category> — AisleLens`; its card
     `/report/<id>/og.png` renders header **AI VISIBILITY REPORT** with **no score number**.
     *(v2.1 CP0 note: an earlier V2 draft of this list said the legacy card says "AI BUYER
     READINESS". That was v2's rename of a card `main` had already replaced — the shipped card
     shows no score at all. In-page copy does say "AI buyer readiness"; the share card does not
     name the score, by design.)*
   - `/demo` → card is `/og/demo.png`; the **SAMPLE · FICTIONAL BRAND** badge is on the image and
     the trademark-attribution note is in the page copy.
   - `/index/<slug>` → per-category OG title is the category, not the generic one; card is
     `/og/index/<slug>.png` and it crowns a leader ONLY when the page's dominance gate passes.

   The card endpoints are `/og/default.png`, `/og/demo.png`, `/og/index.png`,
   `/og/index/<slug>.png`, and `/report/<id>/og.png`. Each must return `content-type: image/png`
   and start with the PNG magic bytes — **anything else fell through to the SPA catch-all and will
   return the HTML shell with a 200**, which looks fine in a browser and breaks every scraper.
   Verified locally on the merge: all five return real PNGs (46–66 kB).
8. **Re-scrape the social card once** — LinkedIn Post Inspector *and* the X/Twitter Card
   Validator, one pass each, for `/` and `/demo`. Both cache aggressively; if you skip this, a
   stale card can persist for days and it will not be a code problem.

## V2.4 What is NOT proven yet

- **`write_products` has still never run against a real store.** The full
  confirm → propose → approve → apply → rerun → rollback loop was verified end to end,
  but in `SHOPIFY_MODE=mock`. Do a dev-store live write (apply + rollback one real
  description edit) before relying on it for a merchant. *(v2.1 CP3 is exactly this walk.)*
  - **Corrected in v2.1 CP0:** V2 reported that one step — the post-write catalog sync normally
    delivered by the `products/update` webhook — had to be written directly and labelled. It no
    longer does. `main`'s Fix Studio fix (`90b137b`) added a real `mirrorToCatalog` on both apply
    and rollback, so the written value is mirrored into the synced catalog immediately and the
    webhook is only the backstop. That step is genuine now.
  - `main` also added a **no-observable-effect guard**: if the verified post-write re-read equals
    the pre-write value, the proposal is marked `failed`, not `applied`. Expect that status when
    testing a write that Shopify normalizes back to its default — it is the guard working, not a
    bug.
- **Install continuity has only been exercised through our own OAuth redirect.** The
  App Store managed-install path (no token, host-match fallback) is built and unit-safe
  but has not run against a real Shopify install.
- **Automatic re-run triggers are documented, not built** — product edits, policy edits,
  catalog sync and engine updates. Re-runs are manual today, and the UI says so.

## V2.5 Rollback

```bash
# Fastest: Railway → Deployments → previous green deploy → Redeploy.
# Or by commit — see the note below on WHICH form applies.
git revert --no-edit -m 1 <the-merge-sha-you-pushed>    # only if a MERGE COMMIT exists
git push origin main
```

> ⚠️ **`-m 1` only works if there is a merge commit — and V2.1 §V2.1 tells you to use
> `--ff-only`, which does not create one.** After a fast-forward, `main` simply advances and
> there is no second parent to keep. Use **Railway → Redeploy the previous green deploy**
> (instant, no git surgery), or revert the range:
> `git revert --no-edit <old-sha>..<new-sha>`. Check with `git log --merges -1` before
> reaching for `-m 1`.

Migration `0026` is additive, so reverting the code is complete and safe; the new tables simply
stop being written to. No down-migration exists and none is needed.

Kill switches, no redeploy required: `PRODUCT_TEST_SEMANTIC=0` disables the semantic tier;
`DAILY_SPEND_CAP_USD=0` halts all live scan spend.

## V2.6 ✅ SHIPPED — v2.1 CP2–CP5 (deployed 2026-07-25, commit `031f271`)

Fast-forward `80f04c1 → 031f271`, 7 commits. **No merge commit** (see the rollback note above).

Gate, all green before the push: full suite **357/357, 0 fail, 0 skipped** with all three
env gates (`RUN_DB_TESTS=1` + `SHOPIFY_MODE=mock` + `APP_ENCRYPTION_KEY`); typecheck clean;
viewer builds; `origin/main` fetched and confirmed an ancestor.

Carries: the **raw-HTML body write path** (migration `0027` adds `products.description_html`;
`liveFieldOf` removed) · the **CP2 production egress measurement** (0% throttle — §5 corrected)
· the **CP5 decision memo** · a Fix Studio enrichment fix · the CP3 live-walk record.

Verified post-deploy: `/healthz` = `031f271`; `/healthz/deep` db `ok`, new worker heartbeating;
`/ /test /index /demo /privacy /scan` all 200; `<title>` server-substituted (no
`__BRAND_NAME__`); a live product test returned a full 5-row table with every green row
plainly supported and `pass_no_blocking` correctly distinguished from a proven pass.

✅ **Migration `0027` IS verified — and the reasoning that said otherwise was wrong.**

> The paragraph that used to sit here read: *"Railway runs migrations non-fatally, so a failure
> still boots a healthy-looking app."* **False.** `railway.json` sets
> `"startCommand": "npm run migrate && npm start"` — `&&`, not `;` — and `src/db/migrate.ts`
> calls `process.exit(1)` on failure. A failed migration therefore never reaches `npm start`,
> the `/healthz` healthcheck fails, and the deploy fails.
>
> So: **production answers `/healthz` with `commit: 87ffcb3`, which means `npm start` ran, which
> means `npm run migrate` exited 0, which means every pending migration applied — including
> `0027`.** No credentials, no dashboard, no log-grepping required. (CLAUDE.md carries the same
> stale "non-fatal" claim; corrected there too.)
>
> The general lesson is worth more than the specific check: **a green `/healthz` on a known
> commit is proof that migrations applied**, for every future release.

ℹ️ **Existing catalog rows have `description_html = NULL` until the next catalog sync** — and
v2.2 CP1 found this was worse than "the guard refuses". The proposer read
`p.descriptionHtml ?? ""`, so it could not tell *"the body is empty"* from *"we never captured
the body"*, and for a stale row it proposed the confirmed sentence **as the entire body** —
replacing everything the merchant had written, under a rationale promising it "changes nothing
else". Apply's conflict guard did stop it every time, so no copy was ever destroyed. Now the
proposer refuses at the source, and the propose route re-reads the one product and mirrors it
back so the merchant is not left with an unactionable refusal.

---

# ▶ RELEASE (previous): "AI Commerce QA" repositioning + the Buyer Test

**Branch:** `feat/phase-b-v1-1` · **Base:** `main` (fast-forward, no merge commit)
**Carries:** the public repositioning · Phase B (the Buyer Test) · the hardening ·
v1.1 (headline math, recovered surfaces, task ranking, semantic tier).

Nothing in this release is deployed until you run the push below.

## 1. Merge + push (run these yourself)

```bash
git checkout main
git merge --ff-only feat/phase-b-v1-1     # must fast-forward; if it refuses, STOP and re-check
git push origin main                       # Railway auto-builds (npm run build) + deploys
```

## 2. Set / confirm these Railway variables

| Variable | Value | Why |
|---|---|---|
| `PUBLIC_BRAND_NAME` | `AisleLens` | public name (never "Shopify…") |
| `PUBLIC_BASE_URL` | `https://lens.thirdocular.com` | OG/share URLs |
| `OPENAI_API_KEY` | (already set) | powers the semantic tier (~$0.001/test) |
| `PRODUCT_TEST_SEMANTIC` | *unset* (or `0` to kill) | `0` disables the semantic tier without a redeploy |
| `AGENTIC_INSTRUMENT_TEST_ENABLED` | **leave unset** | keeps the experiment routes off in production |
| `HOSTED_CASES_DIR` | **leave unset** | keeps `/c/:token` inert |

## 3. Post-deploy verification (in order)

1. **`/healthz`** → `ok:true` and `commit` matches the SHA you just pushed.
2. **Hard-refresh** `https://lens.thirdocular.com/` (Cmd/Ctrl-Shift-R) — the hero must read
   *"AI buyers treat your store like an API. We test it like one."* with the terminal-style
   pass/fail card. Tab title: *"AisleLens — AI Commerce QA for Shopify"*.
3. **Run one Buyer Test on production**: paste a real Shopify product URL at `/test`.
   Confirm the assertion table renders, the headline counts only unproven rows, and every
   green **Proven** row shows a quote that plainly supports it. *If any Pass isn't plainly
   supported by its quote, roll back (§4) — that is the one unrecoverable failure mode.*
4. **OG image + title**: view-source on `/` → `og:image` = `/og-image.svg`,
   `og:title` = the hero line. Open the SVG directly; it must say *AI Commerce QA for Shopify*.
5. **Re-scrape the social card once** (platforms cache aggressively):
   LinkedIn Post Inspector <https://www.linkedin.com/post-inspector/> and
   X Card Validator — paste `https://lens.thirdocular.com/` and force a refresh.
6. **Spot-check the legacy surfaces**: an old `/report/<id>` link still loads, and its share
   title says *"AI buyer readiness"* (not "AI Visibility Score"). `/methodology` renders.

## 4. Rollback

```bash
# Fastest: Railway → Deployments → previous green deploy → Redeploy.
# Or by commit:
git revert --no-edit <the-merge-or-head-sha>
git push origin main
```
Migrations are unchanged by this release, so a code rollback is complete and safe.
The kill switches (no redeploy needed): `PRODUCT_TEST_SEMANTIC=0` disables the semantic
tier; `DAILY_SPEND_CAP_USD=0` halts all live scan spend.

## 5. Known production risk: the egress throttle (watch this)

Shopify applies a rate limit (`local_rate_limited`) that is **keyed to the egress IP and
applied across all stores** — not per store. Every Buyer Test originates from one Railway
IP, so this is a capacity ceiling on the whole funnel, not a per-store courtesy problem —
and per-host throttling structurally cannot help, because the limiter does not count per host.

### ⚠️ Measured behavior (2026-07-24) — corrects the v1.1 assumption

V1.1 smoke testing suggested the HTML tier survived while `.json` was throttled, and V2
§2.1 was designed on that premise. **Direct per-endpoint probing from the dev IP does not
reproduce it.** Measured twice, ~45s apart, stable both times:

> Hosts are de-identified here on purpose. These are measured facts about *named third
> parties'* bot-protection posture, gathered by probing their storefronts; this file is
> tracked in git, and publishing "brand X blocks our IP" is not ours to publish. The
> host↔label mapping lives in the untracked experiment log
> (`experiments/`, gitignored), which is where per-store detail belongs.

| Host | `/robots.txt` | `/policies/*` | `/products/<h>` | `/products/<h>.json` |
|---|---|---|---|---|
| Host A (apparel) | **429** | **429** | **429** | **429** |
| Host B (wellness) | 200 | 404 | **429** | **429** |
| Host C (personal care) | 200 | 404 | 404 | 404 |

Two distinct regimes, and neither is `.json`-specific:
- **Host B** — the throttle covers the whole **`/products/*` path class**. `robots.txt`
  still serves 200, so it IS endpoint-scoped, but the product PAGE is refused exactly like
  the `.json`. Page-first does not rescue this host.
- **Host A** — blanket 429 on every path, i.e. the IP is fully blocked for that
  storefront (bot management, not a rate limiter).

**So: the page-first reorder is NOT a throttle mitigation, and should not be relied on as
one.** It is still worth having for the reasons it demonstrably delivers — on a healthy
store (Host C) the entire test now runs from ONE page fetch with no `.json` and no
`.js` request, which is a ~50% cut in outbound requests per test and therefore in how fast
we spend the shared budget. But when a host throttles, it throttles the page too, and the
merchant gets the honest `rate_limited` error with a retry — not a partial test.

The partial-test path (§2.3) still earns its place: it covers the mixed case (e.g. `.js`
refused while the page answers) and it removed a real honesty bug, where a surface we were
blocked from reading was reported as one the store fails to publish.

**Live run, 5 real stores, spaced 20s, from the dev IP:** 1 completed (page tier, full
6-row result), 3 `rate_limited`, 1 `unreachable` — a **60% throttle rate**, from a
residential dev IP.

### ✅ Re-measured from PRODUCTION (2026-07-25) — the 60% does NOT describe production

The instruction above ("re-measure from production before acting") was carried out.
**15 Shopify stores this project had never fetched, one request per host, paced ≥130s,
through `POST /api/product-test` on production (`80f04c1`): 14 clean, 1 `unreachable`,
0 `rate_limited` — a 0.0% throttle rate.** Full method, per-host table (de-identified) and
limitations: `experiments/v2-1/CP2_RESULTS.md`. Decision: `experiments/v2-1/EGRESS_DECISION.md`.

**So production sits in the "< 5% — no action" band below, not past the escalation trigger.**
Do not buy a proxy pool or build the async path on the strength of the 60% figure; it was
measured on a different IP and is not a production number.

Three caveats that keep this honest: the sample **excludes Cloudflare-fronted storefronts**
(they can't be DNS-verified as Shopify) and those are the likeliest bot-protection cases, so
the true rate is probably above zero; n=15 with one shot per host is a wide interval; and it
measures **cold, well-spaced** egress, so concurrency is the most likely way it moves.

⚠️ **Known instrumentation gap:** a `rate_limited` result **cannot** tell you whether the
cause was Shopify's per-IP limiter (an IP pool would help) or the host's own WAF (it would
not). `policyStatus` is not on `ProductTestResult`, and the policy layer is never probed on
the failing path. Closing that gap is the one code change `EGRESS_DECISION.md` recommends —
do it **before** the rate rises, or the first escalation decision will be unmakeable.

**Shipped mitigations (V2 CP1):**

| Defense | Where | Behavior |
|---|---|---|
| Page-first fetch order | `productTest.ts` | HTML product page is tier 1; `.json` only fills a gap the page left; `.js` last. **Cuts requests per test (~50% on a well-marked-up store), but see the measured note above — it does NOT survive a throttled host** |
| Global egress budget | `productTestCache.ts` | process-wide **20 fetches/min across all hosts** + concurrency 2; bursts wait, they don't stampede |
| Honest degradation | `productTest.ts` | a throttled tier yields a **partial test** with the affected rows marked `requires_store_access` and the accurate reason — never "this store publishes nothing", never an error page |
| Result cache | `productTestCache.ts` | **7 days** per normalized URL ("Tested 3 days ago · Run again") |
| Negative cache | `productTestCache.ts` | a host that 429s is not re-probed for **10 minutes** |

Tunable without a code change: `PRODUCT_TEST_EGRESS_PER_MIN` (default 20),
`PRODUCT_TEST_EGRESS_CONCURRENCY` (default 2), `PRODUCT_TEST_EGRESS_MAX_WAIT_MS` (default 10000).

### Escalation path (NOT built — decide from telemetry)

Every test logs a `product_test` line carrying `tier` (which fetch tier answered),
`throttled` (which tiers were refused) and `degraded`. The same fields land on the
`product_test` event row.

**The trigger signal: throttle rate over a rolling 24h** —
`count(degraded or errorKind="rate_limited") / count(product_test)`.

- **< 5%** — no action. The caches and budget are absorbing it.
- **5–20% sustained for 48h** — raise the cache TTL and lower `PRODUCT_TEST_EGRESS_PER_MIN`
  first; these are env-var changes, no redeploy of code paths.
- **> 20% sustained, or any day where `degraded` exceeds clean results** — pick one.
  Given the measured behavior above (the block covers the whole `/products/*` class, and on
  some hosts every path), **option 1 is the only one that addresses the actual mechanism**:
  1. **Egress proxy pool** — route product fetches through N rotating egress IPs. The
     limiter keys on IP, so this is the only mitigation that changes the input it keys on.
     Cost: a proxy vendor + a per-IP budget split.
  2. **Queued async flow** — accept the URL, return "we'll show your result in a minute",
     run it off the existing Phase-1 job queue at a paced rate. Removes the interactive
     deadline that makes throttling visible, at the cost of the instant-gratification funnel.
  3. **Storefront API for installed merchants** — authenticated merchants stop using the
     public crawl path entirely. Doesn't help the public funnel (the acquisition surface),
     so it is a complement to 1 or 2, never a replacement.

If tests start failing broadly, check the `product_test` log lines for
`errorKind:"rate_limited"` and the `tier`/`throttled` fields before suspecting the engine.

---

One Railway service runs **everything**: the Express API **and** the built React
viewer (static files) from the same process. No Vercel, no CORS, no second service.

## Architecture

```
Browser ──> Railway service (Express, 0.0.0.0:$PORT)
              ├── /api/*            JSON API (scans, prompts, leads, events)
              ├── /healthz          health check
              └── /* (everything)   serves viewer/dist (built React SPA)

  Supabase Postgres   ← runtime data (leads, runs, events) via service-role key
  Railway Volume (/data) ← result files (results.json, report.md, progress.log)
```

- **Build:** `npm run build` (installs + builds the viewer to `viewer/dist`). No
  secrets needed at build time.
- **Start:** `npm run migrate; npm start` (railway.json). Migrations run at startup
  where Railway reliably injects the service's runtime variables, then the server
  boots (`tsx src/server/index.ts`, binds `0.0.0.0` in production). The `;` makes
  boot resilient: a migrate hiccup degrades persistence gracefully rather than
  crash-looping the container (check `/healthz` → `supabase`).
- **Variables must be set on the SERVICE**, not project "Shared Variables" (those
  are not auto-injected). The build-step approach failed for exactly this reason.

## Environment variables (set ALL of these in Railway → Variables)

| Variable | Purpose | Example |
|---|---|---|
| `OPENAI_API_KEY` | engine | `sk-proj-…` |
| `GOOGLE_AI_API_KEY` | engine | `AQ.Ab8…` |
| `PERPLEXITY_API_KEY` | engine | `pplx-…` |
| `SUPABASE_URL` | persistence | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | persistence (server-only) | `eyJ…` |
| `DATABASE_URL` | migrations (session pooler, **port 5432**) | `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| `DAILY_SPEND_CAP_USD` | global daily spend ceiling | `25` |
| `NODE_ENV` | production posture | `production` |
| `DATA_DIR` | volume mount path for result files | `/data` |
| `ADMIN_PASSWORD` | gates `/admin` (unset ⇒ admin disabled) | `a-long-random-string` |
| `IP_HASH_SALT` | salts the one-way IP hash stored for limits | `random-string` |
| `PUBLIC_BRAND_NAME` | public name (UI/titles/OG) — **never "Shopify"** | `AI Visibility` |
| `PUBLIC_BASE_URL` | absolute URL for OG/share links (blank ⇒ from request) | `https://yourbrand.com` |
| `CONTACT_EMAIL` | shown on `/privacy` + footer | `hi@yourbrand.com` |
| `STRIPE_FULL_REPORT_URL` | Stripe Payment Link (missing ⇒ email modal) | `https://buy.stripe.com/...` |
| `STRIPE_WEEKLY_MONITORING_URL` | Stripe Payment Link | `https://buy.stripe.com/...` |
| `STRIPE_FOUNDER_BETA_URL` | Stripe Payment Link | `https://buy.stripe.com/...` |

`PORT` is set by Railway automatically — do not hardcode it.
**`SUPABASE_SERVICE_ROLE_KEY` is server-only.** It is never imported by the viewer
bundle (verified: no `import.meta.env`/`VITE_` secret usage; `grep` of `viewer/dist`
finds no secrets).

## Database / migrations workflow

Migrations are version-controlled SQL in `migrations/` applied by `src/db/migrate.ts`.

```bash
# locally (uses DATABASE_URL from .env)
npm run migrate          # applies pending migrations, then prints the verified tables
```

- The runner tracks applied files in a `schema_migrations` table and is idempotent.
- On Railway the same command runs automatically at startup (`railway.json` start
  command), so production schema stays in sync on every deploy. It needs
  `DATABASE_URL` as a **service** variable (build time is too early / unreliable).
- Adding a migration = drop a new `migrations/NNNN_name.sql` and redeploy (or run
  `npm run migrate`). Never hand-run SQL in the dashboard.

## First-time Railway setup (dashboard steps)

1. **New Project → Deploy from GitHub repo** → pick this repo. Railway reads
   `railway.json` for build/start.
2. **Variables** → paste every variable from the table above.
3. **Volume** → add a volume, mount path **`/data`**, and set `DATA_DIR=/data`.
4. **Deploy.** Build runs `npm run build && npm run migrate`; start runs `npm start`.
5. **Networking → Generate Domain** to get the public URL.
6. Open `/healthz` → should return `{ ok: true, supabase: true, … }`.

## Smoke test (production)

1. `GET /healthz` → `ok:true`, `supabase:true`.
2. Open the domain → `/demo` renders the Caraway report.
3. `/scan`: enter brand + competitor + email → Generate → Run → report renders.
4. Click a CTA → submit email → check Supabase `leads` table has the row.
5. Verify `events` rows: `scan_started`, `scan_completed`, `report_viewed`, `cta_*`.
6. Spend cap: temporarily set `DAILY_SPEND_CAP_USD=0.01`, try a scan → blocked with
   the honest "daily capacity reached" message + a `spend_cap` lead. Reset after.

## Where data lives

- **Postgres (Supabase):** `leads`, `runs`, `events`. The source of truth for
  analytics, leads, and rate-limit counters.
- **Volume (`/data`):** per-run files `config.json`, `results.json`, `report.md`,
  `progress.log`, `status.json`. Survives redeploys; lost only if the volume is deleted.

## Custom domain (Railway)

The app reads its public URL from `PUBLIC_BASE_URL` (or the request host) — there are
**no hardcoded `*.up.railway.app` URLs**, so it works behind any domain.

1. **Railway:** service → **Settings → Networking → Custom Domain** → enter your domain
   (e.g. `app.yourbrand.com` or apex `yourbrand.com`). Railway shows a target value.
2. **DNS (at your registrar):**
   - Subdomain → add a **CNAME** record from the subdomain to the Railway-provided
     target (e.g. `app` → `xxxx.up.railway.app`).
   - Apex/root → use an **ALIAS/ANAME** (or your registrar's flattened CNAME) to the
     target, since CNAME on a root is usually disallowed.
3. Wait for DNS + Railway to provision the TLS cert (minutes to ~an hour).
4. Set **`PUBLIC_BASE_URL=https://yourdomain`** in Variables so OG tags + share links
   use the real domain. Also set **`PUBLIC_BRAND_NAME`** to your final public name.
5. (Stripe) Point each Payment Link's success URL at `https://yourdomain/thanks?plan=<id>`
   and set the `STRIPE_*_URL` vars; the CTAs open them, the `/thanks` page logs
   `payment_completed`.

## Admin cockpit

`/admin` is gated by `ADMIN_PASSWORD` (cookie session, constant-time check,
rate-limited login). It shows today's metrics, the funnel, runs, leads, errors, and
launch-target progress, and can launch standard/deep scans for paid-beta customers.
If `ADMIN_PASSWORD` is unset, `/admin` is disabled.

## Multi-process services (LIVE 2026-06-21) — web + worker + scheduler
One image, three Railway services from the **same repo**. `railway.json` runs `npm run migrate;
npm start` for all of them; `src/start.ts` then **dispatches on `PROCESS_MODE`**: `web`
(default → Express + viewer) · `worker` (`npm run worker`) · `scheduler`. So the **only
per-service difference is the `PROCESS_MODE` variable** — no per-service start-command or
healthcheck overrides (Railway handles those inconsistently). `worker`/`scheduler` run a minimal
`/healthz` server (`src/health.ts`) so the shared healthcheck passes; they need no domain/volume.
- Add a service: Railway **+ Create → GitHub Repo** (NOT Empty Service) → copy the web service's
  env vars → set `PROCESS_MODE=worker` (or `scheduler`). Don't hardcode `PORT` (Railway injects it).
- Turn the queue on LAST: set `JOB_QUEUE_ENABLED=1` on the **web** service only.
- Verify: `/healthz/deep` → `worker` + `scheduler` heartbeats + `jobQueueEnabled:true`.
- Recurring monitoring is mock/$0 until `MONITORING_LIVE=1`; live crawl needs `CRAWLER_MODE=live`.

## Rollback

- **Code:** Railway → Deployments → pick a previous green deploy → **Redeploy**.
- **Migrations:** forward-only. To undo schema, add a new migration that reverses it
  (don't edit an applied file). Data in Supabase is unaffected by a code rollback.
- **Kill switch:** set `DAILY_SPEND_CAP_USD=0` to immediately stop all live scans
  (new scans get the "capacity reached" message); no redeploy needed after the var
  change propagates.

## Security posture

- Localhost-only with a loud warning in dev; binds `0.0.0.0` only in production.
- Email-gated scans; per-email + per-IP daily free-scan limits; per-IP rate limits;
  request size cap; honeypot field; per-scan + global daily spend caps enforced
  **before** any live API call; scan wall-clock timeout.
- No secret is read from anything but environment variables.

## v2.4 release — adversarial corpus + identifier plausibility (2026-07-25)

**Commit:** `feat/v2-4-harden` merged to `main`. Verify with `GET /healthz` → `commit`.

**No migration.** Nothing in this release touches the schema, so a rollback is a plain revert
with no data consideration.

**What changes in production, behaviourally:**
- `identifiers` stops passing placeholder values. A store publishing `mpn: "N/A."`,
  `"TBD-001"` or an all-zero GTIN now correctly reads as *not proven* instead of as a
  published identifier. This **removes** false passes; it cannot add one.
- GTINs written with the barcode's separators (`0-36000-29145-2`) now pass. This **removes**
  false fails.
- `GET /c/:token` refuses a self-contradicting outreach case with the same 404 it already
  gives for a bad token, and logs `[hosted-case] REFUSING to serve …`. Measured against the
  real 12-case bundle: fires on exactly the two broken cases, none of the other ten. Both
  broken cases were repaired in the bundle, so with the current bundle nothing is refused.
  **If a `REFUSING to serve` line appears in the logs, the bundle on the volume is stale —
  redeploy it, do not disable the guard.**

**Verification after deploy (no credentials needed):**
```
curl -s https://lens.thirdocular.com/healthz          # commit == the merge SHA
```
Then, if `HOSTED_CASES_DIR` is set, load one `/c/<token>` and confirm 200 + `X-Robots-Tag:
noindex, nofollow`, and any bad token → 404.

**Rollback:**
```
git revert --no-edit <merge-sha> && git push origin main
```
