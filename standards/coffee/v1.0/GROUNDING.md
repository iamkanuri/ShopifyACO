# GROUNDING — the provenance record for ALS-COFFEE 1.0

Per-entry citations live in [`standard.json`](standard.json) under each entry's `grounding` block,
including the refuting pass's verdict. **This document is the session-level record**: what was
actually run, what it returned, the class-level structural findings that shaped the standard, and —
most importantly — **the questions that were researched and dropped**, so a later session inherits
the evidence rather than re-proposing them.

---

## 1. What was run, and whether it completed

| unit | count | completed |
|---|---|---|
| independent research agents, one per assertion class | 7 | 7 |
| independent refuting agents, given the complete candidate set | 2 | 2 |
| candidate questions produced | 90 | — |
| refutation verdicts issued | 180 (90 × 2) | — |
| distinct web retrievals across all agents | ≈ 400 | — |
| total agent tool calls | 582 | — |

**Completion state: DECISIVE.** All 7 expected research units and both expected refuting units
returned. Applying the discipline in `src/measure/completion.ts`: every scheduled unit completed,
every candidate was adjudicated by at least one refuter, so this is `defects_found` (the refuters
found real defects) rather than `incomplete`. **Had a single research class or refuter died, this
record would say `INCOMPLETE` and the count of grounded questions would be `null` rather than a
number** — that rule exists because the same failure has appeared four times in this project, always
in the flattering direction.

**Classes:** certification and registry landscape · decaffeination · process and intrinsic
specification · freshness and handling · packaging, format, grind and quantity · purchase terms and
logistics · regulatory and labelling constraints.

**Refuters:** buyer-demand (which questions do shoppers demonstrably ask, versus the trade or the
researcher) and registry-reality (does the register exist, is it free and public, and at what level
does it resolve).

### Constraints the research ran under, which bound every claim in this document

- **No storefront or product page was fetched by anyone.** Prohibited for egress reasons. So **no
  statement anywhere in this standard is a measurement of what coffee pages actually contain.**
  Every `machine_readability` judgement in the research describes what specifications *permit* and
  what trade sources *report*, and every `predicted_discrimination` band in `standard.json` is a
  hypothesis. Nobody should read a base rate out of this document.
- **Search budget exhausted before the refuters ran.** Both refuters had zero web searches available
  and worked entirely from direct fetches — 27 and ~47 respectively. One of them turned this into an
  advantage by querying a live autocomplete endpoint directly, which produced the best shopper-intent
  evidence in the whole corpus.
- **Several high-value sources were unreachable**: the two largest buyer communities returned 403 or
  a paywall gate to every agent, so community evidence is skewed toward enthusiast forums whose users
  are far more freshness-literate than a median shopper. Two regulator sites bot-blocked the refuter.
  Primary trade-standard PDFs could not be rendered. Where a figure could not be reached, it is not
  cited.

---

## 2. What the refuters changed — the four findings that reshaped the standard

### 2.1 The package-versus-web-page error. The dominant defect.

Three research classes labelled a food-labelling duty **`mandated`** while citing package-labelling
law as authority for a *product page*. The refuter read the instruments and found:

- The US organic labelling rule is titled for packaged products and places the certifier's name on
  the **information panel**. It does not reach websites or e-commerce listings.
- The US net-quantity rule applies to the **principal display panel of a food in package form**,
  with no mention of internet or online anywhere in the section.
- **By contrast, the commercial-terms instruments genuinely are web-page obligations** — the
  distance-selling information duty, the order-shipment rule, price indication and negative-option
  rules. The corpus got food labelling wrong and commercial terms right.

**What changed:** `ALS-COFFEE-1.0-CERT-001` and `-WEIGHT-001` no longer claim a page mandate. Where a
page duty is asserted it now runs through the **EU distance-selling route** — every mandatory
particular except the durability date must be available pre-purchase — which the refuter set out to
break and could not. That single provision is now the legal spine of `-WEIGHT-001`, `-INGR-001`,
`-ALLERG-001`, `-NETQ-001` and `-STORAGE-001`.

### 2.2 The certificate-verification tier is trade-invented

Shoppers demonstrably **buy** certified coffee and demonstrably **do not audit certificates**. Every
"who certified it / is it current / can I look them up" question traced to a certifier's own
business-to-business material — one help article is literally titled for checking a *supplier's*
status, another register is pitched at checking *business partners*, and a third is framed as
supplier audit and fraud prevention. Building a lookup tool proves that importers and retail buyers
check, not that shoppers do.

**What changed:** the three registry-resolution entries collapsed to one (`-CERT-003`), it is
`blocked` rather than executable, and its `demand_basis` carries the `trade_convention_only` warning
label. The grammar's rule that no *executable* entry may rest on trade convention alone is therefore
respected rather than circumvented. **The one survivor is shade-grown / bird-friendly**
(`-BIRD-001`), where independent conservation and consumer guidance genuinely instruct shoppers.

### 2.3 Level conflation — a register that cannot reach the bag

| claim | research said | refuter confirmed |
|---|---|---|
| a licensed decaffeination process | `registry_resolvable` | **self-declared.** The trademark register resolves who *owns* the mark and states it indicates nothing about licensees. The lot-traceability tool needs a production number from a green-coffee bag tag no retail buyer ever sees. |
| coffee variety | `registry_resolvable` | **not resolvable.** The varieties catalogue is a variety-*name* reference with agronomic data — no seller, brand, SKU or lot lookup. Identity requires shipping beans to a laboratory. The research's own stated lookup method contradicted its own status label. |
| a habitat certification | register exists | **resolves farms, not roasters.** The seal appears on a roaster's bag; the lists carry no certificate number, date or status, so currency is uncheckable in principle. |
| a biodynamic mark | `registry_resolvable` | **a membership directory.** No certificate number, date, expiry or status; a directory that cannot express validity is not a certificate register. |
| a protected origin name | one bundled `registry_resolvable` verdict | **the worst bundling in the corpus.** Four structurally different things shared one verdict, and the one they led with has **no register at all** — the research's own text conceded the origin certificate is a trade document rather than a public searchable record. |

**The honest ceiling, and it is the single most important sentence in this record:**

> **No public register in coffee resolves a specific bag.** Every register resolves an *organisation*;
> a few resolve a *product listing*, which is still not a lot. The strongest true sentence a
> conformance standard can make is: *"an independent public register confirms that the named legal
> entity held this certification, with this scope, at this status, as of this date."* It cannot say
> the coffee in the bag is that coffee.

**Tier 1 — a real, free, public lookup strong enough to fail a false claim.** Exactly one is
unambiguous: the **USDA Organic INTEGRITY Database**. It is simultaneously mandated on-label,
resolvable to the *seller* (only a certified handler may use the seal), status-typed, certificate-
downloadable, and available in bulk — the refuter fetched a real 138 KB spreadsheet export to
confirm it. **If the engine ever supports exactly one registry assertion, it is this one.** The
documented REST API is *not* confirmed: its developer help page returns an application error.

**Tier 3 — effectively self-declared at page level despite real machinery behind them.** One major
fair-trade scheme's authoritative lookup is behind a partner-portal login (confirmed by direct
fetch), so *absence carries no information and presence is not a status check*. Any standard treating
the two fair-trade schemes as one interchangeable claim **silently downgrades the verifiable one and
launders the unverifiable one** — which is why `-CERT-002` separates them explicitly.

### 2.4 The set was badly padded

The refuter's verdict: roughly 90 questions, of which **the demonstrably shopper-driven core is
about 18**, with at least 9 questions being the same question counted two to four times across
classes (roast date appeared 4×, decaf method 3×, net weight, organic, unit price and growing origin
2× each).

**And the ranking was wrong.** The strongest verified shopper signal in the entire corpus —
**grind-to-brewer match**, with five of the top ten live autocomplete completions for "coffee grind"
being brewer-specific and a grind size chart ranking first — **was not ranked first by any of the
seven researchers.** Roast level ranked second, verified against a trade-organisation statement that
of all the information on a coffee label it is the most important to specialty consumers.

**What changed:** duplicates were merged; the grind entries were promoted from marginal to the
best-grounded executable assertions in the standard; and the tiers below were cut.

---

## 3. Questions researched and DROPPED

Recorded with reasons so a later session inherits the evidence rather than re-proposing them. **A
dropped question is not a question nobody thought of.**

| dropped question | why |
|---|---|
| **Anaerobic / carbonic-maceration protocol** (vessel, duration, step position) | Specialty-provenance tier. Cited to glossaries, importer guides and trade press — sources that *define* terms. Processing-method search intent resolves to plant, equipment and flow-chart results, i.e. producer and student intent. |
| **Lot identity / microlot / nanolot** | Same tier. The words are definitionally unstable, one company's nano is another's micro, and no register resolves a lot. |
| **Elevation in metres above sea level** | Same tier. No body defines "high grown"; a single precise figure on an aggregated lot is spurious precision; and the unit ambiguity between feet and metres differs by a factor of three with both appearing on real bags. |
| **Origin grade meaning** (screen-size and altitude grade bands) | Definitions are real and owned by named origin bodies, but the grade attaches at milling and export rather than to a roasted retail pack, and the demand evidence was importer-facing. |
| **Competition-lot / auction provenance** | The one coffee claim with a genuine long-running published record including the winning bidder — but it covers only competition lots, a negligible fraction of coffee, and has no identifier scheme. Retained only as reasoning inside `-VAR-001` and `-CUP-001`. |
| **Additives during processing** (co-fermentation with fruit or spices) | Real and interesting; no register, no definition, and demand evidence was trade press. The competition bodies that *do* exclude additives cover a negligible share of coffee. |
| **Nitrogen flush and residual oxygen** | Packaging tier. The research **self-refuted**: "I found no buyer-community thread asking for residual oxygen before purchase." Every quantitative figure traced to packaging suppliers, converters, machinery vendors or roaster marketing — parties selling the thing being praised. |
| **Bag film, barrier and opacity** | Same tier, same self-refutation. Additionally: the readable signal is the *misleading* one, because end-of-life sustainability attributes are increasingly tagged while barrier performance never is, and compostable films can trade **off** against barrier. |
| **Caffeine content per cup** | Any figure without dose, water volume and brew method is not reproducible, and seven of ten "is decaf coffee" completions are health questions — territory `out_of_scope` excludes. Residual decaf caffeine survives as `-DECAF-003`; general caffeine content does not. |
| **Cups per bag / yield** | Unfalsifiable by construction in its usual form. A 340 g bag yields roughly 25 to 55 cups on dose alone, and the commonest phrasing hedges with "up to". |
| **Kosher and halal certification** | For *unflavoured* coffee both certifying traditions state plainly that plain beans need no certification because coffee is inherently acceptable. Scoring a null as a trust signal is exactly the failure the `not_discriminating` tier exists to prevent; the general vacuity point is captured in `-DIET-001`. |
| **Non-GMO verification** | The refuter established coffee appears on **neither** the high-risk **nor** the monitored-risk crop list — there is no GM coffee. The mark is close to non-differentiating on single-ingredient coffee. |
| **Biodynamic certification** | The certifier's own site does not list coffee among its certified categories, and the entire "demand" evidence was a press release announcing a world-first product. |
| **Company-level social certification** | Certifies the *company* across all product lines and explicitly does not break down individual product supply chains, so no fact about the bag follows. Its demand evidence was a shipping company's blog. |
| **Environmental, ethical-sourcing and carbon claims** | Moved to `out_of_scope` rather than dropped. Unqualified general environmental benefit claims are the target of active regulation, so **recording their presence as conformance would invert the law** — presence is the risk factor. |
| **Health, focus, metabolism and low-acid claims** | `out_of_scope`. A regulated claim family; adjudicating it means taking a position on it. A nutrient-content claim additionally *voids* coffee's nutrition-labelling exemption in the US, so the page creates an obligation it then fails — and a naive checker scores it as more informative. |
| **Pod system identity** (Original versus Vertuo, K-Cup, 44 mm ESE) | A genuinely strong question with the sharpest near-miss in the corpus: "Nespresso compatible" means Original line **only** by trade convention and never Vertuo unless named — a convention a machine cannot infer and a shopper reasonably misreads. Dropped from v1.0 only because the applicability envelope excludes pods from most entries and gating it needs `G-10`; **the highest-value single addition to v1.1.** |
| **Shipping restrictions on coffee** | The research verified the US position only and said so, explicitly warning that "no restriction found" must not become "no restriction exists" elsewhere. Too thin to publish. |
| **Refund timing and money-versus-credit** | Real and well-grounded regulatorily, but not coffee-specific and largely duplicative of `-RETURN-001`. |
| **Subscription go-forward pricing and default enrolment** | Well grounded regulatorily and genuinely important, but the complaint statistic three research questions leaned on **could not be verified anywhere** by the refuter, including in the legal alert the research cited for it. The mechanics survive in `-TERMS-001` and `-CANCEL-001`; the unverifiable statistic is cited nowhere. |

---

## 4. Class-level structural findings worth inheriting

Four negative findings did more to shape this standard than any positive one.

1. **No published trade standard covers roasted-coffee retail labelling, roast-date declaration,
   shelf life or freshness.** The specialty trade organisation's published standards cover sensory
   assessment, evaluator competency, brewers, grinders and training venues. **"The trade body says
   put a roast date on it" is not a citable claim**, and the research predicted this would be the
   commonest error in the class.

2. **The trade does not agree with itself on freshness.** The specialty side treats a best-before
   date as evasion; the mainstream trade association anchors its own consumer guidance to the
   best-by date and **does not recommend seeking a roast date at all**. A standard must not silently
   adopt one side.

3. **The roast date is structurally unavailable to a page.** It is a lot attribute stamped at pack
   time; a product page is a product-level document whose fields are written once. There is **no
   structured-data property for it** — the nearest candidate is vehicle-oriented — and the dominant
   feed specification's expiration attribute is *listing* expiry that defaults to thirty days after
   the last refresh. **A checker that maps either to freshness will be confidently and
   systematically wrong, in the flattering direction.**

4. **The one mandated date is the one the page need not carry.** The durability date is the single
   mandatory particular carved out of the pre-purchase distance-selling requirement, while **storage
   conditions are not carved out**. So the strongest legally-grounded hook for a coffee product page
   in the entire freshness class is **storage and handling, not dates** — a non-obvious reading the
   refuter tried to break and could not, and which it called the best analytical work in the corpus.

**One trap worth restating because a naive search produces it immediately:** searching for a coffee
exemption from EU date marking surfaces an annex that exempts whole or milled coffee beans. That is
the **nutrition declaration** exemption. The date-marking exemption list is a *different annex*, and
coffee is not on it. Different annex, different particular.

---

## 5. Where the research was exemplary, and why that matters

Several entries volunteered **against their own interest**, and the refuter asked for this on record:
the valve, nitrogen-flush, bag-barrier, made-in-USA, shipping-restriction and net-weight-demand
entries all state plainly that the buyer demand is trade-taught or undemonstrated. The unit-price
entry says the requirement is "strongly mandated, weakly demonstrated as behaviour." The
nutrition-panel entry is framed as a *negative* finding, specifically to stop a standard demanding a
panel that both jurisdictions exempt. The cancellation entry recorded that the federal rule most
often cited had been **vacated**, rather than citing struck-down law as live.

That is the discipline this document is held to, and it is the reason the dropped list in §3 is
longer than the standard.

---

## 6. What must be measured before any band in this standard is believed

Every `predicted_discrimination` band in `standard.json` is flagged `measured: false`, and this is
the plan that would change it:

1. Sample real coffee product pages across seller populations — specialty roaster, mainstream
   grocery, pod seller, subscription-first — because almost every band in the standard is a
   hypothesis about *which population a seller belongs to* rather than about coffee.
2. Run the ten executable entries and record per-entry pass/fail **with `n=`**.
3. Publish the measured rates, then update `measured` in a changelog entry. A rate moving *into* the
   15–85% band promotes a `not_discriminating` entry, which is a **strengthening** change needing no
   attestation. A rate moving *out* is a demotion and needs the never-weaken attestation.
4. Audit the passes by hand. The engine's own history is decisive here: audits of 37 and 18 rows both
   reported zero false positives and were read as reassurance, and an audit of 100 rows across 35
   stores then found two real defects. **"Zero across 55 rows" was a statement about sample size.**
