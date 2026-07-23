# AGENTIC INSTRUMENT TEST — STAGE 4 — Phase 0D Fix Studio Invocability Audit

Date: 2026-07-23 · Branch: `feat/agentic-instrument-stage4` (off stage-3 head `4d575ba`)

## 1. Fix Studio module structure (read-only findings)

- **Proposals** are `fix_proposals` rows (`src/db/fixes.ts`, migration `0011`):
  shop_domain, kind (`write_products` | `copy_ready`), target, product_gid,
  `based_on` (conflict baseline), `proposed_value`, status lifecycle
  (proposed → approved → applied | failed | conflict | rolled_back | dismissed),
  `applied_snapshot` (before/after state for rollback).
- **Approval state** = the status column; `approveProposal(shop, id, actor)`
  gates 'proposed' → 'approved'.
- **Apply** (`src/fixes/apply.ts#applyProposal`): approval gate → scope gate
  (`hasWriteScope(shops.scopes)` requires `write_products`) → token via
  `getAccessToken(shop)` (decrypted from local `shop_credentials`) →
  conflict re-read (`rereadProduct` vs `based_on`) → GraphQL `productUpdate`
  (`src/fixes/source.ts`) → post-write re-read snapshot → audit row.
- **Rollback** (`rollbackProposal`): conflict-checked against the value the
  store actually held after apply (`applied_snapshot.applied`), restores
  `applied_snapshot.before`, audited.

## 2. Headless invocability — YES, with one additive completion + two data steps

The service layer is **already headless**: `approveProposal/applyProposal/
rollbackProposal` take `(shop, id, actor)` — no HTTP session, no App Bridge.
The token source is the LOCAL `shop_credentials` row, which has held the
Amendment-1 dev-store token since Stage 2. **No injected-client refactor is
required.** What IS required:

1. **Additive code completion (Rule 3, disclosed):** `writableField()`
   (`src/fixes/propose.ts`) maps only `seo.title`/`seo.description`.
   `buildProductInput` and the mock write layer have implemented
   `descriptionHtml` since Phase 6, but BOTH the `WritableField` type union and
   the target mapping excluded it, making the path unreachable. Stage 4 widens
   the union and adds the missing `case "descriptionHtml"` — both additive;
   no production call site can produce this target today (verified by grep:
   the proposal generator emits only seo.* write targets).
2. **Data steps (no code):** update the local `shops.scopes` to include
   `write_products` (the physical token has had it since Stage 2; the row
   recorded only `read_products`) — else the scope gate correctly refuses;
   `SHOPIFY_MODE` stays `live` (default) so `productUpdate` hits the real API.
3. **Identity assertion (Amendment 1):** performed by the experiment driver
   (`{ shop { myshopifyDomain } }` asserted) immediately before every write
   step, since Fix Studio itself has no such gate (backlog note).

**Latent production finding (disclosed, NOT fixed here):** for
`descriptionHtml` targets, the conflict check reads `live["descriptionHtml"]`
but `rereadProduct` returns a `NormalizedProduct`, which stores the STRIPPED
plain text under `description` and has no `descriptionHtml` property — the
comparison degrades to `"" === based_on`, i.e. the conflict gate is
**vacuous for description writes**. Stage 4 exercises it as-is and records the
vacuous pass honestly; REAL conflict semantics are demonstrated on the
`seo.description` rollback probe (fully-mapped path). Fixing the field
read is Fix Studio backlog, not experiment scope.

**Metafields are outside Fix Studio's writable universe entirely.** The Stage 4
fault removes the description sentence AND the `custom.aluminum_free`
metafield (spec 4.2); the FIX therefore splits: the description restoration
goes through Fix Studio's production actuator (sufficient alone to make c1
`evidenced` — description is an acceptable surface); the metafield is restored
by the tagged Amendment-1 revert mechanism, disclosed in the case + report.
Metafield write-back is item #1 on the Fix Studio backlog list.

## 3. Diagnosis → proposal input mapping

`FixProposal` needs: productGid, kind=`write_products`, target
(=`descriptionHtml`), label, currentValue (faulted description),
proposedValue (restored HTML from the pending-revert marker), basedOn
(= what the conflict check will actually read for this target — see the
vacuity finding; recorded as such), rationale, evidence (finding kind =
EVIDENCE_GAP, constraint, scan verdicts). Adapter: instrument diagnosis
(constraint c1, root cause EVIDENCE_GAP, scan surface inventory, exact
restoration text) → `FixProposal` → `createProposal()`.

## 4. Sync path + cost of two more syncs

Proven in Stages 2–3: `sync-dev-catalog.ts` (upsertShop → storeCredentials →
`syncCatalog`) pulls the 19-product catalog in ~5s, $0 (Shopify reads are
free). Two additional syncs (post-fault, post-fix) are negligible.

## 5. Compiler id fix (Stage 3 finding)

Constraint ids are generated in `compiler.ts` (`x${i}-${attribute.replace(/_/g,"-")}`)
— the hyphenated snake_case round-trip is what Gemini mangled. Round-trip-safe
format specified and implemented: **lowercase alphanumerics only, no internal
separators** (`x1aluminumfree`), ≤32 chars — nothing for a model to convert
(property test 42).

## Decision

**PROCEED.** No abort condition met: the apply path needs only the additive
`writableField` case (not surgery), and the Amendment-1 write path to the dev
store exists and is proven.
