import { safeFetch } from "../crawler/fetch.js";
import { validateUrl } from "../crawler/ssrf.js";
import { extractPage, extractJsonLd, type ExtractedPage } from "../crawler/extract.js";
import { htmlToText, htmlToBlockText } from "../crawler/sanitize.js";
import { parseRobots, isAllowedByRobots, type RobotsPolicy } from "../crawler/robots.js";
import {
  buildEvidence, findSupport, findViolation, findTimingSupport, normalize, termMatches,
  SURFACE_LABEL, type EvidenceSentence, type SupportedEvidence, type QuotableSurface,
} from "./testEvidence.js";
import { lintStrings } from "./claimLinter.js";
import { isValidGtin } from "../feeds/validate.js";
import {
  getCachedResult, storeResult, reserveHostSlot, getCachedRobots, storeRobots,
  reserveEgressSlot, withEgressSlot, markHostThrottled, hostThrottleCooldownMs,
} from "./productTestCache.js";
import { judgeClaims, semanticSpendUsd, type SemanticDeps, type SemanticStats } from "./semanticTier.js";

// ===========================================================================
// PHASE B — the BUYER TEST (the funnel mechanic behind the reposition).
// Paste a Shopify product URL → build a buyer task of 4–6 requirements across
// different surface types (attribute claim · price · variant · purchase terms ·
// logistics) → run each requirement as an HONEST, deterministic assertion
// against the store's PUBLIC data → return an assertion-table result.
//
// Honesty discipline (the whole differentiator):
//   • EVIDENCE-AVAILABILITY, never product truth. A claim not found is "no
//     evidence found", never "your product is not X".
//   • Every Pass on positive evidence must clear the deterministic support gates
//     in ./testEvidence.ts (aboutness · product-surface · presentable quote), and
//     FAILS CLOSED otherwise. A wrong Pass is unrecoverable.
//   • An absence-based pass (`must_be_false`) is DISCLOSED as its own weaker
//     state — never presented as proof.
//   • Surfaces not publicly inspectable (metafields, full policy pages) are
//     "requires store access" — never "missing".
//   • Public data only, robots respected. Deterministic APART FROM one batched
//     model call: `applySemanticTier` resolves claim rows the lexical pass could
//     not, and is on unless `PRODUCT_TEST_SEMANTIC=0`. Measured ≈ $0.0016/test
//     (range $0.0003–$0.0030, n=13). This line used to read "$0 — NO model calls";
//     that was false and a cost experiment was designed around it before anyone
//     checked (experiments/v2-1/CP2_METHOD.md).
// ===========================================================================

const LIMITS = { maxBytes: 1_500_000, timeoutMs: 8_000, maxRedirects: 3 };

// ---- honest term dictionary (support = the positive claim; violating = contrary) ----
interface ClaimTerms { support: string[]; violating: string[] }
const CLAIM_TERMS: Record<string, ClaimTerms> = {
  aluminum_free: { support: ["aluminum-free", "aluminum free", "aluminium-free", "aluminium free", "no aluminum", "without aluminum", "free of aluminum"], violating: ["contains aluminum", "with aluminum", "aluminum-based"] },
  baking_soda_free: { support: ["baking soda free", "baking-soda-free", "without baking soda", "no baking soda", "free of baking soda"], violating: ["contains baking soda"] },
  cruelty_free: { support: ["cruelty-free", "cruelty free", "not tested on animals", "leaping bunny"], violating: ["tested on animals"] },
  vegan: { support: ["vegan", "100% vegan", "plant-based", "plant based"], violating: ["contains animal", "non-vegan"] },
  fragrance_free: { support: ["fragrance-free", "fragrance free", "unscented", "no added fragrance", "no fragrance"], violating: ["added fragrance"] },
  paraben_free: { support: ["paraben-free", "paraben free", "no parabens", "without parabens"], violating: ["contains parabens"] },
  sulfate_free: { support: ["sulfate-free", "sulfate free", "no sulfates", "without sulfates"], violating: ["contains sulfates"] },
  single_origin: { support: ["single origin", "single-origin", "single estate", "single-estate", "single farm"], violating: [] },
  organic: { support: ["organic", "usda organic", "certified organic"], violating: [] },
  fair_trade: { support: ["fair trade", "fair-trade", "fairtrade"], violating: [] },
  gluten_free: { support: ["gluten-free", "gluten free", "no gluten"], violating: ["contains gluten", "contains wheat"] },
  third_party_tested: { support: ["third-party tested", "third party tested", "independently tested", "lab tested", "certificate of analysis"], violating: [] },
  bpa_free: { support: ["bpa-free", "bpa free", "no bpa", "without bpa"], violating: ["contains bpa"] },
};
const CLAIM_LABEL: Record<string, string> = {
  aluminum_free: "Aluminum-free", baking_soda_free: "Baking-soda-free", cruelty_free: "Cruelty-free",
  vegan: "Vegan", fragrance_free: "Fragrance-free / unscented", paraben_free: "Paraben-free",
  sulfate_free: "Sulfate-free", single_origin: "Single-origin", organic: "Organic",
  fair_trade: "Fair-trade", gluten_free: "Gluten-free", third_party_tested: "Third-party tested",
  bpa_free: "BPA-free",
};
// Category keyword → the two claims a buyer most often asks about in that category.
// Ordered specific→general; matched against product_type first (authoritative), then
// title — NEVER tags (a coffee-SCENTED soap must not read as a coffee product).
const CATEGORY_CLAIMS: Array<{ kw: RegExp; claims: string[] }> = [
  { kw: /deodorant|antiperspirant/i, claims: ["aluminum_free", "baking_soda_free"] },
  { kw: /soap|skincare|serum|moisturizer|lotion|cream|cleanser|shampoo|conditioner|balm|body\s?wash/i, claims: ["fragrance_free", "paraben_free"] },
  { kw: /coffee|espresso|roast|whole\s?bean/i, claims: ["single_origin", "organic"] },
  { kw: /supplement|vitamin|protein|powder|capsule/i, claims: ["third_party_tested", "gluten_free"] },
  { kw: /\btea\b|snack|granola|cereal|jerky/i, claims: ["organic", "gluten_free"] },
  { kw: /bottle|container|storage|tumbler/i, claims: ["bpa_free"] },
];

// ---- attribute requirements (v2.3 CP2) --------------------------------------
// Measured motivation: with the defaulted `cruelty_free` row removed, the modal
// store produced exactly ONE finding and 21% produced none, and that one finding
// was the same for 71% of stores ("no stated delivery window"). Uniform failure is
// not depth — it is a template. See experiments/v2-2/RESULT_QUALITY.md.
//
// A requirement earns its place by DISCRIMINATION, not by failure rate: one that
// fails for everyone (cruelty-free, 13/13) and one that fails for no one (price,
// 0/13) carry exactly the same amount of information, which is none.
//
// Every term list below is matched through `findSupport`, so each inherits the same
// evidence discipline as a claim: sentence-scoped, negation-guarded, aboutness-
// checked, chrome-excluded, verbatim whole-sentence quote, fail closed. Single-word
// terms additionally set `wholeWord` — without it "weight" matches "lightweight"
// and the row becomes a silent false PASS.
interface AttributeSpec {
  label: string;
  /** What the row says when nothing was found. Names the fix, not the failing. */
  missingDetail: string;
  terms: readonly string[];
  requireDigit?: boolean;
  wholeWord?: boolean;
  /** When set, the requirement is only asked of products whose category matches —
   *  "care instructions" is a real buyer constraint for a pan and noise for a pencil. */
  onlyFor?: RegExp;
  /** A term occurring is NOT the attribute being stated. This runs on the ORIGINAL
   *  sentence (case intact) and must find an actual VALUE — a material, a place, a
   *  measurement. Without it "Made with love in small batches" states a material and
   *  "Roasted in small batches" states a country of origin, both of which an
   *  adversarial review measured as real passes on the commonest DTC copy there is. */
  valueGuard?: (sentence: string, matchedTerm: string) => boolean;
  /** Treat bottle/bag/jar/tin as the PRODUCT rather than as packaging. Only correct
   *  where a measurement modifies them ("16oz bottle"), never for product claims. */
  allowContainerSubject?: boolean;
  /** Reject any sentence about the shipment outright. */
  shipmentVeto?: boolean;
}

/** A sentence about getting the thing to the buyer is not a statement about the
 *  thing. Applied whole-sentence for size, where the subject can precede OR follow. */
const SHIPMENT_CONTEXT = /\b(shipping|shipped|ships|shipment|freight|pallet|courier|mailer|packaging|per order|orders? (over|above|exceed))\b/i;

/** Nouns that identify a genuine material. Deliberately a closed list: an open
 *  "any capitalised word" rule readmits "Made with Love". */
const MATERIAL_NOUN = /\b(cotton|wool|merino|cashmere|linen|silk|hemp|jute|canvas|denim|suede|leather|down|felt|latex|rubber|silicone|nylon|polyester|acrylic|resin|plastic|steel|stainless|aluminum|aluminium|brass|copper|zinc|titanium|iron|pewter|wood|walnut|oak|maple|cedar|birch|teak|bamboo|cork|paper|cardboard|glass|borosilicate|ceramic|porcelain|stoneware|clay|stone|marble|granite|slate|wax|beeswax|soy|paraffin|carbon|graphite|recycled|organic|leatherette|nubuck|elastane|spandex|lyocell|tencel|viscose|rayon|polypropylene|neoprene|ethylene|eva|abs|polycarbonate)\b/i;

/** A number bound to a unit. This is what "dimensions are stated" actually means;
 *  a bare unit word plus any digit elsewhere in the sentence does not ("Available
 *  in 3 colors with a relaxed length" measured as a pass). */
const UNIT = String.raw`(?:mm|cm|inch|inches|in\b|ft|feet|foot|oz|ounces?|ml|l\b|liters?|litres?|g\b|kg|grams?|lbs?|pounds?)`;
/**
 * An intervening `fl` — "12 fl oz", "12 fl. oz." A merchant writing fluid ounces puts
 * a token between the number and the unit, and digit-adjacency read that as no
 * measurement at all.
 *
 * ⚠️ THE `\b` IS THE WHOLE GUARD, and it was missing in the first draft. Without it
 * `\d+\s?fl` + `ounces?` matches inside ordinary English words: "Midi length, 3
 * flounces, side pockets." passed as a stated measurement, as did "12 flinches"
 * (fl+inch). `flounce` is routine apparel copy. Found by an independent adversarial
 * pass; I had reasoned this half was provably safe because a regex differential
 * showed it only widens strings containing `fl` — which is true, and which includes
 * "flounce". The proof was right and the inference from it was wrong.
 */
const FL = String.raw`(?:fl\b\.?\s?)?`;
// v2.8 CP1 — the `fl` ADJACENCY FIX, and ONLY that.
//
// ⚠️ A HYPHEN BRANCH ("12-oz mug") WAS BUILT HERE AND REMOVED. It closed a real gap
// and 334 independent probes then attributed four distinct false-pass mechanisms to
// it, none of which the legacy tree had:
//   • a one-letter unit as the tail of a hyphenated non-measurement token — "Case
//     dimensions match every 4-G and Wi-Fi tablet.", "Screen height matches the 2-L
//     edition exactly." My own note here used to claim `l`/`ft`/`g` were safe in
//     MEASUREMENT "where a term must match first". That is true of the TERM and
//     false of the LOCATION: MEASUREMENT is tested against the WHOLE SENTENCE, so
//     the matched term and the matched measurement need not be the same span. This
//     is the shape the corpus already pins as "Lightweight frame, 5 ft of reach."
//   • an all-caps style code whose unit ENDS the token — "Style 16-OZ is the black
//     colourway." slips both guards, and worse, DISPLACES THE QUOTE: given
//     "Colourway 3-LB is the darker press. Total weight comes to 2 lbs once cured."
//     the row still passes but now quotes the colourway instead of the weight.
//   • it removed the last backstop under the aboutness classes the corpus already
//     pins as open (usage quantity, bundled item, order threshold, fitment), roughly
//     doubling the written forms in which those gaps fire.
//   • a thousands separator satisfies the lookbehind, so "A 1,200-lb rated ceiling
//     hook." matches on "200-lb".
// The guards could not be tightened without also refusing "A 12-inch-tall vase",
// which is the commonest compound-adjective form of a real dimension. Left OPEN and
// pinned in the corpus rather than shipped half-working.
//
// ⚠️ Also deliberately NOT widened: `l`, `ft`, `feet`, `foot`, `liter` and `measures`
// stay OUT of the dimensions TERM list. v2.7 added them and 196 independent probes
// attributed six false-pass mechanisms to that half — "Only 2 L left in stock."
// passed as a measurement and `ft.` matched "featuring".
const MEASUREMENT_SRC =
  `(?:` +
    String.raw`\b\d+(?:\.\d+)?\s?${FL}${UNIT}` +
    `|` + String.raw`\b(?:dimensions?|capacity|weight|height|width|length|diameter)\s*[:\-–]\s*\d` +
  `)`;
const MEASUREMENT = new RegExp(MEASUREMENT_SRC, "i");
/** Same pattern, global — so every occurrence can be judged in its own local context. */
const MEASUREMENT_ALL = new RegExp(MEASUREMENT_SRC, "gi");

// ---- v2.9 CP1: a quantity of something INSIDE the product is not its size ----
//
// THE MEASURED PROBLEM. The `dimensions` row claims "Measurements are stated", missing
// detail "no readable measurements — size, capacity, weight or fit". A live store was
// told its measurements were stated on the strength of "…has 11-14 grams of high
// quality protein…". An independent 412-probe set then put the false-pass rate at
// 112/258 on clear negatives (43.4%), worst in dosage/usage instructions (15/15),
// external-substance quantity (20/25), nutrition per serving (24/32) and the capacity
// of a COMPONENT rather than the product (15/25).
//
// AND THE DEFENCE WAS AN ACCIDENT, NOT A GUARD. Of the 146 clear negatives that
// correctly returned not_proven, 117 did so ONLY because no term in the dimensions list
// matched at all — a guard fired on just 29. `mg`, `mcg`, `mAh`, `W`, `V`, `%`, `gsm`,
// `denier`, `grit`, `SPF` and `pH` simply are not in the term list; the moment a
// merchant writes the same fact in grams, ml, oz or `capacity:` it passes.
//
// WHY THIS IS POSITIONAL. `MEASUREMENT` is tested against the WHOLE SENTENCE, so the
// matched term and the matched measurement need not be the same span — the defect that
// let "Case dimensions match every 4-G and Wi-Fi tablet." pass in v2.8. Vetoing on a
// whole-sentence signal would repeat that error in reverse: "Each 12 oz bag contains 8 g
// of protein." states a real size AND a nutrient, and must still pass. So every
// measurement occurrence is judged in its OWN window, and the row passes if any single
// occurrence reads as the product's own extent.
const NUTRIENT =
  /\b(protein|sugars?|sodium|salt|fats?|saturates|fibre|fiber|carb(?:s|ohydrates?)?|calories?|kcal|cholesterol|caffeine|alcohol|abv|cbd|thc|vitamins?|minerals?|omega|probiotics?|collagen|electrolytes?|added sugar)\b/i;
/**
 * Markers that the quantity is per unit of CONSUMPTION, not per product.
 *
 * ⚠️ The noun list is deliberately restricted to units that are ONLY ever a serving.
 * A first draft included `bar`, `slice`, `cup` and `glass`, and cost 8 real positives
 * immediately — "One bar weighs 8 oz." and "Net weight 8 oz per bar." are a chocolate
 * or soap maker stating the product's weight, and a cup or glass is a product in its
 * own right on any drinkware store. `scoop`, `capsule`, `gummy` and `sachet` have no
 * such second reading.
 */
const PER_SERVING =
  /\b(per|each|one|every)\s+(serving|portion|scoop|capsule|tablet|gummy|sachet|serve|dose|load|wash|application|treatment)\b|\bserving size\b|\bdaily (?:value|intake)\b|\bper day\b/i;
/**
 * A stated DOSE is an instruction for use, whatever verb introduces it.
 * ⚠️ NOT `serving`: "Acacia serving board, 18 inches long." and "serving bowl" are
 * products. The per-serving READING is already covered by PER_SERVING, which requires
 * a quantifier in front of it and so cannot match a serving board.
 */
const DOSE_NOUN = /\b(dose|dosage)\b/i;
/**
 * Verbs that make the measurement a USAGE instruction rather than a product extent.
 * Inflections matter: the first draft wrote bare `brew`, which does not match "Brewed
 * with 0.2 grams of espresso extract." — the `\b` fails against the following `e`.
 */
const USAGE_VERB =
  /\b(steep|brew|dissolve|dilute|mix|stir|apply|ingest|swallow|marinate|infuse)(?:s|ed|ing)?\b/i;
/** A quantity PER UNIT AREA/LENGTH is a density (GSM, thread count), not an extent. */
const PER_MEASURE = /\bper\s+(?:square|linear|cubic|running)\s+\w+|\bg\/m2\b|\bgsm\b/i;
/**
 * Containers that are a SHIPMENT or a multi-unit pack, not the item being bought.
 * ⚠️ `case` must be QUANTIFIED. A bare word-bounded `case` vetoed "With its case measuring
 * a classic 39mm" on a real watch store — a watch case, a phone case and a pencil case are
 * all the product itself. Only a COUNTED case is a shipping unit. Same reason `crate` and
 * `batch` are absent: a dog crate is a product, and a production run is not a container.
 * Found by replaying the changed engine against 172 captured real stores, which is the
 * whole point of building that harness before shipping the guard.
 */
const PACK_SUBJECT =
  /\b(?:each|per|a|one|full)\s+(?:full\s+)?cases?\b|\bcases?\s+of\s+\d|\bcase\s+pack\b|\b(?:pallet|pallets|carton|cartons|shipment|shipments)\b/i;
/**
 * Non-volumetric senses of `capacity`, which the label-branch would otherwise read as a
 * size. Only the senses with NO product-extent reading: `weight capacity`, `load capacity`
 * and `seating capacity` are deliberately absent, because for a shelf or a chair those are
 * real product specs and the row's own missing-detail says "size, capacity, weight or fit".
 */
const OTHER_CAPACITY = /\b(battery|memory|data|power)\s+capacity\b/i;

/**
 * Is THIS measurement occurrence a quantity of something other than the product?
 * Judged on a local window, not the whole sentence, for the reason in the block above.
 */
function nonProductQuantity(sentence: string, index: number, matched: string): boolean {
  // The clause the occurrence sits in — bounded so a second, unrelated statement in the
  // same sentence cannot veto a genuine measurement.
  const before = sentence.slice(Math.max(0, index - 90), index);
  const after = sentence.slice(index + matched.length, index + matched.length + 60);
  const clauseBefore = before.split(/[.;:!?]|,\s+(?:and|but|or)\s/).pop() ?? before;
  const local = `${clauseBefore} ${matched} ${after}`;

  if (OTHER_CAPACITY.test(local)) return true;          // "Battery capacity: 5000 mAh."
  if (PER_SERVING.test(local)) return true;             // "…per serving", "…per load"
  if (PER_MEASURE.test(local)) return true;             // "280 grams per square meter"
  if (DOSE_NOUN.test(clauseBefore)) return true;        // "Recommended dose is 8 oz…"
  // A nutrient counts only as this measurement's OWN COMPLEMENT — "11 g of protein",
  // "8 g of added sugar" — so it must sit within a couple of words of the unit.
  //
  // ⚠️ A raw 60-character forward slice was WRONG, and wrong on ordinary copy. It vetoed
  // "Each 12 oz bag contains 8 g of protein." — the sentence this guard's own comment
  // names as a must-pass — because `protein` fell inside the window even though it
  // belongs to the SECOND measurement, not the first. Same for "This 16 oz bottle
  // contains 25 g of sugar." and "Each 750 ml bottle is 12% ABV.", which are exactly the
  // "16oz bottle / 12 oz bag" shapes testEvidence.ts documents as how a beverage or
  // coffee store states its size. Nothing in the suite or the corpus caught it; an
  // independent refuter did, by moving the nutrient one word at a time until it flipped.
  //
  // A nutrient merely somewhere BEFORE the measurement is usually the product itself
  // ("Sea salt body scrub, 8 oz jar."), so the backward look stays tight — enough for
  // the spec-label form "Protein: 12 g" and not enough to swallow a product name.
  const complement = new RegExp(`^\\W*(?:of\\s+)?(?:\\w+\\s+){0,2}${NUTRIENT.source.replace(/^\\b|\\b$/g, "")}`, "i");
  if (complement.test(after) || NUTRIENT.test(clauseBefore.slice(-12))) return true;
  if (USAGE_VERB.test(clauseBefore)) return true;       // "Steep in 8 oz of hot water"
  if (PACK_SUBJECT.test(clauseBefore)) return true;     // "Each case weighs 24 lbs."
  return false;
}

/** True when at least ONE measurement in the sentence reads as the product's own extent. */
function statesProductMeasurement(sentence: string): boolean {
  MEASUREMENT_ALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  let sawAny = false;
  while ((m = MEASUREMENT_ALL.exec(sentence)) !== null) {
    sawAny = true;
    if (!nonProductQuantity(sentence, m.index, m[0])) return true;
  }
  // No measurement at all ⇒ unchanged behaviour (the row fails for the old reason).
  return sawAny ? false : false;
}

// ---- origin: REMOVED (v2.8 CP2) ---------------------------------------------
//
// A `Country of origin is stated` requirement lived here, with a closed gazetteer of
// countries, US states and regions behind it. It has been REMOVED from the shipped
// library. This is a decision, not a deferral — it had been deferred four times.
//
// WHAT WAS MEASURED. Two independently-written adversarial sets, plus a
// natural-frequency read of 5,322 real product descriptions from 20 live stores:
//
//   set              recall            specificity
//   A  shipped       76.1% (105/138)   88.8% (119/134)
//   A  narrowed      63.8%  (88/138)   94.0% (126/134)
//   B  shipped       73.8% (104/141)   95.4% (124/130)
//   B  narrowed      50.4%  (71/141)  100.0% (130/130)
//
// The session's fixed decision rule was: keep the narrowed form iff specificity ≥95%
// AND recall ≥40%. The two independent sets STRADDLE that threshold (94.0% / 100.0%),
// so the rule did not discriminate — and pooling the sets flatters the narrowing
// (97.0%) while failing the shipped form (92.0%), which is a fact about set
// composition rather than about the matcher.
//
// WHAT DECIDED IT was the natural-frequency read, which the rule did not anticipate
// and which is the better estimator of merchant impact. Over 369 naturally-occurring
// origin sentences held out from the hand-built sets, the narrowing was **17 true
// statements lost, 0 false passes gained**. The one false-pass class it closes — a
// gazetteer word in its ordinary sense (`Georgia pine`, `Turkey red`, `Jordan
// almonds`) — has **zero observed instances across all 5,322 real products**. So the
// narrowing must not ship: it makes the product wrong more often, to fix something
// that does not occur.
//
// AND THE SHIPPED FORM CANNOT STAY EITHER, because it is wrong in the OTHER direction
// at scale. These all return "no stated country of origin" against copy that plainly
// states one, in BOTH the shipped and narrowed forms:
//     "Made in the U.S.A."      (the clause splitter cuts on the abbreviation's dots)
//     "Handcrafted in Nepal."   "Grown in Panama."   "Milled in Japan."
//     "Made in Los Angeles."    "Made in Barcelona."  (no cities in the gazetteer)
//     "Origin — Italy"          (only `:` is accepted as the label separator)
// Telling a merchant whose page says "Handcrafted in Nepal." that they publish no
// origin is a false statement about a store we read perfectly well. That is precisely
// the class the `warranty` requirement was dropped for in v2.3.
//
// AND IT CARRIED LITTLE INFORMATION EVEN WHEN RIGHT: in the v2.3 production sample the
// row appeared in 11 of 17 stores and returned not_proven in 10 of those 11 — a 0.91
// fail rate, which the standing CLAUDE.md caveat already flags as a contaminated
// measurement precisely because the matcher is broken in both directions.
//
// Losing one row of depth costs less than one false statement about a real store.
//
// THE MEASURED PATH BACK, if a future session wants this row. The two halves of the
// narrowing are separable and only one did any work: the TERMINATOR rule (place must
// be followed by a clause end or an allow-listed continuation) closed every false
// pass; the FRAME narrowing closed none and cost 32 of the 33 lost positives. Shipped
// frames + the terminator projects to 73.0% recall at 100% specificity — a projection,
// never measured, and it must be measured before it is believed. Three mechanical bugs
// are worth fixing first, all pre-existing and all cheap: protect dotted abbreviations
// before the clause split; the gazetteer has no cities, while AMBIGUOUS_PLACE listed
// `sydney`, `columbia`, `victoria`, `jersey` and `york` — none of which were in
// PLACES, so they were dead entries that could never fire; and accept `-`/`—` as label
// separators. Full record: experiments/v2-8/FITNESS.md.


// ---- care: STATING an instruction vs POINTING AT one (v3.0 CP1) -------------
//
// `care` was the only attribute with NO valueGuard, and the v2.9 measurement over
// 172 stores found the one false positive it produced: a cookware store was told
// "Care or use instructions are stated" on
//     "If you follow our easy care instructions, we'll help out if anything goes
//      wrong within three years from your date of purchase."
// The sentence REFERS to care instructions and states none — a buyer asking how to
// look after the pan learns nothing.
//
// THE CLASS IS REFERENCE-TO-ELSEWHERE, not that one sentence. Every other care term
// IS the instruction ("machine wash", "dishwasher safe", "do not bleach"); exactly
// one term — `care instructions` — names the category without giving a member of it,
// and every recorded defect in this row runs through that term: a pointer ("included
// in the box"), a placeholder ("Care instructions: TBD."), and a condition of a
// warranty. So the guard is scoped to that term rather than applied to all of them.
//
// ⚠️ THE GUARD MUST READ THE WHOLE SENTENCE, NOT `matchedTerm`. `termMatches` sorts
// longest-first (testEvidence.ts:272), and `care instructions` (17) is longer than
// `machine wash` (12), `dishwasher safe` (15) and `hand wash only` (14). So in
// "Care instructions: machine wash cold." the matched term is the META one, and a
// guard that branched on `matchedTerm` would delete a canonical true positive. That
// is the shape of the over-tight guard that cost v2.9's first quantity attempt four
// real positives.
const CARE_TERMS = [
  // "how to use" and "instructions for use" were REMOVED: they matched "Learn
  // how to use our rewards program in 3 steps", which is site chrome, not care.
  "machine wash", "machine-wash", "hand wash", "hand-wash", "dishwasher safe", "dishwasher-safe",
  "care instructions", "wipe clean", "tumble dry", "air dry", "spot clean", "do not bleach",
  "hand wash only", "season before", "dry flat", "do not tumble", "iron on low",
] as const;
/** The term(s) that name the category instead of giving a member of it. */
const CARE_META = new Set<string>(["care instructions"]);
/** Everything else: a term whose mere presence IS an instruction. Derived from the
 *  shipped list rather than retyped, so a term added to `CARE_TERMS` is instructive
 *  by default and cannot silently fall into the narrower meta branch. */
const CARE_INSTRUCTIVE = CARE_TERMS.filter((t) => !CARE_META.has(t));

/** The instructions exist somewhere we are not reading. A pointer to evidence is
 *  not evidence — the same distinction `isPlaceholderIdentifier` draws for a field
 *  the merchant filled with "see description".
 *
 *  ⚠️ SCOPED TO ITS OWN CLAUSE (v3.1 CP0). Tested against the WHOLE sentence, this
 *  frame vetoed nine real care instructions, because the overwhelmingly common way
 *  a merchant writes one is `<pointer frame>: <the instruction>` — "Care instructions
 *  are printed on the tag: rinse in cool water and dry immediately." The frame is
 *  true of the first clause and says nothing about the second, and reading it over
 *  both deleted the instruction the sentence plainly gives. Measured, not argued:
 *  see `experiments/v3-1/AB_CARE.md`. */
const CARE_REFERENCE =
  /\b(see|refer to|consult|read|follow(?:ing)?|enclosed|included|attached|supplied|provided|printed|listed|labell?ed|as per|per the|according to|subject to|failure to|void|voids|refer)\b/i;

/** ⚠️ MEASURED LIMIT, from the v3.0 independent adversarial pass. The inflections
 *  below (`wash…ing`, `dry(ing)`, `clean…ing`) are exactly the DEVERBAL NOUNS English
 *  uses to name a topic instead of giving an instruction, so this list can fire on the
 *  category name it exists to reject: "Washing and care instructions are on the label."
 *  passes. 46 of 70 hand-written pointer phrasings leak this way.
 *
 *  Deliberately NOT narrowed, on the v2.8 `origin` precedent. Dropping the inflections
 *  closes the class and costs real positives ("Care instructions: we recommend hand
 *  washing."), and the leaking shape has ZERO occurrences across 8,046 real product
 *  descriptions plus every body in the 172-store capture. Losing true statements to fix
 *  something that does not occur is the trade v2.8 measured and refused. Pinned as a
 *  corpus gap with the full measurement.
 *
 *  An actual care ACTION, for the sentences where only the meta term matched.
 *  Deliberately a closed list of care verbs plus the two things a care instruction
 *  states when it names no verb (a temperature and a cycle).
 *
 *  `store`/`storing` is DELIBERATELY ABSENT despite "store in a cool dry place"
 *  being a real instruction: `store` is the merchant noun that appears on nearly
 *  every page, so it is a collision waiting to happen. The cost is nil, because
 *  "Care instructions: store in a cool dry place." still passes on `dry`.
 *
 *  `condition` was absent for the same reason — `conditions apply` is ordinary terms
 *  copy — and that cost a real positive: "Care instructions: condition the leather
 *  twice a year." was answered "no care instructions stated". It is admitted in v3.1
 *  only in its TRANSITIVE VERB form (`condition the …`, `conditions your …`), which
 *  `warranty conditions apply` and `terms and conditions` cannot reach. A bare
 *  `condition` would; that is why this is a frame and not a word.
 *
 *  ⚠️ An earlier draft of this comment claimed the BARE sentence "Store in a cool
 *  dry place away from sunlight." passes. It does not, and never did — it contains
 *  no CARE_TERMS entry at all, so it is `not_proven` before the guard is reached.
 *  That claim survived review and was killed by writing its corpus case, which is
 *  the entire reason a comment saying "must still pass" owes one. */
const CARE_DIRECTIVE =
  /\b(wash(es|ed|ing)?|rinse[sd]?|rinsing|clean(s|ed|ing)?|wipe[sd]?|wiping|dry(ing)?|dries|soak(s|ed|ing)?|scrub(s|bed|bing)?|polish(es|ed|ing)?|oil(s|ed|ing)?|season(s|ed|ing)?|launder(s|ed|ing)?|bleach(es|ed|ing)?|iron(s|ed|ing)?|tumble[sd]?|dust(s|ed|ing)?|sanitiz(e|es|ed|ing)|sanitis(e|es|ed|ing)|hand-?wash|dishwasher|air-?dry|line-?dry|dry-?clean)\b|\bcondition(?:s|ed|ing)?\s+(?:the|your|it|them|this)\b|\d+\s*°|\b(cold|warm|lukewarm|hot) water\b|\b(low|medium|high) heat\b|\b(delicate|gentle|permanent press) cycle\b/i;

/**
 * The spans the reference frame is allowed to govern.
 *
 * DELIBERATELY NOT `CLAUSE_BOUNDARY` (testEvidence.ts). That splitter is already
 * documented in CLAUDE.md as serving two incompatible jobs for negation scope, and
 * loading a third onto it would make all three harder to change. This one answers a
 * narrower question — "is there a span here that gives an instruction without a
 * pointer frame in it" — so it splits MORE aggressively, including on a bare comma
 * and a dash. Over-splitting makes this guard more permissive, which is the
 * direction it is documented to fail in, and never the direction that invents a
 * finding.
 */
// ` and ` is a boundary too: "Read the care instructions and wash separately in cold
// water before first wear." puts the pointer and the instruction in one comma-less
// sentence, and an independent pass confirmed the guard deleting it. Adding it cannot
// reopen the noun-phrase class, because that class fails the IMPERATIVE test either
// way ("and a washing symbol guide" does not begin with a verb).
const CARE_CLAUSE_SPLIT = /[.;:!?,]|\s[—–]\s|--|\sand\s/i;

/**
 * A clause that READS as an instruction: imperative, verb first.
 *
 * ⚠️ THE FIRST VERSION OF THIS FIX WAS WRONG, and an independent adversarial pass
 * confirmed nine sentences of the shape it reopened. Clause-scoping the frame and
 * then accepting ANY `CARE_DIRECTIVE` match in an unframed clause hands the guard a
 * NOUN PHRASE:
 *     "Care instructions are printed on the hangtag, and a washing symbol guide is on our site."
 *     "Care instructions are included in the box, along with a cleaning cloth."
 *     "Care instructions are enclosed, and our leather polish is available separately."
 *     "Care instructions are supplied with your order — washing guidance is on the label."
 * The pointer sits in the first clause; the second merely CONTAINS a care word —
 * `washing`, `cleaning`, `polish`, `seasoning`, `dust`. Every one of those passed.
 *
 * The distinction that actually separates the two classes is grammatical, not
 * positional: an instruction is IMPERATIVE and begins with its verb, in BASE FORM.
 * That is what tells "sanitize the board with diluted vinegar weekly" from "washing
 * symbols and fabric details at the link below" — the `-ing`/`-s` forms are precisely
 * the deverbal nouns English uses to NAME a topic rather than give an instruction,
 * which is the same weak point the residual gap in the corpus records.
 *
 * `follow` is deliberately absent: "follow the wash symbols printed on the label" is
 * imperative and is still a pointer.
 */
const CARE_IMPERATIVE_CLAUSE =
  /^\s*(?:then\s+|please\s+|and\s+then\s+)?(?:wash|rinse|clean|wipe|dry|soak|scrub|polish|oil|season|launder|bleach|iron|tumble|dust|sanitize|sanitise|condition|hand-?wash|air-?dry|line-?dry|dry-?clean)\b/i;

/**
 * True when the sentence GIVES a care instruction rather than merely mentioning
 * that care instructions exist.
 *
 * Fails OPEN for every instructive term — those are self-evidently instructions and
 * vetoing them would cost real findings for no measured gain. The narrow branch runs
 * only when the sole care term present is the meta one.
 */
function statesCareInstruction(sentence: string): boolean {
  const n = normalize(sentence);
  // An actual instruction anywhere in the sentence settles it.
  if (termMatches(n, CARE_INSTRUCTIVE, false).length > 0) return true;
  // Only `care instructions` matched. It counts when SOME clause carries a care
  // action and is not itself a pointer — "…printed on the tag: rinse in cool water".
  // A pointer clause ("included in the box", "if you follow…") proves nothing, and a
  // clause with no action at all closes the bare placeholder "Care instructions: TBD."
  // No pointer frame anywhere: unchanged, and it FAILS OPEN. Vetoing ordinary
  // subject-less care copy would gut the row for no measured gain, and the known
  // deverbal-noun residual ("Washing and care instructions are on the label.") lives
  // on this branch, pinned in the corpus rather than closed.
  if (!CARE_REFERENCE.test(sentence)) return CARE_DIRECTIVE.test(sentence);
  // A pointer frame IS present, so the default is that the instructions are held
  // somewhere we are not reading. Only a clause that is itself an instruction —
  // imperative, verb first — overrides it.
  // ⚠️ NO SECOND REFERENCE TEST ON THE CLAUSE. It looked like cheap extra safety and an
  // independent pass measured it deleting ordinary instructions, because the objects a
  // care verb takes are exactly the frame's vocabulary:
  //     "Care instructions: polish with the INCLUDED beeswax balm."
  //     "Care instructions: season the pan with the PROVIDED oil before first use."
  // A verb-initial clause IS an instruction; what it acts on does not change that.
  // `follow` is kept out of CARE_IMPERATIVE_CLAUSE precisely so that the one imperative
  // that IS a pointer — "follow the wash symbols printed on the label" — still fails.
  return sentence.split(CARE_CLAUSE_SPLIT).some((clause) => CARE_IMPERATIVE_CLAUSE.test(clause));
}

const ATTRIBUTE_SPECS: Record<string, AttributeSpec> = {
  materials: {
    label: "Materials are stated",
    missingDetail: "no statement of what this product is made of that an AI buyer could read",
    // COMPOSITION FRAMES, not bare material nouns. "aluminum" alone would match
    // "aluminum-free" — a deodorant claiming to be free of a metal would have read
    // as having stated its materials. A frame cannot do that.
    terms: [
      "made of", "made from", "made with", "crafted from", "crafted of", "constructed from",
      "constructed of", "material:", "materials:", "fabric:", "composition:", "made in part from",
      "% cotton", "% wool", "% polyester", "% linen", "% silk", "% nylon", "% leather", "% recycled",
    ],
    // The frame alone is not a composition statement. "Made with love in small
    // batches" and "made with care by hand" are among the most common sentences in
    // exactly the artisan/DTC categories this tool targets, and both passed before
    // this guard existed.
    valueGuard: (s) => MATERIAL_NOUN.test(s),
  },
  dimensions: {
    // Label scope, corrected after the CP4 audit. It used to read "Size, capacity or
    // weight is stated" and passed a bar-end plug on "Compatible with handlebars
    // measuring 18 mm to 21.5 mm inner diameter." — a FITMENT dimension, not the
    // product's own size. The store does publish a machine-readable measurement, so
    // the evidence-availability claim was true; the LABEL claimed more than its quote
    // supported. Same class as v2.2's "Ships within a week" passing on processing time.
    label: "Measurements are stated",
    missingDetail: "no readable measurements — size, capacity, weight or fit",
    terms: [
      "dimensions", "capacity", "diameter", "inches", "inch", "cm", "mm", "millimeters", "centimeters",
      "liters", "litres", "ml", "oz", "fl oz", "fluid ounces", "ounces", "lbs", "pounds", "grams", "kg",
      "kilograms", "height", "width", "length", "weighs", "weight", "lb", "gram", "ounce",
    ],
    requireDigit: true,
    wholeWord: true,
    // `requireDigit` only asks that SOME digit exists in the sentence, so "Available
    // in 3 colors with a relaxed length" and the title "Wizard of Oz 2024 Collector
    // Poster" both satisfied it. A dimension is a number BOUND to a unit.
    valueGuard: (s) => statesProductMeasurement(s),
    allowContainerSubject: true,
    shipmentVeto: true,
  },
  // NOTE — an `origin` requirement was built, shipped, deferred four times and then
  // REMOVED in v2.8 CP2. See the tombstone above MEASUREMENT for the measurements and
  // the reasoning. Short version: wrong in both directions on real merchant copy, and
  // a 0.91 fail rate means it carried little information even when right.
  // NOTE — a `warranty` requirement was built, measured (0.71 fail rate, in band)
  // and then DROPPED before shipping. Its term list ("guarantee", "guaranteed",
  // "satisfaction guarantee") collides head-on with the claim linter's `guarantee`
  // rule, and the linter lints `evidenceQuote` too. So a store whose copy says
  // "30-day money-back guarantee" would have had its ENTIRE report blocked and
  // returned as `unreachable` — a flatly false statement about a store we read
  // perfectly well. A requirement that can destroy the whole result to add one row
  // is not worth its discrimination. See experiments/v2-3/RESULT_QUALITY_2.md.
  care: {
    label: "Care or use instructions are stated",
    missingDetail: "no care or use instructions an AI buyer could read",
    terms: CARE_TERMS,
    // A term occurring is not the attribute being stated — the same rule
    // `materials` and `dimensions` already carry. See the block above CARE_TERMS
    // for the measured false positive this closes and why it is scoped to the one
    // term that names the category rather than giving a member of it.
    valueGuard: (s) => statesCareInstruction(s),
    // Categories where a buyer genuinely constrains on care. A pencil does not.
    // WORD-BOUNDED: without \b, "pan" matched "Company" and "Japanese", "pot" matched
    // "Potato", and "rug" matched "Arugula" and "Rugged" — so every brand named
    // "… Company" got a care row. That is precisely the irrelevant-uniform-row
    // failure this whole checkpoint exists to remove.
    onlyFor: /\b(apparel|clothing|shirts?|dress(es)?|pants?|socks?|sweaters?|jackets?|textiles?|bedding|sheets?|towels?|linens?|rugs?|cookware|pans?|pots?|skillets?|knives|knife|cutting boards?|bags?|backpacks?|shoes?|boots?|footwear|wool|leather|cast iron)\b/i,
  },
};

/** Subjects that make the sentence about the SHIPMENT rather than the product, when
 *  they appear BEFORE the frame. `MODIFIED_SUBJECT` in testEvidence only looks after
 *  the term, which composition/origin frames structurally defeat. */
// v2.5: still load-bearing AFTER the subject rule, and complementary to it — it
// reaches the shapes with no finite verb, where `nonProductSubject` has nothing to
// delimit a subject with ("Our packaging: made from recycled cardboard.", "Mailer,
// made from 100% recycled fibre."). The alternation is extended with packaging
// compounds that are unambiguous. Bare `box` is deliberately still ABSENT: a
// jewellery box or a keepsake box IS the product, and vetoing "The box is made of
// walnut" would be a false fail on exactly the merchants who sell boxes.
const SUBJECT_BEFORE_VETO = /\b(packaging|package|carton|wrapper|wrapping|mailer|pallet|shipping box(es)?|shipper|the box it ships in|outer box|our boxes|gift ?box(es)?|hang ?tag|poly ?bag|tissue ?paper|insert ?card|packing ?slip|shipping ?label)\b[^.]{0,48}$/i;

/** Find a sentence that genuinely STATES this attribute about this product. Layers
 *  the shared evidence discipline (negation, aboutness, chrome veto, presentable
 *  quote) with two attribute-specific gates the shared layer cannot express. */
function findAttributeSupport(evidence: EvidenceSentence[], spec: AttributeSpec): SupportedEvidence | null {
  for (const ev of evidence) {
    // Evaluate this sentence in isolation so a veto on one sentence never hides a
    // genuine statement in the next.
    // A whole-sentence shipment veto. The subject can sit on EITHER side of the
    // term — "Rated for a 300 lbs weight capacity on the shipping pallet" puts it
    // after — so for size statements the safest rule is that a sentence about the
    // shipment is never a statement about the product's size.
    if (spec.shipmentVeto && SHIPMENT_CONTEXT.test(ev.text)) continue;
    const hit = findSupport([ev], spec.terms, {
      requireDigit: spec.requireDigit, wholeWord: spec.wholeWord,
      allowContainerSubject: spec.allowContainerSubject,
    });
    if (!hit) continue;
    const idx = ev.text.toLowerCase().indexOf(hit.term.toLowerCase());
    const before = idx > 0 ? ev.text.slice(0, idx) : "";
    if (SUBJECT_BEFORE_VETO.test(before)) continue;
    if (spec.valueGuard && !spec.valueGuard(ev.text, hit.term)) continue;
    return hit;
  }
  return null;
}

// ---- identifier plausibility (v2.4 CP1) -------------------------------------
// The identifiers row promises that "a machine buyer can match this product to a
// catalogue entry". A value that cannot do that must not satisfy it.
//
// The previous guard was a fully-anchored token list (`^(n\/?a|tbd|…)$`), so ANY
// affix defeated it. Executed against 34 placeholder values, 24 passed as real
// published identifiers — "N/A.", "N/A - see description", "TBD-001", "test123",
// "n / a", "NA/NA", "PLACEHOLDER", "YOUR-MPN-HERE", "0-0", "???" among them. This
// is not hypothetical shape: a merchant filling a required field with nothing is
// exactly how these values arise.
const PLACEHOLDER_TOKEN = "na|tbd|none|null|nil|unknown|unspecified|notapplicable|placeholder|sample|default|test|undefined|false|example|dummy|temp|blank|nomlpn|nompn|nogtin|nosku|yourmpnhere|yourgtinhere";
/** Token(s), then optional trailing digits, then an optional "see …"/"on request" note. */
const PLACEHOLDER_CORE = new RegExp(`^(?:${PLACEHOLDER_TOKEN})+\\d*(?:see\\w*|onrequest|tbc|comingsoon)?$`, "i");

/**
 * True when a raw GTIN string is a real, publishable GTIN.
 *
 * Extracted in v3.0 CP3 so the AUTHENTICATED path can pick a variant barcode using
 * the identical rule the `identifiers` row judges it by. ENGINE_GAPS G-07 is explicit
 * that these guards must apply to catalog values exactly as they do to JSON-LD ones —
 * "an Admin API value is no more trustworthy than a JSON-LD one. Reuse, do not
 * reimplement." A second copy of this arithmetic is how the two paths drift.
 *
 * ⚠️ IT LIVES HERE, IN THE JUDGING PATH, AND THAT IS THE POINT AGAIN. v3.5 CP2a moved
 * it into `src/crawler/extract.ts` because the extractor had started SELECTING a GTIN
 * by this rule; CP2c reverted that selection, so the extractor reports what the product
 * node publishes and this module decides whether it is publishable. One rule, one
 * caller, in the layer that renders the verdict.
 *
 * Merchants publish GTINs with the separators printed on the barcode ("0-36000-29145-2",
 * "400 638 133 3931"). Those are the same number, and rejecting them told stores that DO
 * publish an identifier that they don't. Normalised HERE rather than in `isValidGtin`,
 * which is shared with the feed validator — there the spec genuinely requires a
 * digits-only value, so loosening it would weaken a different, correct check.
 *
 * All-zeros passes the check-digit arithmetic (0 mod 10 === 0) and is the commonest
 * "I had to put something in the field" value there is.
 */
export function isPublishableGtin(raw: string): boolean {
  const digits = raw.trim().replace(/[\s-]/g, "");
  return isValidGtin(digits) && !/^0+$/.test(digits);
}

/**
 * v3.5 CP2a — THE IDENTIFIERS ROW NOW NAMES THE VALUE IT PASSED ON.
 *
 * It used to render "Your structured data publishes MPN." and no quote at all. v3.2
 * CP3 measured what that costs: one mechanical check of one class found 18 false
 * passes inside a general sample whose 507 rendered rows had already been read
 * individually and pronounced clean. A row that renders no value is invisible to
 * every audit that reads rendered evidence, however many rows it reads.
 *
 * ⚠️ AN IDENTIFIER IS MERCHANT-CONTROLLED TEXT REACHING A LINTED OUTPUT — a pinned
 * hostile class. `lintStrings` runs over `detail` as a BLOCKING gate in
 * `runProductTest`, so an `mpn` of "GUARANTEE-001" would return the whole report as
 * `unreachable` for a store we read perfectly well. That is the exact failure the
 * `warranty` requirement was dropped for in v2.3. Fail closed per ROW: a value we
 * cannot reproduce is replaced by a sentence saying we cannot reproduce it, which
 * still names the reason. Measured 0 of 338 captured real stores hit this.
 *
 * Which families a single-token identifier can actually reach was MEASURED, not
 * assumed: 15 of the linter's 17 rules require whitespace, so only `guarantee` and
 * `price-is-always-public` are reachable. "RANK-HIGHER-2" was the obvious second
 * example and it lints CLEAN — the ranking rule needs a space. Both directions are
 * pinned in the corpus.
 */
function renderIdentifierDetail(withValue: string, withoutValue: string): string {
  return lintStrings([withValue]).ok ? withValue : withoutValue;
}

/** True when this identifier value cannot identify anything. */
export function isPlaceholderIdentifier(raw: string): boolean {
  // Separators and punctuation carry no identifying information, and stripping
  // them is what collapses "N/A.", "n / a", "N.A." and "n-a" onto one token.
  const core = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!core) return true;
  // A real MPN is never this short; a catalogue key of "abc" or "123" matches
  // nothing. (The old rule allowed anything >= 3 characters.)
  if (core.length < 4) return true;
  // A single repeated character: "0000", "xxxx", "----".
  if (/^(.)\1*$/.test(core)) return true;
  return PLACEHOLDER_CORE.test(core);
}

/** Only "required" phrasings — a store merely OFFERING a subscription is not a blocker. */
const SUBSCRIPTION_REQUIRED = ["subscription required", "subscription is required", "subscription only", "subscribe to purchase", "only available by subscription", "must subscribe"];

const norm = normalize;

// ---- public product snapshot -------------------------------------------------
interface PublicVariant { title: string; priceUsd: number | null; available: boolean; options: string[] }
export interface PublicProduct {
  origin: string; handle: string; title: string | null; vendor: string | null; productType: string | null;
  tags: string[]; descriptionText: string; variants: PublicVariant[]; minPriceUsd: number | null;
  optionNames: string[]; optionValues: string[]; extracted: ExtractedPage | null;
  /** v3.5 CP2b — the storefront's OWN record key for this product, read from the
   *  page's Shopify analytics bootstrap (`shopifyStorefrontObjectId`). `null` means
   *  UNDECIDABLE (bootstrap absent/unparseable, or this path never had page HTML),
   *  and every reader must treat null as "nothing is disqualified". */
  storefrontObjectId: string | null;
  /**
   * v3.8 — the currency the STORE ITSELF declares, ISO-4217, or `null` when the
   * page declares none.
   *
   * ⚠️ `minPriceUsd` IS MISNAMED AND ALWAYS HAS BEEN. It is `Math.min(...variant
   * prices)`, and a Shopify storefront serves those in the store's own currency —
   * so on a GBP store it is a GBP number that every surface renders with a `$`.
   * Measured across 349 deduped real-store snapshots: **38 stores declare a
   * non-USD currency** (GBP, CAD, AUD, EUR) and `missoma.com`'s £135.00 necklace
   * was published to its own merchant as `Lowest readable price is $135.00.`
   *
   * The field is named `declaredCurrency`, not `currency`, because it is a
   * statement about what the PAGE SAYS rather than about what the price IS. Null
   * means "the store declared nothing", which is not the same as USD — 1 store in
   * 349 is in that position, and the price row deliberately still answers for it
   * (see the `price_under` branch) because the brief's scope is a positive non-USD
   * declaration, not an absence.
   */
  declaredCurrency: string | null;
  /** Sentence-level, chrome-free product evidence — the ONLY text we may match or
   *  quote. Raw page text is deliberately excluded (see testEvidence.ts). */
  evidence: EvidenceSentence[];
  /** Availability from JSON-LD `Offer.availability` ("InStock"/"OutOfStock"/…),
   *  the first source in the precedence order (before variants, before `.js`). */
  ldAvailability: string | null;
  /** How the shipping policy fetch went — drives an honest delivery verdict. */
  policyStatus: "not_fetched" | "readable" | "unreachable" | "robots_disallowed" | "rate_limited";
  fetched: { json: boolean; page: boolean; js: boolean; policy: boolean };
  /** Which fetch tier answered / was refused (V2 §2.1, §2.3). */
  diagnostics: FetchDiagnostics;
}

// ---- fetch-tier diagnostics (V2 §2.1) ---------------------------------------
// The throttle we defend against is per-egress-IP AND endpoint-specific: in the
// v1.1 smoke run `/products/*` returned 429 `local_rate_limited` on stores we had
// never touched, while `/robots.txt` and `/policies/*` on those same hosts served
// 200. Recording WHICH tier answered is therefore the only way to tell an upstream
// block apart from a store that genuinely publishes nothing.
export type FetchTier = "page" | "json" | "js" | "policy";

export interface FetchDiagnostics {
  /** Tiers we actually issued a request for, in order. */
  attempted: FetchTier[];
  /** The tier that supplied the primary product node. */
  answeredBy: "page" | "json" | null;
  /** Tiers refused upstream (429/403) or held back by our own egress budget. */
  throttled: FetchTier[];
  /** A tier was refused but other tiers answered — the test runs, partially (§2.3). */
  degraded: boolean;
  /**
   * How the shared `robots.txt` fetch went on THIS host. It is the one request we
   * always make, so it is the only host-reachability signal that survives when
   * every product tier is refused — which is precisely when the split matters:
   *
   *   • `rate_limited` + robots `ok`      → the throttle is scoped to the
   *     `/products/*` path class. That is Shopify's per-egress-IP limiter, and
   *     egress diversity would move it.
   *   • `rate_limited` + robots `refused` → the host refuses us everywhere, i.e.
   *     its own bot management. More IPs would not reliably help.
   *
   * Without this the two are indistinguishable from the response, and they have
   * different remedies (EGRESS_DECISION.md, open recommendation #1).
   */
  robots: "ok" | "refused" | "unreachable" | "cached" | "not_fetched";
  /**
   * WHO refused, when the result is `rate_limited`. `errorKind` alone cannot say,
   * because our own budgets and an upstream 429 both surface as the same error —
   * and a throttle rate that silently counts our own limiter measures nothing.
   */
  throttleSource: "upstream" | "our_budget" | "our_cooldown" | null;
}

export type FetchErrorKind = "bad_url" | "not_shopify" | "not_found" | "rate_limited" | "robots_disallowed" | "unreachable";
export interface FetchError { kind: FetchErrorKind; message: string }

export const FETCH_ERROR_MESSAGE: Record<FetchErrorKind, string> = {
  bad_url: "Paste a Shopify product URL — it should contain /products/…",
  not_shopify: "This looks like it isn't a Shopify store — the test needs Shopify's public product data.",
  not_found: "We couldn't find a product at that URL.",
  rate_limited: "This store is limiting automated requests right now. We'll retry — try again in a few minutes.",
  robots_disallowed: "This store asks automated tools not to read this page, and we respect that.",
  unreachable: "We couldn't reach that store's public product data.",
};

function parseProductUrl(raw: string): { origin: string; handle: string } | null {
  const check = validateUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!check.ok || !check.url) return null;
  const u = check.url;
  const m = u.pathname.match(/\/products\/([^/?#]+)/i);
  if (!m) return null;
  return { origin: `${u.protocol}//${u.host}`, handle: decodeURIComponent(m[1]!.replace(/\.(js|json)$/i, "")) };
}

/** Normalized cache/throttle key for a product URL (origin + handle, no query). */
export function normalizeProductUrl(raw: string): string | null {
  const p = parseProductUrl(raw);
  return p ? `${p.origin.toLowerCase()}/products/${p.handle.toLowerCase()}` : null;
}

// Shape of Shopify's public /products/{handle}.json → { product: {...} }. Prices are
// STRING dollars ("8.50"); options carry values; variants use option1/2/3; `available`
// is often absent from the .json endpoint (defaulted true — a listed, sellable variant).
interface ShopifyProductJson {
  title?: string; vendor?: string; product_type?: string; tags?: string[] | string; body_html?: string;
  options?: Array<{ name?: string; values?: string[] }>;
  variants?: Array<{ title?: string; price?: string | number; available?: boolean; option1?: string; option2?: string; option3?: string; options?: string[] }>;
}
/** Which tier a price value came from. The two tiers serve DIFFERENT UNITS, and
 *  the unit is NOT inferable from the value — which is the whole defect below. */
type PriceTier = "json" | "js";

/**
 * Read a variant price, in the units the tier that served it actually uses.
 *
 * ⚠️ WHAT THIS REPLACES, AND WHY THE OLD SHAPE COULD NOT WORK. It was
 * `p > 1000 && Number.isInteger(p) ? p / 100 : p` — a single guess applied to
 * both tiers, keyed on the MAGNITUDE of the value. A magnitude cannot decide a
 * unit: `1000` is $10.00 from `.js` and $1000.00 from a tier serving dollars,
 * and the guard has no way to tell. Measured cost on 349 deduped real-store
 * snapshots (experiments/v3-8/census.ts + blast.mjs), per STORE:
 *
 *   4 stores rendered at exactly 100x — levainbakery.com's $10.00 mug published
 *     as $1000.00 (its `.js` price is `1000`, and `1000 > 1000` is FALSE, so the
 *     strict comparison let the boundary through untouched);
 *   2 stores where the error was LAUNDERED INTO A PLAUSIBLE NUMBER, which is the
 *     worse half. `minPriceUsd` is a `Math.min` over PER-VALUE conversions, so a
 *     store whose variants straddle the boundary gets its minimum taken across
 *     two different units: firelightcoffee.com renders $10.60 for a product whose
 *     cheapest variant is $9.35, because 1060 converted and 935 did not. Nobody
 *     looks twice at $10.60 — not an auditor, not a merchant, not a status diff.
 *
 * THE TIER IS THE ANSWER, and it was measured before it was written. Over the
 * same 349 snapshots, with zero exceptions:
 *   `/products/{handle}.json` — 134 tiers answered; 931 price strings, every one
 *     matching `^\d+\.\d+$`; 0 numeric, 0 integer-valued strings, 0 carrying a
 *     symbol or separator. Decimal DOLLARS.
 *   `/products/{handle}.js`   — 119 tiers answered; every value a NUMBER, none a
 *     string. Integer CENTS.
 * The confirmation is available inside a single store: firelightcoffee.com
 * publishes the same 28 variants in both tiers, `.json` as `9.35` and `.js` as
 * `935`.
 *
 * ⚠️ AND IT FAILS CLOSED ON THE `.js` TIER. A `.js` value that is not a finite
 * non-negative integer is a value whose unit we have not established, and
 * dividing an unestablished unit by 100 is the CATASTROPHIC direction — a $50
 * product published as $0.50. Measured today: `understated_100x` occurs on 0 of
 * 349 stores, and that is the invariant this function exists to keep. A wrong
 * price may never become a differently-wrong price; the only acceptable failure
 * direction is refusing to state one.
 *
 * ⚠️ WHAT REFUSING ACTUALLY PRODUCES, and it is TWO different things depending on
 * the path — an earlier draft of this comment named only the second and was wrong
 * about the common case. Returning `null` empties `prices`, so `minPriceUsd`
 * falls back to the JSON-LD offer and is null only if that is absent too. Then:
 *   • on the PUBLIC path, `adjudicability` scores `price_under` 0 when
 *     `minPriceUsd == null`, and a 0-scored candidate is DROPPED — so no price
 *     row is generated and the merchant sees no such row at all;
 *   • on a PINNED or reconstructed contract the row already exists, and
 *     `evaluate`'s `price_under` branch returns `requires_store_access`.
 * Both are honest. Neither states a number.
 */
const priceToUsd = (p: string | number | undefined, tier: PriceTier): number | null => {
  if (tier === "js") {
    if (typeof p !== "number" || !Number.isFinite(p) || !Number.isInteger(p) || p < 0) return null;
    return p / 100;
  }
  // The `.json` tier serves string dollars. A number here is a shape no captured
  // store produces; it is read as dollars rather than refused because that is what
  // the endpoint's contract says, and because refusing would be a behaviour change
  // measured on zero stores in either direction.
  if (typeof p === "number") return Number.isFinite(p) ? p : null;
  if (typeof p === "string") { const n = Number(p.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
};

/** Pull the JSON-LD Product node's own `description` (main's extractPage keeps only
 *  identifiers/offer, not the prose) — a legitimate structured_data text surface. */
export function jsonLdProductDescription(html: string): string | null {
  for (const node of extractJsonLd(html)) {
    const t = node["@type"];
    const types = (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
    if (!types.includes("product") && !types.includes("productgroup")) continue;
    const d = node.description;
    if (typeof d === "string" && d.trim()) return htmlToText(d);
  }
  return null;
}

/** The JSON-LD Product `category`, used as the category signal when the page tier
 *  answers alone. V2 §2.1 made the page primary, and `product_type` lives only on
 *  the `.json` endpoint — without this, claim inference would silently fall back to
 *  title-matching on every page-only test and mis-categorize honest stores. */
export function jsonLdProductCategory(html: string): string | null {
  const nodes = extractJsonLd(html);
  for (const node of nodes) {
    const t = node["@type"];
    const types = (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
    if (!types.includes("product") && !types.includes("productgroup")) continue;
    const c = node.category;
    // Shopify and GS1 both emit breadcrumb-ish categories ("Home > Bath > Soap");
    // the most specific segment is the last one.
    if (typeof c === "string" && c.trim()) return c.split(">").pop()!.trim();
    if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string") {
      return String((c as { name: string }).name).trim();
    }
  }
  // Fallback: a BreadcrumbList. Its last crumb is the product itself, so the
  // SECOND-TO-LAST is the collection the store files it under ("Home > Bar Soap >
  // Pine Tar"). Structured navigation, not prose — description text is deliberately
  // NOT consulted, for the same reason tags aren't: a coffee-SCENTED soap must
  // never read as a coffee product.
  for (const node of nodes) {
    const t = node["@type"];
    const types = (Array.isArray(t) ? t : [t]).map((x) => String(x).toLowerCase());
    if (!types.includes("breadcrumblist")) continue;
    const items = node.itemListElement;
    if (!Array.isArray(items) || items.length < 2) continue;
    const names = items
      .map((it) => {
        const el = it as { name?: unknown; item?: { name?: unknown } };
        return typeof el?.name === "string" ? el.name : typeof el?.item?.name === "string" ? el.item.name : null;
      })
      .filter((n): n is string => Boolean(n && n.trim()));
    if (names.length >= 2) return names[names.length - 2]!.trim();
  }
  return null;
}

// ---- v3.2 CP2: the merchant's OWN product_type, from the page --------------
//
// THE DEFECT. `fetchPublicProduct` skips the `.json` tier whenever the page's
// JSON-LD is complete (`pageSufficient`), so `js` is null and `productType` falls
// back to JSON-LD `Product.category` — which most themes omit, and which on one real
// store was the breadcrumb root "Home". Measured on the coffee capture: 15 of 44
// products were unclassifiable from what the engine exposes, so G-10's predicate had
// only the title to work with and the standard declined to run on a third of stores.
// The same null flows into `CATEGORY_CLAIMS` and `AttributeSpec.onlyFor`, so category
// inference in PRODUCTION silently degraded to the title alone at the same rate.
//
// ⚠️ THE OBVIOUS FIX IS THE WRONG ONE. Fetching `/products/{handle}.json` anyway
// would spend the extra request the tier ORDER exists to avoid — the v1.1 smoke run
// measured `.json` returning 429 while HTML on the same hosts returned 200 — and it
// would break every existing snapshot, because replay serves only URLs that were
// actually recorded and on precisely these stores the engine never fetched it. A fix
// that invalidates the corpus it has to be measured on is not a fix.
//
// The value is already in bytes we hold. Shopify's own analytics bootstrap emits the
// merchant's `product_type` verbatim, and it is present on 43 of the 44 captured
// coffee pages — measured before this was written, not assumed:
//     var meta = {"product":{"id":…,"vendor":"…","type":"Coffee","handle":"…",…}};
//
// ⚠️ PARSED, NOT REGEXED OUT. `"type"` appears inside `variants[]` and elsewhere in
// the same blob, so a bare `/"type"\s*:\s*"([^"]*)"/` reads whatever comes first and
// would silently return a variant's field on a theme that reorders keys. The object
// is valid JSON, so it is brace-balanced (string-aware, so a `}` inside a value
// cannot end it early) and `JSON.parse`d, which also handles the `\/` and `&`
// escapes Shopify emits. Bounded so a pathological page cannot make this expensive.
const META_SCAN_LIMIT = 400_000;

/**
 * The bootstrap object itself. ONE walk, and every reader goes through it.
 *
 * v3.5 CP2b needed a second field out of this payload (`product.id`, for rule D).
 * Writing a second walk is how the two drift — the identical mistake this repo
 * documents for the CLI/dashboard score and for `isPublishableGtin`. `shopifyMetaProductType`
 * is now a thin reader over this and its behaviour is unchanged, which its existing
 * tests assert.
 */
export function shopifyMetaObject(html: string): Record<string, unknown> | null {
  const at = html.search(/\bvar\s+meta\s*=\s*\{/);
  if (at === -1) return null;
  const open = html.indexOf("{", at);
  let depth = 0, inStr = false, esc = false, end = -1;
  const limit = Math.min(html.length, open + META_SCAN_LIMIT);
  for (let i = open; i < limit; i++) {
    const c = html[i]!;
    if (esc) { esc = false; continue; }
    if (inStr) { if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) return null;                    // truncated or unbalanced: no guess
  try {
    const parsed = JSON.parse(html.slice(open, end)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch { return null; }
}

const metaProduct = (html: string): Record<string, unknown> | null => {
  const p = shopifyMetaObject(html)?.product;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
};

export function shopifyMetaProductType(html: string): string | null {
  const t = metaProduct(html)?.type;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/**
 * v3.8 — THE STOREFRONT'S ACTIVE CURRENCY, from the page's own bootstrap.
 *
 * Shopify emits `Shopify.currency = {"active":"GBP","rate":"1.0"};`. This is the
 * SECOND source in the currency precedence, behind the JSON-LD `priceCurrency`
 * that `extractPage` already parses — and it exists because the JSON-LD one is
 * not always there. Measured across 349 deduped real-store snapshots
 * (experiments/v3-8/census.ts): of 38 stores declaring a non-USD currency, 34 are
 * reachable by JSON-LD alone and **4 are known only to this bootstrap**
 * (hismileteeth.com, anarchycoffeeroasters.com, banffroastingcompany.com,
 * littlesistercoffeemaker.ca). Availability across the whole corpus is 340/349
 * here versus 298/349 for the JSON-LD field.
 *
 * ⚠️ TWO OTHER SIGNALS WERE MEASURED AND DELIBERATELY REJECTED.
 *   `Shopify.country` — 8 stores publish `country=US` while serving GBP or CAD.
 *     It reflects the VISITOR's geo at fetch time, not the store's currency, so
 *     reading it would refuse eight correct stores and misclassify others.
 *   `og:price:currency` — disagrees with both other signals on 3 stores
 *     (origincoffee.co.uk says USD/USD/GBP; rocanini.com says -/USD/CAD). A
 *     third opinion that contradicts the other two is not a tiebreaker.
 * Zero stores in the corpus have JSON-LD saying USD while this field says
 * otherwise, so the precedence is never exercised against a contradiction — a
 * fact recorded here because a future store WILL contradict it, and the reader
 * should know the ordering was never tested against that case.
 */
export function shopifyActiveCurrency(html: string): string | null {
  // Parsed from the assignment, not grepped for any three-letter token: "active"
  // also appears inside unrelated theme JSON, and a bare regex would return the
  // first one it met.
  const at = html.search(/\bShopify\.currency\s*=\s*\{/);
  if (at === -1) return null;
  const open = html.indexOf("{", at);
  const close = html.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  try {
    const o = JSON.parse(html.slice(open, close + 1)) as { active?: unknown };
    return typeof o.active === "string" && /^[A-Za-z]{3}$/.test(o.active) ? o.active.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * v3.5 CP2b — THE STOREFRONT'S OWN KEY FOR THIS PRODUCT, from the same bootstrap.
 *
 * Shopify emits `var meta = {"product":{"id":8079462006899,…}}`, and that integer is
 * the record id the storefront uses internally — the same value the page also emits as
 * `product.id`, `source_product_id`, `rid` and `data-product-id`. Themes republish it
 * in the JSON-LD `mpn` field. Measured across 338 captured real stores, 23 products
 * publish exactly that: an identifier that resolves to nothing outside the one store
 * that minted it, in the field whose row promises an external catalogue match.
 *
 * ⚠️ PARSED, NOT REGEXED. `"id"` occurs inside `variants[]` on every one of these
 * pages, so a bare regex returns a variant's key on any theme that orders keys
 * differently — and nothing downstream could tell.
 *
 * ⚠️ RETURNS null LIBERALLY, AND THAT IS THE POINT. Bootstrap absent, truncated,
 * unparseable, `product` missing, `id` of the wrong type — every one of those is
 * "we could not decide", and the caller must treat it as NOT DISQUALIFIED. A guard
 * that fires on unknown suppresses real merchants, which is the direction this
 * project treats as unrecoverable. Measured: the bootstrap parsed on 327 of 338
 * captured pages, so 11 pages are undecidable and stay undisqualified.
 */
export function shopifyStorefrontObjectId(html: string): string | null {
  const id = metaProduct(html)?.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

export interface FetchDeps {
  /** `extraContentTypes` is an opt-in, per-call widening (the `.js` endpoint only). */
  fetchUrl?: (url: string, extraContentTypes?: RegExp[]) => Promise<{ status: number; contentType: string | null; body: string; finalUrl?: string }>;
  loadRobots?: (origin: string) => Promise<RobotsPolicy>;
  /** Injectable clock — cache/throttle windows are testable without real time. */
  now?: () => number;
  /** Injectable sleep. Tests advance their own clock here instead of burning real
   *  seconds, so throttle spacing is exercised precisely rather than approximately. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const defaultFetchUrl: NonNullable<FetchDeps["fetchUrl"]> = async (url, extraContentTypes) => {
  const r = await safeFetch(url, extraContentTypes ? { ...LIMITS, extraContentTypes } : LIMITS);
  return { status: r.status, contentType: r.contentType, body: r.body, finalUrl: r.finalUrl };
};

/** Fetch a product's PUBLIC data: /products/{handle}.json (structured) + the HTML
 *  page (JSON-LD prose / FAQ). Robots-checked; SSRF-safe; byte-capped. Returns a
 *  TYPED error so the UI can be specific instead of generic. */
export interface FetchContext { fetchUrl: NonNullable<FetchDeps["fetchUrl"]>; robots: RobotsPolicy }

export async function fetchPublicProduct(
  raw: string,
  deps: FetchDeps = {},
): Promise<{ product?: PublicProduct; error?: FetchError; ctx?: FetchContext; diagnostics?: FetchDiagnostics }> {
  const parsed = parseProductUrl(raw);
  if (!parsed) return { error: { kind: "bad_url", message: FETCH_ERROR_MESSAGE.bad_url } };
  const { origin, handle } = parsed;
  const host = new URL(origin).host.toLowerCase();
  const rawFetch = deps.fetchUrl ?? defaultFetchUrl;
  const diagnostics: FetchDiagnostics = {
    attempted: [], answeredBy: null, throttled: [], degraded: false,
    robots: "not_fetched", throttleSource: null,
  };

  // NEGATIVE CACHE (§2.4): a host that just refused us is not re-probed for 10
  // minutes. Repeat visitors would otherwise each burn global budget rediscovering
  // the same block — and each wait through it — for nothing.
  const cooldownMs = hostThrottleCooldownMs(host, deps);
  if (cooldownMs > 0) {
    // OUR cooldown, echoing an earlier upstream refusal — not a fresh measurement.
    // Counting it as an upstream throttle would inflate the rate by re-reporting one
    // block once per visitor for ten minutes.
    diagnostics.throttleSource = "our_cooldown";
    return { error: { kind: "rate_limited", message: FETCH_ERROR_MESSAGE.rate_limited }, diagnostics };
  }

  // Every outbound request passes TWO independent budgets:
  //   • the per-host courtesy limit (≥2s spacing, hourly cap) — don't hammer a store;
  //   • the process-wide Shopify egress budget — don't get our ONE production IP
  //     blocked across every store at once. Per-host limiting structurally cannot
  //     prevent that, because the upstream limiter counts our IP, not the host.
  // Waiting happens OUTSIDE the concurrency gate so a parked request doesn't hold
  // a slot that a ready request could use.
  let hostBudgetSpent = false;
  let globalBudgetSpent = false;
  const fetchUrl: NonNullable<FetchDeps["fetchUrl"]> = async (url, extraContentTypes) => {
    const slot = reserveHostSlot(host, deps);
    if (!slot.ok) {
      hostBudgetSpent = true;
      throw new Error("host hourly budget exhausted");
    }
    const egress = reserveEgressSlot(deps);
    if (!egress.ok) {
      globalBudgetSpent = true;
      throw new Error("global egress budget exhausted");
    }
    const waitMs = Math.max(slot.waitMs, egress.waitMs);
    if (waitMs > 0) await (deps.sleep ?? realSleep)(waitMs);
    return withEgressSlot(() => rawFetch(url, extraContentTypes));
  };

  /** Record a tier that the STORE refused (429/403) and start its cooldown. */
  const noteThrottled = (tier: FetchTier): void => {
    if (!diagnostics.throttled.includes(tier)) diagnostics.throttled.push(tier);
    // An upstream refusal outranks one of our own budgets: if the store said no, that
    // is the fact worth reporting, whatever our limiter did alongside it.
    diagnostics.throttleSource = "upstream";
    markHostThrottled(host, deps);
  };

  // robots.txt: once per host per hour, shared across all users. Its redirect also
  // reveals the store's CANONICAL host — merchants paste apex URLs
  // (`store.com/products/x`) while the storefront serves `www.store.com`, and some
  // apex hosts throttle or refuse what the canonical host answers fine. Following it
  // turns an avoidable "rate limited" into a real result.
  let canonicalOrigin = origin;
  const getRobots = deps.loadRobots ?? (async (o: string) => {
    const cached = getCachedRobots<RobotsPolicy>(o, deps);
    if (cached) { diagnostics.robots = "cached"; return cached; }
    try {
      const r = await fetchUrl(`${o}/robots.txt`);
      if (r.finalUrl) {
        try {
          const f = new URL(r.finalUrl);
          if (f.host.toLowerCase() !== new URL(o).host.toLowerCase()) canonicalOrigin = `${f.protocol}//${f.host}`;
        } catch { /* keep the requested origin */ }
      }
      // 429/403 on robots.txt is the host refusing us OUTRIGHT, not a path-class limit —
      // the distinction the throttle split turns on. Anything else non-200 is just
      // "no robots.txt here", which is normal and permissive.
      diagnostics.robots = r.status === 200 ? "ok" : r.status === 429 || r.status === 403 ? "refused" : "unreachable";
      const policy: RobotsPolicy = r.status === 200 ? parseRobots(r.body) : { rules: [], fetched: false };
      storeRobots(o, policy, deps);
      return policy;
    } catch {
      // Includes our own budget refusals, which throw from `fetchUrl`. Those are recorded
      // as `throttleSource` below; the host itself said nothing, so it is not `refused`.
      diagnostics.robots = "unreachable";
      return { rules: [], fetched: false };
    }
  });

  const robots = await getRobots(origin);
  const jsonPath = `/products/${encodeURIComponent(handle)}.json`;
  const pagePath = `/products/${encodeURIComponent(handle)}`;
  if (!isAllowedByRobots(robots, jsonPath) && !isAllowedByRobots(robots, pagePath)) {
    return { error: { kind: "robots_disallowed", message: FETCH_ERROR_MESSAGE.robots_disallowed } };
  }

  let js: ShopifyProductJson | null = null;
  let extracted: ExtractedPage | null = null;
  let ldDescription: string | null = null;
  let ldCategory: string | null = null;
  let pageProductType: string | null = null;
  let pageStorefrontObjectId: string | null = null;
  let pageActiveCurrency: string | null = null;
  let saw404 = false;
  let sawNonJson = false;

  // ---- TIER 1: the product PAGE (V2 §2.1 — reordered, was tier 2) ------------
  // The v1.1 smoke run is the evidence: `/products/*.json` returned 429 while HTML
  // on the same hosts returned 200. So the tier most likely to answer goes FIRST,
  // and a throttled `.json` degrades the test instead of erroring it. The page's
  // JSON-LD Product node carries name, description, price and availability — enough
  // to adjudicate claim, price and stock requirements on its own.
  if (isAllowedByRobots(robots, pagePath)) {
    diagnostics.attempted.push("page");
    try {
      const r = await fetchUrl(`${canonicalOrigin}${pagePath}`);
      if (r.status === 429 || r.status === 403) noteThrottled("page");
      else if (r.status === 404) saw404 = true;
      else if (r.status === 200 && /html/i.test(r.contentType ?? "")) {
        extracted = extractPage(r.body);
        ldDescription = jsonLdProductDescription(r.body);
        ldCategory = jsonLdProductCategory(r.body);
        // v3.2 CP2 — the merchant's own `product_type`, which otherwise dies here:
        // when the page answers, the `.json` tier never runs and this value is lost.
        pageProductType = shopifyMetaProductType(r.body);
        // v3.5 CP2b — same bytes, same walk: the storefront's own key for this
        // product, which rule D compares the published `mpn` against.
        pageStorefrontObjectId = shopifyStorefrontObjectId(r.body);
        // v3.8 — same bytes again: the storefront's active currency, the fallback
        // for the 4 non-USD stores whose JSON-LD carries no `priceCurrency`.
        pageActiveCurrency = shopifyActiveCurrency(r.body);
        if (extracted.product?.name || extracted.product?.offer) diagnostics.answeredBy = "page";
      }
    } catch { /* the JSON tier is the fallback */ }
  }

  // ---- TIER 2: /products/{handle}.json — ONLY to fill a gap the page left ----
  // A page with a complete JSON-LD Product node (node + prose + price +
  // availability) already answers the requirements this test can ask, so we spend
  // neither a second request nor a second chance at being throttled. Otherwise the
  // .json fills in body copy, product_type, options and variant detail.
  const ldProduct = extracted?.product ?? null;
  const pageHasNode = Boolean(ldProduct?.name || ldProduct?.offer);
  const pageHasText = Boolean(ldDescription || extracted?.faqs?.length || extracted?.metaDescription);
  const pageSufficient = pageHasNode && pageHasText && ldProduct?.offer?.price != null && Boolean(ldProduct?.offer?.availability);

  if (!pageSufficient && isAllowedByRobots(robots, jsonPath)) {
    diagnostics.attempted.push("json");
    try {
      const r = await fetchUrl(`${canonicalOrigin}${jsonPath}`);
      if (r.status === 429 || r.status === 403) noteThrottled("json");
      else if (r.status === 404) saw404 = true;
      else if (r.status === 200 && /json/i.test(r.contentType ?? "")) {
        js = (JSON.parse(r.body) as { product?: ShopifyProductJson }).product ?? null;
        if (js && !diagnostics.answeredBy) diagnostics.answeredBy = "json";
      } else if (r.status === 200) sawNonJson = true;
    } catch { /* whatever the page tier returned still stands */ }
  }

  const budgetRefused = hostBudgetSpent || globalBudgetSpent;
  // Only claim OUR budget as the cause when the store never refused us: `noteThrottled`
  // already set `upstream`, and that is the stronger fact. Without this branch a
  // self-inflicted refusal is indistinguishable from a store block, which is exactly
  // the measurement error the CP2 method doc calls the worst way the experiment can fail.
  if (budgetRefused && diagnostics.throttleSource === null) diagnostics.throttleSource = "our_budget";
  if (!js && !extracted) {
    // Nothing at all came back: the existing specific errors still apply (§2.3).
    if (diagnostics.throttled.length || budgetRefused) return { error: { kind: "rate_limited", message: FETCH_ERROR_MESSAGE.rate_limited }, diagnostics };
    if (saw404) return { error: { kind: "not_found", message: FETCH_ERROR_MESSAGE.not_found }, diagnostics };
    if (sawNonJson) return { error: { kind: "not_shopify", message: FETCH_ERROR_MESSAGE.not_shopify }, diagnostics };
    return { error: { kind: "unreachable", message: FETCH_ERROR_MESSAGE.unreachable }, diagnostics };
  }
  // A tier was refused but another answered ⇒ run the test on what we have and say
  // so, per-row, in the merchant's own words (§2.3). A partial honest test beats an
  // error page — and unlike an error page, it is still useful.
  diagnostics.degraded = diagnostics.throttled.length > 0 || budgetRefused;

  // Availability precedence (§3.1): JSON-LD Offer.availability → `.json` variants →
  // the `.js` endpoint (which carries the `available` flag `.json` often omits).
  // The `.js` fetch happens ONLY when the first two yielded nothing.
  const ldAvailability = extracted?.product?.offer?.availability ?? null;
  const jsonHasVariantSignal = (js?.variants ?? []).some((v) => typeof v.available === "boolean");
  let usedJsEndpoint = false;
  if (!ldAvailability && !jsonHasVariantSignal) {
    const dotJsPath = `/products/${encodeURIComponent(handle)}.js`;
    if (isAllowedByRobots(robots, dotJsPath)) {
      diagnostics.attempted.push("js");
      try {
        // Shopify serves this JSON as `text/javascript`; the allowance is scoped to
        // THIS call only (safeFetch's default allowlist is unchanged).
        const r = await fetchUrl(`${canonicalOrigin}${dotJsPath}`, [/^text\/javascript/i, /^application\/javascript/i]);
        if (r.status === 429 || r.status === 403) noteThrottled("js");
        else if (r.status === 200 && /javascript|json/i.test(r.contentType ?? "")) {
          const dotJs = JSON.parse(r.body) as ShopifyProductJson;
          if (dotJs && Array.isArray(dotJs.variants)) {
            usedJsEndpoint = true;
            js = js ? { ...js, variants: dotJs.variants } : dotJs;
          }
        }
      } catch { /* the row stays honestly unadjudicated */ }
      diagnostics.degraded = diagnostics.degraded || diagnostics.throttled.includes("js") || hostBudgetSpent || globalBudgetSpent;
    }
  }

  const tags = Array.isArray(js?.tags) ? js!.tags! : typeof js?.tags === "string" ? js!.tags!.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const optionNames = (js?.options ?? []).map((o) => o.name ?? "").filter(Boolean);
  const optionValues = [...new Set((js?.options ?? []).flatMap((o) => o.values ?? []))].filter((v) => v && !/^(default|title)/i.test(v));
  // PROVENANCE IS EXACT, not inferred. When the `.js` tier answers, its variants
  // REPLACE the `.json` ones wholesale (`js = { ...js, variants: dotJs.variants }`
  // above) and `usedJsEndpoint` is set in the same branch — so this flag is a
  // precise statement about where EVERY price in `variants` came from. If the `.js`
  // fetch was attempted and failed to parse, the flag stays false and the prices
  // are still the `.json` ones. There is no mixed case to get wrong.
  const priceTier: PriceTier = usedJsEndpoint ? "js" : "json";
  const variants: PublicVariant[] = (js?.variants ?? []).map((v) => ({
    title: v.title ?? "", priceUsd: priceToUsd(v.price, priceTier), available: v.available !== false,
    options: v.options ?? [v.option1, v.option2, v.option3].filter((o): o is string => Boolean(o)),
  }));
  const prices = variants.map((v) => v.priceUsd).filter((p): p is number => p != null);
  const descriptionText = js?.body_html ? htmlToText(js.body_html) : "";
  const ld = extracted?.product;

  // The evidence index: PRODUCT surfaces only. Raw page text (nav, upsell, review
  // and subscription-widget chrome) is deliberately NOT an evidence surface — it is
  // what produced the live false positive this hardening exists to fix.
  const evidence = buildEvidence([
    { surface: "product_description", text: descriptionText },
    { surface: "structured_data", text: ldDescription },
    { surface: "product_faq", text: (extracted?.faqs ?? []).map((f) => `${f.q} ${f.a}`).join("\n") },
    { surface: "product_title", text: js?.title ?? ld?.name ?? null },
    { surface: "product_options", text: optionValues.join(". ") },
    { surface: "meta_description", text: extracted?.metaDescription ?? null },
  ]);

  return {
    product: {
      origin: canonicalOrigin, handle, title: js?.title ?? ld?.name ?? extracted?.title ?? null,
      // PRECEDENCE IS G-10's OWN SIGNAL ORDER: `product_type` is authoritative, then
      // JSON-LD category, then the breadcrumb (the last two both inside `ldCategory`).
      // `pageProductType` sits with `js.product_type` rather than below `ldCategory`
      // because it IS that field — the same value `/products.json` publishes, read
      // from the merchant's own analytics payload instead of a second request. A
      // theme-generated `Product.category` is the weaker signal of the two, and on a
      // real store it was the breadcrumb root "Home".
      vendor: js?.vendor ?? ld?.brand ?? null, productType: js?.product_type ?? pageProductType ?? ldCategory, tags,
      descriptionText, variants, minPriceUsd: prices.length ? Math.min(...prices) : (ld?.offer?.price ?? null),
      optionNames, optionValues, extracted, evidence, ldAvailability,
      storefrontObjectId: pageStorefrontObjectId,
      // PRECEDENCE, measured rather than guessed (see `shopifyActiveCurrency`):
      // the JSON-LD `priceCurrency` `extractPage` already parses covers 34 of the
      // 38 non-USD stores; the analytics bootstrap covers the other 4. Neither
      // `Shopify.country` nor `og:price:currency` is consulted, both for recorded
      // reasons. Normalised to upper case so "gbp" and "GBP" cannot differ.
      declaredCurrency: ((ld?.offer as { currency?: string | null } | null | undefined)?.currency
        ?? pageActiveCurrency ?? null)?.toUpperCase() ?? null,
      policyStatus: "not_fetched",
      fetched: { json: Boolean(js), page: Boolean(extracted), js: usedJsEndpoint, policy: false },
      diagnostics,
    },
    ctx: { fetchUrl, robots },
    diagnostics,
  };
}

/** Fetch `/policies/shipping-policy` and fold it in as a `shipping_policy` evidence
 *  surface. Called ONLY when the task includes a delivery requirement (≤1 extra
 *  fetch per test), under the same robots + throttle + cache discipline. */
export async function attachShippingPolicy(
  product: PublicProduct,
  ctx: { fetchUrl: NonNullable<FetchDeps["fetchUrl"]>; robots: RobotsPolicy },
): Promise<PublicProduct> {
  const path = "/policies/shipping-policy";
  if (!isAllowedByRobots(ctx.robots, path)) return { ...product, policyStatus: "robots_disallowed" };
  try {
    const r = await ctx.fetchUrl(`${product.origin}${path}`);
    // A throttled policy page is NOT an absent policy — say which one it was (§2.3).
    if (r.status === 429 || r.status === 403) {
      return {
        ...product, policyStatus: "rate_limited",
        diagnostics: {
          ...product.diagnostics,
          throttled: [...product.diagnostics.throttled, "policy"],
          degraded: true,
          // The STORE refused this tier — same attribution as `noteThrottled`, which
          // this path predates and does not go through.
          throttleSource: "upstream",
        },
      };
    }
    if (r.status !== 200 || !/html/i.test(r.contentType ?? "")) return { ...product, policyStatus: "unreachable" };
    // ⚠️ This line used to call `htmlToText` under the comment "Policy pages are
    // chrome-heavy; keep only the main text and cap it." That was FALSE: `htmlToText`
    // is a tag stripper, so it kept the text of <title>, <nav>, <header> and <footer>
    // verbatim and then collapsed every newline. Only the cap was real. The result was
    // a measured false positive on a live store — "Organic — stated in your shipping
    // policy", where the word appeared solely in the store's SEO title — and, because
    // the whole document arrived as one unbroken run, a fused ~1000-char "sentence"
    // that defeated the quote gate and the subject gate at the same time.
    // `htmlToBlockText` drops <head> and the chrome containers and turns block
    // boundaries into newlines, so `splitSentences` sees sentences rather than a page.
    const text = htmlToBlockText(r.body).slice(0, 20_000);
    if (!text) return { ...product, policyStatus: "unreachable" };
    return {
      ...product,
      evidence: [...product.evidence, ...buildEvidence([{ surface: "shipping_policy", text }])],
      policyStatus: "readable",
      fetched: { ...product.fetched, policy: true },
    };
  } catch {
    return { ...product, policyStatus: "unreachable" };
  }
}

// ---- buyer task generation (4–6 requirements across surface types) -----------
export type ReqKind =
  | "claim" | "price_under" | "variant_option" | "no_subscription" | "delivery" | "in_stock"
  // v2.3 CP2 — depth the public data can actually adjudicate.
  | "attribute"   // a stated product attribute (materials, dimensions, origin, …)
  | "identifiers" // GTIN/MPN in structured data — what a machine consumer needs
  // v3.1 CP1 — a row we cannot re-ask. NOT a verdict about the store: it is the
  // engine reporting that it failed to reconstruct the question. See `evaluate`.
  | "unsupported";
export interface Requirement {
  id: string; kind: ReqKind; label: string; claim?: string; capUsd?: number; optionValue?: string;
  /** Key into ATTRIBUTE_SPECS. Only set for `attribute` requirements. */
  attribute?: string;
  /** Why an `unsupported` row could not be re-asked. Rendered to the merchant, so it
   *  must describe OUR limitation and never imply anything about their store. */
  unsupportedReason?: string;
}

// ---- label → requirement (v3.1 CP1) -----------------------------------------
//
// The public result persists RENDERED ASSERTIONS, not the `Requirement` objects that
// produced them, so importing a public test into a shop has to rebuild the contract
// from labels. `contractFromPublicResult` did that with a regex ladder that ended in
// an unconditional `kind: "claim"` — so "Materials are stated" was rebuilt as the
// claim key `materials_are_stated`, which no dictionary contains, and `evaluate`
// dereferenced `undefined`. A merchant who imported a public test containing a
// materials, measurements, care or identifiers row pinned a contract that THREW on
// every re-run: the public-test-to-install path the whole funnel depends on.
//
// The tables below are DERIVED from the same objects that generate the labels
// (`ATTRIBUTE_SPECS`, `CLAIM_LABEL`, the fixed candidates in `buildBuyerTask`), never
// retyped. Renaming a label therefore keeps the round-trip working; renaming it in
// only one of two places — the actual failure mode here — is no longer possible.
const FIXED_LABEL_KINDS: ReadonlyArray<readonly [string, ReqKind]> = [
  ["In stock and purchasable", "in_stock"],
  ["Available as a one-time purchase", "no_subscription"],
  ["Delivery timing is stated", "delivery"],
  ["Product identifier (GTIN or MPN) is published", "identifiers"],
];

/**
 * Labels this generator USED to emit. A pinned contract is a database row that can
 * be older than any rename, so dropping these would break exactly the merchants who
 * have been here longest — and it would do it silently, by degrading their rows to
 * `unsupported` rather than by failing anything a test can see.
 *
 * Enumerated by sweeping every historical revision of this file for requirement
 * labels, not by memory. The complete set of renames is:
 *   "Ships in the US within a week"    -> "Delivery timing is stated"
 *   "Size, capacity or weight is stated" -> "Measurements are stated"
 * `"Country of origin is stated"` is deliberately ABSENT: v2.8 CP2 removed that
 * requirement outright, so there is nothing to map it to. A contract still carrying
 * it resolves to `unsupported`, which is the honest answer — the engine really
 * cannot ask that question any more, and saying so beats inventing a verdict.
 */
const LEGACY_LABELS: ReadonlyArray<readonly [string, Omit<Requirement, "id" | "label">]> = [
  ["Ships in the US within a week", { kind: "delivery" }],
  ["Size, capacity or weight is stated", { kind: "attribute", attribute: "dimensions" }],
];

const normLabel = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/** True when the key names a claim this engine can actually evaluate. */
export const isKnownClaim = (key: string | undefined): boolean =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(CLAIM_TERMS, key);
/** True when the key names an attribute this engine can actually evaluate. */
export const isKnownAttribute = (key: string | undefined): boolean =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(ATTRIBUTE_SPECS, key);

/**
 * Recover the requirement a generated label came from, exactly.
 *
 * Returns null for the two labels that embed merchant-supplied values (a price cap
 * and a variant option) — those carry their parameter in the text and are parsed by
 * the caller, which is the only place that knows the row index to build an id from.
 */
export function requirementFromLabel(label: string, id: string): Requirement | null {
  const key = normLabel(label);
  for (const [text, kind] of FIXED_LABEL_KINDS) if (normLabel(text) === key) return { id, kind, label };
  for (const [attribute, spec] of Object.entries(ATTRIBUTE_SPECS)) {
    if (normLabel(spec.label) === key) return { id, kind: "attribute", attribute, label };
  }
  for (const claim of Object.keys(CLAIM_TERMS)) {
    // Both forms `buildBuyerTask` can emit: the pretty label, and the underscore
    // fallback it uses for a claim with no CLAIM_LABEL entry.
    const pretty = CLAIM_LABEL[claim];
    if ((pretty && normLabel(pretty) === key) || normLabel(claim.replace(/_/g, " ")) === key) {
      return { id, kind: "claim", claim, label };
    }
  }
  for (const [text, req] of LEGACY_LABELS) if (normLabel(text) === key) return { ...req, id, label };
  return null;
}

// ---- contract + engine versioning (V2 §4.4) ---------------------------------
// A before/after comparison is only evidence if BOTH runs asked the same question
// of the same evaluator. If either changed, the honest answer is to refuse the
// comparison — not to show a diff that silently redefined itself in between.

/** Bump when the EVALUATOR's semantics change (a status could differ on identical
 *  input). Pure additions that cannot change an existing verdict don't need a bump. */
/**
 * The engine identity a saved buyer test is compared against.
 *
 * ⚠️ BUMP THIS WHENEVER A MATCHER FILE CHANGES. `buyerTests.ts` refuses a
 * before/after across two different values, because results from two different
 * matchers are not comparable — and that refusal is the ONLY thing standing
 * between a merchant and a silent regression in their own trend line.
 *
 * ⚠️ IT SAT AT `v2.0.0` FROM v2.0 THROUGH v3.7 WHILE THE MATCHER CHANGED
 * REPEATEDLY. v3.5's rule D flipped identifier rows on real stores under this
 * same tag; v3.0's `care` guard, v2.8's quantity guard and v2.5's subject rule
 * all shipped under it too. So every record tagged `v2.0.0` may have come from
 * any of a dozen engines, and the guard has been dead for most of its life — not
 * because it was wrong, but because nobody remembered to move the number.
 *
 * **A guard that depends on memory is not a guard.** `test/engineVersion.test.ts`
 * now pins this value against a content hash of the matcher files, so changing a
 * matcher without bumping fails `npm test`. Do not weaken that test to make a
 * change land; bump the version, which is the thing it exists to make you do.
 *
 * v2.1.0 — v3.8: the tier-aware cents conversion and the non-USD price refusal.
 * Together they change what 44 of 349 captured stores' price rows report.
 */
export const ENGINE_VERSION = "v2.1.0";

/** Identity of a published standard a run was executed against. Plain data by
 *  design: the engine must not import anything from `standards/`, or the dependency
 *  runs backwards and `standards/tsconfig.json` (which follows imports INTO src/)
 *  becomes circular. The caller supplies id, version and content hash. */
export interface StandardIdentity {
  id: string;
  version: string;
  /** sha256 of the standard's canonical form — see standards/hash.ts. */
  hash: string;
}

/** A stable fingerprint of a buyer task: same requirements ⇒ same version, in any
 *  process, forever. Deliberately covers only the fields that decide a verdict.
 *
 *  v3.0 CP4 — WIDENED FOR STANDARDS, AND THE PRECEDENT IS RESPECTED. Two runs under
 *  DIFFERENT versions of the same standard must not compare as though they asked the
 *  same question, so the standard's identity has to be inside the fingerprint. But the
 *  existing hash was deliberately built so pre-v2.3 contracts hash unchanged, and
 *  widening the tuple unconditionally would have re-fingerprinted every stored contract
 *  at once and made every saved before/after comparison refuse itself as "drifted".
 *
 *  So the identity is an OPTIONAL second argument and the tag changes with it:
 *    - no standard  -> `c1-xxxxxxxx`, byte-identical to what it has always produced.
 *    - a standard   -> `c1s-xxxxxxxx`, and the id+version+hash are inside the hashed
 *                      string.
 *  A standard-pinned contract therefore cannot collide with a generated one even by
 *  hash accident, and the difference is legible to a human reading a stored row. */
export function contractVersion(requirements: Requirement[], standard?: StandardIdentity): string {
  const canonical = requirements
    // `attribute` is appended ONLY when present, so every pre-v2.3 requirement
    // hashes to exactly the byte string it always did. Widening the tuple
    // unconditionally would have changed every stored contract's fingerprint at
    // once and made every saved before/after comparison refuse itself as "drifted".
    .map((r) => [r.kind, r.claim ?? "", r.capUsd ?? "", r.optionValue ?? "", ...(r.attribute ? [r.attribute] : [])].join(":"))
    .sort()
    .join("|");
  // Prefixed rather than appended, so a standard's identity can never be confused
  // with a requirement tuple by a reader of the canonical string.
  const full = standard
    ? `std:${standard.id}@${standard.version}#${standard.hash}||${canonical}`
    : canonical;
  // FNV-1a — short, deterministic, dependency-free. Not a security hash: this
  // detects accidental drift, it does not defend against a forged contract.
  let h = 0x811c9dc5;
  for (let i = 0; i < full.length; i++) {
    h ^= full.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${standard ? "c1s" : "c1"}-${h.toString(16).padStart(8, "0")}`;
}

function inferClaims(p: PublicProduct): string[] {
  // product_type is the authoritative category signal; title is the fallback.
  // Tags are deliberately excluded — scent/ingredient tags ("coffee", "lavender")
  // routinely misclassify (a coffee-scented soap is not a coffee product).
  for (const src of [(p.productType ?? "").toLowerCase(), (p.title ?? "").toLowerCase()]) {
    if (!src) continue;
    for (const c of CATEGORY_CLAIMS) if (c.kw.test(src)) return c.claims;
  }
  // Fallback: a claim the product's own tags explicitly STATE (not a category guess).
  const tagHay = p.tags.join(" ");
  for (const key of Object.keys(CLAIM_TERMS)) {
    if (CLAIM_TERMS[key]!.support.some((t) => norm(tagHay).includes(norm(t)))) return [key];
  }
  // NO CLAIM. This used to default to `["cruelty_free"]`, and measuring 13 real
  // stores (v2.2 CP3) showed what that cost: CATEGORY_CLAIMS covers personal care,
  // food and drinkware, so dog harnesses, backpacks, notebooks, bike parts,
  // candles and garden tools ALL fell through to it. "Cruelty-free" was asked of
  // every one of the 13, failed 13/13, and — because a claim always scores highest
  // in `adjudicability` — sat at the TOP of every table. It was typically one of
  // only two not-proven rows, so half the findings we showed were an artifact of
  // this line, and every report opened with the same irrelevant sentence.
  //
  // It was not a false claim: the row says the store doesn't STATE the attribute,
  // which was true. It was worse than false — it was irrelevant, identical across
  // unrelated merchants, and it made a specific diagnosis read like a template.
  // An empty list is honest: `buildBuyerTask` simply builds a task without a claim
  // row, and the summary already omits the clause.
  return [];
}
function niceCap(min: number): number { return Math.max(10, Math.ceil((min + 0.01) / 5) * 5); }

/** Can PUBLIC data decide this requirement at all? Requirements the public surfaces
 *  can adjudicate rank first, so the table is full of findings a merchant can act on
 *  rather than rows that shrug (§4.1). */
function adjudicability(p: PublicProduct, r: Requirement): number {
  switch (r.kind) {
    // A claim is ALWAYS adjudicable: "no evidence found" is itself the most
    // actionable finding the tool produces (state it, and it becomes provable).
    case "claim": return 3;
    // These score 0 only when they'd be forced to say "requires store access".
    case "price_under": return p.minPriceUsd != null ? 3 : 0;
    case "variant_option": return p.optionValues.length ? 3 : 0;
    case "in_stock": return p.ldAvailability || p.variants.length ? 3 : 1;
    case "no_subscription": return 2; // absence-based, always answerable
    case "delivery": return 2;        // the policy fetch usually resolves it
    // Decidable exactly when there is product text to decide it against.
    case "attribute": return p.evidence.length ? 3 : 0;
    // Structural and binary: readable whenever the page markup was readable.
    case "identifiers": return p.extracted ? 3 : 0;
    // Never generated — `unsupported` only ever arrives on a RECONSTRUCTED contract,
    // which bypasses `buildBuyerTask` entirely. Scored 0 so that if a future path
    // ever does feed one through generation, it is ranked out rather than shown.
    case "unsupported": return 0;
  }
}

// ---- the first line the merchant reads --------------------------------------
// `product_type` is the merchant's own taxonomy field and is frequently not a
// noun for the thing: the v2.2 sample produced "Find this walk", "Find this
// products" and "Find this confidant". Their data, our sentence — and it made a
// specific diagnosis look broken before the merchant reached a single finding.
//
// The product TITLE is always the merchant's own name for the product and is
// never nonsense, so it leads. `product_type` is used only when it looks like an
// actual category word, and a neutral phrasing is the floor.
const PRODUCT_TYPE_STOPLIST = /^(products?|all|default|misc|miscellaneous|other|none|home ?page|frontpage|new|featured|shop|collection|item|untitled|general|\d+)$/i;

export function taskSubject(p: PublicProduct): string {
  const title = (p.title ?? "").replace(/\s+/g, " ").trim();
  // The summary is LINTED, and a failed lint blocks the ENTIRE result and returns
  // `unreachable` for a store we read perfectly. Piping the merchant's raw title
  // into it therefore kills the whole test, deterministically and unfixably by
  // retry, for real products: "Lifetime Guarantee Leather Belt" trips `guarantee`,
  // "Rank Higher: The SEO Workbook" trips `ranking-prediction`. This is the same
  // hazard that got the `warranty` requirement dropped — it must not come back in
  // through the first line of the page.
  const usable = (s: string): boolean => lintStrings([`Find the ${s}, purchasable one-time with fast US shipping.`]).ok;
  if (title && title.length <= 70 && usable(title)) return `the ${title}`;
  if (title) {
    // Long titles are usually "Name — long marketing subtitle"; keep the head.
    const head = title.split(/\s+[–—|:]\s+/)[0]!.trim();
    if (head && head.length <= 70 && usable(head)) return `the ${head}`;
  }
  const type = (p.productType ?? "").replace(/\s+/g, " ").trim();
  if (type && type.length <= 30 && /^[a-z][a-z\s&'-]*$/i.test(type) && !PRODUCT_TYPE_STOPLIST.test(type) && lintStrings([`Find this ${type.toLowerCase()}.`]).ok) {
    return `this ${type.toLowerCase()}`;
  }
  return "this product";
}

/** Upper bound on rows in the table. v2.2 shipped 4–6; the measured consequence was
 *  a modal store with ONE genuine finding. The target (v2.3 CP2) is 8–12 tested with
 *  2–4 failing, and a failing SET that differs between stores.
 *
 *  ⚠️ v3.0 CP4 — THIS CAP BELONGS TO GENERATION, NOT TO EVALUATION, and it is scoped
 *  to `buildBuyerTask` alone (its only reference). A standard has more entries than
 *  ten and every one of them is a published assertion someone may cite, so truncating
 *  a conformance run to the first ten would silently drop entries while the result
 *  still claimed to have tested the standard. Supplied requirements bypass this by
 *  construction — they never pass through `buildBuyerTask` — which is why no change
 *  was needed here beyond saying so. Verified by a test that runs an 18-entry pinned
 *  contract and asserts 18 rows come back. */
const MAX_REQUIREMENTS = 10;

export function buildBuyerTask(p: PublicProduct): { summary: string; requirements: Requirement[] } {
  // Candidate pool, then ranked by whether public data can decide it.
  const candidates: Requirement[] = [];
  const claims = inferClaims(p).slice(0, 2);
  claims.forEach((c, i) => candidates.push({ id: `claim${i}`, kind: "claim", claim: c, label: CLAIM_LABEL[c] ?? c.replace(/_/g, " ") }));
  if (p.minPriceUsd != null) {
    const cap = niceCap(p.minPriceUsd);
    candidates.push({ id: "price", kind: "price_under", capUsd: cap, label: `Price under $${cap}` });
  }
  // The label embeds a MERCHANT-supplied option value, and every rendered string is
  // linted with the whole result refused on a violation. A variant named "Lifetime
  // Guarantee" or "Rank Higher" would therefore destroy the merchant's own report,
  // deterministically. Same hazard as the product title and the dropped `warranty`
  // requirement — drop the candidate instead of the result.
  const optionValue = p.optionValues.find(
    (v) => v && !/^(default|title)$/i.test(v) && lintStrings([`${v} option available`]).ok,
  );
  if (optionValue) candidates.push({ id: "variant", kind: "variant_option", optionValue, label: `${optionValue} option available` });
  candidates.push({ id: "stock", kind: "in_stock", label: "In stock and purchasable" });
  candidates.push({ id: "sub", kind: "no_subscription", label: "Available as a one-time purchase" });
  candidates.push({ id: "delivery", kind: "delivery", label: "Delivery timing is stated" });
  // v2.3 CP2 — attribute + structured-data depth. `onlyFor` keeps a requirement out
  // of categories where it isn't a real buyer constraint: asking a graphite pencil
  // for care instructions is the same mistake as asking it to be cruelty-free.
  const categoryHay = `${p.productType ?? ""} ${p.title ?? ""}`;
  for (const [key, spec] of Object.entries(ATTRIBUTE_SPECS)) {
    if (spec.onlyFor && !spec.onlyFor.test(categoryHay)) continue;
    candidates.push({ id: `attr_${key}`, kind: "attribute", attribute: key, label: spec.label });
  }
  candidates.push({ id: "ids", kind: "identifiers", label: "Product identifier (GTIN or MPN) is published" });

  // Selection: keep 4–6 requirements that SPAN the surface types (claim · price ·
  // variant · purchase terms · logistics) — depth across surfaces is what makes the
  // result impressive — while preferring the publicly adjudicable candidates.
  const surfaceType = (r: Requirement): string =>
    r.kind === "variant_option" || r.kind === "in_stock" ? "variant"
    : r.kind === "no_subscription" ? "terms"
    : r.kind === "delivery" ? "logistics"
    : r.kind === "price_under" ? "price"
    : r.kind === "identifiers" ? "machine"
    : r.kind === "attribute" ? `attr:${r.attribute}`
    : "claim";
  const pool = candidates
    .map((r, i) => ({ r, i, score: adjudicability(p, r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  // Pass 1: the best adjudicable candidate from each surface type, in priority
  // order. Spanning surfaces is what makes a result read as a diagnosis rather
  // than a checklist, and it is also what stops one dominant gap (delivery, 71%
  // of stores in the v2.2 sample) from being the entire report.
  // `attr:origin` and `attr:warranty` were dropped from this list with their
  // requirements (v2.8 CP2 and v2.3 respectively). A priority entry that matches no
  // candidate is a silent no-op, which is exactly how `attr:warranty` survived three
  // sessions after the requirement it named stopped existing.
  const SURFACE_PRIORITY = [
    "claim", "logistics", "attr:materials", "attr:dimensions", "machine",
    "price", "variant", "terms", "attr:care",
  ];
  const picked = new Set<Requirement>();
  for (const type of SURFACE_PRIORITY) {
    if (picked.size >= MAX_REQUIREMENTS) break;
    const best = pool.find((x) => surfaceType(x.r) === type && !picked.has(x.r));
    if (best) picked.add(best.r);
  }
  // Pass 2: fill the remaining slots with the next-best candidates.
  for (const x of pool) {
    if (picked.size >= MAX_REQUIREMENTS) break;
    picked.add(x.r);
  }
  const ordered = candidates.filter((c) => picked.has(c)); // restore reading order

  const claimWords = claims.map((c) => (CLAIM_LABEL[c] ?? c).toLowerCase()).join(", ");
  const summary = `Find ${taskSubject(p)}${claimWords ? `, confirm it's ${claimWords}` : ""}, purchasable one-time with fast US shipping.`;
  return { summary, requirements: ordered };
}

// ---- the four honest result states ------------------------------------------
// pass_evidenced       — positive evidence found AND validated (§2)
// pass_no_blocking     — a must_be_false requirement with nothing contradicting it,
//                        DISCLOSED as inference, never rendered as proof
// not_proven           — surface inspectable, no supporting evidence (or the
//                        readable value doesn't meet the ask)
// requires_store_access— the surface isn't publicly inspectable at all
export type AssertionStatus = "pass_evidenced" | "pass_no_blocking" | "not_proven" | "requires_store_access";
export const PASSING: AssertionStatus[] = ["pass_evidenced", "pass_no_blocking"];

export interface Assertion {
  label: string;
  status: AssertionStatus;
  detail: string;
  evidenceQuote?: string;
  /** Human label of the surface the evidence came from (or was sought on). */
  evidenceSurface?: string;
  /** The surfaces actually checked for THIS requirement (§4.4 specificity). */
  surfacesChecked: string[];
}

/** Distinct human labels of the product surfaces available on this snapshot. */
function textSurfaces(p: PublicProduct): string[] {
  const seen = new Set<QuotableSurface>(p.evidence.map((e) => e.surface));
  const order: QuotableSurface[] = ["product_description", "structured_data", "product_faq", "product_title", "product_options", "meta_description"];
  const labels = order.filter((s) => seen.has(s)).map((s) => SURFACE_LABEL[s]);
  return labels.length ? labels : ["product copy"];
}
const listPhrase = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** V2 §2.3 — the honesty rule for a degraded run. If a fetch tier was refused, we
 *  never got to look, so we must NOT report the store as publishing nothing. The
 *  difference between "we couldn't read this" and "you don't publish this" is the
 *  difference between a finding and an accusation, and only one of them is true. */
const THROTTLED_DETAIL =
  "The store's product endpoint is limiting automated requests right now, so we couldn't read this surface. That's an upstream limit rather than something about this store — try again in a few minutes.";
const accessDetail = (p: PublicProduct, whenReadable: string): string =>
  p.diagnostics?.degraded ? THROTTLED_DETAIL : whenReadable;

/**
 * The honest row for a requirement this engine cannot ask (v3.1 CP1).
 *
 * `requires_store_access` is the right STATUS and the wrong WORDS: it is the engine's
 * existing "we did not adjudicate this" bucket, it counts as neither pass nor fail,
 * and `PASSING` excludes it — but its usual copy blames the store's visibility. This
 * detail deliberately blames US instead. The distinction the whole engine turns on is
 * finding vs accusation, and "we could not re-ask this question" must never be
 * rendered as "your store does not state this".
 */
function unsupportedRow(p: PublicProduct, req: Requirement, reason: string): Assertion {
  console.error(`[buyer-test] UNSUPPORTED REQUIREMENT id=${req.id} kind=${req.kind} label=${JSON.stringify(req.label)} — ${reason}`);
  return {
    label: req.label,
    status: "requires_store_access",
    surfacesChecked: textSurfaces(p),
    detail: "We couldn't re-run this check automatically. That's a limitation on our side, not a finding about your store — this row is reported as unchecked rather than as a result.",
  };
}

export function evaluate(p: PublicProduct, req: Requirement): Assertion {
  switch (req.kind) {
    // A row whose question could not be reconstructed. Reported, never silently
    // dropped: a contract that quietly loses a row the merchant already saw is the
    // same class of dishonesty as a conformance list that drops entries (CP3).
    case "unsupported":
      return unsupportedRow(p, req, req.unsupportedReason ?? "no reason recorded");
    case "claim": {
      // ⚠️ TOTAL, NOT `!`. The bare non-null assertion here was the live crash: a
      // reconstructed contract carrying `claim: "materials_are_stated"` made this
      // `undefined`, and the very next line read `.violating` off it — a TypeError
      // thrown inside an unguarded `.map()` in `runAuthenticatedTest`, which took
      // down the merchant's entire re-run over one row. Reconstruction is fixed in
      // `requirementFromLabel`; this branch stays defensive anyway, because a pinned
      // contract is DATA that has been sitting in a database since before the fix,
      // and a compiled standard can name a claim key this build does not have.
      const fx = CLAIM_TERMS[req.claim!];
      if (!fx) return unsupportedRow(p, req, `unknown claim key '${req.claim}'`);
      const checked = textSurfaces(p);
      // PRODUCT surfaces only — the same filter the attribute rows apply, and for the
      // same reason. The shipping policy is evidence about ORDERS, not about this
      // product, and a claim proven from it is a statement the merchant never made
      // about the thing being tested. The asymmetry (attribute rows filtered, claim
      // rows did not) was unintentional and produced a measured false positive on a
      // live store; an independent probe set then false-passed 364 of 390 chrome
      // negatives, spread across six surfaces.
      //
      // Blast radius, measured before making the change: all 13 CLAIM_TERMS keys that
      // pass off policy text also pass identically from `product_description`, and no
      // claim class was found whose evidence legitimately lives ONLY in policy text —
      // the plausible shapes ("We only ship organic products.") are store-wide
      // statements on a logistics document, while the row asserts the claim about THIS
      // product. Policy sentences are appended last and `findSupport` takes the first
      // match, so the policy only ever decided a row when the product surfaces were
      // silent — exactly when the merchant is being told something new.
      //
      // The lint filter is unchanged: a sentence we could not legally render is skipped
      // so a merchant whose copy says "guaranteed" never has their report refused.
      const quotable = p.evidence.filter((e) => e.surface !== "shipping_policy" && lintStrings([e.text]).ok);
      // Contrary evidence must clear the same aboutness gates before we report it —
      // AND must not be an artefact of one term sitting inside another.
      //
      // `contains gluten` is a plain substring of `contains gluten-free`, and the
      // violating list is checked first, so a store that STATES it is gluten-free
      // was told its copy "states the opposite of this requirement" — with its own
      // compliant sentence quoted as the proof. `added fragrance` inside `no added
      // fragrance` is the same shape. This is the most damaging defect the v2.4
      // corpus found: not a missed pass, but an assertion about the merchant that
      // is the reverse of what they wrote.
      const contra = fx.violating.length ? findViolation(quotable, fx.violating, fx.support) : null;
      if (contra) {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: `Your public copy states the opposite of this requirement.`,
          evidenceQuote: contra.quote ?? undefined, evidenceSurface: SURFACE_LABEL[contra.surface],
        };
      }
      // `wholeWord` matters here and was not set before v2.5: the claim dictionary
      // contains single words, so `organic` matched inside `inorganic` — a word that
      // asserts the opposite of the claim it was crediting.
      const hit = findSupport(quotable, fx.support, { wholeWord: true });
      // A PASS WITHOUT A QUOTE MUST SAY SO. `findSupport` returns a hit with
      // `quote: null` when no clean sentence can be cut, and this branch used to render
      // `hit.quote ?? undefined` — so the row passed showing the merchant nothing to
      // check, silently. That is the shape the live false positive took: "Organic —
      // stated in your shipping policy", no quote at all.
      //
      // ⚠️ FAILING CLOSED HERE WAS TRIED AND MEASURED WRONG. It looked right — the
      // testEvidence.ts header states "anything that can't clear all three gates is NOT
      // a pass" — but on the independent 390-negative chrome set, ZERO of the 195
      // surviving false passes were quote-less, so it closed nothing; and it cost four
      // real positives plus a canonical corpus case, all for the same reason:
      // `presentableQuote` rejects anything under three words, and "Certified
      // gluten-free." and variant values like "Organic Cotton." are two. Blocking a
      // merchant's genuine two-word claim to fix a defect that does not travel this path
      // is a bad trade. So the row passes and DISCLOSES, exactly as the attribute row
      // does for a spec block.
      if (hit) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: hit.quote
            ? `Stated in your ${SURFACE_LABEL[hit.surface]}.`
            : `Stated in your ${SURFACE_LABEL[hit.surface]}, in wording we can't quote back as a clean sentence.`,
          evidenceQuote: hit.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hit.surface],
        };
      }
      return {
        label: req.label, status: "not_proven", surfacesChecked: checked,
        detail: `Checked ${listPhrase(checked)} — no statement an AI buyer could verify.`,
      };
    }
    case "price_under": {
      const checked = ["variant prices", "structured data"];
      if (p.minPriceUsd == null) {
        return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: accessDetail(p, "No public price is exposed on this product.") };
      }
      // v3.8 — THE NON-USD REFUSAL, and it comes BEFORE any number is rendered.
      //
      // The cap in `req.label` is a US-dollar cap; `p.minPriceUsd` is a number in
      // the STORE's currency. When the store's own bytes declare that currency is
      // not USD, the only honest answer is that we cannot decide: we do not convert
      // currencies, and comparing 135 GBP against a $140 cap is not a comparison.
      // Measured: 38 of 349 real stores declare non-USD, 5 of them inside the
      // published general sample, and every one was being told its price was a
      // dollar figure — `missoma.com`'s £135.00 necklace rendered as
      // `Lowest readable price is $135.00.`
      //
      // ⚠️ IT STATES NO NUMBER AT ALL. Rendering the raw figure behind the right
      // symbol would be a SECOND claim — that the number we read is a price in that
      // currency — and nothing here measured that. A CONVERTED number is forbidden
      // outright: it would invent a rate, on a public instrument, about a real
      // merchant. What a price row should eventually PROMISE for a non-USD store is
      // a genuine open question, filed rather than answered (ENGINE_GAPS P-18).
      // This is only the removal of a false statement, which is the whole of its
      // claim: a false statement about a real store is the unrecoverable direction,
      // and `not_proven` is the recoverable one.
      //
      // ⚠️ AN ABSENT DECLARATION IS NOT A NON-USD DECLARATION. `declaredCurrency`
      // null means the page declared nothing — 1 store in 349 — and the row still
      // answers exactly as before. Refusing on silence would be a wider change than
      // anything measured here, and it is filed rather than taken.
      if (p.declaredCurrency && p.declaredCurrency !== "USD") {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: `Your store publishes prices in ${p.declaredCurrency}, and this check states a US-dollar cap. We don't convert currencies, so we can't answer it from your public data.`,
        };
      }
      if (p.minPriceUsd < req.capUsd!) {
        return { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: `Lowest readable price is $${p.minPriceUsd.toFixed(2)}.`, evidenceSurface: "variant prices" };
      }
      return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: `Lowest readable price is $${p.minPriceUsd.toFixed(2)}, at or above the $${req.capUsd} requirement.` };
    }
    case "variant_option": {
      const checked = ["variant options"];
      const v = p.variants.find((x) => x.options.some((o) => norm(o) === norm(req.optionValue!)) || norm(x.title).includes(norm(req.optionValue!)));
      if (v && v.available) return { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: `A "${req.optionValue}" variant is listed and purchasable.`, evidenceSurface: "variant options" };
      if (v) return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: `The "${req.optionValue}" variant is listed but shows as unavailable.` };
      return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: `Checked the public variant list — no "${req.optionValue}" variant found.` };
    }
    case "in_stock": {
      // Precedence (§3.1): JSON-LD Offer.availability → variants (incl. the `.js`
      // fallback merged at fetch time). Only a genuine absence of BOTH is an
      // access limit — and then the reason is specific.
      const checked = ["structured data", "variant options"];
      if (p.ldAvailability) {
        const a = p.ldAvailability.toLowerCase();
        if (/instock|limitedavailability|onlineonly|instoreonly/.test(a)) {
          return { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: "Your structured data marks this product in stock.", evidenceSurface: "structured data" };
        }
        if (/outofstock|soldout|discontinued/.test(a)) {
          return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Your structured data marks this product out of stock." };
        }
        if (/preorder|backorder/.test(a)) {
          return { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Your structured data marks this product as pre-order, not immediately purchasable." };
        }
      }
      if (p.variants.length) {
        return p.variants.some((v) => v.available)
          ? { label: req.label, status: "pass_evidenced", surfacesChecked: checked, detail: "At least one variant is listed as purchasable.", evidenceSurface: "variant options" }
          : { label: req.label, status: "not_proven", surfacesChecked: checked, detail: "Checked the public variant list — no variant shows as available." };
      }
      return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: accessDetail(p, "This product exposes no availability data publicly.") };
    }
    case "no_subscription": {
      const checked = textSurfaces(p);
      // Same PRODUCT-surface + lint filter as the claim and attribute rows. This row
      // searched `p.evidence` raw — no surface filter and not even the lint pre-filter —
      // which was undocumented and unintentional.
      //
      // ✅ G-08 names `no_subscription` alongside `delivery` as reading `p.evidence`
      // raw. That half was ALREADY CLOSED here by v2.9's policy-surface work, before
      // the gap was written up; only `delivery` was still exposed at v3.0. Recorded so
      // a future session reading ENGINE_GAPS.md does not go looking for a second fix. Two consequences: a subscription
      // sentence in the SHIPPING POLICY ("Subscribe & save on every delivery") is a
      // statement about the store's ordering options, not about whether THIS product can
      // be bought once; and an unlintable policy sentence could refuse the whole report.
      const quotable = p.evidence.filter((e) => e.surface !== "shipping_policy" && lintStrings([e.text]).ok);
      const hard = findSupport(quotable, SUBSCRIPTION_REQUIRED);
      if (hard) {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: "Your public copy indicates a subscription is required.",
          evidenceQuote: hard.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hard.surface],
        };
      }
      // Absence of a blocker is NOT positive proof — it gets its own weaker state.
      return {
        label: req.label, status: "pass_no_blocking", surfacesChecked: checked,
        detail: "Nothing in your public product data requires a subscription. This is the absence of a blocker, not a stated one-time-purchase option.",
      };
    }
    case "attribute": {
      // A requirement naming an attribute with no spec is a programming error, not a
      // merchant's problem. Say so: when `origin` was removed in v2.8 CP2 the bare `!`
      // turned three stale call sites into "Cannot read properties of undefined
      // (reading 'shipmentVeto')", which names neither the attribute nor the cause.
      // v3.1 CP1 — this used to THROW. Naming the attribute was the right instinct
      // and killing the run was not: `runAuthenticatedTest` maps `evaluate` over the
      // pinned contract with no per-row guard, so one stale requirement destroyed
      // every other row's verdict. It is now loud in the log and honest in the table.
      const spec = ATTRIBUTE_SPECS[req.attribute!];
      if (!spec) return unsupportedRow(p, req, `unknown attribute '${req.attribute}' — no ATTRIBUTE_SPECS entry (was it removed?)`);
      // PRODUCT surfaces only. The shipping policy is evidence about ORDERS, not
      // about this product, and matching attributes there produces false passes —
      // measured, not hypothesised: "Size, capacity or weight is stated" passed a
      // real store on "If an order exceeds 150 lbs, it will be delivered via
      // freight." That sentence says nothing about the product's weight. Delivery
      // is the one requirement whose subject genuinely IS the shipping policy, and
      // it reads `p.evidence` directly.
      // Also drop any sentence we could not legally show. The claim linter runs over
      // `evidenceQuote` as a final gate and BLOCKS the whole result when it trips —
      // returning `errorKind: "unreachable"` for a store we read perfectly well. A
      // merchant's own wording must never be able to do that, so an unquotable
      // sentence is skipped here and the search continues. Fail closed per ROW
      // (not_proven if nothing clean is found), never fail the whole report.
      const productEvidence = p.evidence.filter(
        (e) => e.surface !== "shipping_policy" && lintStrings([e.text]).ok,
      );
      const checked = textSurfaces({ ...p, evidence: productEvidence });
      // Two further gates, both from measured false passes:
      //
      //  • SUBJECT-BEFORE veto. `passesAboutness` only inspects the noun AFTER the
      //    term, but composition and origin frames put their subject in FRONT of it
      //    — so "Our packaging is made from 100% recycled cardboard" and "Our
      //    shipping boxes are made in the USA" read as product facts. Excluding the
      //    shipping-policy SURFACE does not help: merchants routinely inline the
      //    same sentence in the product body.
      //  • VALUE guard. A term occurring is not the attribute being stated.
      const hit = findAttributeSupport(productEvidence, spec);
      if (hit) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          // Attributes are commonly stated in a spec BLOCK ("Dimensions: 11.42W x
          // 18.9H … Capacity: 20 L"), which `presentableQuote` rejects as symbol
          // soup — correctly, it is not a sentence. The match is still real, so the
          // row says where it found it and why there is nothing to quote, rather
          // than passing with a silently empty evidence slot.
          detail: hit.quote
            ? `Stated in your ${SURFACE_LABEL[hit.surface]}.`
            : `Stated in your ${SURFACE_LABEL[hit.surface]}, in a specification block rather than a sentence we can quote.`,
          evidenceQuote: hit.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hit.surface],
        };
      }
      // A degraded fetch means we never got to look — reporting "you don't publish
      // this" would be an accusation rather than a finding (§2.3).
      if (p.diagnostics?.degraded) {
        return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: THROTTLED_DETAIL };
      }
      return {
        label: req.label, status: "not_proven", surfacesChecked: checked,
        detail: `Checked ${listPhrase(checked)} — ${spec.missingDetail}.`,
      };
    }
    case "identifiers": {
      // Structural: read from JSON-LD, never from prose. But "structural" is NOT the
      // same as "cannot false-pass" — an earlier comment here claimed exactly that
      // and was wrong. `signals.gtin/mpn` are set for ANY non-empty string, so
      // `mpn: "N/A"`, `"TBD"`, `"-"` and `gtin: "0"` all read as a published
      // identifier, while the row's own copy promises a machine buyer can match the
      // product to a catalogue entry. The VALUE has to be plausible.
      const checked = ["structured data"];
      if (!p.extracted) {
        return { label: req.label, status: "requires_store_access", surfacesChecked: checked, detail: accessDetail(p, "We couldn't read this product's page markup to check for structured identifiers.") };
      }
      const info = p.extracted.product;
      const gtinRaw = (info?.gtin ?? "").trim();
      const mpnRaw = (info?.mpn ?? "").trim();
      // v3.5 CP2b — RULE D. An `mpn` that is byte-identical to the storefront's own
      // record key for this product is disqualified. Licensed by Coffee Standard v1.3,
      // which added the clause; the standard defines the requirement, the engine
      // implements it, in that order.
      //
      // Why THIS rule and not the obvious one: four candidate discriminators were
      // scored over the 36 mpn-publishing products in the captured corpus.
      //   A  mpn === sku                         0% precision, 0 TP, 7 compliant merchants FAILED
      //   B  same value in ANY id-shaped field   88.5%, 3 FP
      //   B′ same value in a STRONG id field     95.8%, 1 FP
      //   C  all-digits 10-14, fails check digit 100% / 95.7% — but its clean sheet is
      //                                          luck: it misses necessaire.com, whose
      //                                          key satisfies GS1 by coincidence, and
      //                                          MPN is not GTIN
      //   D  mpn === bootstrap product id        100% / 100%, 0 compliant merchants failed
      // Rule A is the one an earlier writeup pointed at ("sku":"100754","mpn":"100754"
      // adjacent). It convicts exactly the COMPLIANT case: a brand that manufactures
      // what it sells legitimately uses one string for both, and one of the seven is a
      // real published part number while another is a VALID GTIN.
      //
      // ⚠️ FAILS OPEN. `storefrontObjectId` is null whenever we could not decide, and
      // null disqualifies nothing.
      const storefrontId = p.storefrontObjectId;
      const mpnIsStorefrontKey = mpnRaw.length > 0 && storefrontId != null && mpnRaw === storefrontId;
      const realMpn = !isPlaceholderIdentifier(mpnRaw) && !mpnIsStorefrontKey;
      // Separator normalisation, check digit and the all-zeros rejection all live in
      // `isPublishableGtin` so the authenticated path can select a variant barcode by
      // the SAME rule this row judges it by (v3.0 CP3 / G-07).
      const realGtin = isPublishableGtin(gtinRaw);
      const named: string[] = [];
      const bare: string[] = [];
      if (realGtin) { named.push(`a GTIN (${gtinRaw})`); bare.push("a GTIN"); }
      if (realMpn) { named.push(`an MPN (${mpnRaw})`); bare.push("an MPN"); }
      if (named.length) {
        // ⚠️ NO PROVENANCE CLAUSE, because there is no longer any provenance to state:
        // `selectGtin` reads the product node and nothing else (v3.5 CP2c). CP2a added a
        // caveat naming an offer- or variant-sourced GTIN; reverting the descent made it
        // unreachable, and an unreachable branch that renders merchant-facing copy is a
        // sentence nobody can test. If the descent ever returns, the caveat returns with
        // it — see the tombstone on `selectGtin`.
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: renderIdentifierDetail(
            `Your structured data publishes ${listPhrase(named)}.`,
            `Your structured data publishes ${listPhrase(bare)}, but we can't reproduce the value here — it contains wording our reporting standard doesn't allow us to repeat.`,
          ),
          evidenceSurface: "structured data",
        };
      }
      // ⚠️ THE DISQUALIFICATION HAS TO BE VISIBLE. Falling through to the generic
      // "publishes no GTIN or MPN" would be FALSE about a store that publishes an MPN,
      // and it would hide the decision from exactly the audit that has to catch it: a
      // row whose rendered evidence names nothing is a row nobody can check. This
      // branch names the value AND the reason, under the same per-ROW lint gate as the
      // pass copy — a merchant's own string must never fail their whole report.
      //
      // ⚠️ v3.5 CP3 — AND IT MUST NOT ASSERT AN ABSENCE WE NEVER ESTABLISHED. This
      // sentence used to open "The only identifier in your product structured data is
      // an MPN (…)" and close "so a machine buyer can't match this product to a
      // catalogue entry". Measured over the 23 real stores rule D newly fails
      // (`experiments/v3-5/ship_pivot.ts`: DEFECTS_FOUND, 23/23 examined, 0 snapshots
      // missing, two-sided canary passing), SIX of them publish a check-digit-valid
      // GTIN in their own JSON-LD — flybyjing, monos, negativeunderwear, nomatic,
      // wandpdesign, yellowbirdsauce — just not on the node this engine reads. On all
      // six the value hangs off a DIFFERENT Product node, so this is node selection
      // (ENGINE_GAPS P-12) and not the reverted descent: at `d151876`, with the wide
      // descent live, every one of the six still named the MPN. For those six, both
      // clauses of the old sentence were flatly false.
      //
      // The STATUS is right and does not change: `conflict_rules[1]` of
      // ALS-COFFEE-1.3-IDENT-001 says "the engine reads the product-level node only;
      // per-variant identity is a known limitation published as a blocked entry". So
      // the defect is the SENTENCE. It now says where we read and what that excludes.
      //
      // ⚠️ ONE SENTENCE FOR BOTH MERCHANTS, DELIBERATELY. The engine does not look
      // below the product node, so it cannot tell the store that publishes nothing else
      // from the store that publishes six GTINs one node down — and copy that branched
      // on a distinction we never measured would be the same defect with better
      // grammar. The corpus pins the identical string on both shapes.
      if (mpnIsStorefrontKey && !realGtin) {
        // The reach limit, stated once so the two lint variants cannot drift apart.
        const readLimit =
          " We read that node only, so a GTIN published beneath it on an offer or a variant is not counted here.";
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: renderIdentifierDetail(
            `The only identifier we can use on your product's own structured-data node is an MPN (${mpnRaw}), and that is the id your own storefront uses for this product — it resolves to nothing outside your store.${readLimit}`,
            `The only identifier we can use on your product's own structured-data node is an MPN that is the id your own storefront uses for this product — it resolves to nothing outside your store.${readLimit}`,
          ),
        };
      }
      return {
        label: req.label, status: "not_proven", surfacesChecked: checked,
        detail: p.extracted.signals.productSchema
          ? "Your product structured data publishes no GTIN or MPN, so a machine buyer can't match this product to a catalogue entry."
          : "This product publishes no Product structured data, so there is no GTIN or MPN for a machine buyer to read.",
      };
    }
    case "delivery": {
      const checked = textSurfaces(p);
      // G-08 — DROP ANY SENTENCE WE COULD NOT LEGALLY SHOW, exactly as the claim and
      // attribute rows do. The claim linter runs over `evidenceQuote` as a final gate
      // and BLOCKS THE WHOLE RESULT when it trips, returning errorKind "unreachable"
      // for a store we read perfectly well. This row read `p.evidence` raw, so a
      // shipping policy saying "Delivery guaranteed within 3 business days" refused
      // the merchant's entire report — a flatly false statement about their store,
      // reproduced as a fixture before this line existed (10 rows -> 0).
      //
      // This is the identical failure class the `warranty` requirement was DROPPED
      // for in v2.3. The rule was already written in the attribute branch's comment
      // and simply was not applied here: fail closed per ROW, never fail the report.
      //
      // ⚠️ NO SURFACE FILTER, and that asymmetry is deliberate rather than an
      // oversight. Claim and attribute rows also exclude `shipping_policy` because a
      // statement about ORDERS is not a statement about the PRODUCT. Delivery is the
      // one requirement whose subject genuinely IS the shipping policy, so excluding
      // it would delete the row's best evidence. Only the lint filter applies.
      const quotable = p.evidence.filter((e) => lintStrings([e.text]).ok);
      const hit = findTimingSupport(quotable);
      if (hit) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: `Delivery timing is stated in your ${SURFACE_LABEL[hit.surface]}.`,
          evidenceQuote: hit.quote ?? undefined, evidenceSurface: SURFACE_LABEL[hit.surface],
        };
      }
      // We READ the shipping policy but it states no window → a real, actionable
      // finding, not a shrug. Only an unreadable policy is an access limit (§3.2).
      if (p.policyStatus === "readable") {
        return {
          label: req.label, status: "not_proven", surfacesChecked: checked,
          detail: "Checked your product data and shipping policy — neither states a delivery window an AI buyer can read.",
        };
      }
      return {
        label: req.label, status: "requires_store_access", surfacesChecked: checked,
        detail: p.policyStatus === "robots_disallowed"
          ? "Your shipping policy asks automated tools not to read it, so we can't check delivery timing from public data."
          : p.policyStatus === "rate_limited"
          ? THROTTLED_DETAIL
          : accessDetail(p, "No delivery timing in your public product data, and your shipping policy page couldn't be read publicly."),
      };
    }
  }
}

// ---- semantic tier bridge (§5) ----------------------------------------------

/** Apply the bounded semantic tier to claim requirements the lexical pass left
 *  unresolved. Grants require a verbatim quote; `about_other_subject` can withdraw
 *  a lexical match. Any failure leaves `assertions` untouched (fail closed+silent). */
async function applySemanticTier(
  p: PublicProduct,
  requirements: Requirement[],
  assertions: Assertion[],
  deps: RunOptions,
): Promise<{ assertions: Assertion[]; stats: SemanticStats | undefined }> {
  const byLabel = new Map(requirements.map((r) => [r.label, r]));
  // Only unresolved CLAIM requirements are eligible.
  const unresolved = assertions
    .map((a, i) => ({ a, i, r: byLabel.get(a.label) }))
    .filter((x) => x.r?.kind === "claim" && x.a.status === "not_proven" && x.r?.claim);
  // Lexically-matched claims are eligible for a VETO only.
  const matched = assertions
    .map((a, i) => ({ a, i, r: byLabel.get(a.label) }))
    .filter((x) => x.r?.kind === "claim" && x.a.status === "pass_evidenced" && x.r?.claim);

  if (!unresolved.length && !matched.length) return { assertions, stats: undefined };
  const attributes = [...unresolved, ...matched].map((x) => ({ key: x.r!.claim!, label: x.a.label }));

  const outcome = await judgeClaims(p.evidence, attributes, deps.semantic ?? {});
  if (!outcome.stats.called) return { assertions, stats: undefined };

  const next = [...assertions];
  for (const g of outcome.grants) {
    const target = unresolved.find((x) => x.r!.claim === g.attribute);
    if (!target) continue; // grants only ever promote an UNRESOLVED claim
    next[target.i] = {
      ...target.a,
      status: "pass_evidenced",
      detail: `Stated in your ${g.surfaceLabel}.`,
      evidenceQuote: g.quote,
      evidenceSurface: g.surfaceLabel,
    };
  }
  for (const attr of outcome.vetoes) {
    const target = matched.find((x) => x.r!.claim === attr);
    if (!target) continue; // vetoes only ever withdraw a LEXICAL match
    next[target.i] = {
      ...target.a,
      status: "not_proven",
      detail: `Checked ${listPhrase(target.a.surfacesChecked)} — the matching text is about something else, not this product.`,
      evidenceQuote: undefined,
      evidenceSurface: undefined,
    };
  }
  console.log(JSON.stringify({
    at: "semantic_tier", granted: outcome.stats.granted, vetoed: outcome.stats.vetoed,
    discarded: outcome.stats.discarded, costUsd: Number(outcome.stats.costUsd.toFixed(5)),
    cumulativeUsd: Number(semanticSpendUsd().toFixed(5)), error: outcome.stats.error ?? null,
  }));
  return { assertions: next, stats: outcome.stats };
}

// ---- orchestration + result assembly ----------------------------------------
export interface ProductTestResult {
  ok: boolean;
  error?: string;
  errorKind?: FetchErrorKind;
  productUrl: string;
  storeName: string | null;
  productName: string | null;
  task: string;
  assertions: Assertion[];
  /** State breakdown — evidenced passes are reported SEPARATELY from inferred ones. */
  evidencedCount: number;
  noBlockingCount: number;
  notProvenCount: number;
  requiresAccessCount: number;
  total: number;
  surfacesChecked: string[];
  notInspectable: string[];
  /** One line per `not_proven` requirement — the actionable list. */
  suggestedCorrections: string[];
  /** Kept for compatibility with the first rendered version (the first correction). */
  suggestedCorrection: string | null;
  /** Requirements public data can't decide, shown BELOW the table as the
   *  "what authenticated testing adds" argument rather than as blind rows. */
  deferred: Assertion[];
  /** Semantic-tier accounting (grants/discards/cost) — surfaced for diagnosis. */
  semantic?: SemanticStats;
  /** Set when served from cache (ISO timestamp of the original run). */
  testedAt?: string;
  cached?: boolean;
  /** True when a fetch tier was refused and the test ran on partial data (§2.3).
   *  The affected rows carry their own accurate reason; this drives the banner. */
  degraded?: boolean;
  /** Which tier supplied the product node, and which tiers were refused (§2.1).
   *  Reported for production diagnosis of the upstream throttle. */
  fetchTier?: "page" | "json" | null;
  throttledTiers?: string[];
  /**
   * Egress diagnosis (v2.2 CP5.1). `rate_limited` on its own is unactionable: it can
   * mean Shopify's per-IP limit on the `/products/*` path class (which egress diversity
   * would move), the host's own bot management (which it would not), one of OUR budgets,
   * or our 10-minute negative cache echoing an earlier refusal. These three fields
   * separate those cases, so the moment the throttle rate moves we know which remedy
   * applies instead of guessing. See EGRESS_DECISION.md, open recommendation #1.
   */
  robotsStatus?: "ok" | "refused" | "unreachable" | "cached" | "not_fetched";
  throttleSource?: "upstream" | "our_budget" | "our_cooldown" | null;
  /** How the shipping-policy fetch went, when the task needed one. */
  policyStatus?: "not_fetched" | "readable" | "unreachable" | "robots_disallowed" | "rate_limited";
  /** The error is an upstream limit, not a verdict — the UI offers a retry (§2.3). */
  retryable?: boolean;
  /** V2 CP2 — the token that carries THIS result through install, so the first
   *  authenticated screen is the merchant's own test continued. */
  testToken?: string;
  /** v3.0 CP4 — which published standard this result was tested against, when one was
   *  supplied. Absent on a generated task, which is the honest signal that the questions
   *  came from the engine's heuristic rather than from a citable public text. */
  standard?: StandardIdentity;
  /** The contract fingerprint. Only set on a standard-pinned run; a generated public run
   *  has never carried one and gaining one would change nothing but the payload. */
  contractVersion?: string;
}

export interface RunOptions extends FetchDeps {
  /** Explicit "Run again": bypasses the cache at most once per hour per URL. */
  force?: boolean;
  /** Injectable semantic-tier transport (tests never hit the network). */
  semantic?: SemanticDeps;
  /**
   * G-09 (v3.0 CP4) — A PINNED CONTRACT FOR THE PUBLIC PATH.
   *
   * Without this there is no way to ask a public URL a fixed set of questions: the
   * requirements were generated per product by `buildBuyerTask`, which is exactly the
   * vendor's private rubric a published standard exists to replace. `runAuthenticatedTest`
   * has accepted a pinned contract since v2 CP2, so a standard could be executed against a
   * CONNECTED store and not against a public URL — an asymmetry, not a design.
   *
   * The pure evaluator is shared, so this is plumbing. `buildBuyerTask` still runs: its
   * `summary` is a linted, merchant-visible string and must stay.
   */
  requirements?: Requirement[];
  /** Identity of the published standard `requirements` were compiled from. Without it a
   *  conformance result cannot say WHICH text it was tested against, and the whole
   *  standards position is decorative. Folded into `contractVersion`. */
  standard?: StandardIdentity;
}

export async function runProductTest(url: string, deps: RunOptions = {}): Promise<ProductTestResult> {
  const base: ProductTestResult = {
    ok: false, productUrl: url, storeName: null, productName: null, task: "",
    assertions: [], evidencedCount: 0, noBlockingCount: 0, notProvenCount: 0, requiresAccessCount: 0,
    total: 0, surfacesChecked: [], notInspectable: [], suggestedCorrections: [], suggestedCorrection: null, deferred: [],
  };

  // Serve from cache first — the cheapest request is the one we never make.
  //
  // ⚠️ A PINNED RUN NEVER TOUCHES THE CACHE, in either direction. The cache is keyed
  // on the normalised URL alone, so without this a standard-pinned result would be
  // served to the public funnel for the same product — a merchant would be shown a
  // conformance table against a standard they never asked about — and, in reverse, a
  // conformance run would silently return a generated 10-row task. The key predates
  // any notion of a contract; scoping the cache by contract fingerprint would be the
  // richer fix and is not needed while pinned runs are measurement runs.
  const cacheKey = deps.requirements?.length ? null : normalizeProductUrl(url);
  if (cacheKey) {
    const cached = getCachedResult(cacheKey, deps);
    if (cached) return cached;
  }

  const { product: fetched, error, ctx, diagnostics } = await fetchPublicProduct(url, deps);
  if (!fetched) {
    return {
      ...base, error: error?.message, errorKind: error?.kind,
      // An upstream limit is not a verdict on the store — the UI offers a retry (§2.3).
      retryable: error?.kind === "rate_limited" || error?.kind === "unreachable",
      throttledTiers: diagnostics?.throttled,
      // The failure path is where the split matters most — there is no product to
      // read it off, so it comes from the diagnostics the fetcher carried out.
      robotsStatus: diagnostics?.robots,
      throttleSource: diagnostics?.throttleSource ?? null,
    };
  }

  // `buildBuyerTask` ALWAYS runs, even when a standard supplies the requirements: its
  // `summary` is the first line the merchant reads, it is claim-linted, and a standard
  // has no equivalent. Only the requirement LIST is replaced.
  const generated = buildBuyerTask(fetched);
  const pinned = deps.requirements?.length ? deps.requirements : null;
  const requirements = pinned ?? generated.requirements;
  const summary = generated.summary;

  // ONE extra fetch, only when the task actually needs delivery timing (§3.2).
  //
  // ⚠️ CONFIRMED, NOT ASSUMED (the gaps doc asked for exactly this): the trigger reads
  // the EFFECTIVE requirement list, so a standard carrying a `delivery` entry still
  // fetches the policy. Pinned by a test — had this kept reading `generated`, every
  // standard's delivery row would have silently answered from product copy alone.
  let product = fetched;
  if (ctx && requirements.some((r) => r.kind === "delivery")) {
    product = await attachShippingPolicy(fetched, ctx);
  }

  let assertions = requirements.map((r) => evaluate(product, r));

  // Semantic tier (§5): one batched model call for claim requirements the lexical
  // pass could not resolve. Grants require a verbatim quote; failures are silent.
  const semantic = await applySemanticTier(product, requirements, assertions, deps);
  assertions = semantic.assertions;

  // §4.2 — at most ONE "requires store access" row in the table. The rest move
  // below it, where they read as the install argument rather than a blind spot.
  //
  // ⚠️ v3.0 CP4 — THIS COLLAPSE IS DISABLED FOR A STANDARD-PINNED RUN, deliberately.
  // It is a RENDERING rule, and it is the right one for a generated 10-row task: a
  // column of blind spots reads as an accusation and buries the findings. A
  // conformance result is a different artifact. A reader checking a page against
  // ALS-COFFEE-1.0 wants every assertion the standard makes, each with its own
  // verdict — a result that silently moves eight of ten entries "below the table" is
  // not a conformance list, and a citation like "fails ALS-COFFEE-1.0-IDENT-001"
  // cannot resolve against a row that was collapsed away. Nothing is hidden and
  // `deferred` stays empty; the honest per-row states do all the work.
  const kindOf = (a: Assertion) => requirements.find((r) => r.label === a.label)?.kind;
  const deferred: Assertion[] = [];
  if (!pinned) {
    let accessShown = 0;
    assertions = assertions.filter((a) => {
      if (a.status !== "requires_store_access") return true;
      if (accessShown === 0) { accessShown++; return true; }
      deferred.push(a);
      return false;
    });
  }
  const count = (s: AssertionStatus) => assertions.filter((a) => a.status === s).length;

  // FLOOR (v2.3 CP3): below a minimum of actually-read data, say so plainly.
  //
  // The v2.2 sample had one store return `ok: true` with no answering fetch tier,
  // one surface checked and zero proven rows — a test that ran on almost nothing
  // and reported as though it had run. v2.3 makes that strictly worse: with 8–10
  // requirements instead of 4–6, a store we could barely read now produces a long
  // column of "not stated" rows built on no evidence. That is the difference
  // between a finding and an accusation, at scale.
  //
  // The floor is deliberately about INPUT (did we read a product surface?) and
  // ONLY about input. Two rejected alternatives, both of which look like better
  // safety nets and are not:
  //   • "no passes at all" is DEAD as a condition — `no_subscription` is always a
  //     candidate and returns pass_no_blocking unless a subscription blocker is
  //     found, so the count is ~never zero. It would read as a guard and never fire.
  //   • "no pass_evidenced" would fire, but on the wrong cases: a store we read
  //     perfectly well that genuinely states none of it is a REAL result — the
  //     harshest one the tool produces — and suppressing it would be dishonest in
  //     the merchant's favour.
  const readSomething =
    product.evidence.length > 0 ||
    Boolean(product.extracted?.hasProductSchema) ||
    product.variants.length > 0 ||
    product.minPriceUsd != null;
  if (!readSomething) {
    return {
      ...base,
      error:
        "We couldn't read enough of this store's public data to run a meaningful test — " +
        "not enough of the product page, structured data or variants was readable. " +
        "That's a limit on what we could see, not a finding about this product.",
      errorKind: "unreachable",
      retryable: true,
      throttledTiers: product.diagnostics?.throttled,
      robotsStatus: product.diagnostics?.robots,
      throttleSource: product.diagnostics?.throttleSource ?? null,
    };
  }

  const notInspectable = ["product metafields"];
  if ([...assertions, ...deferred].some((a) => a.status === "requires_store_access" && /ship|deliver/i.test(a.label))) {
    notInspectable.push("full shipping & returns policy");
  }

  // ONE correction line per not_proven requirement (§2), phrased per requirement kind.
  const suggestedCorrections = assertions
    .filter((a) => a.status === "not_proven")
    .map((a) => {
      switch (kindOf(a)) {
        case "claim":
          return `Confirm whether this product is ${a.label.toLowerCase()}. If it is, state it in a product field and in customer-readable copy so an AI buyer can verify it.`;
        case "delivery":
          return "State a delivery window (for example \"ships within 2 business days\") in your shipping policy or on the product page.";
        case "in_stock":
          return "Expose availability publicly — structured data with an in-stock offer, or a purchasable variant an AI buyer can read.";
        case "variant_option":
          return `Make the "${a.label.replace(/ option available$/, "")}" option visible and purchasable in your public variant list.`;
        case "no_subscription":
          return "State plainly that a one-time purchase is available, so an AI buyer doesn't have to infer it.";
        case "price_under":
          return `Your lowest readable price doesn't meet this buyer's cap — no evidence change needed, this is a pricing fact.`;
        default:
          return `State ${a.label.toLowerCase()} in a form an AI buyer can verify.`;
      }
    });
  const suggestedCorrection = suggestedCorrections[0] ?? null;

  // BLOCKING honesty gate: every merchant-visible string must clear the claim
  // linter. A result that can't meet the standard is not rendered (§7.10) — a
  // copy regression fails loudly here rather than shipping an overclaim.
  const lint = lintStrings([
    summary, ...suggestedCorrections,
    ...[...assertions, ...deferred].flatMap((a) => [a.label, a.detail, a.evidenceQuote]),
  ]);
  if (!lint.ok) {
    console.error(`[product-test] result BLOCKED by claim linter: ${lint.violations.map((v) => `${v.rule}: "${v.excerpt}"`).join(" | ")}`);
    return {
      ...base,
      error: "We couldn't produce a result that meets our reporting standard for this product.",
      errorKind: "unreachable",
    };
  }

  const result: ProductTestResult = {
    ok: true, productUrl: url,
    storeName: product.vendor ?? new URL(product.origin).host.replace(/^www\./, ""),
    productName: product.title, task: summary, assertions,
    evidencedCount: count("pass_evidenced"),
    noBlockingCount: count("pass_no_blocking"),
    notProvenCount: count("not_proven"),
    requiresAccessCount: count("requires_store_access"),
    total: assertions.length,
    surfacesChecked: textSurfaces(product),
    notInspectable,
    suggestedCorrections,
    suggestedCorrection,
    deferred,
    semantic: semantic.stats,
    degraded: product.diagnostics.degraded,
    fetchTier: product.diagnostics.answeredBy,
    throttledTiers: product.diagnostics.throttled,
    robotsStatus: product.diagnostics.robots,
    throttleSource: product.diagnostics.throttleSource,
    policyStatus: product.policyStatus,
    // v3.0 CP4 — a conformance result must be able to name the exact text it was
    // tested against, or a citation cannot resolve. Set only on a pinned run.
    ...(pinned ? { contractVersion: contractVersion(requirements, deps.standard) } : {}),
    ...(deps.standard ? { standard: deps.standard } : {}),
  };
  // A degraded result is deliberately NOT cached: it is missing surfaces we would
  // normally read, and pinning it for 7 days would turn a transient upstream block
  // into a week-long wrong answer.
  if (cacheKey && !product.diagnostics.degraded) storeResult(cacheKey, result, deps);
  return result;
}
