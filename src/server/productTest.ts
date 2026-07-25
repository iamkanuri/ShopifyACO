import { safeFetch } from "../crawler/fetch.js";
import { validateUrl } from "../crawler/ssrf.js";
import { extractPage, extractJsonLd, type ExtractedPage } from "../crawler/extract.js";
import { htmlToText } from "../crawler/sanitize.js";
import { parseRobots, isAllowedByRobots, type RobotsPolicy } from "../crawler/robots.js";
import {
  buildEvidence, findSupport, findViolation, findTimingSupport, normalize,
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
const MEASUREMENT = /(\b\d+(\.\d+)?\s?(mm|cm|inch|inches|in\b|ft|feet|foot|oz|ounces?|ml|l\b|liters?|litres?|g\b|kg|grams?|lbs?|pounds?)|\b(dimensions?|capacity|weight|height|width|length|diameter)\s*[:\-–]\s*\d)/i;

// ---- place detection (v2.5 CP1) ---------------------------------------------
//
// REPLACED: a capitalisation heuristic. It required a capital letter after the
// origin frame, which is not a property of places — it is a property of Title Case.
// Measured wrong in BOTH directions across 132 probes:
//   • "Made in Very Small Batches." / "Made in Heaven, worn on Earth." /
//     "Roasted in Our Roastery" / "Country of origin: Unknown"  → read as countries;
//   • "made in vermont" (ordinary lowercase copy) and the very common spec label
//     "Origin: Italy"                                          → read as no origin.
//
// A gazetteer is right far more often than a capital letter, is case-insensitive
// in both directions, and — unlike the heuristic — is auditable: you can read the
// list and see exactly what the tool will and will not accept as a place.
// Deliberately a CLOSED list. An open rule is what let "Heaven" through.

const COUNTRIES = [
  "afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia", "australia",
  "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belgium",
  "belize", "benin", "bhutan", "bolivia", "bosnia", "botswana", "brazil", "brunei", "bulgaria",
  "burkina faso", "burundi", "cambodia", "cameroon", "canada", "chad", "chile", "china",
  "colombia", "congo", "costa rica", "croatia", "cuba", "cyprus", "czechia", "czech republic",
  "denmark", "dominican republic", "ecuador", "egypt", "el salvador", "estonia", "eswatini",
  "ethiopia", "fiji", "finland", "france", "gabon", "gambia", "georgia", "germany", "ghana",
  "greece", "guatemala", "guinea", "guyana", "haiti", "honduras", "hungary", "iceland", "india",
  "indonesia", "iran", "iraq", "ireland", "israel", "italy", "ivory coast", "cote d'ivoire",
  "côte d'ivoire", "jamaica", "japan", "jordan", "kazakhstan", "kenya", "kosovo", "kuwait",
  "kyrgyzstan", "laos", "latvia", "lebanon", "lesotho", "liberia", "libya", "liechtenstein",
  "lithuania", "luxembourg", "madagascar", "malawi", "malaysia", "maldives", "mali", "malta",
  "mauritania", "mauritius", "mexico", "moldova", "monaco", "mongolia", "montenegro", "morocco",
  "mozambique", "myanmar", "namibia", "nepal", "netherlands", "holland", "new zealand",
  "nicaragua", "niger", "nigeria", "north macedonia", "norway", "oman", "pakistan", "palestine",
  "panama", "papua new guinea", "paraguay", "peru", "philippines", "poland", "portugal", "qatar",
  "romania", "russia", "rwanda", "samoa", "saudi arabia", "senegal", "serbia", "sierra leone",
  "singapore", "slovakia", "slovenia", "somalia", "south africa", "south korea", "korea",
  "south sudan", "spain", "sri lanka", "sudan", "suriname", "sweden", "switzerland", "syria",
  "taiwan", "tajikistan", "tanzania", "thailand", "togo", "trinidad", "tunisia", "turkey",
  "türkiye", "turkmenistan", "uganda", "ukraine", "united arab emirates", "united kingdom",
  "great britain", "britain", "england", "scotland", "wales", "northern ireland",
  "united states", "united states of america", "america", "uruguay", "uzbekistan", "venezuela",
  "vietnam", "yemen", "zambia", "zimbabwe",
];

/** Abbreviations and demonyms that only ever denote a country in this position. */
const COUNTRY_SHORT = ["usa", "u.s.a.", "u.s.", "us", "uk", "u.k.", "eu", "uae", "prc", "nz", "roc"];

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming",
];

/** Sub-national regions and cities common in origin copy. Kept short on purpose:
 *  a city list is unbounded, and the frame plus a country covers most real copy. */
const REGIONS = [
  "bavaria", "tuscany", "catalonia", "provence", "normandy", "andalusia", "piedmont", "sicily",
  "yorkshire", "cornwall", "ontario", "quebec", "british columbia", "tasmania", "hokkaido",
  "kyoto", "okinawa", "seoul", "tokyo", "milan", "florence", "paris", "london", "berlin",
  "lisbon", "porto", "oaxaca", "jalisco", "antioquia", "yunnan", "kerala", "rajasthan",
  "sheffield", "solingen", "seki", "murano", "harris tweed", "new england", "pacific northwest",
  "scandinavia", "the alps", "the andes", "patagonia",
];

const PLACES = new Set([...COUNTRIES, ...COUNTRY_SHORT, ...US_STATES, ...REGIONS]);

/**
 * Gazetteer entries that are ALSO ordinary English words, a material, a person's
 * name or a product noun. These — and only these — must be capitalised to count.
 *
 * Measured: a case-insensitive gazetteer false-passed 27 of 40 non-origin sentences,
 * and the losses were concentrated here — "Made in china clay" (kaolin), "Made in
 * Turkey red dye", "Roasted in Jordan almonds", "Made in Georgia pine". Requiring a
 * capital on EVERY entry was the obvious fix and the wrong one: it re-broke lowercase
 * copy ("made in vermont"), which is exactly what the gazetteer was introduced to
 * recover. Scoping the requirement to the ambiguous entries keeps both.
 *
 * Still open, and pinned in the corpus rather than papered over: a CAPITALISED
 * ambiguous word followed by a material noun ("Made in Georgia pine") still passes.
 * Distinguishing that needs the head noun after the place, not more list surgery.
 */
const AMBIGUOUS_PLACE = new Set([
  "china", "turkey", "georgia", "jordan", "chad", "guinea", "wales", "washington",
  "virginia", "india", "morocco", "panama", "brunei", "cornwall", "mali", "niger",
  "togo", "oman", "florence", "milan", "paris", "berlin", "canada", "hungary",
  "montenegro", "malta", "kenya", "somalia", "columbia", "victoria", "sydney",
  "indiana", "montana", "nevada", "utah", "maine", "delaware", "jersey", "york",
]);
/** Longest place name in words — how far ahead `statesAPlace` has to look. */
const PLACE_MAX_WORDS = 4;

/**
 * Longest-first prefix lookup, so "new zealand" is tried before "new".
 *
 * `requireCap` is what stops the gazetteer being WORSE than the capitalisation
 * heuristic it replaced. Measured over 40 non-origin sentences, a case-insensitive
 * gazetteer false-passed 27 of them: every entry that is also an ordinary English
 * word matched in its ordinary sense — "Made in china clay" (kaolin), "Made in
 * Turkey red dye", "Roasted in Jordan almonds". Capitalisation had been suppressing
 * those incidentally.
 *
 * So the capital is required again — EXCEPT when the sentence carries no capitals at
 * all, which is what recovers the lowercase copy the heuristic used to lose
 * ("each mug is hand-thrown and made in vermont"). The signal is not "is this
 * capitalised" but "is this capitalised GIVEN that this writer capitalises".
 */
function startsWithPlace(words: string[], requireCap: boolean): boolean {
  for (let n = Math.min(PLACE_MAX_WORDS, words.length); n >= 1; n--) {
    // Keep any Unicode LETTER — a `[^a-z]` strip turned "côte d'ivoire" into
    // "cte d'ivoire" and lost a real country.
    const raw = words.slice(0, n).join(" ").replace(/[^\p{L}.'\s-]/gu, "").trim();
    const lower = raw.toLowerCase();
    if (!PLACES.has(lower)) continue;
    // Only the ambiguous entries have to earn their capital.
    if (requireCap && AMBIGUOUS_PLACE.has(lower) && !/^\p{Lu}/u.test(raw)) continue;
    return true;
  }
  return false;
}

/** Does the text after an origin frame name a real place? */
function statesAPlace(sentence: string, term: string): boolean {
  const lower = sentence.toLowerCase();
  const i = lower.indexOf(term.toLowerCase());
  if (i === -1) return false;
  // Strip the frame's OWN trailing separator before bounding the clause. Splitting
  // first cut "Country of Origin: Japan" at the colon and left nothing to inspect —
  // a regression the corpus caught immediately, on the canonical spec-label form.
  const tail = sentence.slice(i + term.length).replace(/^[\s:,\-–—]+/, "");
  // Only the frame's own CLAUSE counts. Scanning the whole sentence would credit
  // "Made in small batches, shipped from Vermont." with a country of origin, when
  // what it states is where it ships from — which need not be where it was made.
  const clause = tail.split(/[.,;:!?)(]/)[0] ?? "";
  const stripArticle = (s: string): string =>
    s.replace(/^[\s:,\-–—]+/, "").replace(/^(the|our|a|an|its|my|their)\s+/i, "");

  // Does this writer use capitals at all? If not, a lowercase place name is the
  // best evidence available and must still count.
  const requireCap = /\p{Lu}/u.test(sentence);

  const head = stripArticle(clause).trim().split(/\s+/).filter(Boolean);
  if (head.length && startsWithPlace(head, requireCap)) return true;

  // A second locative inside the same clause: "Handmade in small batches in
  // Vermont." names its origin, even though the word right after the frame is
  // "small". The clause bound above is what keeps this from over-reaching.
  for (const m of clause.matchAll(/\bin\s+/gi)) {
    const rest = stripArticle(clause.slice(m.index! + m[0].length)).trim().split(/\s+/).filter(Boolean);
    if (rest.length && startsWithPlace(rest, requireCap)) return true;
  }
  return false;
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
    valueGuard: (s) => MEASUREMENT.test(s),
    allowContainerSubject: true,
    shipmentVeto: true,
  },
  origin: {
    label: "Country of origin is stated",
    missingDetail: "no stated country of origin",
    terms: [
      "made in", "handmade in", "handcrafted in", "crafted in", "manufactured in", "assembled in",
      "produced in", "country of origin", "designed and made in", "grown in", "milled in", "roasted in",
      // The bare spec label. "Origin: Italy" is one of the commonest ways a store
      // states provenance and matched nothing before v2.5. The COLON is required:
      // without it this would match "single origin" coffee, which is a claim about
      // sourcing, not a stated country.
      "origin:",
    ],
    // "Made in small batches", "Roasted in small batches every Tuesday", "Grown in
    // partnership with local farms" and "Handmade in batches of twelve" all read as
    // a stated country of origin without this. A place is required.
    valueGuard: (s, term) => statesAPlace(s, term),
  },
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
    terms: [
      // "how to use" and "instructions for use" were REMOVED: they matched "Learn
      // how to use our rewards program in 3 steps", which is site chrome, not care.
      "machine wash", "machine-wash", "hand wash", "hand-wash", "dishwasher safe", "dishwasher-safe",
      "care instructions", "wipe clean", "tumble dry", "air dry", "spot clean", "do not bleach",
      "hand wash only", "season before", "dry flat", "do not tumble", "iron on low",
    ],
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
const priceToUsd = (p: string | number | undefined): number | null => {
  if (typeof p === "number") return Number.isFinite(p) ? (p > 1000 && Number.isInteger(p) ? p / 100 : p) : null; // cents-guard
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
  const variants: PublicVariant[] = (js?.variants ?? []).map((v) => ({
    title: v.title ?? "", priceUsd: priceToUsd(v.price), available: v.available !== false,
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
      vendor: js?.vendor ?? ld?.brand ?? null, productType: js?.product_type ?? ldCategory, tags,
      descriptionText, variants, minPriceUsd: prices.length ? Math.min(...prices) : (ld?.offer?.price ?? null),
      optionNames, optionValues, extracted, evidence, ldAvailability,
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
    // Policy pages are chrome-heavy; keep only the main text and cap it.
    const text = htmlToText(r.body).slice(0, 20_000);
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
  | "identifiers"; // GTIN/MPN in structured data — what a machine consumer needs
export interface Requirement {
  id: string; kind: ReqKind; label: string; claim?: string; capUsd?: number; optionValue?: string;
  /** Key into ATTRIBUTE_SPECS. Only set for `attribute` requirements. */
  attribute?: string;
}

// ---- contract + engine versioning (V2 §4.4) ---------------------------------
// A before/after comparison is only evidence if BOTH runs asked the same question
// of the same evaluator. If either changed, the honest answer is to refuse the
// comparison — not to show a diff that silently redefined itself in between.

/** Bump when the EVALUATOR's semantics change (a status could differ on identical
 *  input). Pure additions that cannot change an existing verdict don't need a bump. */
export const ENGINE_VERSION = "v2.0.0";

/** A stable fingerprint of a buyer task: same requirements ⇒ same version, in any
 *  process, forever. Deliberately covers only the fields that decide a verdict. */
export function contractVersion(requirements: Requirement[]): string {
  const canonical = requirements
    // `attribute` is appended ONLY when present, so every pre-v2.3 requirement
    // hashes to exactly the byte string it always did. Widening the tuple
    // unconditionally would have changed every stored contract's fingerprint at
    // once and made every saved before/after comparison refuse itself as "drifted".
    .map((r) => [r.kind, r.claim ?? "", r.capUsd ?? "", r.optionValue ?? "", ...(r.attribute ? [r.attribute] : [])].join(":"))
    .sort()
    .join("|");
  // FNV-1a — short, deterministic, dependency-free. Not a security hash: this
  // detects accidental drift, it does not defend against a forged contract.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `c1-${h.toString(16).padStart(8, "0")}`;
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
 *  2–4 failing, and a failing SET that differs between stores. */
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
  const SURFACE_PRIORITY = [
    "claim", "logistics", "attr:materials", "attr:dimensions", "machine",
    "price", "variant", "terms", "attr:origin", "attr:warranty", "attr:care",
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

export function evaluate(p: PublicProduct, req: Requirement): Assertion {
  switch (req.kind) {
    case "claim": {
      const fx = CLAIM_TERMS[req.claim!]!;
      const checked = textSurfaces(p);
      // Same protection the attribute rows get: a sentence we could not legally
      // render is skipped here, so a merchant whose copy happens to say
      // "guaranteed" never has their whole report refused as `unreachable`.
      const quotable = p.evidence.filter((e) => lintStrings([e.text]).ok);
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
      if (hit) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: `Stated in your ${SURFACE_LABEL[hit.surface]}.`,
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
      const hard = findSupport(p.evidence, SUBSCRIPTION_REQUIRED);
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
      const spec = ATTRIBUTE_SPECS[req.attribute!]!;
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
      const realMpn = !isPlaceholderIdentifier(mpnRaw);
      // Merchants publish GTINs with the separators printed on the barcode
      // ("0-36000-29145-2", "400 638 133 3931"). Those are the same number, and
      // rejecting them told stores that DO publish an identifier that they don't.
      // Normalised HERE rather than in `isValidGtin`, which is shared with the feed
      // validator — there the spec genuinely requires a digits-only value, so
      // loosening it would weaken a different, correct check.
      const gtinDigits = gtinRaw.replace(/[\s-]/g, "");
      // All-zeros passes the check-digit arithmetic (0 mod 10 === 0) and is the
      // commonest "I had to put something in the field" value there is.
      const realGtin = isValidGtin(gtinDigits) && !/^0+$/.test(gtinDigits);
      const have = [realGtin ? "GTIN" : null, realMpn ? "MPN" : null].filter(Boolean) as string[];
      if (have.length) {
        return {
          label: req.label, status: "pass_evidenced", surfacesChecked: checked,
          detail: `Your structured data publishes ${listPhrase(have)}.`, evidenceSurface: "structured data",
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
      const hit = findTimingSupport(p.evidence);
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
}

export interface RunOptions extends FetchDeps {
  /** Explicit "Run again": bypasses the cache at most once per hour per URL. */
  force?: boolean;
  /** Injectable semantic-tier transport (tests never hit the network). */
  semantic?: SemanticDeps;
}

export async function runProductTest(url: string, deps: RunOptions = {}): Promise<ProductTestResult> {
  const base: ProductTestResult = {
    ok: false, productUrl: url, storeName: null, productName: null, task: "",
    assertions: [], evidencedCount: 0, noBlockingCount: 0, notProvenCount: 0, requiresAccessCount: 0,
    total: 0, surfacesChecked: [], notInspectable: [], suggestedCorrections: [], suggestedCorrection: null, deferred: [],
  };

  // Serve from cache first — the cheapest request is the one we never make.
  const cacheKey = normalizeProductUrl(url);
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

  const { summary, requirements } = buildBuyerTask(fetched);

  // ONE extra fetch, only when the task actually needs delivery timing (§3.2).
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
  const kindOf = (a: Assertion) => requirements.find((r) => r.label === a.label)?.kind;
  const deferred: Assertion[] = [];
  let accessShown = 0;
  const tableAssertions = assertions.filter((a) => {
    if (a.status !== "requires_store_access") return true;
    if (accessShown === 0) { accessShown++; return true; }
    deferred.push(a);
    return false;
  });
  assertions = tableAssertions;
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
  };
  // A degraded result is deliberately NOT cached: it is missing surfaces we would
  // normally read, and pinning it for 7 days would turn a transient upstream block
  // into a week-long wrong answer.
  if (cacheKey && !product.diagnostics.degraded) storeResult(cacheKey, result, deps);
  return result;
}
