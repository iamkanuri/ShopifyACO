import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { referentVeto, ENTITY_HEAD, LANDHOLDING, FOLLOWER_OK, CLAUSE_SPLIT } from "../src/server/referent.js";
import { normalize, termMatches, buildEvidence, findSupport } from "../src/server/testEvidence.js";
import { evaluate, type Requirement, type PublicProduct } from "../src/server/productTest.js";

// ===========================================================================
// G-15-R — THE REFERENT VETO's own suite.
//
// Four things are proved here, and the last two are the ones a later session will be
// tempted to skip:
//   1. it CLOSES the shapes it was built for;
//   2. it DECLINES on the shapes that must keep passing;
//   3. every DECLINE gate has a CONTROL ANCHOR — a sentence that passes only because
//      that gate exists. Without these, the mutation proof reads four of this guard's
//      components as DECORATIVE, because the corpus contains none of their shapes. That
//      is the v2.4 coverage hole, and it was filed before this file was written rather
//      than discovered afterwards.
//   4. the two COUPLINGS that can rot silently are PINNED: the bridge vocabulary against
//      the engine's claim dictionary, and the clause splitter against `subject.ts`'s.
//
// Pure: no network, no database, no clock, no model calls.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

/** Run the veto the way `findSupport` does — same normalisation, same span. */
function veto(sentence: string, term: string): string | null {
  const n = normalize(sentence);
  const raw = sentence.replace(/\s+/g, " ").trim();
  const m = termMatches(n, [term], true)[0];
  assert.ok(m, `the fixture does not contain ${JSON.stringify(term)}: ${sentence}`);
  return referentVeto(n, raw, m!);
}

/** The whole engine path, so a test cannot pass against the predicate while the wiring
 *  is wrong. This is what caught `vocabulary.ts` needing the same flag. */
const mk = (text: string): PublicProduct => ({
  origin: "https://s.example", handle: "p", title: "Thing", vendor: "Acme",
  productType: "Thing", tags: [], descriptionText: text,
  variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
  minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
  evidence: buildEvidence([{ surface: "product_description", text }]),
  ldAvailability: null, policyStatus: "not_fetched",
  fetched: { json: true, page: false, js: false, policy: false },
} as unknown as PublicProduct);
const claimStatus = (text: string, claim: string): string =>
  evaluate(mk(text), { id: "c", kind: "claim", claim, label: claim } as Requirement).status;

// ---------------------------------------------------------------------------
// 1 — THE SHAPES IT CLOSES. Real merchant sentences, verbatim from the v3.9
//     adjudication (`experiments/v3-9/out/corrected.json`), each confirmed misleading.
// ---------------------------------------------------------------------------

test("[referent] closes the adjudicated supply-chain-entity rows", () => {
  const cases: Array<[string, string, string]> = [
    ["ws-01/A040", "organic",
     "Nestled along the southern shores of Guatemala's breathtaking Lake Atitlan, AproCafe Atitlan is a cooperative of 54 organic-certified producers farming the volcanic slopes"],
    ["ws-02/A070", "fair trade",
     "Banko Dhadhato is one of many primary Fair Trade and organic certified cooperatives that make up the storied Yirgacheffe Coffee Farmers Cooperative Union."],
    ["ws-08/A069", "organic",
     "Banko Dhadhato is one of many primary Fair Trade and organic certified cooperatives that make up the storied Yirgacheffe Coffee Farmers Cooperative Union."],
    ["ws-05/A067", "organic",
     "Chirinos brings together over 800 smallholder farmers in the high mountains of Peru, where organic farming is taken seriously and community prosperity is built cup by cup."],
  ];
  for (const [id, term, text] of cases) {
    assert.ok(veto(text, term), `${id}: expected a veto on ${JSON.stringify(term)}\n  ${text}`);
  }
});

test("[referent] the partitive branch closes a proportion-of-a-class claim", () => {
  // ws-07 / A053, ozonecoffee.co.uk. `most of X is P` does not entail P of a member.
  assert.equal(
    veto("A large proportion of Peruvian specialty coffee is certified organic.", "certified organic"),
    "referent-proportion",
  );
  assert.equal(veto("Most supermarket coffee is certified organic.", "certified organic"), "referent-proportion");
});

// ---------------------------------------------------------------------------
// 2 — THE HONEST CARRIERS. Real sentences adjudicated TRUE. A guard that takes one of
//     these is a net regression regardless of what it closes.
// ---------------------------------------------------------------------------

test("[referent] every adjudicated honest carrier still passes", () => {
  const carriers: Array<[string, string, string]> = [
    ["hc-01/A015", "organic", "Organic Guatemalan Coffee - Calgary Heritage Roasting Co."],
    ["hc-02/A030", "organic", "You'll find our Organic Peru Norte is medium bodied and accented by clean, bright, and smooth acidity."],
    ["hc-03/A013", "paraben-free", "Formulated without parabens, phthalates, or sulfates. This wash is paraben-free."],
    ["hc-04/A049", "cruelty-free", "Clean-burning, cruelty-free, and made without parabens or sulfates."],
    ["hc-05/A044", "vegan", "Built from water-resistant nylon twill with vegan leather details, the Metro Travel Wallet is designed to carry your passports."],
    ["hc-06/A045", "vegan", "All of our Supers are vegan and tested for pesticides, heavy metals and microbiological content."],
    ["hc-07/A023", "single origin", "Discover Guatemala El Sol Natural, a naturally processed single origin coffee with notes of Concord grape."],
    ["hc-09/A033", "single origin", "Enjoy fair trade, organic, single origin Colombian coffee at the touch of a button."],
    ["hc-10/A034", "organic", "Enjoy fair trade, organic, single origin Colombian coffee at the touch of a button."],
    ["hc-11/A021", "unscented", "UltraWash Dishwasher Detergent Case, Unscented"],
    ["hc-12/A017", "single origin", "Single Origin - Mexico - One of our absolute favorite coffees in Oaxaca is back."],
    ["hc-13/A038", "single origin", "single origin Ethiopia washed"],
    ["hc-14/A016", "gluten free", "ALL Chomps are gluten free - no need to worry about that pesky ingredient."],
    ["hc-15/A051", "organic", "Constructed out of 5oz organic cotton."],
    ["hc-16/A002", "single origin", "Ours are single origin and roasted to perfection."],
    ["hc-17/A055", "gluten-free", "Free of the Top 9 Allergens, gluten-free, non-GMO, and kosher, these cookies are safe for schools."],
    ["hc-18/A059", "single origin", "Each beautifully designed tin can holds our carefully sourced single origin Colombian medium roast."],
  ];
  for (const [id, term, text] of carriers) {
    assert.equal(veto(text, term), null, `${id}: the guard vetoed a TRUE row\n  ${text}`);
  }
  assert.ok(carriers.length >= 17, "the carrier half shrank — a one-directional suite cannot see over-refusal");
});

// ---------------------------------------------------------------------------
// 3 — CONTROL ANCHORS. One per DECLINE gate. Each sentence passes ONLY because that
//     gate exists; disable the gate and the case fails. Without these the mutation
//     proof reports the gates as decorative, which is a corpus hole, not a useless gate.
// ---------------------------------------------------------------------------

test("[referent] CONTROL — the finite-verb gate: a verbless fragment is never vetoed", () => {
  // A title, an option value, a spec line. The frequency corpus carries NO product_title
  // and NO product_options surface, so this hazard is invisible to it — which is exactly
  // why it needs an anchor in code rather than a measurement.
  assert.equal(veto("Certified organic farm, Sonoma County.", "organic"), null);
  assert.equal(veto("Organic farm blend, medium roast", "organic"), null);
});

test("[referent] CONTROL — the first-person gate: a merchant's OWN farm is their product", () => {
  assert.equal(veto("Every bag is grown on our own certified organic farm in Kona.", "organic"), null);
  assert.equal(veto("We are a certified organic farm in Sonoma and we roast every lot here.", "organic"), null);
});

test("[referent] CONTROL — the head-position test: an attributive entity word is a modifier", () => {
  // "organic farming methods" is a claim about how the product was made.
  assert.equal(veto("Certified organic farming methods are used for this lot.", "organic"), null);
  assert.equal(veto("Our shop stocks organic farmers market tomatoes.", "organic"), null);
  assert.equal(veto("This granola contains organic farm produce, delivered weekly.", "organic"), null);
});

test("[referent] CONTROL — the proper-name decline: a Title-Cased head is a NAME", () => {
  assert.equal(veto("Every bean is harvested at Willow Creek Organic Farms.", "Organic"), null);
});

test("[referent] CONTROL — the spaced-hyphen separator: a trade name after the claim", () => {
  // hc-01's shape. A merchant's own name following the claim can never be reached.
  assert.equal(veto("This coffee is Organic - Calgary Heritage Roasting Co. farms.", "Organic"), null);
});

test("[referent] ANTI-VACUITY — the two sentences the veto MUST catch", () => {
  // Without these, Rules 1 and 2 could both be deleted and every case above would still
  // pass. A guard whose removal breaks nothing is not a guard.
  assert.ok(veto("This lot is from a cooperative that has 54 organic certified producers that farm here.", "organic"),
    "Rule 1 (forward attachment) is unreachable by this suite");
  assert.ok(veto("Most supermarket coffee is certified organic.", "certified organic"),
    "Rule 2 (partitive predicative) is unreachable by this suite");
});

// ---------------------------------------------------------------------------
// 4 — THE COUPLINGS THAT ROT SILENTLY.
// ---------------------------------------------------------------------------

test("[referent] PIN — the bridge vocabulary against the engine's claim dictionary", () => {
  // The bridge is hand-authored and CLOSED on purpose: deriving it from CLAIM_TERMS
  // yields `of`, `on`, `no`, `not`, `free`, `farm`, `estate`, `lab`, `party` — function
  // words, which would destroy the "an unknown token stops the scan" property outright.
  // So the coupling is caught by a pin instead: change any claim term and this fails,
  // forcing the bridge to be re-measured rather than silently widened on every store.
  const src = readFileSync(join(REPO, "src", "server", "productTest.ts"), "utf8");
  const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
  const start = src.indexOf(anchor);
  assert.ok(start >= 0, "CLAIM_TERMS' typed declaration is gone — repair this pin, do not delete it");
  const open = start + anchor.length - 1;
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0, "CLAIM_TERMS is not brace-balanced");
  // eslint-disable-next-line no-new-func
  const terms = new Function(`return ${src.slice(open, end)};`)() as Record<string, { support: string[] }>;
  const words = [...new Set(Object.values(terms).flatMap((t) => t.support).flatMap((s) => s.split(/[\s-]+/)))]
    .map((w) => w.toLowerCase()).sort();
  const hash = createHash("sha256").update(words.join(" ")).digest("hex").slice(0, 16);
  assert.equal(
    hash, "297234044dbbf35a",
    `the claim dictionary's word set moved (${words.length} words, hash ${hash}). G-15-R's ` +
    "BRIDGE_WORD list was measured against the previous set. Re-measure the bridge, then " +
    "re-pin this hash — do NOT re-pin it alone.",
  );
});

test("[referent] PIN — the clause splitter is byte-identical to subject.ts's", () => {
  // A local copy was taken deliberately (CLAUSE_BOUNDARY is a known open defect serving
  // two incompatible jobs, and adding a fourth caller needs scope, not another list).
  // A copy that drifts is worse than a shared defect, so the equality is asserted.
  const subj = readFileSync(join(REPO, "src", "server", "subject.ts"), "utf8");
  const m = /const CLAUSE_SPLIT = (\/.*\/[gimsuy]*);/.exec(subj);
  assert.ok(m, "subject.ts no longer declares CLAUSE_SPLIT under that name — repair this pin");
  assert.equal(m![1], CLAUSE_SPLIT.toString(), "the local clause splitter has drifted from subject.ts's");
});

test("[referent] DUAL MEMBERSHIP is exactly {farming}, and both memberships are load-bearing", () => {
  // A word in both ENTITY_HEAD and the follower vocabulary is a latent defect whose
  // correctness depends on word order. Exactly one such word is intended.
  const dual = [...ENTITY_HEAD].filter((w) => FOLLOWER_OK.test(` ${w} x`));
  assert.deepEqual(dual, ["farming"], `unintended dual membership: ${dual.join(", ")}`);
  // …as a FOLLOWER it proves the head:
  assert.ok(veto("This lot comes from a cooperative of 54 organic certified producers farming the slopes.", "organic"));
  // …as a HEAD it is attributive and must not veto:
  assert.equal(veto("Certified organic farming methods are used for this lot.", "organic"), null);
});

test("[referent] LANDHOLDING is a strict subset of ENTITY_HEAD", () => {
  for (const w of LANDHOLDING) assert.ok(ENTITY_HEAD.has(w), `${w} is dialled down but never vetoes`);
  assert.ok(LANDHOLDING.size < ENTITY_HEAD.size);
});

// ---------------------------------------------------------------------------
// 5 — THE WIRING. A predicate that is correct and unwired is not a guard.
// ---------------------------------------------------------------------------

test("[referent] the guard is WIRED into the claim branch and NOT into the others", () => {
  const s = "This lot is from a cooperative that has 54 organic certified producers that farm here.";
  assert.equal(claimStatus(s, "organic"), "not_proven", "the claim branch does not apply the referent guard");

  // The attribute path shares findSupport and must be untouched: no `referentGuard` flag.
  const noFlag = findSupport(buildEvidence([{ surface: "product_description", text: s }]), ["organic"], { wholeWord: true });
  assert.ok(noFlag, "without the flag the same sentence must still match — the guard is not opt-in");

  // …and an honest sentence still passes through the full engine.
  assert.equal(claimStatus("Constructed out of 5oz organic cotton.", "organic"), "pass_evidenced");
});
