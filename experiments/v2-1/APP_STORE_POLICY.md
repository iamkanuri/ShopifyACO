# CP4 — Verifying the App Store install-entry-point policy claim

**Date:** 2026-07-24 · **Method:** 4 independent research lenses over primary Shopify docs, then
one adversarial fact-checker per load-bearing claim (72 agents; **19 claims survived, 48 were
refuted or corrected**). Everything below was retrieved 2026-07-24; no Shopify page displays a
last-updated date and the requirements page states it is subject to change.

---

## 1. Verdict: V2's policy read was CORRECT

The V2 session asserted that App Store requirement **2.3.1** requires installs to begin on
Shopify's surface. **That is right — it was not a misremembering and not a stale number.**

Requirement **2.3.1** exists, is titled **"Initiate installation from a Shopify-owned surface,"**
and its first sentence is a mandate:

> "Apps must be installed and initiated only on Shopify services."

— [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements), §2.3.1.
The §2.3 section intro restates it: *"Apps can only be installed and initiated on Shopify services."*
Requirement 2 ("Functionality") contains exactly 2.1, 2.2, 2.3 — no 2.4+ — so there is no
renumbering that could have drifted.

**This means the V2 decision to build the storefront-host-match fallback was the right call.**
The instruction for this checkpoint was "do not architect around an unverified policy reading" —
the reading is now verified, and it supports what was built.

Three refinements to how the claim was *used*:

1. **2.3.1 has two cumulative mandates, not one.** The second: *"Your app must not request the
   manual entry of a myshopify.com URL or a shop's domain during the installation or configuration
   flow."* This is the concretely testable clause. Satisfying it does **not** by itself satisfy
   sentence one — they bind independently.
2. **"Initiated" is never operationally defined.** No primary page says whether a marketing-site
   button that hands off to the App Store listing counts as initiating on a Shopify surface. That
   line is **not established**.
3. **Install/OAuth rules are not confined to §2.** They also touch 1.1.1 (embedded apps must work
   without third-party cookies), 2.2.2, 2.2.3, 3.2.x (justify sensitive scopes — relevant to our
   `write_products` / `write_pixels` / `read_customer_events`), 4.5.4–4.5.5, 1.2.1. Treating §2.3
   as the whole compliance surface is a mistake.

Do **not** conflate 2.3.1 with the 2019 changelog "Enabling Install Requirements" — that is about
store *eligibility filters* (geographic/sales-channel gating) in the submission form.

---

## 2. Which continuity mechanism is permitted

**The storefront-host-match fallback. Not `?t=`.** And the decisive reason is *mechanical*, not
policy.

### The managed-installation wrinkle settles it

> "Shopify managed installation is an installation method where Shopify installs an app and
> updates its access scopes **without making any calls to the app**"

— [App installation](https://shopify.dev/docs/apps/build/authentication-authorization/app-installation),
which also lists the benefit *"No browser redirects during installation or updates."*

AisleLens is `embedded=true` + token exchange, so this **is** our path. Therefore:

- **No app-owned endpoint participates in the install handshake.** There is no app-controlled
  redirect hop for a `?t=` to ride on, and no OAuth `state` nonce to piggyback, because the app
  never builds the authorize URL.
- The app's own endpoint can still *mint and store* a token server-side before handoff — Shopify
  simply carries nothing forward. Re-identification on the far side must use only
  Shopify-supplied inputs.
- **The first framed load IS app-controlled.** Shopify appends its own parameters to the app URL
  (`embedded`, `hmac`, `host`, `id_token`, `locale`, `session`, `shop`, `timestamp`). So "there is
  nowhere app-side to act" would be wrong — what is gone is the *install-time* redirect. This is
  exactly what the repo's existing `POST /api/shopify/token` bootstrap already handles.

### Host-match: undocumented, but violates nothing

It requires no domain entry (2.3.1 ✓), happens after OAuth (2.3.2 ✓), and lands on the app UI
(2.3.3 ✓). Shopify neither describes nor forbids it — it is **our inference from documented
primitives** (the first framed load's `shop` parameter), not a sanctioned pattern.

### `?t=` — ambiguous on policy, effectively closed on mechanics

Unambiguous: **asking the merchant to type their shop domain on the public site is forbidden
outright** by 2.3.1 sentence two. Ambiguous: whether a site→listing hand-off violates sentence
one, and whether *any* custom query parameter survives a listing install into the app's first
load — **no primary source addresses that in either direction**. Only Shopify Partner support or
an actual review outcome can resolve it; docs cannot.

### Ruled out on evidence: cookie continuity

> "All apps rendered in the Shopify admin need to use session tokens because third-party cookies
> won't work with browsers that restrict cross-domain data access."

— [Session tokens](https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens).
A cookie set top-level on `lens.thirdocular.com` is third-party inside the admin frame.

---

## 3. What 2.3.2 / 2.3.3 constrain (and don't)

- **2.3.2 "Authenticate immediately after install":** *"Your app must immediately authenticate
  using OAuth before any other steps occur. Merchants should not be able to interact with the user
  interface (UI) before OAuth."* Note the modal split — first clause `must`, UI clause `should
  not`. 2.3.4 repeats the must for reinstalls.
- **2.3.3 "Redirect to the app UI after installation"** constrains the **destination, not the
  payload.** Nothing in requirements 1–5 governs what the first authenticated screen may *contain*.
  So showing the merchant their already-run Buyer Test is **permitted by silence** — not endorsed.
  It must not be interactive before token exchange completes.

**A marketing site is assumed and external traffic is encouraged** — §4.4.1 tells partners to put
statistics *"on your website and landing pages instead"*, and the
[marketing guidance](https://shopify.dev/docs/apps/launch/marketing) says driving external traffic
*"can help improve your app's ranking."* So 2.3.1 is not hostile to a public funnel per se; it
constrains where the **install** begins, not where the **interest** begins. That is precisely the
shape AisleLens already has.

**Built for Shopify is an optional badge tier, not review criteria.** Do not cite BFS 3.1.3 or
4.2.3 as install requirements.

---

## 4. If `?t=` were pursued anyway — the cost list (NOT a recommendation)

Per the brief, this is noted, not built:

1. **Opt out of managed installation** (`use_legacy_install_flow = true` under `[access_scopes]`)
   to regain an app-controlled redirect and a `state` param — accepting Shopify's own stated
   downside that scopes can then diverge per installation, and leaving the recommended path.
2. **Obtain the shop domain without the merchant typing it** — 2.3.1 sentence two forbids manual
   entry, and no documented mechanism exists for a public page to learn it.
3. **Keep install origin on a Shopify surface regardless** — sentence one binds independently, and
   self-hosted install links hard-error for apps created after 2019-12-05.
4. **Empirically verify a custom param survives** a listing install through to `application_url` —
   undocumented in both directions, untested here.
5. **Handle HMAC verification** for any param riding a Shopify-signed request. *(Inference: a param
   appended after Shopify computes the HMAC breaks verification. No doc states this.)*
6. **Get a Partner support / app review ruling** before depending on it commercially.
7. **Preserve 2.3.2 ordering** — a carried test may render only after token exchange.

A cheaper unverified variant: show a **claim code after install** rather than carrying state
through it — plausibly outside 2.3.1 since it is neither the installation nor the configuration
flow, but **no primary source confirms that reading**.

---

## 5. Confidence and limits

**Verified (high confidence, primary sources, load-bearing quotes taken from raw markdown and
cross-checked on independent fetches):** 2.3.1's existence, title and both sentences; 2.3.2/2.3.3/
2.3.4 wording; Requirement 2 has only 2.1/2.2/2.3; managed installation makes no calls to the app
and involves no install-time redirects; embedded admin apps use token exchange; the legacy flow
remains available and is discouraged; the Shopify-supplied first-load parameter set; session tokens
exist because third-party cookies fail; listing-traffic params reach the partner's analytics, not
the app; BFS is optional.

**Verified with a fidelity caveat:** the two `help.shopify.com` quotes (including the 2019-12-05
third-party-install-link rule) came through a summarizing fetch layer because that host blocks
curl — run twice with different prompts plus a corroborating search snippet, all agreeing. That
rule is load-bearing for §4 item 3; worth one human eyeball.

**Inferred, flagged as ours, not documented:** that appending a param after signing breaks HMAC;
that storefront-host matching is a viable reconciliation key; that first-party cookies from the
public site are unusable in the admin frame; that a marketing-site → listing link satisfies
"initiated on Shopify services."

**Not established:** the operational meaning of "initiated"; whether custom query state survives
any Shopify-mediated install (absence of documentation, *not* documented prohibition); how app
review treats this in practice.

**Practical note for future work:** cite requirement **heading text**, not numbers, in code
comments and checklists — the numbering on that page has shifted historically.
