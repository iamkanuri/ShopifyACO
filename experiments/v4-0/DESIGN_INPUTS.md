# v4.0 Phase B — DESIGN INPUTS for the referent guard

Everything a designer needs, assembled from the artifacts and **re-verified by execution
this session**. Where the v4.0 brief's number disagreed with the artifact, the artifact
wins and the disagreement is recorded.

---

## 0. What is being attempted, and what counts as success

Close the **referent** class: *the term's governing noun phrase does not denote this
product*. G-15. Two targets, reported separately:

| target | size | decides ship? |
|---|---|---|
| **PRIMARY — real-copy defects** | 8 sole-attributed `wrong_subject` rows over 7 stores | **yes** |
| SECONDARY — capability groups | 17 reinstated groups / 73 false passes, all `comparative` + `review_quote` | no |

**Revert-and-pin is an explicit success.** Four of five subject-shaped attempts in this
repo's history ended there. A pin with a measured cost is a publishable fate.

### The cost bar — CORRECTED

The brief says *"2.13–5.13 true rows at risk per defect only this axis closes"*.
`experiments/v3-9/out/robust.json` says **2.33–5.13**:

| reading | defects only this axis closes | honest carriers at risk | ratio |
|---|---|---|---|
| strict | 6 (6 stores) | 14 | **2.33** |
| raw / corrected | 8 (7 stores) | 41 | **5.13** |

`14 / 6 = 2.333…` and `41 / 8 = 5.125`. The brief's `2.13` is not in any artifact.
**A guard must lose fewer than ~2.33 true rows per real-copy defect it closes**, measured
on the 3,349-sentence corpus and the 349-store A/B — not on the acceptance suite.

### Verified against the artifacts

| claim | source | verdict |
|---|---|---|
| 8 sole-attributed defects over 7 stores | `corrected.json` — A040, A065, A067, A069, A070, A022, A047, A053 | ✅ (raw/corrected reading; strict is 6 over 6) |
| 17 groups / 73 false passes, all comparative + review_quote | `suite2.json.v4_capability_target` — 10 + 7, sum = 73 | ✅ |
| comparative 34 sentences, review_quote 3, in 3,349 | `v3-6/freq/occurrence.json` — 34/18 stores, 3/3 stores | ✅ |
| G-14 `wrong_subject` cell 441/914; table is 104 cells | `g14.table.test.ts` — 13 keys × 8 classes | ✅ |
| P-22: 2 of 69 quoted rows, 1 merchant-visible | reproduced exactly; **and extended — see below** | ✅ + |
| term-list frequency "unmeasured" | now measured: `plant-based` 4, `plant based` 0, `unscented` 1 sentence | ✅ measured |
| cost bar 2.13–5.13 | `robust.json` says 2.33–5.13 | ❌ **corrected** |

---

## 1. THE PRIMARY TARGET — 8 rows a referent guard must close

Sole-attributed to `wrong_subject`; full untruncated sentences, from
`experiments/v3-9/out/corrected.json`. Suite 2.0 carries these as `ws-01…ws-08`.

| id | store | claim | class | the sentence |
|---|---|---|---|---|
| A040 | littlewaves.coffee | organic | supplier_attribute_not_product | *"More : Nestled along the southern shores of Guatemala's breathtaking Lake Atitlán, AproCafé Atitlán is a cooperative of 54 organic-certified producers farming the volcanic slopes…"* |
| A070 | wreckingballcoffee.com | fair_trade | supplier_entity_generality | *"Banko Dhadhato is one of many primary Fair Trade and organic certified cooperatives that make up the storied Yirgacheffe Coffee Farmers Cooperative Union (YCFCU)."* |
| A069 | wreckingballcoffee.com | organic | producer_entity_not_product | *(the same sentence, read for `organic`)* |
| A065 | trafficcoffee.com | organic | third_party_subject | *"David has other 2 farms and wants to improve his processes to produce sustainable coffee, that's why his farms have three certifications, Fairtrade, Organic (one farm), and…"* |
| A022 | equator.ca | organic | company_level_generality | *"Equator Coffee Roasters specializes in roasting and delivering fresh organic coffee."* |
| A067 | unionroasted.com | organic | regional_generality | *"Chirinos brings together over 800 smallholder farmers in the high mountains of Peru, where organic farming is taken seriously and community prosperity is built cup by cup."* |
| A047 | necessaire.com | fragrance_free | bundled_component_attribute | *"The Body Wash Eucalyptus to gently cleanse and nourish, The Body Serum to deeply hydrate and replenish, and The Body Lotion Fragrance-Free to strengthen, firm, and lock in…"* |
| A053 | ozonecoffee.co.uk | organic | region_industry_generality | *"The country has a particularly strong tradition of organic and cooperative farming: a large proportion of Peruvian specialty coffee is certified organic, grown by smallholder…"* |

**The mechanism they share:** the term's governing NP denotes an **organisation**
(cooperative, union, roaster, producers), a **place** (the country, the high mountains of
Peru), a **practice or category** (organic farming, Peruvian specialty coffee), or a
**bundled sibling item** — never the product under test.

### Ten more misleading rows exist, and only these 8 are this axis's alone
`corrected.json` records **18** misleading rows. Of the other ten, one is closed by Phase A
(A041 magicspoon, `plant-based`), two are the soil-science sense of `organic`, two are
`single-origin` inside a blend, and the rest are co-attributed to `letter_not_spirit` or
`tense_modality`, both DESCOPED. A design that reports closing 18 has miscounted its target.

---

## 2. THE COST SIDE — 18 honest carriers a guard must not take

These are TRUE rows real merchants publish. 14 of them carry `wrong_subject` markers.

| id | store | claim | the sentence |
|---|---|---|---|
| A002 | askinosie.com | single_origin | *"Ours are single origin and roasted to perfection."* |
| A015 | canadianheritageroastingco.com | organic | *"Organic Guatemalan Coffee - Calgary Heritage Roasting Co."* (title) |
| A030 | highrisecoffeeroasters.com | organic | *"You'll find our Organic Peru Norte is medium bodied and accented by clean, bright, and smooth acidity."* |
| A013 | brooklyncandlestudio.com | paraben_free | *"Formulated without parabens, phthalates, or sulfates."* |
| A049 | otherland.com | cruelty_free | *"Clean-burning, cruelty-free, and made without parabens or sulfates."* |
| A044 | monos.com | vegan | *"Description Built from water-resistant nylon twill with vegan leather details, the Metro Travel Wallet is designed to carry…"* |
| A045 | moonjuice.com | vegan | *"All of our Supers are vegan and tested for pesticides, heavy metals, microbiological content and more."* |
| A016 | chomps.com | gluten_free | *"ALL Chomps are gluten free - no need to worry about that pesky ingredient."* |
| A023 | evermorecoffee.com | single_origin | *"Discover Guatemala El Sol Natural, a naturally processed single origin coffee with notes of Concord grape, milk chocolate, and raspberry."* |
| A033 / A034 | justuscoffee.com | single_origin / organic | *"Enjoy fair trade, organic, single origin Colombian coffee at the touch of a button."* |
| A017 | colorroasters.com | single_origin | *"Single Origin - Mexico - One of our absolute favorite coffees in Oaxaca is back."* |
| A038 | lamillcoffee.com | single_origin | *"single origin Ethiopia washed"* |
| A059 | redbaycoffee.com | single_origin | *"Each beautifully designed tin can holds our carefully sourced single origin Colombian medium roast..."* |
| A051 | outerknown.com | organic | *"Constructed out of 5oz organic cotton."* |
| A055 | partakefoods.com | gluten_free | *"Free of the Top 9 Allergens, gluten-free, non-GMO, and kosher, these cookies are safe for schools, playdates, and parties."* |
| A063 | thursdayboots.com | organic | *"Product Features … Sodello Brand 80% Organic Cotton, 18% Nylon, 2% Elastane …"* |
| A021 | dropps.com | fragrance_free | *"UltraWash Dishwasher Detergent Case, Unscented"* ⚠️ under Phase A adjudication |

### The two collisions any design must survive

1. **`organic ... coffee` appears on BOTH sides.** A022 (defect) governs *"fresh organic
   coffee"*; A033/A034 (true) govern *"organic, single origin Colombian coffee"*; A023
   (true) governs *"single origin coffee"*. **The governing head noun alone cannot separate
   them.** What differs is the frame around it: A022's main predicate is
   *"Equator Coffee Roasters **specializes in** …"* — a company-activity frame.
2. **Universal quantification is honest on one side and hostile on the other.** A045
   (*"All of our Supers are vegan"*, product is `/products/superbeauty`) and A016
   (*"ALL Chomps are gluten free"*, store is chomps.com) are TRUE by entailment. G-15
   records the trap: *"quantified brand claims are honest, unquantified ones are not, and
   the marker cannot tell them apart."*

---

## 3. THE THREE NEAR-IDENTICAL PAIRS — the real acceptance test

From byte-frozen suite 1.0. *"If a fix cannot separate these two it has not solved the
problem, it has moved it."*

| must PASS | must REFUSE |
|---|---|
| `fps-01` *"We use the Swiss Water Process for every lot we sell."* | `sit-01` *"All of our decafs use the Swiss Water Process."* |
| `fps-03` *"Every bag we sell is a Swiss Water Decaf."* | `sit-02` *"Every decaf we stock is a Mountain Water Decaf."* |
| `pln-02` *"This lot went through the Swiss Water Process before roasting."* | `pst-01` *"Until 2024 we used the Swiss Water Process for this lot."* |

- Pairs 1 and 2 differ in the quantifier's **restrictor**: *every lot / bag **we sell*** is
  the seller's whole product set and provably contains this item; *all of our **decafs*** /
  *every **decaf** we stock* is a proper subset whose membership the sentence never
  establishes.
- Pair 3 is a **TENSE** pair, and `tense_modality` is DESCOPED. A referent guard must leave
  `pln-02` passing and is **not** expected to close `pst-01`. Touching either is a defect.
- `xsl-01` *"We also stock a Swiss Water Process decaf from Colombia."* and `fps-02`
  *"We decaffeinate this coffee with the Mountain Water Process."* **share the subject
  `We`** and differ only in attachment. This is why the record says term-attachment, not
  grammatical subject.

---

## 4. HARD CONSTRAINTS from the record

1. **Term-attachment, not grammatical subject.** 9 of G-15's 17 real cases are unreachable
   by any subject frame; 8 of the 19 suite-1.0 carriers have no surface subject at all.
2. **FAIL OPEN on unreadable attachment.** `nonProductSubject` fails open by design because
   vetoing on unknown suppresses the subject-less copy that fills a Shopify description.
   Any rule that *requires* a readable referent fails 11 of 19 guard carriers.
3. **A closed list used as the PROTECTOR fails open in the damaging direction.** If a list
   is used, it must be on the VETO side, so an unlisted shape passes.
4. **Do not attempt a head-noun rule of the `origin` shape.** That tombstone cost 17 true
   statements for 0 false passes gained.
5. **`CLAUSE_BOUNDARY` is a known open defect** serving two incompatible jobs. Do not add
   to it without scope.
6. Blast radius already measured: `first_person` is **180 of 335 stores (53.73%, exact)**;
   `trade_form` 27–63%; `plain_present` 91–175; `spec_block` 66–144.

## 5. GATES a shipped guard must clear

```
suite 1.0        must_not_regress 19/19 EXACT · hostile half must stay non-empty
                 and at least one stratum fully open (no exact hostile count is pinned)
suite 2.0        must_not_regress 17/17 EXACT — the live constraint
                 hostile half RECORDED, not targeted (baseline 0/8)
G-14 gate        104 cells + 8 class totals + hostile/control totals, asserted exactly.
                 A working guard SHOULD move the wrong_subject cell — update the constants
                 with per-cell arithmetic and state the direction. That is the gate working.
ENGINE_VERSION   tripwire fires on any byte change to productTest.ts / testEvidence.ts /
                 subject.ts / crawler/extract.ts. Bump AND re-pin, same commit.
349-store A/B    status + detail + quote, keyed on url|label, two-sided canary
adversarial      independent attackers who authored neither the guard nor suite 2.0
```
