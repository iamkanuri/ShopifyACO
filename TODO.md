# TODO — AisleLens (repo: ShopifyACO)

Single source of truth for deferred work. Reflects the live beta at
`https://lens.thirdocular.com`. Update as items ship.

> ⚠️ **Read this first:** the product is a credible beta. The bottleneck is
> **distribution, not features** — get it in front of ~10 real merchants before
> building anything below. Build a feature only when a paying-customer signal pulls
> for it. Most items here are deliberately NOT started.

---

## ✅ DONE (2026-06-20): dark/minimal re-theme + scan redesign

Shipped a **dark, near-black, sleek** rebrand matching thirdocular.com, plus a
progressive-disclosure restructure of the landing/scan/report flow.
- **Palette** (all in `viewer/src/theme.css` `:root`): `--bg #0b0b0d`, `--surface #141417`,
  `--ink #f5f4f0` (warm off-white), ONE muted gray `--ink-2 #8c8a83` for secondary text,
  `--accent` is now the **off-white CTA** (`--ink`), `.btn-primary` = off-white bg / near-black
  text. Removed all indigo/purple, gradients, box-shadows (`--shadow*: none`), and emoji/✓/✨
  glyphs. Form controls get a global dark rule (they used to default to white). Favicon in
  `index.html` updated to the dark mark.
- **Landing** (`pages/LandingPage.tsx`): first screen = ONE thing (headline "See if AI
  recommends your store" + subline + store-URL input + "Run free scan" + trust line). The
  proof card / learn grid / sample / index promo / pricing band were removed; only a quiet
  how-it-works + 3-item FAQ remain below the fold.
- **Scan** (`pages/ScanPage.tsx`): two-step reveal. Step 1 = single URL input. Clicking
  reveals step 2 (brand auto-guessed from the domain, category, ≥1 competitor, email).
  Prompt editing + "Suggest more with AI" + engine toggles now live in a collapsed
  **"Customize prompts (optional)"** `<details>`. Backend contract unchanged (still sends
  brand/category/competitors/email/prompts; email gate + abuse guards intact).
- **Report** (`pages/Report.tsx`): leads with the verdict headline + score + key tiles +
  insight; the 6 deep sections are now collapsible (`<details className="report-collapse">`,
  threat open by default).
- **Bug fix:** the "Suggest more" button now surfaces failures as a loud red `banner-error`
  (was a muted, easy-to-miss chip), handles the empty-result + non-200 cases, and no longer
  dead-ends when no prompts exist (it generates them first). Removed the ✨ and "(~$0.01)".
  Likely root cause in prod was a missing/silent OpenAI path — now visible. **Confirm
  `OPENAI_API_KEY` is set on Railway** (OpenAI is engine-isolated, so scans run without it).

Remaining simplification ideas if wanted later: trim report tile/badge noise further;
revisit the demo fixture copy.

## ✅ DONE (2026-06-20, round 2): AI store auto-detect + key health check

- `/api/store/infer` (`src/server/infer.ts`): one capped OpenAI call detects brand,
  category, competitors, and starter prompts from a store name/URL. ScanPage runs it on
  entry and prefills the form; fully graceful on failure (manual entry, guessed brand).
- Fixed `/scan?url=…` re-asking for the URL; removed the redundant Store URL field.
- Softened the dark palette (charcoal `#16171b` / warm off-white `#dedcd5`) — pure
  black/white was too harsh. Report meta chips relabeled to "live web"/"no web search"
  with a plain-English legend.
- **Admin engine-key health check** (`src/server/healthcheck.ts`, `/api/admin/engine-keys`,
  button on `/admin`): pings OpenAI/Google/Perplexity to report Valid/Invalid/Not-configured.
  Added because **silent per-engine failures** hid a stale prod `OPENAI_API_KEY` (ChatGPT
  was dropping out of every scan while the key worked locally). Run it after any key change.

## 0. Go-to-market (the actual priority — not code)

- [ ] Publish 3–5 **AI Visibility Index** categories (cookware, sunscreen, supplements…),
      then DM/email each listed brand their rank + one lost prompt → their report link.
- [ ] Run the 5 leaderboard social captions (cookware/sunscreen/electrolytes/vacuums/creatine).
- [ ] Offer the **$99 Founder teardown** by hand (record a 5-min Loom per buyer) — no code.
- [ ] Watch `/admin` for the only signals that matter: shares, CTA clicks, **paid orders**.
      Continue signal ≈ 3–5 paid reports + Index driving traffic; else rethink the offer.

---

## 1. Deferred SECURITY / hardening

Ordered roughly by importance. None are blockers for a manual beta; revisit before
scaling traffic or selling to security-conscious merchants.

- [ ] **Authenticated report access.** Reports are now unguessable (80-bit run IDs) but
      still public-by-link: anyone with the URL can `GET /api/runs/:id` + `/report.md`.
      Add a per-report access token or email magic-link for paid/serious merchants.
- [ ] **Replace the single in-process scan lock with a real queue.** Today one scan at a
      time → 409 under concurrent load (TODO already in `runStore.ts`). Move to a
      Supabase-backed `runs` queue + worker loop + per-user/email/IP concurrency, status
      transitions queued→running→complete/failed. Required before any paid ads / virality.
- [ ] **Multi-instance spend-cap safety.** The global cap uses `max(in-memory, DB sum)` —
      correct for ONE process. Keep Railway at **1 replica**. To scale out, reserve the
      estimated spend in the DB *before* starting a scan (atomic), not after.
- [ ] **DB-down policy is too permissive.** When Supabase is unreachable, per-email/IP
      daily counters return 0 (fail-open) so free-scan limits weaken. (Global spend cap
      still bounds cost via the in-memory accumulator, so it stays cost-safe.) For public
      launch: if DB down, allow admin scans only / show "capacity temporarily unavailable".
- [ ] **Bot defense beyond honeypot + rate limits.** Add Cloudflare Turnstile / captcha on
      the scan submit; consider an origin allowlist. (Single-service so no CORS today.)
- [ ] **CSRF on state-changing admin endpoints.** Admin uses a `sameSite=lax` cookie;
      add a CSRF token (or `sameSite=strict`) for POST `/api/admin/*` if exposure grows.
- [ ] **Reject over-long prompts instead of silently truncating** (`slice(0, 300)` →
      400 "Prompt too long; max 300 chars"). Small honesty fix.
- [ ] **Drop the unused raw `ip` column** (migration 0006). Schema still has `runs.ip`
      from 0001; code writes only `ip_hash`. Drop it to match the privacy promise.
- [ ] **Enforce, don't just warn, weak prod config.** `reportConfig()` warns on default
      `IP_HASH_SALT`, missing `PUBLIC_BASE_URL`/`CONTACT_EMAIL`, short `ADMIN_PASSWORD`,
      Stripe URLs without a webhook secret. Consider failing startup on the worst of these.
- [ ] **🔴 Rotate the Shopify API secret in `imp keys.txt`** (exposed in plaintext; no
      code reads it) BEFORE any Shopify OAuth / App Store work. (gitignored, but rotate.)
- [ ] **Stripe lifecycle:** handle refunds, failed payments, and subscription
      cancellations (`customer.subscription.deleted`, `invoice.payment_failed`) for the
      $49/mo plan. Today only `checkout.session.completed` is handled.
- [ ] **Admin auth hardening (later):** single shared password is fine solo; add per-user
      admin + optional 2FA if a team forms.

---

## 2. Planned FEATURES

### A. Make the offer real (highest product leverage — only after paying signal)
- [ ] **Fix "generators"** (turn the report from *interesting* → *actionable*): copy-ready
      outputs — `/llms.txt`, Product schema JSON-LD, "Brand vs Competitor" page outline,
      5 PDP copy blocks AI can quote. Ship these BEFORE Shopify OAuth.
- [ ] **Fulfill the $49/mo monitoring plan:** scheduled scans (cron) + historical
      trend tracking + "new lost prompt" alerts. Until this exists, monitoring is sold as
      a waitlist (UI already handles the unset-Stripe-URL case).
- [ ] **Scary, competitor-named report headline** ("AI shoppers are being sent to GreenPan
      before Caraway") — fear converts better than "Visibility score 24/100".
- [ ] **Shareable "AI chose your competitor" cards** — per lost prompt, generate a small
      image card (prompt · who AI recommended · "your brand: not mentioned") for DMs/social.

### B. Index as the acquisition engine (build on what's live)
- [ ] **"Claim your brand"** CTA on every Index row: public = rank only; claimed = full
      prompt-level report + fix cards + monitoring upsell.
- [ ] Weekly **category ambush** pages (pick 3 categories, publish weekly, outbound the brands).
- [ ] **Before/after scans** → case-study machine ("rec rate 4% → 18% after the fixes").
- [ ] Public **"AI Answer Evidence DB"** — anonymized prompt → winning brand examples
      (positions the product as market intelligence, not a one-off scan).

### C. Original roadmap (do NOT start before week-1 fundamentals)
- [ ] **Shopify OAuth + catalog read** — auto-build scan configs from real products/
      collections. (Rotate the Shopify secret first.) Public name must stay non-"Shopify".
- [ ] **Merchant dashboard** — share-of-voice over time (needs scheduled scans + history).
- [ ] **Multi-run aggregation** — aggregate N scans to report stable rates with
      confidence/variance instead of single-run snapshots.
- [ ] **Fixes engine (verified):** store crawling to turn GENERAL HYGIENE fix cards into
      brand-specific, verified changes (audit live PDPs/schema). Analysis already drafts them.

### D. Detection (core IP) upgrades
- [ ] **Sentiment pass** → populate `mentioned_positive` / `mentioned_negative` (enum
      values already exist; non-breaking).
- [ ] **Optional LLM classification pass** for ambiguous/complex answers the clause-scoped
      heuristic can't resolve. Gate behind a flag; default analysis stays offline/free.
- [ ] **More engines:** `src/engines/anthropic.ts` (Claude — Messages API + web_search) is
      a placeholder; Copilot follows the same `EngineAdapter` shape (new file + 1 registry line).

### E. Agency / distribution channel
- [ ] **Agency mode:** "scan N brands/month" + white-label PDF export. (No Shopify App
      Store approval needed to sell this — potential faster revenue than self-serve.)

---

## 3. Operational
- [ ] **Flip Stripe to LIVE** once KYC is approved: recreate the 3 Payment Links + webhook
      in live mode, swap all 5 `STRIPE_*` Railway vars to live (`sk_live_…`/`whsec_…`).
- [ ] **Email delivery** for fulfilling paid reports (currently manual from `reports@thirdocular.com`).
- [ ] Clear test orders/leads from Supabase before the live launch (or accept they're test rows).
