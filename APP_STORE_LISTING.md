# Shopify App Store listing — draft (AisleLens)

Copy-paste starting point for the Partner dashboard listing. Public name is **AisleLens**
(never "Shopify…" — trademark). Review/adjust before submitting. The required legal/support
pages are live in-app (see URLs below); set `CONTACT_EMAIL` on Railway so the support/contact
links resolve.

---

## Shopify form fields — exact character limits (copy/paste)

(All ASCII — no em dashes / smart quotes, so nothing pastes as a garbled character.)

**App introduction** (<=100):
Are AI assistants recommending your store, or your competitors? Measure it, then fix it.

**App details** (<=500):
Shoppers increasingly ask ChatGPT, Gemini, and Perplexity what to buy. AisleLens measures whether those assistants recommend your products versus competitors, shows your share of voice, and flags your weakest assistant. It diagnoses why competitors win, tied to the exact buyer prompts you are losing, and proposes reviewable fixes you approve before anything changes (conflict-checked and reversible). Then verify whether it moved the needle, with real statistics. Start free.

**App features** (max 5, <=80 each):
1. Measure if ChatGPT, Gemini and Perplexity recommend you, with sample sizes.
2. See your share of voice vs named competitors, and your weakest engine.
3. Diagnose why competitors win, tied to the exact prompts you are losing.
4. Apply reviewable SEO fixes: conflict-checked and one-click reversible.
5. Verify changes with before/after stats; monitor visibility with alerts.

**Demo store URL**: optional. AisleLens runs in the admin (nothing renders on the storefront), so either leave it blank OR use the public demo `https://lens.thirdocular.com/demo` if the field accepts a non-Shopify URL. Do NOT put the password-protected dev store here — give the reviewer the dev store + test steps in the separate review-instructions field.

---

## App name
**AisleLens — AI shopping visibility**

## Tagline (short, ~62 char max)
Are AI assistants recommending your store — or your competitors?

## Short description (~100–120 words)
Shoppers increasingly ask ChatGPT, Gemini, and Perplexity "what should I buy?" AisleLens
measures whether those assistants mention and recommend *your* products versus competitors,
shows your share of voice, then helps you close the gap. Connect your store and AisleLens
benchmarks buyer-intent prompts across multiple assistants, diagnoses *why* competitors win
(citing the exact lost queries), proposes reviewable fixes you approve before anything is
written back, and verifies whether a change actually moved the needle — with real statistics,
never vanity claims. Start free with a quick visibility scan.

## Key benefits (bullets)
- **Measure** AI visibility across ChatGPT, Gemini, and Perplexity — with sample sizes and confidence, not hype.
- **See your share of voice** vs named competitors, and which assistant is your weakest.
- **Diagnose why** competitors get recommended — tied to the exact buyer prompts you're losing.
- **Fix it safely** — reviewable proposals applied only after you approve them, conflict-checked and reversible.
- **Prove it worked** — before/after verification with confidence intervals; honest "inconclusive" when there's no detectable change.
- **Monitor** your visibility on a schedule and get alerted on credible changes (no cry-wolf).

## Categories
Primary: **Store data & analytics** (alt: Marketing & conversion). Secondary: **SEO** (AI / answer-engine optimization).
- **App attributes** (select only what's true): **Marketing & sales** ✓ · **Visuals and reports** ✓ ·
  **Customer behavior** ~ (only to surface the AI-referral attribution funnel — optional). Skip anything we don't do.
- **SEO → "what SEO tools can merchants use?"**: **Structured data / schema markup** (JSON-LD: Product,
  AggregateRating, FAQ) · **Meta titles & descriptions** (SEO title/description backfill) · **content /
  optimization recommendations**. Do NOT select: sitemaps, redirects, image alt-text, backlinks, page speed.
- **SEO → "how can merchants monitor performance?"**: **Dashboards & reports** (AI Visibility Score, share of
  voice) · **scheduled monitoring + alerts** · **before/after verification (confidence intervals)** ·
  **visibility / share-of-voice tracking over time**.

## Pricing — the Shopify App Store listing is FREE
Shopify requires in-app charges to go through the **Shopify Billing API**, so we list the Shopify app **free**
and merchants get full value (scan, dashboard, evidence, fixes) at no Shopify charge. The paid plans below run
on our own web product (`lens.thirdocular.com`, Stripe) — NOT through Shopify — and are **not** part of this
listing's pricing:
- Full report $29 · Weekly monitoring $49/mo · Founder beta $99 (web funnel only).
(Adding in-app paid plans for Shopify merchants later would require building the Shopify Billing API.)

---

## Required URLs (live in-app — paste these into the listing)
- Privacy policy: `https://lens.thirdocular.com/privacy`
- Terms of service: `https://lens.thirdocular.com/terms`
- Support / contact: `https://lens.thirdocular.com/support`
- Data deletion: `https://lens.thirdocular.com/data-deletion`
- App URL: `https://lens.thirdocular.com/app`
- OAuth callback: `https://lens.thirdocular.com/api/shopify/callback`

## Compliance / GDPR webhooks (already implemented + HMAC-verified, audit-only)
All point to `https://lens.thirdocular.com/api/shopify/webhooks`:
`customers/data_request`, `customers/redact`, `shop/redact` (mandatory) +
`app/uninstalled`, `products/create|update|delete`, `shop/update`.

## Scopes
`read_products` (catalog), `read_customer_events` + `write_pixels` (AI-referral Web Pixel
attribution), and `write_products` (Fix Studio one-click apply). `write_products` is used
**only** for the merchant-approved SEO title/description backfill — gated by explicit
approval, a live re-read conflict check, a rollback snapshot, and an audit log. Structured-
data fixes (JSON-LD, review schema) are copy-ready (one-click copy), never auto-written.

---

## Still needed from you (manual in the Partner dashboard)
- App **icon** (512×512) + at least 3 **screenshots** (Dashboard, Evidence, Fix Studio are good).
- A short **demo video** (optional but helps approval).
- Set `CONTACT_EMAIL` on Railway (e.g. `support@thirdocular.com`) so support/contact links resolve.
- Fill the listing fields above, then **Submit for review** (review typically ~1–2 weeks).
