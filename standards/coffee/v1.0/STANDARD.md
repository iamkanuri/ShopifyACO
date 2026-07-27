# AisleLens Coffee Standard v1.0

**Buyer questions, assertions and evidence rules for roasted coffee product pages.**

- Machine-readable authority: [`standard.json`](standard.json) · content hash
  `334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5`
- Provenance for every question, and the questions that were dropped: [`GROUNDING.md`](GROUNDING.md)
- The grammar this is authored against: [`../../SCHEMA.md`](../../SCHEMA.md) (version `1.0`)
- What the engine can and cannot execute: [`../../ENGINE_CONTRACT.md`](../../ENGINE_CONTRACT.md)

---

## What this is, and what it is not

A published, versioned set of **42 questions a competent coffee buyer asks**, each turned into an
assertion with defined evidence rules, each citable by a stable id. Ten of them the engine runs
today. Thirty-two it does not, for reasons stated per entry.

> **This document has never been applied to a real store by anyone, and no second party has applied
> it without us. Until that happens it is a rubric with a versioned changelog, not a standard.** It
> is written to a publishable bar and is not published.

**Every failure rate in this document is a prediction, not a measurement.** No coffee product page
was inspected while authoring it. §"What would have to be measured" in `GROUNDING.md` sets out what
would change that.

**What a conformance result means.** Each assertion answers whether *evidence of a defined form is
published and readable* — never whether the coffee is what the page says it is. That distinction is
carried per entry in the `pass_means` field, and it is the whole basis on which this document can be
honest. A row that does not pass says *we looked at readable surfaces and found no statement a
machine buyer could verify*. It does not say the product lacks the property.

---

## What this standard does not attempt to adjudicate

Six exclusions, stated so the document bounds itself. Two of them are not squeamishness — they are
the categories where adjudicating would mean taking a position on a regulated claim.

| out of scope | why |
|---|---|
| whether any claim on the page is true | The engine adjudicates evidence availability, never product truth. |
| health, wellbeing and physiological effects | A regulated claim family in every major market. Adjudicating "boosts focus" or "low acid, gentler on your stomach" means taking a position on a regulated claim. |
| environmental and ethical-sourcing claims naming no scheme | Unqualified general environmental benefit claims are the target of active regulation. **Recording their presence as conformance would invert the law: presence is the risk factor.** |
| sensory quality, tasting notes, cup preference | No external definition exists to check a flavour descriptor against. |
| the physical label on the bag that arrives | The roast date, the net-quantity declaration and the certifier name are lot-level and printed at pack time. A page test can confirm a claim *about* the label, never the label. |
| price fairness and producer payment levels | No register, no definition, and the main price-transparency reference in coffee is anonymised aggregate by construction. |

---

## Scope

**Covers** retail product pages selling roasted coffee to consumers as whole bean, ground, pods or
capsules, including decaffeinated coffee, single-origin lots and blends.

**Excludes** green coffee, instant and extract products, ready-to-drink coffee, equipment, and
coffee-flavoured goods that are not coffee. Flavoured coffee is excluded from the ingredient and
allergen entries, which are blocked rather than applied.

**Category is decided** from `product_type` first, then the JSON-LD product category or breadcrumb,
then the title — and **never from tags or collection handles**, because a coffee-scented soap must
not read as a coffee product.

---

## The four tiers

| tier | count | meaning |
|---|---|---|
| **executable** | 10 | The engine runs it today, against public data. |
| **blocked** | 16 | Should be executable; the engine cannot yet. Each names the gap. |
| **not_discriminating** | 5 | The engine *could* run it and deliberately does not, because the predicted failure rate falls outside 15–85% and the row would carry no information. |
| **advisory** | 11 | A real buyer question public data cannot adjudicate. Published, never tested, never scored. |

**Ten of forty-two is the honest ratio, and the binding constraint is not the research.** It is the
size of two hardcoded engine dictionaries (`ENGINE_GAPS.md` G-06). Of the three claim keys coffee can
use, none was chosen for coffee — they happen to exist. Every genuinely coffee-specific claim class
is blocked there.

---

## EXECUTABLE (10)

| id | question | engine binding | predicted fail band | known gaps |
|---|---|---|---|---|
| `ALS-COFFEE-1.0-FORMAT-001` | Can I buy this as whole beans? | `variant_option "Whole Bean"` | 30-60% | 1 |
| `ALS-COFFEE-1.0-FORMAT-002` | Can I buy this already ground, so I do not need a grinder? | `variant_option "Ground"` | 35-70% | 1 |
| `ALS-COFFEE-1.0-GRIND-001` | Can I get this ground for espresso? | `variant_option "Espresso"` | 55-85% | 1 |
| `ALS-COFFEE-1.0-GRIND-002` | Can I get this ground for a filter or pour-over brewer? | `variant_option "Filter"` | 60-85% | 1 |
| `ALS-COFFEE-1.0-WEIGHT-001` | How much coffee do I get — is there a weight anywhere on this page? | `attribute:dimensions` | 15-40% | 5 |
| `ALS-COFFEE-1.0-CERT-001` | Does this page say the coffee is organic? | `claim:organic` | 30-70% | 4 |
| `ALS-COFFEE-1.0-CERT-002` | Does this page say the coffee is fair trade? | `claim:fair_trade` | 40-75% | 3 |
| `ALS-COFFEE-1.0-SOURCE-001` | Is this coffee from one place, or is it a blend? | `claim:single_origin` | 40-75% | 2 |
| `ALS-COFFEE-1.0-IDENT-001` | Can a shopping assistant match this exact bag to a catalogue entry? | `identifiers` | 55-85% | 0 |
| `ALS-COFFEE-1.0-DELIV-001` | When will this actually be sent to me? | `delivery` | 50-80% | 3 |

**The two grind entries are the best-grounded assertions in the standard**, and that was not obvious
at the outset. Grind-to-brewer match is the strongest verified shopper signal in the whole research
corpus — five of the top ten live autocomplete completions for "coffee grind" are brewer-specific —
and **none of the seven independent researchers ranked it first.**

**`-CERT-002` is the entry to trust least.** A page reading *"We believe fair trade should be the
industry standard, and we are working toward it"* passes it today: an explicit statement that the
seller is **not** certified is credited as having stated the claim. That is a pinned defect in the
engine's adversarial corpus, not a wording problem, and it is declared in the entry's `known_gaps`.

**Known gaps are declared, not hidden.** The `known gaps` column counts pinned adversarial-corpus
defects whose shape the entry collides with. `-WEIGHT-001` carries five, because a brew ratio in
grams, a nutrition quantity, an order threshold and a shipment weight all read as the product's own
measurement, while a genuine weight in a sentence that also mentions shipping is wrongly refused. An
entry that collides with a pinned defect is knowingly unreliable and says so here rather than in a
source comment.

---

## BLOCKED (16)

Should be executable; the engine cannot yet. Each entry names the gap in
[`../../ENGINE_GAPS.md`](../../ENGINE_GAPS.md).

| id | question | operator | blocked by |
|---|---|---|---|
| `ALS-COFFEE-1.0-ROAST-001` | How dark is this roast? | `equals_one_of` | G-03 |
| `ALS-COFFEE-1.0-GRIND-003` | How coarse is the grind, and what is that measured against? | `equals_one_of` | G-03 |
| `ALS-COFFEE-1.0-DECAF-001` | How was the caffeine taken out of this coffee? | `equals_one_of` | G-06, G-03 |
| `ALS-COFFEE-1.0-DECAF-002` | The page says chemical-free or naturally decaffeinated — what does that actually tell me? | `equals_one_of` | G-06 |
| `ALS-COFFEE-1.0-DECAF-003` | How much caffeine is actually left in this decaf? | `matches_format` | G-03, G-06 |
| `ALS-COFFEE-1.0-FRESH-001` | When was this roasted? | `matches_format` | G-02 |
| `ALS-COFFEE-1.0-DATEFORM-001` | If there is a date on this, is it worded the way the law where I live requires? | `equals_one_of` | G-03 |
| `ALS-COFFEE-1.0-STORAGE-001` | How should I store this once it arrives, and should I keep it in the fridge or freezer? | `is_stated` | G-06 |
| `ALS-COFFEE-1.0-PROV-001` | Which country was this coffee grown in? | `is_stated` | G-01 |
| `ALS-COFFEE-1.0-PROC-001` | How was this coffee processed after picking — washed, natural, or honey? | `equals_one_of` | G-03, G-06 |
| `ALS-COFFEE-1.0-NETQ-001` | Does the weight shown apply to the exact size I am buying? | `is_stated` | G-12 |
| `ALS-COFFEE-1.0-PRICE-002` | What does this cost per kilogram, so I can compare it with another bag? | `derived_from` | G-05, G-12 |
| `ALS-COFFEE-1.0-INGR-001` | Is there anything in this besides coffee? | `is_stated` | G-06, G-10 |
| `ALS-COFFEE-1.0-ALLERG-001` | Does this contain anything I am allergic to? | `is_stated` | G-06, G-10 |
| `ALS-COFFEE-1.0-CERT-003` | Does the organic claim on this page resolve against the certifier's own public register? | `resolves_against_register` | G-04, G-06 |
| `ALS-COFFEE-1.0-KONA-001` | If this says Kona or Hawaiian, how much of it actually is? | `is_stated` | G-01, G-10 |

Three of these deserve calling out.

**`-DECAF-001` carries the most dangerous near-miss in the standard.** On virtually every coffee page
a specification row labelled **"Process"** names the post-harvest treatment at the mill — washed,
natural, honey — and says nothing about decaffeination. A checker keyed on that word reads a drying
method as a solvent disclosure. Relatedly, *"naturally decaffeinated"* is the established trade
euphemism for an ester solvent, so the phrase a shopper reads as "no solvent" usually means the
opposite.

**`-STORAGE-001` has the strongest legal footing of anything in the freshness class**, and it is
counter-intuitive: the durability date is the *one* mandatory particular carved out of the EU
pre-purchase distance-selling requirement, while **storage conditions are not**. So storage — not
dates — is the assertion in this class with a genuine page-level duty behind it.

**`-PROV-001` is commercially central and has no mechanism at all.** The engine's origin matcher was
removed for being wrong in *both* directions on real copy, and its own record forbids a third
head-noun rule. The measured path back is in `ENGINE_GAPS.md` G-01 and it is a terminator rule, not
another word list.

---

## NOT DISCRIMINATING (5)

The engine could run these and deliberately does not. Published so a reader can see the question was
considered rather than missed.

| id | question | predicted fail band |
|---|---|---|
| `ALS-COFFEE-1.0-PRICE-001` | What does this cost? | 0-5% |
| `ALS-COFFEE-1.0-STOCK-001` | Can I actually buy this right now? | 5-20% |
| `ALS-COFFEE-1.0-TERMS-001` | Can I buy a single bag without signing up for a recurring subscription? | 0-10% |
| `ALS-COFFEE-1.0-DECAF-004` | Can I buy a decaf version of this same coffee? | 85-98% |
| `ALS-COFFEE-1.0-DIET-001` | Is this coffee vegan and gluten-free? | 80-97% |

**A row that passes for everyone and a row that fails for everyone carry the same amount of
information, which is none.** Price is the canonical case: the engine measured a price requirement
failing for zero of thirteen real stores. `-DECAF-004` and `-DIET-001` are the mirror image — decaf
is almost always a separate product, and plain roasted coffee is inherently vegan and gluten-free, so
both would fail or pass near-universally and neither tells a reader anything.

This tier did not exist when the grammar was written. **Coffee forced it into existence**, because
the three original tiers could describe the price question only as untestable (false) or as
executable (noise). See `SCHEMA.md` §2.

---

## ADVISORY (11)

Real buyer questions public data cannot adjudicate. Published, never tested, never scored.

| id | question | predicted fail band |
|---|---|---|
| `ALS-COFFEE-1.0-REST-001` | How long should I let these beans rest before brewing them? | 70-95% |
| `ALS-COFFEE-1.0-SHELF-001` | How long will this stay good, and does that change once I open the bag? | 75-95% |
| `ALS-COFFEE-1.0-ROASTORDER-001` | Will this be roasted after I order, and how soon after roasting does it ship? | 75-95% |
| `ALS-COFFEE-1.0-GRINDDATE-001` | If I choose the ground option, when is it actually ground? | 85-98% |
| `ALS-COFFEE-1.0-VALVE-001` | Does the bag have a one-way valve to let the gas out? | 70-95% |
| `ALS-COFFEE-1.0-BIRD-001` | Is this coffee shade grown, and is that the same as bird friendly? | 80-97% |
| `ALS-COFFEE-1.0-VAR-001` | What variety is this, and can a Geisha claim be checked? | 50-85% |
| `ALS-COFFEE-1.0-CUP-001` | Is there a cupping score, and does it come with enough detail to mean anything? | 80-97% |
| `ALS-COFFEE-1.0-RETURN-001` | If I do not like the coffee, can I send it back after I have opened the bag? | 70-95% |
| `ALS-COFFEE-1.0-CANCEL-001` | If I subscribe, can I cancel online myself, where I signed up? | 75-95% |
| `ALS-COFFEE-1.0-DUTY-001` | If this ships to my country, who pays the customs duty and import tax? | 60-90% |

Two of these exist mainly to name a phrase that fools every keyword check:

- **"Ships within 24 hours"** is dispatch latency, not roast age. A bag roasted three weeks ago
  satisfies it. (`-ROASTORDER-001`)
- **"Cancel anytime"** names no mechanism, no location and no cut-off, and is fully consistent with a
  cancellation flow requiring a phone call during business hours. It is printed constantly and is the
  reason rules were written in this area. (`-CANCEL-001`)

And one names a phrase that reads as law and probably is not: **"for food safety and hygiene reasons
we cannot accept returns of opened products"** is likely wrong on both available EU and UK exceptions
for sealed shelf-stable roasted coffee. (`-RETURN-001`)

---

## The registry position, in one paragraph

Registry resolution is what would upgrade a finding from *"the page says so, cited"* to *"an
independent register confirms"*, and it is the piece nobody in this market occupies. The honest
ceiling:

> **No public register in coffee resolves a specific bag.** Every register resolves an
> *organisation*; a few resolve a *product listing*, which is still not a lot.

Exactly one register is unambiguously strong enough to fail a false claim: the **USDA Organic
INTEGRITY Database** — mandated on-label, resolvable to the seller, status-typed,
certificate-downloadable, and confirmed available in bulk. Fair-trade and habitat schemes maintain
real free registers that sellers almost never publish an identifier for. One major fair-trade
scheme's authoritative lookup is behind a login, so **absence carries no information and presence is
not a status check** — and treating the two fair-trade schemes as one claim would silently downgrade
the verifiable one and launder the unverifiable one. A licensed decaffeination process, a variety
claim and a protected origin name have **no usable register at all**, despite the research initially
reporting that they did. Full detail in `GROUNDING.md` §2.3.

---

## Limits a reader must not exceed

1. **No band here is measured.** Every one is a hypothesis about which seller population a page
   belongs to.
2. **No page was inspected.** Statements about how sellers publish things describe what
   specifications permit and what trade sources report.
3. **Ten entries are executable and each has stated residual risk.** Read the `adversarial` block
   before quoting one.
4. **Sentence-scoped matching bounds what any text entry can see.** A fact split across two
   sentences is invisible; abbreviated units (`12 fl. oz.`, `1 lb.`) are broken apart by the
   tokenizer; and a specification block matches but cannot be quoted. `ENGINE_GAPS.md` G-11.
5. **One entry regresses when a merchant connects their store.** `-IDENT-001` passes publicly and
   returns "requires store access" once authenticated, because the authenticated snapshot drops the
   markup field while the barcode sits in the synced catalog. `ENGINE_GAPS.md` G-07.
6. **A conformance result cannot currently be produced against a public URL at all.** The public test
   has no way to accept a supplied contract. `ENGINE_GAPS.md` G-09 — and it should be built first,
   because without it every other gap is academic.

---

## Changelog and the never-weaken rule

Version `1.0`, 2026-07-26. First authored version; nothing has been measured.

> **The changelog may never show an assertion being weakened in the same window a merchant failed
> it.** That single event retroactively poisons every result this standard ever produced.

Mechanically: a `weakened` or `demoted` change requires an attestation stating whether failures exist
under the prior form, and if they do, the affected results must be **reissued or invalidated** — there
is no grandfathering option. `strengthened` changes (copy that passed now fails) are always safe and
need no attestation. The consistency of that attestation is enforced by the test suite, which
includes a deliberately contradictory fixture that must fail. Full rule: `SCHEMA.md` §5.
