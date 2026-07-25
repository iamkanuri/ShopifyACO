# CP3 — the live authenticated walk (run 2026-07-25)

**Result: PASSED — 44 assertions, on the real dev store, with `SHOPIFY_MODE=live`.**
`write_products` had never executed against a real store before this. It has now, and it was
reversed.

Script: `experiments/v2-1/cp3_walk.ts` (gitignored — session artifact, not shipped code).
Re-runnable; `--revert` restores from the marker alone.

## ⚠️ Correction: the dev store's domain

The task brief (and this repo's mock fixture) named the dev store
**`ai-visibility-dev.myshopify.com`**. That is **not** our store — the real one carries a
suffix, as `IMPLEMENTATION_STATUS.md:96` has recorded correctly since the OAuth install.

The short domain **resolves to a live, third-party Shopify store**. Following the brief, this
session sent Admin API auth attempts there and got HTTP 401 — which was initially, and
wrongly, read as "our token was revoked". Nothing was read or written on that store; an
invalid token was rejected. Corrected everywhere before any write ran, and the stale string
in the mock fixture (`src/catalog/source.ts`) is fixed so the next reader can't repeat it.

**Lesson worth keeping: a 401 against a store you don't own looks exactly like a revoked
token against a store you do.** The identity assertion (`{ shop { myshopifyDomain } }`) is
what distinguishes them, which is why rule 4 requires it before *every* write.

## Safety contract, as executed

- **Identity asserted immediately before every write**, never cached — including before the
  revert write. Four writes total, four assertions.
- **Marker-first.** The original raw `descriptionHtml` was written to
  `cp3_revert_marker.json` **before** the first write, with a standalone revert command.
- **The first attempt FAILED and the machinery worked.** An over-strict assertion tripped at
  the staging step; the script reverted, verified the store against the marker, removed the
  marker, and exited non-zero — leaving the store clean without intervention.
- **Ending state: the dev store's body is byte-identical to its pre-session baseline**, and
  no marker remains. Asserted, not assumed.
- The dev-store token stored in the local DB for the run was deleted in cleanup.

## What the walk proved

| # | Step | Assertion | Result |
|---|---|---|---|
| 1 | baseline | raw `descriptionHtml` captured, marker exists before any write | ✅ |
| 2 | stage markup | paragraphs + list + bold + link present after Shopify's own normalization | ✅ |
| 3 | catalog sync | `normalizeProduct` carries RAW html **and** still exposes the stripped view | ✅ |
| 3 | catalog sync | `products.description_html` persisted (migration 0027, live) | ✅ |
| 5 | authenticated run | unstated claim is **not** passed on public+catalog data (fails closed) | ✅ `not_proven` |
| 6 | merchant says **no** | **no proposal exists** | ✅ |
| 7 | merchant says **yes** | proposal = original bytes + exactly one appended block | ✅ |
| 7 | — | store still untouched at proposal time | ✅ |
| 8 | apply before approve | **refused**; store still untouched | ✅ |
| 9 | approve → apply | reported `applied` | ✅ |
| 10 | **independent Admin API read** | store body === pre-write body + exactly one block, nothing else moved | ✅ |
| 10 | — | `<ul> <li> <b> <a href=` all survived a **live** write | ✅ |
| 10 | — | snapshot holds the RAW pre-write html; records what the store *actually* holds | ✅ |
| 11 | catalog sync | mirror matches live raw html; stripped view in sync | ✅ |
| 12 | identical rerun | contract + engine pinned; `not_proven` → **`pass_evidenced`** | ✅ |
| 13 | rollback | independent read: pre-write body back, **byte for byte** | ✅ |
| 14 | restore | final state === pre-session baseline, byte for byte; marker gone | ✅ |

Verification at steps 10 and 13 uses a **separate** GraphQL read path, not the app's
`rereadProduct` — so the proof never depends on the code that performed the write.

## The finding that changed the walk: Shopify normalizes `descriptionHtml`

The first attempt asserted the staged body would read back exactly as sent. It does not:

```
sent   (267 bytes): …<ul><li>Arrowroot and magnesium hydroxide</li><li>No baking soda</li>…
stored (271 bytes): …<ul>\n<li>Arrowroot and magnesium hydroxide</li>\n<li>No baking soda</li>\n…
```

Shopify re-serializes the markup (here, inserting newlines between list items). This is not a
bug in our write path — and the app already handles it correctly, which is *why* `apply`
snapshots the verified **re-read** rather than the value it intended to write.

It does mean "byte for byte" has to be stated against the right pair of values. The walk
asserts the two that actually matter, and both are Shopify-normalized on both sides:

- **exactly one block appended:** post-write body, minus one trailing claim block, === the
  pre-write body the store held;
- **reversibility:** after rollback, the store holds the pre-write body **byte for byte**.

Comparing "what we sent" to "what is stored" would have been the wrong test — it would fail
on a correct implementation, and passing it would have required weakening the real assertion.

## Caveat: the public leg was not exercised

The walk covers **claim → authenticated run → confirm → propose → approve → apply → verify →
rerun → rollback**. It does **not** cover the public Buyer Test that normally precedes it,
because the dev store is password-protected (`302 → /password`), so its product pages are not
publicly readable. That is the same constraint already recorded for live diagnosis on this
store. Exercising the public leg end-to-end needs a published storefront, not more code.
