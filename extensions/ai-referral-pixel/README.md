# AI Referral Pixel (Phase 10)

A Shopify **Web Pixel extension** that detects storefront sessions arriving from an AI
assistant (ChatGPT / Perplexity / Gemini / Copilot / Claude) and beacons consent-gated,
**directional** funnel events to the AI Visibility ingest endpoint.

> **Directional, not causal.** AI assistants frequently strip the referrer, so this
> *undercounts* — treat the numbers as a floor for "identifiable AI-referred sessions".

## What it does
- Runs in the `strict` sandbox (no DOM access).
- On the landing page, classifies the referrer/`utm_source`. If it's an AI assistant, it
  stores the original referrer + a random session id in `sessionStorage`.
- Beacons `session_start` once, then `product_viewed` / `checkout_started` /
  `checkout_completed` for the rest of the session — all attributed to the original AI
  source (the **server** re-classifies authoritatively).
- Only runs with **analytics consent** (enforced by `customer_privacy` in the toml).

## Deploy (merchant / app owner)
```bash
# from the repo root, with the Shopify CLI authenticated to the Partner app
shopify app deploy
```
Then in **Shopify Admin → Settings → Customer events**, the "AI Referral Pixel" appears.
Fill its settings:
- **Ingest URL** → `https://lens.thirdocular.com/api/pixel/ingest`
- **Shared secret** (optional) → must match `PIXEL_SHARED_SECRET` on the server if set.
  (Anti-noise only — it ships to the browser, so it is **not** authentication.)

Activate the pixel. Verify by visiting the store with
`?utm_source=chatgpt`, then check **/app** → AI referral attribution.

## Privacy
No PII is sent: a random session nonce, the referrer **host** only, the landing **path**
(query stripped), and the event type. The server stores no raw IP (only a salted hash).
