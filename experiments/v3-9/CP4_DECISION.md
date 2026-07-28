# v3.9 CP-4 — the parse fix: what was measured, and what it is worth

**Everything here was executed before any fix was designed**, which is the brief's own
instruction and the order that slipped in v3.8.

---

## 1. The mechanism — CONFIRMED, and WIDER than the brief claimed

`experiments/v3-9/cp4_probe.ts`, which lifts `priceToUsd` out of `productTest.ts`'s source
bytes rather than re-implementing it (a re-implementation would be a second engine that
drifts). Two-sided canary live: `"19.99"` → 19.99, `"1.2.3"` → null.

`productTest.ts:917` —
```ts
if (typeof p === "string") { const n = Number(p.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
```

**Twelve inputs produce a stated `$0.00`:** `"USD"` · `"EUR"` · `""` · `"   "` · `"N/A"` ·
`"TBD"` · `"Contact us"` · `"Sold out"` · `"$"` · `"-"` · `"null"` · `"free"`. The claimed
mechanism is exactly right: the strip leaves `""`, and `Number("") === 0`, and
`Number.isFinite(0)` is `true`, so the guard cannot fire.

**And two shapes are wrong in a way the brief did not name, which matter MORE:**

| input | returns | should be |
|---|---|---|
| `"-5.00"` | **$5.00** | a refusal — the sign character is stripped |
| `"1e5"` | **$15.00** | 100000 — `e` is stripped and the exponent digits concatenate |

Both are **differently-wrong prices**, not refusals. That is the precise thing the 3a
invariant forbids: *a wrong price may never become a differently-wrong price; the only
acceptable failure is refusing to state one.* A `$0.00` at least looks broken to a reader.
`$15.00` does not.

The `.js` tier already fails closed (`Number.isInteger(p) && p >= 0`). **Only the `json`
tier leaks.**

---

## 2. Natural frequency — ZERO, and the zero is canary-verified

`experiments/v3-9/cp4_freq.mjs`, over the exact field the engine reads
(`variants[].price` on the `/products/{handle}.{json,js}` tiers — not `price` anywhere in
the bytes, which would inflate the count with fields no code path touches).

```
snapshot files scanned      363   (v2-9 general 172 · v3-0 25 · v3-1 44 · v3-2 122)
product bodies parsed       273
variant price fields         1925
offenders                       0
```

Two-sided canary **live**: the predicate fires on `"USD"`, `""`, `"-5.00"`, `"1e5"` and
`"1,299.00"`, and does not fire on `"19.99"`, `"1299.00"`, `1999`, `0`. So `0` is a
measurement, not a dead predicate.

This independently reproduces the already-recorded finding that the `.json` tier is
decimal-dollar strings and the `.js` tier is integer cents, with zero exceptions.

## 3. Rider 1 — NONE of the 11 surviving general defects is this class

`experiments/v3-9/cp4_rider1.mjs`, read from the snapshot bytes:

| survivor | captured `variants[].price` | class |
|---|---|---|
| `branchbasics.com` · `knifewear.com` · `kosas.com` · `studioneat.com` · `tenthousand.cc` | `"0.00"` / `0` | **P-19's** — a real zero |
| `fieldcompany.com` · `partakefoods.com` | *no variant price field at all* | neither |

**The same-push re-measurement invariant does NOT fire.** No published figure moves.

---

## 4. What the fix would close, and what it would not

The frozen fetch corpus (`experiments/v3-8/fetch_cases.json`, committed at `234ee7b`)
**already contains this class** — so rider 2's freeze-then-fix order was satisfied by v3.8
and no new case needed authoring. 101 cases, 67 flagged, 55 unreachable by sampling.

Closed by refusing a non-clean decimal: `cur-06` (`"GBP"`) · `mm-06` (non-ASCII digits) ·
`mm-17` (`"Free with any order"` wins `Math.min`) · `znn-05` (`""`) · `znn-06`
(`"Call for pricing"`, `"TBD"`) · `znn-08` (`"-5.00"` loses its sign) · `mm-08` (`"1.0E+03"`).

⚠️ **NOT closed, and this must not be claimed:** `mm-05` (`"1.299,00"`), `cur-04`
(`"€12,50"`), `cur-05` — the corpus author's `honest_answer` for these is *the correct
number* (locale parsing), not a refusal. The fix moves them from **wrong number** to
**refuses to state one**. That is an improvement under the invariant and a *failure*
against the corpus's stated honest answer, and the flags will change from `wrong_price` to
`status != honest` rather than disappearing. Report it that way.

---

## 5. THE SCOPE LINE: zero is NOT touched

`"0.00"` parses cleanly as a decimal and continues to return `0`. Changing that would move
**5 of the 11 surviving general defects**, fire the same-push re-measurement invariant, and
turn a zero-blast-radius parse fix into a published-figure change. `$0.00`-as-a-price is
**P-19**, filed separately, and it stays filed.

Keeping zero is what holds this fix's real-store blast radius at exactly **0 rows**.

---

## 6. The decision, stated honestly

| | `origin` (v2.8, removed) | CP-4 |
|---|---|---|
| true statements lost | **17** | **0** |
| false passes closed | 0 | 0 observed; 7 corpus cases |
| natural instances | 0 in 5,322 products | 0 in 1,925 price fields |
| verdict | descope | **not the same shape** |

`origin` was descoped because the narrowing **cost 17 true statements**. CP-4 costs
**nothing**: every value it refuses is one the engine currently renders WRONG. So the
tombstone precedent does not carry over — its decisive term is absent here.

What the fix does cost is the **`ENGINE_VERSION` bump**. `priceToUsd` is in
`productTest.ts`, so the tripwire forces `v2.1.0 → v2.2.0`, and that 409s **every**
merchant's saved test — for a change that provably alters no observed store's row. The
brief anticipates this and calls the tripwire firing "it working". Recorded so the cost is
visible rather than discovered: **the bump is the entire measurable cost of this fix, and
it is paid by every merchant.**
