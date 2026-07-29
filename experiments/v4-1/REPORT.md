# v4.1 — MAKE IT LEGIBLE

Session 2026-07-29. Branch `feat/v4-1-legibility`, off `main` at `0cd03a5`.
Shipped in two pushes: **`be63eb7`** (Track A) and **`bf6d63c`** (Track B). Both live and
probe-verified.

---

## FOR THE FOUNDER — what a stranger now sees, in order

They paste a URL. If it isn't a product page they get a **card, not a red error**, that says
what this tests and why it needs a product URL — and if they pasted a store root it shows
them the exact shape to use instead, with links to a real result and to the standard itself.
If it is a product page they get a verdict table that now **says which layer produced it**:
"General buyer task — these requirements were generated for this specific product, not taken
from a published standard." Below it, one button: **run Coffee Standard v1.3 against this
product**. On a coffee product that returns ten rows, each carrying its **entry ID as a
clickable citation**, the standard's **content hash**, and under every row a peer line —
*"96 of 100 coffee stores don't state this either."* On anything else it returns an honest
refusal naming the signal it used (*"we read this page's category as `Dish - Bulk` from its
product type"*), and says the general result still stands. Behind all of it, the page an
agency lands on when they follow a citation no longer argues with itself.

---

## 0. DISCOVERY FIRST — and it moved the whole session

The brief assumed the problem was the result page. It was not. Five parallel read-only
surveys plus an adversarial verifier established, **by execution against production**:

**`/test` has never run a published standard.** Its response carries no `standard` and no
`contractVersion`, for a coffee product exactly as for a bath mat. Coffee Standard v1.3
executed in exactly one place — `/demo`, against a frozen capture of one store. Meanwhile
`copy.ts:166` told every visitor AisleLens *"executes a published buying standard against
the page"*, next to a button that delivered the general engine. **The user's reported
confusion was a literal false statement on the landing page.**

**And the citation surface was self-contradicting in production.** All verified against the
served bytes before anything was touched:

| defect | what a reader saw |
|---|---|
| `_comment` leak | *"the test did not run — 0 pairs tested"* rendered as a finding |
| per-kind table | headline **483 / 11**, table below summing to **488 / 18** |
| hand-typed prose | *"507 rows … eighteen … 0.83% to 7.80%"* — all superseded |
| stale limits | a *"$1000.00 mug"* alarm about defects v3.8 closed |
| no `og:image` | all 181 standards pages unfurled as bare text cards |
| dead citation | HTTP **200** with an empty body |

---

## 1. THE FOUR CASES, BEFORE AND AFTER

| URL | before | after |
|---|---|---|
| **coffee product** (`stumptowncoffee.com/products/hair-bender`) | unlabelled 9-row generated table; no standard, no citation, no peer context | same table, now **labelled** as the general layer + one click to **ALS-COFFEE v1.3**: 10 rows, hash `ba2050578ed0`, `c1s-f3967d50`, entry IDs as citations, a peer line per row |
| **non-coffee Shopify** (`dropps.com/products/…`) | identical unlabelled table; nothing said why no standard appeared | labelled general layer; standard button returns an honest refusal — `out_of_category` via `product_type = "Dish - Bulk"`, 10 entries skipped with reasons, general result explicitly still stands |
| **non-Shopify** (`nike.com/t/…`) | red banner: *"Paste a Shopify product URL"* | a card explaining what this tests, that Shopify product endpoints are what the engine reads, and that this is *"a limit of what we've built, not a judgement about the store"* |
| **Shopify store root** (`klatchcoffee.com`) | **the identical red banner** — the discriminator is the path, not the platform | told apart: *"That's a store, not a product page"*, with the exact URL shape to use and links to `/demo` and the standard |

---

## 2. THE PEER LINE, AND THE TRAP INSIDE IT

Ten coffee entries carry published per-entry measurements. Pass count is derived as
`adjudicated − failed` so it cannot drift. **`test/publicStandard.test.ts` asserts the
figures reconcile, that the denominators are still mixed, and that at least one entry still
carries undecided rows** — otherwise the guard would be asserting nothing.

⚠️ **"X of 100 coffee stores" is FALSE for five of the ten.** 24 products publish no Product
schema, so `IDENT-001` was asked of 76; one is pre-portioned, so the FORMAT and GRIND
entries were asked of 99. And `DELIV-001` was **asked of 100 and could only be decided on
74** — the other 26 returned "requires store access". Counting an undecided row as a pass is
a different measurement, and this project has published both by accident: v1.1 stated 45%,
the adjudicated reading is 60.8%. **A 15.8-point gap from one denominator choice.** The
rendered sentence names the denominator it used, every time.

Rates are read through **`measuredOf`, never the raw field** — v1.3 carries `IDENT-001`'s
rate in its *sidecar* and the other nine inside the document, so reading `standard.json`
directly publishes 94.7% where the current record is 97.4%. **Fourth distinct instance of
that defect in this codebase; the first three all shipped.**

---

## 3. WHAT WAS CUT

- The result page's closing line sold the retired product (*"how live AI assistants
  currently answer questions like this in your category"*) and sat **outside the lint
  surface entirely**.
- Two landing-page paragraphs stating measurements the viewer bundle **cannot derive**
  (162/ten and 507/eighteen, against artifacts reading 160/7 and 483/11). A test now forbids
  any percentage or audit count in that prose.
- `/scan` and `/index` removed from `sitemap.xml`, `/test` added — the sitemap was telling
  crawlers and AI readers to prefer the retired funnel.
- The Methodology page's *"AI Commerce QA"* framing and its **second, colliding sense of the
  word "standard"** (*"this page is the standard every result is held to"*).
- Terms and Support defined the product as the retired share-of-voice scanner.

**Deliberately NOT cut:** the `Available as a one-time purchase` row, which I measured as
`pass_no_blocking` on **349 of 349** stores — genuinely zero information. Removing it means
editing `buildBuyerTask` in `productTest.ts`, which is a matcher file, and the brief forbade
firing the tripwire. **Filed, not done.**

---

## 4. WHAT THIS BRIEF GOT WRONG

1. **`OUTREACH_PACK.md` was never delivered.** Not in Downloads, not in the repo. CP-3 had
   no placeholders to fill, so it did not run.
2. **The brief assumed two layers already shared one URL box.** They did not — there was one
   layer, and the second existed only on `/demo`. That reframed the session.
3. **"5.17% general bound" was right, and `CLAUDE.md` is stale** — it still says 7.53% / 488
   rows. The artifact says 5.17% over 483 rows with 11 confirmed.
4. **"Coffee has the n=100 per-entry rates" is half true.** Five of ten have denominators of
   99, 76 or 74, each for a recorded reason.
5. **The brief expected the tripwire to stay silent, and it did** — but only because the
   standard wiring was deliberately kept out of `productTest.ts`. The obvious implementation
   (threading a classifier into `runProductTest`) would have fired it.

---

## 5. WHAT DID NOT SHIP, STATED PLAINLY

- **CP-2, the agency one-pager.** Not built. Discovery found a hard blocker worth recording:
  the single `@media print` block names no `details`, no `.std-page` and no `.pt-*`, so
  **every collapsed section is dropped from a printed PDF today** — including on the existing
  `/report` print button. A one-pager built before that CSS is extended would forward with
  its evidence missing, which is worse than not having one.
- **CP-3, the outreach numbers file.** Blocked on the missing pack (above). The derivable
  half — the ten per-entry peer rates with their true denominators — is now live in the
  product and reproducible from `experiments/v4-1/standard_run_probe.ts`.
- **The "what an AI sees" two-column panel.** Not built. Discovery established it is fully
  supported by the existing extraction layer with no new capability.

**Verification limitation:** JS-off is fully verified (curl + both probes, 21/21 and 15/15).
JS-on is verified structurally — typecheck, viewer build, a successful real-browser
navigation, and direct API responses matching what the component renders. I could **not**
read the DOM back: the browser tool returned "Policy check temporarily unavailable" on every
call, as it did last session.

---

## GATES

```
no matcher file in the WHOLE-SESSION diff        productTest · testEvidence · subject ·
                                                 crawler/extract · referent — none touched
ENGINE_VERSION                                   v2.4.0, unchanged; tripwire silent
standard hashes                                  all four frozen (fitness.json is a sidecar)
npm test                                         1,053 · 977 pass · 0 fail · 76 skipped (+7)
npm run typecheck                                clean
viewer build                                     clean
production probes after each push                VERIFIED_CLEAN 21/21 and 15/15
same-push invariant                              no published figure re-rendered
```
