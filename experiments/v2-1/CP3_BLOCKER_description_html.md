# CP3 BLOCKER — the confirmed-claim write flattens a merchant's HTML description

> ## ✅ FIXED 2026-07-25 (v2.1 CP2.5, commit `fffa0fd`)
>
> The fix shape below was implemented as written, plus one thing the analysis missed:
> **the proposal is built from the DB, not from a live re-read**, so `products.description_html`
> had to be added too (migration **`0027_product_description_html.sql`**) — otherwise the raw
> HTML never reached `proposeClaimStatement` regardless of what the types carried.
>
> `liveFieldOf` was **removed**, not repointed (as §3 anticipated): with raw HTML carried end to
> end, write field == read-back field for all three writable fields, so the indirection was dead
> weight. A `NOTE` in `propose.ts` records why it is gone.
>
> Verified by four tests, all run with every gate set (`RUN_DB_TESTS=1`, `SHOPIFY_MODE=mock`,
> `APP_ENCRYPTION_KEY`) so the write-path tests did not silently skip:
> markup survives apply byte for byte · rollback restores byte-identically · the conflict guard
> **engages** on a real mid-flight edit and leaves the merchant's newer edit untouched · the
> no-observable-effect guard still fires on this path.
>
> Both new guarantees were **mutation-tested**: restoring the stripped-text propose fails the
> markup test; disabling the conflict check fails the conflict test. The old test could not have
> caught either.
>
> ⚠️ **Existing rows:** a `descriptionHtml` proposal created before this change carries a stripped
> `based_on`, so it will now be refused as a `conflict` rather than applied. That is the safe
> direction — refuse, never clobber.
>
> **Still not done:** this is proven in mock only. The live walk (CP3) has not run — see
> `CP3_CREDENTIAL_BLOCKER.md`. `write_products` has still never executed against a real store.

**Found:** 2026-07-24, during CP1 (while tracing the `descriptionHtml` conflict guard the brief
asked CP3 to prove non-vacuous). **Status:** FIXED 2026-07-25 (see banner). **Severity:** was a
blocker for CP3's apply step.
**Introduced by:** V2 CP3 (`proposeClaimStatement`), **not** by the v2.1 CP0 merge — the merge only
preserved the write capability. It is reachable on the V2 branch tip too.

---

## The defect

`proposeClaimStatement` (`src/fixes/propose.ts`) builds the proposed value from the **plain-text**
description and writes it into the **HTML** field:

```
proposed = (p.description ?? "").trim() + "\n\n" + sentence     // plain text
target   = "descriptionHtml"                                     // HTML field
```

`CatalogProduct.description` is plain text by construction — `src/catalog/normalize.ts:137` does
`description: stripHtml(node.descriptionHtml)`, and the comment at line 50 says so outright
(*"Strip HTML to plain text (descriptions arrive as descriptionHtml)"*). **No type in the codebase
retains the raw `descriptionHtml`** for a stored product: `CatalogProduct` has only
`description: string | null`, and `NormalizedProduct` likewise.

`buildProductInput` then sends `{ id, descriptionHtml: <that plain text> }`
(`src/fixes/source.ts:73`).

### Concrete failure

A merchant whose product description is:

```html
<p>Cold-pressed in small batches.</p>
<ul><li>Aluminum-free</li><li>Unscented</li></ul>
<p><b>Free returns</b> within 30 days. <a href="/pages/care">Care guide</a></p>
```

confirms "yes, this product is aluminum-free", approves the proposal, and clicks apply. The store's
description becomes:

```
Cold-pressed in small batches. Aluminum-free Unscented Free returns within 30 days. Care guide

This product is aluminum-free.
```

Every paragraph, the list, the bold, and the link are **destroyed**. The mock fixture makes it
visible at $0: `src/catalog/source.ts:132` seeds `<p>Description for <b>product 1</b>.</p>`, which
would be written back as `Description for product 1.`

### Why this is an honesty-spine violation, not just a bug

The proposal's own rationale text promises the opposite:

> "This appends one plain sentence and **changes nothing else**."

That statement is false as written. The merchant approves the write on the strength of it. The
whole point of the confirmed-claim path is that the merchant authorizes a *specific, minimal*
edit — so a write that silently rewrites their entire body copy is exactly the failure the gate
exists to prevent.

### Why nothing catches it today

- **The conflict guard does not catch it.** It compares `live.description` (plain) against
  `based_on` (plain) — consistent, so it correctly detects *merchant edits*, but it is blind to
  markup loss because both sides of the comparison are already stripped.
- **The no-observable-effect guard does not catch it.** Post-write `stripHtml(plain text)` ≈ the
  plain text written, which differs from the pre-write value (the sentence was appended), so the
  guard sees a real change and reports `applied`. The markup loss is invisible to it.
- **Rollback would restore only the flattened text**, because `snapshot.before` is
  `live[liveFieldOf(field)]` = the **stripped** description. So the rollback promise is also
  broken: rolling back leaves the merchant with plain text, not their original HTML.

That last point is the most serious: **the write is not actually reversible for this target.**

---

## Fix shape (not applied — needs a decision)

The write path needs the raw HTML end to end:

1. Carry raw HTML alongside the stripped text: add `descriptionHtml` to `NormalizedProduct` and
   `CatalogProduct`, keeping `description` (stripped) as-is — evidence matching and the claim
   linter depend on the stripped form, so it must not change.
2. `proposeClaimStatement` appends a block to the **raw** HTML (`<p>{sentence}</p>`), and sets
   `basedOn` to the raw HTML.
3. `liveFieldOf("descriptionHtml")` must then resolve to the **raw** field for both the conflict
   baseline and the rollback snapshot — which means `rereadProduct` has to expose raw HTML, not
   just the normalized product.
4. Re-point the mock write/read overlay in `src/fixes/source.ts` at the raw field so mock exercises
   the same path.
5. Only then is the "appends one sentence and changes nothing else" promise true, and only then is
   rollback genuinely reversible.

Note this partly **undoes** the `liveFieldOf` indirection that V2 added: `liveFieldOf` exists
because the write field and the read-back field differ. Carrying raw HTML makes them the same
field again, which is simpler and safer than mapping between two lossy representations.

## Deploy safety in the meantime

**Deploying is safe.** Reaching this code requires: an installed shop → an authenticated Buyer Test
→ the merchant answering "yes" to a requirement → a proposal → explicit approval → apply. Only the
dev store is installed, and `write_products` apply has never run against any real store. Nothing on
the public funnel touches it.

**CP3 must not run the apply step on a dev-store product whose description contains HTML worth
keeping** until this is fixed — and per the marker-first rule, the revert marker for that walk must
capture the **raw `descriptionHtml`**, not the stripped text, or the revert itself will not restore
the original.
