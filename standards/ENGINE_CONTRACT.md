# ENGINE CONTRACT — what the AisleLens assertion engine can actually execute

**Derived from the code at commit `9843cb6` (`main`, == production `/healthz`), not from any
brief.** Every claim below cites the file and line where it is decided. Where the task brief that
commissioned this session disagreed with the code, the code wins and §8 records the difference.

Read this before authoring a single assertion. A standard whose assertions the engine cannot
execute is a document, not a standard — and the way that failure actually arrives is not "the
compile step errored". It arrives as an entry that compiles, runs, and quietly means something
other than what the `question` field promised a shopper.

> ### ⚠️ Re-pinned at v3.4 CP-2, and reading was not how it was checked
>
> This document was pinned to `96ceacd` and had not moved since. `src/server/productTest.ts`
> grew from **1,600 to 2,267 lines** across 12 commits in the interval (720 insertions, 53
> deletions), so nearly every citation in it was wrong while still
> *looking* right — a line number is the one kind of claim that rots invisibly, because a stale
> one still resolves to a real line of real code.
>
> Every citation was re-verified **by execution**, not by reading:
> `experiments/v3-4/verify_contract.mjs` takes the bytes of each cited line at the document's own
> pinned base commit and locates them at HEAD, resolving each to MATCH / MOVED / GONE. Measured
> over the **112** citations it then found (106 here, 6 in [`compile.ts`](compile.ts)):
>
> | | | |
> |---|---:|---|
> | `MATCH` — still correct | **18** | |
> | `MOVED` — points at real code, the wrong code | **70** | |
> | `GONE` — the cited bytes no longer exist at all | **11** | the code changed, not just its position |
> | unresolvable by the script | **13** | bare `:N` citations naming no file |
>
> **81 of 112 citations were outright wrong**, and not one of them looked wrong. Re-running the
> corrected document against HEAD now returns **119 / 119 MATCH, 0 unresolvable — `VERIFIED_CLEAN`**.
> The count rose from 112 to 119 because of finding 1 below; every bare `:N` was also expanded to
> name its file, so the document is now mechanically checkable end to end with nothing left to
> adjudicate by hand.
>
> **Four findings from that pass are worth more than the corrected numbers**, because each is a way
> a verification reports clean while being blind:
>
> 1. **The verifier could not see inside ```` ```ts ```` fences, and that is where the worst claim
>    was.** It scanned markdown backtick *spans*; a fenced block contains no inline backticks, so
>    six citations here were never extracted or checked — including the one under this document's
>    single most emphatic sentence, *"Eight kinds. There is no ninth."* `ReqKind` has had nine since
>    v3.1 CP1 (§1). **The check that would have caught it was silently not running.**
> 2. **It extracted ZERO citations from `compile.ts` and reported a tally that looked complete** —
>    same root cause, different file type. The script now **aborts** on a document that yields no
>    citations, because "found nothing" and "nothing is wrong" are the same output.
> 3. **A unique byte match is not the right match.** `evaluate` is a switch whose branches were
>    written from one another. The CLAIM branch's lint pre-filter gained a surface filter, so its
>    old bytes now occur exactly once at HEAD — **in the `delivery` branch**. The resolver found one
>    hit and confidently re-pointed a claim-row citation at a delivery row.
>    `experiments/v3-4/check_context.mjs` re-derives each citation's enclosing construct at both
>    commits and flags any that changed; it caught this one and cleared five look-alikes in the
>    `origin` tombstone.
> 4. **Re-anchoring a range's two endpoints independently can invert it.** §1.1's range was rewritten
>    with a start of 1625 and an end of 1127 — an end *below* its start, which is not a citation but
>    a corruption, produced when one endpoint moves and the other silently does not. The verifier
>    now rejects that shape outright (`BADRANGE`) rather than trying to resolve it.
>
> **11 citations were `GONE`** — those are not line-number drift, they are *the document asserting
> things that stopped being true*. Six engine gaps had been closed since the pin. See below.

> ### Six gaps closed since the pin — what this document used to say, and what is true now
>
> | | this document used to say | true at `9843cb6` |
> |---|---|---|
> | **G-06 §2** | an unknown claim key **crashes** with a `TypeError` | fails **closed** — `unsupportedRow` (`productTest.ts:1635`) |
> | **G-06 §2** | an unknown attribute key **throws** a named error | fails **closed** — `unsupportedRow` (`productTest.ts:1788`) |
> | **G-07** | `identifiers` is broken in the authenticated path | closed in `0faac0d` (`authenticatedTest.ts:216`) |
> | **G-08** | `delivery` and `no_subscription` read `p.evidence` raw and can refuse a whole report | closed — both lint-pre-filter (`productTest.ts:1893`, `productTest.ts:1764`) |
> | **G-09** | a standard **cannot** be executed against a public URL at all | closed in `0faac0d` — `RunOptions.requirements` + `standard` |
> | **G-10** | a standard cannot gate its own applicability | closed in `be14e37` — `standards/applicability.ts` |
>
> Two more corrections of the same kind: claim rows **now do** exclude the `shipping_policy`
> surface, and `EXPECTED_OPEN_GAPS` is **36**, not 31. Both are marked in place below.

---

## 1. Requirement kinds — the complete executable vocabulary

The engine's unit of work is a `Requirement`, evaluated by one pure function.

```ts
// src/server/productTest.ts:1224-1239
export type ReqKind =
  | "claim" | "price_under" | "variant_option" | "no_subscription" | "delivery" | "in_stock"
  | "attribute"     // a stated product attribute (materials, dimensions, …)
  | "identifiers"   // GTIN/MPN in structured data
  | "unsupported";  // v3.1 CP1 — engine-internal; NOT authorable. See below.

export interface Requirement {
  id: string; kind: ReqKind; label: string; claim?: string; capUsd?: number; optionValue?: string;
  attribute?: string;            // key into ATTRIBUTE_SPECS. Only for `attribute`.
  unsupportedReason?: string;    // why a row could not be re-asked
}

// src/server/productTest.ts:1618
export function evaluate(p: PublicProduct, req: Requirement): Assertion
```

**Eight authorable kinds, and no extension point that does not require editing
`src/server/productTest.ts`.** This is the single most important fact in this document, and it is
the reason `ENGINE_GAPS.md` is a first-class deliverable rather than an appendix: a standard
authored under this constraint can only make executable the assertions that fit one of these eight
shapes.

⚠️ **This document used to say "Eight kinds. There is no ninth." `ReqKind` now has nine.** The
correction matters in a smaller way than it looks, and the reason is worth stating exactly, because
"the closed vocabulary grew" would be the wrong lesson.

`unsupported` (v3.1 CP1) is **an engine-internal outcome, not a question**. It exists because a
public result persists *rendered assertions* rather than `Requirement` objects, so importing a
public test into a shop rebuilds the contract from labels — and that rebuild used to end in an
unconditional `kind: "claim"`, minting keys like `materials_are_stated` that no dictionary contains
and that `evaluate` then dereferenced. The ninth kind is how a row the engine **cannot re-ask**
gets reported instead of silently dropped:

```ts
case "unsupported":                                              // productTest.ts:1623
  return unsupportedRow(p, req, req.unsupportedReason ?? "no reason recorded");
```

**A standard may never bind it, and this is enforced rather than advised** —
`compile.ts:172` throws: *"req_kind 'unsupported' is an engine-internal outcome and cannot be bound
by a standard entry"*. So the authorable vocabulary is still eight, and the ceiling this document
describes is unchanged. What grew is the engine's honesty about rows it cannot answer.

### 1.1 `claim` — a named attribute claim from a closed dictionary

```ts
{ kind: "claim", claim: "single_origin", label: "Single-origin" }
```

Evaluated at `productTest.ts:1625-1708`. Looks up `CLAIM_TERMS[req.claim]`, searches for a
*violating* term first (`findViolation`), then a *supporting* term (`findSupport`, `wholeWord: true`).

**The dictionary is closed and `CLAIM_TERMS` is NOT exported** (`productTest.ts:47`, no `export`).
The 13 keys, read from the source:

| key | supporting terms (verbatim) |
|---|---|
| `aluminum_free` | aluminum-free, aluminum free, aluminium-free, aluminium free, no aluminum, without aluminum, free of aluminum |
| `baking_soda_free` | baking soda free, baking-soda-free, without baking soda, no baking soda, free of baking soda |
| `cruelty_free` | cruelty-free, cruelty free, not tested on animals, leaping bunny |
| `vegan` | vegan, 100% vegan |
| `fragrance_free` | fragrance-free, fragrance free, unscented, no added fragrance, no fragrance |
| `paraben_free` | paraben-free, paraben free, no parabens, without parabens |
| `sulfate_free` | sulfate-free, sulfate free, no sulfates, without sulfates |
| **`single_origin`** | **single origin, single-origin, single estate, single-estate, single farm** |
| **`organic`** | **organic, usda organic, certified organic** |
| **`fair_trade`** | **fair trade, fair-trade, fairtrade** |
| `gluten_free` | gluten-free, gluten free, no gluten |
| `third_party_tested` | third-party tested, third party tested, independently tested, lab tested, certificate of analysis |
| `bpa_free` | bpa-free, bpa free, no bpa, without bpa |

Three are relevant to coffee (bolded). **`gluten_free` and `vegan` are also technically askable of
coffee and this standard deliberately does not ask them** — see §7 on discrimination.

✅ **An unknown claim key used to crash. It now fails CLOSED** — G-06 §2, closed in `d35b26e`.
`evaluate` did `const fx = CLAIM_TERMS[req.claim!]!;` with a non-null assertion, so an unrecognised
key threw `Cannot read properties of undefined (reading 'violating')` **out of the whole run**. It
now reads `const fx = CLAIM_TERMS[req.claim!];` (`productTest.ts:1634`) and returns an honest row:

```ts
if (!fx) return unsupportedRow(p, req, `unknown claim key '${req.claim}'`);   // productTest.ts:1635
```

`unsupportedRow` (`productTest.ts:1608`) logs, then returns `requires_store_access` with wording
that names the limitation as ours: *"We couldn't re-run this check automatically. That's a
limitation on our side, not a finding about your store."* **The row is reported as unchecked rather
than as a result** — which is the same distinction §3 turns on.

⚠️ **This does NOT make an unresolvable claim key acceptable in a standard.** The runtime path is a
backstop; `compileStandard` still refuses an unknown key at compile time, and
`standards/__tests__` test group 4 is what enforces it. The change is that a bad key now costs one
unchecked row instead of the merchant's entire report.

✅ **Claim rows now DO exclude the `shipping_policy` surface.** This document used to record the
opposite, as the second of two false positives "the concurrent session is fixing". It shipped in
`d730ea2`, and claim rows apply the same product-surface filter the attribute rows always did:

```ts
const quotable = p.evidence.filter(                               // productTest.ts:1656
  (e) => e.surface !== "shipping_policy" && lintStrings([e.text]).ok);
```

The reason is stated at the site and is worth carrying into any standard: *a statement about
ORDERS is not a statement about the PRODUCT*, and a claim proven from a shipping policy is a
sentence the merchant never wrote about the thing under test. Blast radius was measured before the
change — all 13 `CLAIM_TERMS` keys that passed off policy text also pass identically from
`product_description`.

⚠️ **Design as though it were still absent anyway.** The engine's surface scoping is not
configurable per entry, `accepted_evidence` in a published standard remains **documentation
nothing enforces** (G-06 §3 — still open), and `delivery` deliberately keeps reading
`shipping_policy` because there its subject genuinely *is* the shipment. A standard must name its
product surfaces explicitly rather than relying on the engine to scope them.

### 1.2 `attribute` — a stated product attribute from a closed spec table

```ts
{ kind: "attribute", attribute: "dimensions", label: "Measurements are stated" }
```

Evaluated at `productTest.ts:1778-1839` via `findAttributeSupport` (`productTest.ts:623`).
`ATTRIBUTE_SPECS` is **not exported** (`productTest.ts:537`) and contains exactly **three** entries:

| key | label | what actually has to be true |
|---|---|---|
| `materials` | "Materials are stated" | a composition FRAME (`made of`/`made from`/`made with`/`crafted from`/`% cotton`…) **and** a `MATERIAL_NOUN` somewhere in the sentence (`productTest.ts:125`, a closed list of ~70 nouns; **no coffee term is in it**) |
| `dimensions` | "Measurements are stated" | a term from a closed unit list, `requireDigit`, `wholeWord`, **and** `MEASUREMENT` — a number bound to a unit (`productTest.ts:179`) — plus a whole-sentence `shipmentVeto` and `allowContainerSubject` |
| `care` | "Care or use instructions are stated" | a laundry/cookware care term, and `onlyFor` gates it to apparel/textiles/cookware/footwear categories (`productTest.ts:604`) |

✅ **An unknown attribute key used to throw a named error. It now fails CLOSED** — same G-06 §2
change, same commit. `if (!spec) throw new Error(…)` became
`if (!spec) return unsupportedRow(p, req, …)` (`productTest.ts:1788`). The attribute branch had the
*named* error the claim branch lacked, which made it the better of the two and still fatal: a named
`Error` propagates out of `runAuthenticatedTest`'s bare `requirements.map(evaluate)` exactly as an
anonymous `TypeError` does.

**`origin` and `warranty` are both gone.** `origin` was removed in v2.8 CP2
(`productTest.ts:306-364`, a 59-line tombstone). `warranty` was dropped before shipping because its
term list collided with the claim linter's `guarantee` rule (`productTest.ts:582-589`). Neither can
be referenced.

**For coffee, `dimensions` is the only usable attribute**, and it is usable for exactly one
purpose: **net weight** (`12 oz`, `340 g`, `1 lb`). `allowContainerSubject` is set, and
`CONTAINER_IS_PRODUCT` (`testEvidence.ts:246`) explicitly includes `bag`, `pouch`, `tin`, `can`,
`canister` — the containers a coffee seller states weight against. This is the single best-fitted
executable assertion coffee gets, and it exists by accident of a drinkware fix.

### 1.3 `variant_option` — a named option value is listed and purchasable

```ts
{ kind: "variant_option", optionValue: "Whole Bean", label: "Whole Bean option available" }
```

Evaluated at `productTest.ts:1719-1725`.

```ts
const v = p.variants.find((x) =>
  x.options.some((o) => norm(o) === norm(req.optionValue!))   // exact, normalised
  || norm(x.title).includes(norm(req.optionValue!)));          // SUBSTRING of variant title
if (v && v.available) → pass_evidenced
if (v)                → not_proven  ("listed but shows as unavailable")
else                  → not_proven  ("no such variant found")
```

**This kind takes an arbitrary string and is therefore the one genuinely parameterisable kind the
engine has.** It never returns `requires_store_access`. It is the only mechanism by which this
standard can adjudicate grind and pack-size choice, and the exact-then-substring rule is why
`"Whole Bean"` matches a variant titled `"12 oz / Whole Bean"`.

⚠️ **The `optionValue` is interpolated into `label`, which is linted.** `buildBuyerTask` guards
this by dropping candidates whose value fails the lint (`productTest.ts:1495-1497`). A standard entry
carries a *fixed* option value, so the standard itself must clear the linter — §6.

⚠️ **Substring matching cuts both ways.** `optionValue: "Ground"` matches a variant titled
`"Background Blend"`. Option values are merchant-controlled strings and the match is unbounded.
Every `variant_option` entry in the standard states this in `insufficient_evidence`.

### 1.4 `price_under` — the lowest readable price is below a cap

```ts
{ kind: "price_under", capUsd: 25, label: "Price under $25" }
```

`productTest.ts:1709-1718`. `requires_store_access` only when `minPriceUsd == null`. Price is
essentially always public on a Shopify product, which is why the linter has a dedicated rule
forbidding any "price not stated" phrasing (`claimLinter.ts:44`) and why this kind carries **almost
zero information** — see §7.

### 1.5 `in_stock` — availability is publicly readable and positive

`productTest.ts:1726-1749`. Precedence: JSON-LD `Offer.availability` → the variant list → (at fetch
time) the `.js` endpoint. `InStock|LimitedAvailability|OnlineOnly|InStoreOnly` pass;
`OutOfStock|SoldOut|Discontinued` and `PreOrder|BackOrder` are `not_proven`.

### 1.6 `no_subscription` — nothing publicly requires a subscription

`productTest.ts:1750-1777`. Searches only "required" phrasings (`productTest.ts:698`:
`subscription required`, `subscription is required`, `subscription only`, `subscribe to purchase`,
`only available by subscription`, `must subscribe`) — a store merely *offering* a subscription is
not a blocker.

**This kind can only ever return `not_proven` or `pass_no_blocking`. It can never return
`pass_evidenced`.** It is an absence-based inference and the engine discloses it as its own weaker
state. A standard entry using it must not be worded as though a one-time purchase were *proven*.

### 1.7 `delivery` — a delivery window is stated

`productTest.ts:1873-1917`, via `findTimingSupport` (`testEvidence.ts:499`). Two vocabularies:
self-contained deadlines (`ships same day`, `next-day shipping`, …) and digit-requiring ones
(`ships within`, `business days`, `delivered within`, …). `allowLogisticsSubject: true` — this is
the one requirement whose subject legitimately *is* the shipment.

This is the only kind that triggers a **second network fetch** (`/policies/shipping-policy`,
`productTest.ts:2117-2119`), and the only one whose `requires_store_access` verdict distinguishes
*robots-disallowed* from *rate-limited* from *unreachable*.

`"free shipping"` is deliberately **not** a timing term (`testEvidence.ts:455`) — it states price,
not speed, and crediting it was the live false positive that caused the whole evidence module to
be written.

### 1.8 `identifiers` — a plausible GTIN or MPN is published in structured data

`productTest.ts:1840-1872`. Reads `p.extracted.product.gtin/mpn` — **JSON-LD only, never prose**.
GTIN must pass `isValidGtin` after stripping spaces/hyphens and must not be all zeros; MPN must
survive `isPlaceholderIdentifier` (`productTest.ts:684`), which the corpus pins with 20 cases.

✅ **This kind used to be broken in the authenticated path. G-07 is CLOSED** (`0faac0d`).
`snapshotFromCatalog` set `extracted: null`, so `evaluate` took the `!p.extracted` branch and
answered `requires_store_access` — *for a store we had access to* — while the barcode sat in the
synced catalog. It now builds a synthetic `extracted` from the catalog's own identifier fields:

```ts
extracted: extractedFromCatalog(p),                    // authenticatedTest.ts:216
// -> { product: { sku, gtin, mpn: null, … } }         // authenticatedTest.ts:140-156
```

`barcode` → `gtin` and `sku` → `sku`, via `identifiersFromCatalog`; `NormalizedVariant` carries
both (`catalog/normalize.ts:8-9`).

⚠️ **Two things a standard author must still know about this row.**

- **`mpn` is `null` on the authenticated path by construction.** The catalog has no MPN field, so
  an authenticated `identifiers` row can only ever pass on a valid GTIN. That is the honest
  mapping — inventing an MPN from a Shopify id is exactly the defect the next paragraph records —
  but it means the row's public and authenticated answers are not the same question.
- **The row renders NO QUOTE, and that is the reason its worst defect went unseen for two audits.**
  A merchant's `mpn` may be the store's own Shopify product id, or a byte-copy of its SKU — neither
  of which can match a product to an external catalogue, which is the row's entire promise. 21
  confirmed instances across two samples. Because the row prints a sentence rather than evidence,
  no human audit of rendered output could see it. Recorded, with the mechanism, as **G-07** in
  [`ENGINE_GAPS.md`](ENGINE_GAPS.md) — the gap is now that defect, not the plumbing.

---

## 2. Evidence surfaces — and which are publicly inspectable

```ts
// src/server/testEvidence.ts:32-44
export type QuotableSurface =
  | "product_description" | "structured_data" | "product_faq" | "product_title"
  | "product_options" | "meta_description" | "shipping_policy"
  | "product_metafield"   // authenticated only
  | "seo_description";    // authenticated only
```

Nine surfaces. **Which are populated depends on which path runs, and the two paths do not agree —
neither is a superset of the other.**

| surface | public test | authenticated test | source |
|---|---|---|---|
| `product_description` | ✅ `body_html` → text | ✅ `p.description` | `productTest.ts:1144` / `authenticatedTest.ts:183` |
| `product_title` | ✅ | ✅ | `productTest.ts:1147` / `authenticatedTest.ts:184` |
| `product_options` | ✅ option values, joined | ✅ | `productTest.ts:1148` / `authenticatedTest.ts:185` |
| `structured_data` | ✅ JSON-LD `Product.description` | ❌ **not populated** | `productTest.ts:1145` |
| `product_faq` | ✅ JSON-LD FAQ q+a | ❌ **not populated** | `productTest.ts:1146` |
| `meta_description` | ✅ `<meta name=description>` | ❌ **not populated** | `productTest.ts:1149` |
| `shipping_policy` | ⚠️ **only when the task has a `delivery` requirement** | ✅ when policy text synced | `productTest.ts:1214` / `productTest.ts:2117` |
| `product_metafield` | ❌ **never** | ✅ namespace+type filtered | `authenticatedTest.ts:187` |
| `seo_description` | ❌ **never** | ✅ | `authenticatedTest.ts:188` |

**Publicly inspectable, therefore usable by a free test:** `product_description`, `product_title`,
`product_options`, `structured_data`, `product_faq`, `meta_description`, and `shipping_policy`
(conditionally). Plus the non-text structural surfaces: variant prices, variant availability,
JSON-LD `Offer`, and JSON-LD identifiers.

**Requires store access:** `product_metafield`, `seo_description`.

> **A public-tier assertion that depends on metafields can never pass a free test.** This is the
> rule the brief flagged and the code confirms: `buildEvidence` in the public path is called with
> six surfaces and metafields is not among them. There is no configuration that changes this.
> Every entry in this standard carries `public_inspectable` for exactly this reason, and
> `standards/__tests__` test group 7 enforces it.

**Raw page text is not an evidence surface and never will be.** `testEvidence.ts:30-31` and
`productTest.ts:1142` both say so; it is what produced the live regression the module exists to
prevent (nav, upsell, review and subscription-widget chrome).

⚠️ **The `shipping_policy` fold-in carries chrome.** `attachShippingPolicy` runs the policy page
through `htmlToText` and caps it at 20 000 chars (`productTest.ts:1210`) with no chrome filter, so
the store's own SEO page title lands in the evidence index. That is the mechanism behind the
concurrent fix: a claim was proven from a shipping policy's `<title>`. Assertions in this standard
never accept `shipping_policy` as evidence for a product property — only for logistics.

---

## 3. Result states

```ts
// src/server/productTest.ts:1565
export type AssertionStatus = "pass_evidenced" | "pass_no_blocking" | "not_proven" | "requires_store_access";
export const PASSING: AssertionStatus[] = ["pass_evidenced", "pass_no_blocking"];
```

| state | means | reached how |
|---|---|---|
| `pass_evidenced` | positive evidence found **and** it cleared all three gates | a `findSupport`/structural hit |
| `pass_no_blocking` | nothing contradicts an absence-based requirement | **only** `no_subscription` |
| `not_proven` | the surface was inspectable and nothing supporting was found — **or** a readable value does not meet the ask | the default |
| `requires_store_access` | the surface is not publicly inspectable at all, **or** a fetch tier was refused so we never looked | `price_under`/`in_stock`/`identifiers` with no data; `delivery` with an unreadable policy; **any `attribute` row on a degraded fetch** (`productTest.ts:1832`) |

**The distinction that carries the product's whole honesty position is `not_proven` versus
`requires_store_access`.** `not_proven` says *we looked at readable surfaces and found no statement
a machine buyer could verify*. `requires_store_access` says *we did not get to look*. Conflating
them turns a finding into an accusation, and the code says so in those words
(`productTest.ts:1591-1596`, `productTest.ts:1830-1834`).

**`not_proven` is never a statement about the product.** It is a statement about evidence
availability. The standard's consumer-facing wording must preserve that, and the claim linter
enforces it mechanically (§6).

Two further behaviours a standard author must know:

- ✅ **At most ONE `requires_store_access` row appears in the result table — except on a
  standard-pinned run, where the collapse is DISABLED** (`productTest.ts:2141-2150`). On a generated
  task the rest move to `deferred[]`; this document used to state that unconditionally, and it was
  the right rule for the wrong artifact. G-09 point 4 resolved it deliberately rather than letting a
  standard inherit it: a reader checking a page against `ALS-COFFEE-1.1` wants **every** assertion
  the standard makes with its own verdict, and a citation like *"fails …-IDENT-001"* cannot resolve
  against a row that was collapsed below the table. On a pinned run `deferred` stays empty and the
  honest per-row states do all the work. **Nothing is hidden in either mode** — the difference is
  where the rows are rendered.
- **A floor**: if no product surface was readable at all, the whole test returns an error rather
  than a column of "not stated" rows (`productTest.ts:2172-2190`). The floor is about *input*, not
  about the pass count.

---

## 4. Matcher discipline every assertion inherits whether it wants to or not

Any assertion routed through `findSupport` — every `claim`, every `attribute`, and `delivery` —
inherits all of the following. None of it is optional and none of it is configurable per entry.

1. **Sentence-scoped evaluation.** `splitSentences` (`testEvidence.ts:71`) breaks after `.!?` +
   whitespace and on newlines. Every gate then runs on one sentence in isolation
   (`productTest.ts:626-628`). **Consequences a standard must design around:** a fact stated across
   two sentences is invisible; a pronoun subject in the next sentence loses its veto (pinned
   corpus gap); and `"12 fl. oz."` is split into three fragments so the unit and the digit end up
   in different sentences (pinned corpus gap). *An assertion whose true phrasing needs two
   sentences cannot be executable.*
2. **Longest-match-first term ordering.** `termMatches` sorts by match length descending
   (`testEvidence.ts:331`). This exists because list order alone once bypassed a working negation
   guard. Specificity, not authoring order, decides which term matched.
3. **Word boundaries** where `wholeWord` is set — non-alphanumeric boundaries, so `machine-wash`
   and `9.5oz` still match while `weight` no longer hides inside `lightweight`
   (`testEvidence.ts:321`). `claim` rows set it; `attribute` rows set it per spec. **A single-word
   term without `wholeWord` matches inside other words** — that is how `organic` matched inside
   `inorganic`.
4. **Clause-scoped negation.** A closed 40-entry `NEGATOR` vocabulary (`testEvidence.ts:106`),
   scoped backwards to the nearest `CLAUSE_BOUNDARY` (`testEvidence.ts:122`), plus a narrow forward
   `POST_TERM_DENIAL` (`testEvidence.ts:146`). **`findSupport` fails closed across terms: if *any* matched term in
   the sentence is negated, the sentence supports nothing** (`testEvidence.ts:374`).
5. **Aboutness by subject.** `nonProductSubject` (`subject.ts:113`) reads the subject span up to
   the first finite verb and the container-verb frame, and vetoes `packaging | shipment |
   bundled-item | comparative | review`. It **fails open**: only a confident non-product reading
   vetoes, because vetoing on "unknown" would suppress the ordinary subject-less copy that fills a
   product description.
6. **Two legacy guards that are still load-bearing.** `SUBJECT_BEFORE_VETO` (`productTest.ts:618`)
   and `MODIFIED_SUBJECT` (`testEvidence.ts:228`) reach the shapes with no finite verb, where the
   subject rule has nothing to delimit. They are complementary, not redundant.
7. **Context vetoes** for related-product, review, and subscription-widget text
   (`testEvidence.ts:232-236`).
8. **Questions are not statements.** Interrogative sentences are dropped (`testEvidence.ts:338`).
9. **Verbatim whole-sentence quoting.** `presentableQuote` (`testEvidence.ts:280`) returns a whole
   sentence ≤180 chars, cut at a word boundary, and returns `null` on symbol soup, on fewer than
   three words, on >2 price tokens, or below 55% letter density. **A specification block
   (`Dimensions: 11.42W x 18.9H`) matches but cannot be quoted**, and the row says so rather than
   passing with an empty evidence slot (`productTest.ts:1824-1826`). *An assertion whose evidence
   normally lives in a spec table will pass without a quote.*
10. **Fail closed.** Anything that cannot clear all gates is not a pass. Stated as
    non-negotiable: "A wrong Fail is recoverable; a wrong Pass destroys the product's whole
    differentiator" (`testEvidence.ts:23-24`).

**One non-deterministic element.** `applySemanticTier` (`productTest.ts:1926`) makes one batched
model call to resolve `claim` rows the lexical pass left unresolved. It can **grant** an unresolved
claim (requires a verbatim quote) or **veto** a lexical match. It is on unless
`PRODUCT_TEST_SEMANTIC=0`, costs ≈$0.0016/test, and **returns empty with no API key — which is the
condition every offline test and the entire adversarial corpus runs under.** So:

> Any assertion whose correctness depends on the semantic tier is untestable by the acceptance
> gate. `subject.ts:24-27` records this as the reason a semantic aboutness gate was rejected: "A
> fix that cannot be measured by the gate is not a fix." The same rule applies to a standard entry.

---

## 5. The two hardest constraints, verified against the code

### 5.1 `origin` is gone, and coffee provenance therefore has no mechanism

Verified. `productTest.ts:306-364` is the tombstone; `ATTRIBUTE_SPECS` has no `origin` key;
`SURFACE_PRIORITY` no longer lists `attr:origin` (`productTest.ts:1536-1539`); and
`adversarialCorpus.test.ts:180-213` carries **two structural tests** asserting that no requirement
anywhere is an origin requirement or is labelled as a country-of-origin claim, across five
categories including `Coffee`.

The recorded reason is not "it was imperfect" — it is that the matcher was **wrong in both
directions on real merchant copy**:

- False pass: `"Made in Georgia pine."` (a wood read as a US state).
- False fail: `"Made in the U.S.A."` (the clause splitter cuts on the abbreviation's dots),
  `"Handcrafted in Nepal."`, `"Made in Los Angeles."` (the gazetteer held no cities),
  `"Origin — Italy"` (only `:` was accepted as a separator).
- And a **0.91 production fail rate** (`not_proven` in 10 of the 11 stores that carried it), which
  means it carried little information even when right.

**Consequence for this standard, decided here:** coffee provenance — country, region, farm,
producer, harvest — is **not specified as an executable assertion in any form.** It is published as
`advisory`, and the mechanism it would need is specified in `ENGINE_GAPS.md` as **G-01**, which is
explicitly *not* a third head-noun rule. The code's own instruction is `Do not attempt a third
head-noun rule` (CLAUDE.md), and the measured path back is a **terminator rule**, which closed every
false pass, rather than a frame narrowing, which closed none and cost 32 of 33 lost positives.

### 5.2 The `dimensions` vocabulary is partially unsafe — current state

Read from `productTest.ts:130-181` and `productTest.ts:565-568`.

**In the term list** (`wholeWord`, `requireDigit`): `dimensions, capacity, diameter, inches, inch,
cm, mm, millimeters, centimeters, liters, litres, ml, oz, fl oz, fluid ounces, ounces, lbs, pounds,
grams, kg, kilograms, height, width, length, weighs, weight, lb, gram, ounce`.

**Deliberately excluded from the term list:** `l`, `ft`, `feet`, `foot`, `liter`, `measures`. v2.7
added them; 196 independent probes attributed six false-pass mechanisms to that half
(`"Only 2 L left in stock."` passed as a measurement; `ft.` matched `featuring`).

**`MEASUREMENT`** (the `valueGuard`, run on the whole sentence) accepts a number + optional space +
optional `fl` + unit, **or** a `dimensions:|capacity:|weight:|…` label followed by a digit. The `fl`
adjacency shipped in v2.8 CP1; the `\b` after `fl` is the entire guard that stops `3 flounces`
matching.

**A hyphen branch (`12-oz mug`) was built and removed.** Four false-pass mechanisms were attributed
to it. So `"A 12-oz mug"` is a pinned known-fail.

**Consequence for coffee net weight.** `oz`, `ounces`, `g`/`grams`, `kg`, `lb`/`lbs`/`pounds` are
all in the term list and all satisfy `MEASUREMENT` when bound to a digit. `allowContainerSubject`
plus `CONTAINER_IS_PRODUCT` covers `bag`, `pouch`, `tin`, `can`, `canister`. **`12 oz bag`,
`340 g`, `1 lb` all work; `12-oz bag` and `12 fl. oz.` do not.** Both non-working forms are stated
in the standard entry's own `insufficient_evidence`/limits rather than hidden.

### 5.3 The pinned gaps — which ones collide with this standard

`adversarialCorpus.test.ts:1226`: **`EXPECTED_OPEN_GAPS = 36`**. This section was written when the
count was **31** and every heading and total in it said so.

⚠️ **The rise is not 5 new defects, and reading it as decay gets the direction backwards.** The
corpus asserts the count in **both** directions, so the number is a ledger rather than a backlog:
31 → 30 when v3.1 CP2c closed the ZIP-code delivery false pass, then 30 → 32 when two **false
fails** were accepted to close two **false passes** — a trade, recorded honestly rather than as a
clean win — and 32 → 36 when v3.2's four coffee guards were reverted and pinned with the cost of
the attempt beside them. Each is named at its own case.

The gaps below were verified by reading every case at the 31-gap count; **the five added since have
not been re-checked against this standard's entries**, and saying so is cheaper than implying a
completeness this pass did not perform. The ones known to touch an assertion this standard makes
executable:

| pinned gap | corpus case | collides with |
|---|---|---|
| usage/content quantity read as product size | `"Each serving contains 12 grams of protein."` | **ALS-COFFEE-1.0-WEIGHT-001** — coffee pages state brew ratios in grams constantly (`"Use 18 g of coffee per 300 ml"`). Being fixed concurrently; the entry is marked `collides_with_pinned_gap` regardless |
| usage quantity | `"Steep in 8 oz of hot water for 3 minutes."` | same entry, same class |
| bundled-item measurement | `"Comes with a free 8 oz sample of our conditioner."` | same entry |
| order-threshold measurement | `"Minimum order 5 kg."`, `"Discount applies to purchases over 10 lbs."` | same entry |
| shipment measurement | `"Arrives in 12 x 9 inch boxes."`, `"Parcel weight is 2.4 lbs."` | same entry |
| shipment-veto overreach | `"Weighs 3 lbs and ships free."` — a true weight vetoed | same entry, in the **false-fail** direction |
| comparative veto is one-word-wide | `"Most cheap versions are made from thin stamped steel."` | every `claim` and `attribute` entry |
| negation coordination / colon reset | `"We do not offer weekend pickup, or overnight shipping."` | **ALS-COFFEE-1.0-DELIV-001** |
| returns window read as a delivery window | `"Returns are accepted within 30 business days of receipt."` | **ALS-COFFEE-1.0-DELIV-001** |
| claim proven from `shipping_policy` chrome | `"A gift bundle of our house blends."` + policy SEO title | every `claim` entry. Being fixed concurrently |
| review-quote passes a claim | `"Love that it's fragrance-free!" — a customer` | every `claim` entry |
| container-scoped claim credited to contents | `"The tube is BPA-free."` | every `claim` entry — for coffee, a bag/packaging property credited to the coffee |
| aspiration passes a claim | `"We believe fair trade should be the industry standard."` | **ALS-COFFEE-1.0-CERT-002** — directly, and this is the single worst collision in the standard |

**One case that is NOT a gap, corrected here because the corpus's own comment says otherwise.**
`"Made with inorganic mineral pigments."` (`adversarialCorpus.test.ts:540`) carries **no `actual`**, so it
is a passing case, not a pinned defect. Its `why` text claims "`organic` is matched WITHOUT wholeWord
(only attributes set that flag)" — that was true when the case was written and is **stale**:
`productTest.ts:1678` now passes `{ wholeWord: true }` to `findSupport` for claim rows, which is what
closed it. The count of 31 is unaffected. I originally listed this as a collision with the organic
entry on the strength of the comment and had to withdraw it after checking the code, which is a small
instance of the rule this repo keeps rediscovering: the comment is not the measurement.

**Every executable entry in this standard carries a `known_gaps` field naming the pinned corpus
cases it collides with.** An assertion whose shape collides with a pinned gap is knowingly
unreliable, and the standard says so in the published document rather than in a comment.

---

## 6. The claim linter — forbidden vocabulary, and why it can destroy a whole report

`src/server/claimLinter.ts`. Sixteen regexes across four families. **The linter runs over every
merchant-visible string, including `label`, `detail`, and `evidenceQuote`, and a single violation
returns the ENTIRE result as `errorKind: "unreachable"`** (`productTest.ts:2223-2234`,
`authenticatedTest.ts:351-361`).

This is not theoretical. Two recorded instances:

- A `warranty` requirement was **dropped from the engine** because its term list
  (`guarantee`, `guaranteed`, `satisfaction guarantee`) collides with the `guarantee` rule, so a
  store whose copy says "30-day money-back guarantee" would have had its whole report refused
  (`productTest.ts:582-589`).
- A product titled **"Lifetime Guarantee Leather Belt"** returned the whole report as `unreachable`
  until `taskSubject` was made to lint-check the merchant's own title
  (`productTest.ts:1444-1465`).

### The complete forbidden set, as it constrains an assertion label

| rule | pattern (source: `claimLinter.ts`) | what a standard author must never write |
|---|---|---|
| `product-truth` | `\byour (product\|item\|formula\|deodorant\|soap\|**coffee**)\s+(is\|isn't\|is not\|lacks\|contains\|doesn't\|does not)\b` | **`coffee` is one of only six nouns in this rule.** "Your coffee is…", "Your coffee contains…", "Your coffee does not…" — all fatal. **This is the single highest-risk rule for a coffee standard and it exists nowhere else in the engine.** |
| `product-truth` | `\b(is\|are)\s+not\s+(aluminum\|…\|gluten\|bpa\|cruelty\|baking)[- ]free\b` | "is not gluten-free" etc. |
| `product-truth` | `\byour product does not (have\|contain\|include)\b` | — |
| `guarantee` | `\bguarantee(s\|d\|ing)?\b` | **no assertion may contain "guarantee" in any inflection.** Rules out "freshness guarantee", "guaranteed roast date", "satisfaction guarantee", and — critically for coffee — any label built from a merchant's own "guaranteed fresh" wording |
| `ranking-prediction` | `\brank(s\|ed\|ing)?\s+(higher\|first\|top\|better)\b` | — |
| `ranking-prediction` | `\b(get\|be\|become)\s+(recommended\|ranked\|featured)\s+(by\|in\|more)\b` | — |
| `ranking-metric` | `\bshare of voice\b` | — |
| `predictive` | `\bwill\s+(improve\|increase\|boost\|rank\|win\|fix\|convert\|drive\|make ai\|get you)\b` | rules out most "this will help…" remediation phrasings |
| `predictive-fix` | `\bthis (edit\|fix\|change\|correction) will\b` | — |
| `predictive` | `\byou'?ll\s+(get\|see\|rank\|win\|earn\|recover\|start)\b` | — |
| `revenue-loss` | `\blos(e\|es\|ing\|t)\s+\$?\d` | — |
| `revenue` | `\b(costing\|missing out on\|leaving\|forfeiting)\s+\$?\d` | — |
| `revenue-projection` | `\$\d[\d,]*\s*(per\|\/)\s*(month\|year\|day\|week)\b` | — |
| `revenue-promise` | `\b(increase\|boost\|grow)\s+(your\s+)?(sales\|revenue\|conversions?)\b` | — |
| `causal` | `\b(caused\|because of this\|as a result of\|leads? to\|results? in)\s+(your\|the)\s+(loss\|drop\|ranking\|invisibility)\b` | — |
| `price-is-always-public` | `(does not state\|doesn't state\|missing\|no evidence of)[^.]{0,30}\b(price\|cost)\b` | **rules out "missing price per unit", "no evidence of cost per ounce"** — a real hazard for the unit-price assertion class |
| `not-inspectable-mislabeled` | `\b(missing\|absent)\s+(metafields?\|policy\|policies)\b` | never describe an unreadable surface as "missing" |

✅ **The hazard this section used to describe is CLOSED. G-08's lint half is fixed** — `5931b6a`.
Every one of the four requirement kinds that reaches the matcher now pre-filters its evidence with
`lintStrings`, so an unquotable sentence is **skipped and the search continues** instead of
refusing the report:

| kind | filter | line |
|---|---|---|
| `claim` | `surface !== "shipping_policy"` **and** `lintStrings` | `productTest.ts:1656` |
| `attribute` | product surfaces **and** `lintStrings` | `productTest.ts:1802-1804` |
| `no_subscription` | `surface !== "shipping_policy"` **and** `lintStrings` | `productTest.ts:1763` |
| `delivery` | `lintStrings` **only** | `productTest.ts:1892` |

So a coffee store whose shipping policy says **"delivery guaranteed within 3 business days"** no
longer has its entire report refused — reproduced as a fixture before the fix existed, 10 rows → 0.

Three things worth carrying forward, because each is a general lesson rather than a changelog:

1. **`delivery` deliberately has NO surface filter, and the asymmetry is a design decision.** Claim
   and attribute rows exclude `shipping_policy` because a statement about orders is not a statement
   about the product. Delivery is the one requirement whose subject genuinely *is* the shipping
   policy, so excluding it would delete the row's best evidence. Only the lint filter applies.
2. **`no_subscription`'s half was already closed before the gap was written up** — by v2.9's
   policy-surface work — and only `delivery` was still exposed. G-08 named both. A future session
   reading the gap should not go looking for a second fix.
3. **The rule was already written and simply not applied.** It sat in the `attribute` branch's own
   comment: *fail closed per ROW, never fail the report*. This is the same class that got the
   `warranty` requirement dropped from the engine entirely in v2.3.

⚠️ **A standard still cannot design around the linter itself.** The filter decides which *evidence*
is searched; a standard's own `label` and `detail` strings are linted at the end (§6 opening), and
one violation there still returns the whole result as `unreachable`. The forbidden vocabulary above
constrains authoring, not just rendering.

---

## 7. The discrimination principle, with the measured numbers

A requirement's value is how well it **discriminates**, not how often it fails. The code states
this directly (`productTest.ts:87-89`): "one that fails for everyone (cruelty-free, 13/13) and one
that fails for no one (price, 0/13) carry exactly the same amount of information, which is none."

Measured figures, read from the source rather than from the brief:

| requirement | measured fail rate | source |
|---|---|---|
| defaulted `cruelty_free` claim | **13/13 = 100%** — zero information | `productTest.ts:88`, `productTest.ts:1395-1397` |
| `price_under` | **0/13 = 0%** — zero information | `productTest.ts:89` |
| `delivery` | **71%** of stores in the v2.2 sample | `productTest.ts:1530-1531` |
| dropped `warranty` | **0.71**, in band — dropped for the linter collision, not for discrimination | `productTest.ts:583` |
| removed `origin` | **0.91** (10 of 11 stores) — and contaminated, because the matcher was broken in both directions | `productTest.ts:347-350` |

**Target band: 15–85% failure.** The `price_under` and `cruelty_free` results are what a rate
outside that band looks like in production, and they are why the engine ranks by discrimination
rather than by failure count.

⚠️ **The PREDICTED band has since been measured and refuted, and this section used to teach
authoring it.** It said every executable entry carries `predicted_discrimination` with a numeric
band and reasoning, "flagged as an untested hypothesis". It was tested. On 43 real coffee products
the author's bands **held 2 of 10**; on 100 they **held 1 of 10**, and **every miss was HIGH** —
entries discriminated less than predicted, systematically and in one direction. A predicted band is
not a weak measurement, it is a measurement of the author.

Per [`experiments/v3-4/DECISION.md`](../experiments/v3-4/DECISION.md), grammar **1.2** therefore
replaces `predicted_discrimination` with `discrimination_prediction` — `direction`, `confidence`,
`reasoning`, **and no number** — which may not determine an entry's tier and which no test may
read. It is kept rather than deleted for one reason: *the calibration that condemned the band is
computable only because the predictions were recorded beside the measured rates.* A field nobody
records cannot be shown to be wrong.

⚠️ **Three numbers that are not the same number**, and they are routinely run together: *bands held
1/10* (the prediction was right) · *above predicted band 8/10* (discriminates LESS than predicted)
· *carries information 4/10* (the MEASURED rate falls inside 15–85%). `FORMAT-001` at 73.7% against
a predicted 30–60% is above its band **and** squarely informative. **"Above its band" does not mean
"carries no information."**

The `cruelty_free` story is worth restating because it is the failure mode a *published* standard
is most likely to reproduce at scale: the row was **not false** — the store genuinely did not state
the attribute. It was **irrelevant, identical across unrelated merchants, and enough to make a
specific diagnosis read like a template** (`productTest.ts:1399-1401`). A fifty-question standard
applied uniformly is that failure with a version number on it. `applicability` is the field that
prevents it.

---

## 8. Where the commissioning brief was wrong

Recorded because the brief instructed me to, and because these are the kind of small numeric drifts
that become load-bearing when a later session cites them.

| brief said | code says | materiality |
|---|---|---|
| "Three independent negative sets scored the same matcher at 100%, 94% and 17% specificity" | The tombstone's table (`productTest.ts:314-320`) records **two** sets, A and B, at 88.8%/94.0% and 95.4%/100.0% for shipped/narrowed. The 17.0% figure appears only in `CLAUDE.md`'s summary, alongside 100.0% and 94.0% — i.e. **the three quoted numbers are not the three columns of one table**; two are the *narrowed* specificities of sets A and B, and the third is from a differently-authored set. | Low, but the brief's framing implies a cleaner three-way comparison than the record supports. The conclusion — that the term's specificity is a property of the set author — survives, and is the honest reading. |
| "the **narrowed** form told stores writing 'Made in the U.S.A.' they state no origin" | The tombstone lists that sentence under "the shipped form cannot stay **either** … in BOTH the shipped and narrowed forms" (`productTest.ts:336-345`). The cause is the clause splitter cutting on the abbreviation's dots, which is orthogonal to the narrowing. | **Material.** The brief attributes to the narrowing a defect that both forms share and that neither introduced. A later session could waste a checkpoint "un-narrowing" to fix it. |
| "`l`, `ft`, `feet`, `foot` produced **183 false passes**" | `productTest.ts:170-173` records **196 probes** attributing **six false-pass mechanisms**. No count of 183 appears anywhere in the source. | Low. The exclusion is real and correctly described; the specific number is not corroborated and should not be cited. |
| "delivery-window fails ~**69%**" | **71%** (`productTest.ts:1530-1531`). | Immaterial; noted for citation hygiene. |
| "**31** defects are pinned open" | Confirmed exactly at `96ceacd`. **Now 36** (`adversarialCorpus.test.ts:1226`) — §5.3 has the ledger. | ✅ then; re-check before citing |
| "a `warranty` requirement was dropped … 'Lifetime Guarantee Leather Belt' once returned the whole report as unreachable" | Confirmed, both (`productTest.ts:582-589`, `productTest.ts:1444-1452`). | ✅ |
| "Two false positives are being fixed concurrently" | Both confirmed present as **pinned open gaps** at `96ceacd`. ✅ **Both have since SHIPPED** (`d730ea2`): the shipping-policy-chrome claim pass (§1.1) and the internal-quantity measurement pass. Per instruction I designed as though they were fixed, and the assumption held. | ✅ resolved — the two entries flagged `collides_with_pinned_gap` in `standard.json` can be re-checked against the shipped behaviour rather than against a prediction |

**One thing the brief did not mention that changed the design — and it has since been fixed.** The
`identifiers` requirement was strictly *worse* in the authenticated path than in the public one: the
connected-store run set `extracted: null` and answered "requires store access" for a merchant who
had granted store access, with the barcode sitting in the synced catalog. **G-07's plumbing half is
closed** (`0faac0d`, §1.8). What survives under that gap id is a different and worse defect in the
same row — an `mpn` that is the store's own Shopify id — which the row's quoteless rendering hid
from two consecutive audits.

**And one thing the brief was right to treat as fixed, which was not fixed then and is now.**
`96ceacd` could not execute a standard against a public URL at all — no way to pin a requirement
list, no standard identity on the result, a 10-row evaluation cap, and a rendering collapse that
buried most of a conformance list. All four were closed in `0faac0d` (**G-09**), and applicability
gating followed in `be14e37` (**G-10**). Every assertion this document describes can now actually be
run against the thing a published standard is about: a public product page.

---

## 9. What this contract permits, in one table

The complete set of executable assertion shapes available to any AisleLens standard today.

| shape | parameterisable? | can reach `pass_evidenced`? | public? | notes |
|---|---|---|---|---|
| `claim` × 13 fixed keys | key only, from a closed list | yes | yes | 3 keys relevant to coffee |
| `attribute` × 3 fixed keys | key only, from a closed list | yes | yes | only `dimensions` fits coffee |
| `variant_option` | **yes — arbitrary string** | yes | yes | the one real extension point |
| `price_under` | yes — numeric cap | yes | yes | ~zero discrimination |
| `in_stock` | no | yes | yes | |
| `no_subscription` | no | **no** — `pass_no_blocking` only | yes | absence-based |
| `delivery` | no | yes | conditionally | triggers a 2nd fetch; ~~can block the whole report~~ **lint-pre-filtered since `5931b6a`** |
| `identifiers` | no | yes | yes — **both paths** | ~~broken authenticated~~ **fixed `0faac0d`**; `mpn` is always `null` authenticated, and the row renders **no quote** |

**Still true, and it is the reason `ENGINE_GAPS.md` exists:** eight kinds, no ninth, and no
extension point that does not require editing `src/server/productTest.ts`. Anything a standard needs
that is not in this table is `blocked` and belongs in [`ENGINE_GAPS.md`](ENGINE_GAPS.md) with a
mechanism specification — not in the standard as though it worked.

**What changed at v3.4 is where these shapes can RUN, not how many there are.** G-09 and G-10
closing means a pinned contract now executes against a public product URL, carries the standard's
identity into the result so a citation resolves, and gates itself on applicability. The
*expressiveness* ceiling is untouched: the binding constraint on how much of a category is
executable is still the size of two hardcoded dictionaries (G-06).
