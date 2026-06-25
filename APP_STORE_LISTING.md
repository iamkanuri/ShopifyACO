# Shopify App Store listing — draft (AisleLens)

Copy-paste starting point for the Partner dashboard listing. Public name is **AisleLens**
(never "Shopify…" — trademark). Review/adjust before submitting. The required legal/support
pages are live in-app (see URLs below); set `CONTACT_EMAIL` on Railway so the support/contact
links resolve.

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
Primary: Marketing / Store data & analytics. Secondary: Marketing — SEO (AI/answer-engine optimization).

## Pricing summary (shown on listing)
- **Free** — quick AI visibility scan + competitor leaderboard.
- **Full report — $29 one-time** — deeper prompts, gap analysis, fix roadmap.
- **Weekly monitoring — $49/mo** — recurring scans, share-of-voice trends, alerts.
- **Founder beta — $99** — deep scans + direct founder review.
(Stripe is in TEST mode until KYC; prices above match the live plan config.)

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
