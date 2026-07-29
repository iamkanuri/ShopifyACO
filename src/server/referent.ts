// ===========================================================================
// G-15-R — THE REFERENT VETO. The term's governing noun phrase does not denote
// this product.
//
// WHY THIS IS NOT `subject.ts`. That module's header commits it to reading the
// grammatical SUBJECT. This reads TERM ATTACHMENT, which is a different signal and
// the reason the two cannot be merged: 9 of G-15's 17 adjudicated real cases have no
// surface subject at all, and `xsl-01` / `fps-02` share the subject "we" while
// differing only in what the term attaches to. A separate module also keeps
// `nonProductSubject`'s mutation ledger intact and makes this its own mutation-proof
// unit.
//
// THE MECHANISM, in one sentence: reading FORWARD from the end of the matched term
// across a bounded bridge of coordination-and-certification tokens, the match is
// vetoed when the first content word is a supply-chain PARTY or CULTIVATION-PRACTICE
// noun standing in HEAD position — plus one independent branch that vetoes when the
// term is predicated of a PARTITIVE PROPORTION of a class rather than of a universal.
//
// ⚠️ IT FAILS OPEN, AND THAT IS ARITHMETIC RATHER THAN TASTE. A rule that REQUIRES a
// readable referent fails 11 of the 19 suite-1.0 must-not-regress carriers, 8 of which
// have no surface subject. So every list here sits on the VETO side: an omission costs
// this guard RECALL, never a merchant a true row. That is the mirror image of the
// `origin` tombstone, whose head list was a PROTECTOR — the claim passed only if the
// head was a product noun, so every omission deleted a real product and it cost 17 true
// statements for 0 false passes gained. Same shape of list, opposite polarity, opposite
// failure direction. Do not invert it.
//
// Pure: no product, no clock, no network, no model calls.
// ===========================================================================

export type ReferentVeto = "referent-party" | "referent-landholding" | "referent-proportion";

// ---------- clause window ----------
// A LOCAL COPY, deliberately not a fourth caller of `CLAUSE_BOUNDARY` — that regex is a
// known open defect serving two incompatible jobs, and adding a caller needs scope, not
// another list. Byte-identical to `subject.ts`'s `CLAUSE_SPLIT`; a test asserts that
// equality so the copy cannot drift silently.
export const CLAUSE_SPLIT = /[.!?](?=\s|$)|[;:]|,\s+(and|but|or|yet|so)\s|\s+(but|however|whereas|although|though)\s/i;

export function clauseAt(s: string, index: number): { text: string; offset: number } {
  let start = 0, end = s.length;
  const re = new RegExp(CLAUSE_SPLIT.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index + m[0].length <= index) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  return { text: s.slice(start, end), offset: start };
}

// ---------- STEP 0: two DECLINE gates, checked before anything is read ----------

/** (0a) A clause with no finite verb is a FRAGMENT — a title, an option value, a spec
 *  line, a self-description. Vetoing there took 6 of 8 constructed farm-direct probes,
 *  and the hazard is invisible to the frequency corpus, which carries no
 *  `product_title` and no `product_options` surface at all. This gate is the design's
 *  largest single safety property and it is the one this file is least able to measure. */
const FINITE = /(^|[^a-z])(is|are|was|were|has|have|had|comes?|arrives?|ships?|holds?|makes?|grows?|brings?|works?|produces?|uses?|features?|includes?|contains?|offers?|sources?|supplies|specializes|specialises)([^a-z]|$)/i;

/** (0b) First person ANYWHERE in the clause ⇒ the entity is the seller's own, and a
 *  claim about the farm they own is a claim about what they grow. Clause-wide rather
 *  than a character window, so it reaches a possessive that FOLLOWS the head. */
const OWN_ENTITY = /(?:^|[^a-z])(our|ours|we|us|my|mine)(?:[^a-z]|$)/i;

// ---------- the closed lists, ALL on the veto side ----------

/**
 * A party or a process in production.
 *
 * CLOSURE PRINCIPLE, so a later reader can decide what belongs: an agentive (-er/-or)
 * role, an organisation noun, a landholding, or a deverbal process noun — never an
 * artefact a merchant can put in a box.
 *
 * DELIBERATELY EXCLUDED, each for a reason that was measured rather than guessed:
 *  • `roaster(s)`, `roastery`, `collective`, `union`, `association`, `consortium`,
 *    `federation`, `mill`, `factory`, `agronomy` — ZERO firings across 3,349 real
 *    sentences in every design's measurement, and three of them cost a probe row. An
 *    unmeasured entry on a veto list is a liability that has bought nothing.
 *  • `estate(s)` — collides head-on with the support term `single estate`.
 *  • `practices`, `principles`, `methods`, `standards`, `certification` — *"base their
 *    production on sustainable organic practices only"* and *"grown using organic
 *    methods"* are live passing rows adjudicated NOT misleading.
 *  • `brand`, `company`, `partner`, `artisan`, `distributor` — carrier A063 is literally
 *    *"Sodello Brand 80% Organic Cotton"*.
 *  • `product`, `coffee`, `cotton`, `leather`, and EVERY place noun or adjective. Nine
 *    of the 18 honest carriers die if any is added, and `product` is the head noun of
 *    all 14 generated `wrong_subject` templates.
 */
export const ENTITY_HEAD = new Set([
  "cooperative", "cooperatives", "co-operative", "co-operatives", "co-op", "co-ops", "coop", "coops",
  "producer", "producers", "grower", "growers", "farmer", "farmers", "smallholder", "smallholders",
  "supplier", "suppliers", "importer", "importers", "exporter", "exporters",
  "farm", "farms", "plantation", "plantations", "orchard", "orchards",
  "farming", "agriculture", "cultivation", "husbandry",
]);

/** The priced dial-down subset. Dropping these six reopens exactly one defect (`ws-03`)
 *  and removes every farm-direct hazard in the design. Measured: corpus firings 8 → 6,
 *  stores 5 → 4. Kept, because the finite-verb gate, the first-person gate, the
 *  head-position test and the proper-name decline between them close every farm-direct
 *  probe that has been constructed — and because that sentence is exactly the one an
 *  author is not licensed to write, it is recorded here for the adversarial pass to
 *  attack rather than asserted as settled. */
export const LANDHOLDING = new Set(["farm", "farms", "plantation", "plantations", "orchard", "orchards"]);

/** Tokens the forward scan may CROSS: coordination of a claim-adjective list, and
 *  certification wording. Anything else stops the scan, which is the commonest way this
 *  guard declines.
 *
 *  ⚠️ HAND-AUTHORED AND CLOSED, NOT DERIVED FROM `CLAIM_TERMS` — that derivation was
 *  proposed and executed, and it yields `of`, `on`, `no`, `not`, `free`, `farm`,
 *  `estate`, `lab`, `party`. Function words in the bridge destroy the "an unknown token
 *  stops the scan" property outright. The coupling is caught by a PIN instead (see
 *  `test/referent.test.ts`): change any claim term and the pin fails, forcing the bridge
 *  to be re-measured rather than silently widened on every store. */
const BRIDGE_WORD = new Set([
  "and", "or", "certified", "certification", "verified",
  "organic", "fair", "trade", "fairtrade", "vegan", "gluten", "free", "single", "origin",
  "one", "two", "three", "several", "many", "other", "small", "smallholder", "family", "local", "partner",
]);

/**
 * HEAD-POSITION TEST — the graft that makes any of this usable.
 *
 * In a noun-noun compound the entity word is a MODIFIER, not the head: *"Organic Farm
 * Blend"*, *"Organic farmers market tomatoes"*, *"Fair Trade cooperative coffee"* are all
 * claims about the product. Only a function word, a relative pronoun, a participle or the
 * clause end proves the entity word is the head.
 *
 * ⚠️ THIS IS A CLOSED CONTINUATION VOCABULARY, SO AN UNRECOGNISED FOLLOWER DECLINES THE
 * VETO. The alternative — deciding head-hood from a list of function words — fails CLOSED
 * on omission, which makes it a protector list and reintroduces the `origin` failure.
 * ⚠️ `to`, `produce`, `produces`, `harvest`, `harvests`, `farm`, `farms` are ABSENT on
 * purpose: each is a noun homograph that makes the entity word a modifier —
 * *"organic farm to table eggs"*, *"certified organic farm produce, delivered weekly"*.
 */
export const FOLLOWER_OK = /^(?:$|\s*[.,;:!?)\]"'…–—-]|\s+(?:that|which|who|whose|where|when|and|or|but|in|of|from|at|on|near|across|throughout|around|within|along|with|is|are|was|were|has|have|had|make|makes|making|work|works|working|grow|grows|growing|farming|producing|harvesting|located|based|situated|operating|run|owned|supplying|serving|we|they|our|their)(?![a-z]))/i;

// ---------- the partitive predicative branch ----------

const COPULA_LEAD = /(?:^|[^a-z])(is|are|was|were|'s|'re)\s+(?:(?:100%|fully|certified|entirely|completely|usda|proudly|now|also)\s+){0,3}$/i;

/** ⚠️ UNIVERSALS ARE ABSENT ON PURPOSE, and this asymmetry is the only reason the branch
 *  can exist at all. *"most of X is P"* does not entail P of a member; *"all of X is P"*
 *  does. Carriers hc-06 (*"All of our Supers are vegan"*) and hc-14 (*"ALL Chomps are
 *  gluten free"*) are TRUE by entailment and must keep passing. */
const PROPORTION = /^(?:a |the )?(?:large |small |significant |growing |good |fair |high |vast )?(?:proportion|percentage|share|majority|minority|portion|fraction|handful)\s+of\s|^(?:most|many|much|some|several|a few|plenty)(?:\s+of)?\s/i;

/** Wider than `OWN_ENTITY`: a restrictor anchored to THIS product entails for it.
 *  Without `this`, *"Most of the cotton in this tee is organic."* is lost. */
const OWNED_SUBJ = /(?:^|[^a-z])(our|ours|we|us|my|mine|this|these|it|its)(?:[^a-z]|$)/i;

/** ws-02 sits EXACTLY on this bound (3 tokens, 22 of 32 chars). One more coordinated
 *  adjective and it fails open. There is no measurement saying 3 is right rather than 4,
 *  and widening is the direction that costs true rows — so it does not widen without one. */
const MAX_BRIDGE_TOKENS = 3;
const MAX_BRIDGE_CHARS = 32;

/**
 * @param n   `normalize(sentence)` — `findSupport` has already computed it.
 * @param raw `sentence.replace(/\s+/g," ").trim()`, CASE PRESERVED and index-aligned with
 *            `n` by the invariant `testEvidence.ts` already asserts for `QuoteSpan`.
 * @param m   the `TermMatch` `findSupport` already holds.
 */
export function referentVeto(
  n: string,
  raw: string,
  m: { term: string; index: number; end: number },
): ReferentVeto | null {
  const { text: clause, offset } = clauseAt(n, m.index);
  const rel = Math.max(0, m.index - offset), relEnd = Math.max(0, m.end - offset);
  if (rel > clause.length || relEnd > clause.length) return null;   // mis-split ⇒ decline
  if (!FINITE.test(clause)) return null;                            // gate 0a
  const before = clause.slice(0, rel);

  // ---- RULE 2: partitive predicative. Checked first; independent of attachment. ----
  if (COPULA_LEAD.test(before)) {
    const subj = before.replace(COPULA_LEAD, "").trim();
    if (subj && !OWNED_SUBJ.test(subj) && PROPORTION.test(subj)) return "referent-proportion";
  }

  // ---- RULE 1: forward attachment ----
  if (OWN_ENTITY.test(clause)) return null;                         // gate 0b
  let tail = clause.slice(relEnd), tokens = 0, chars = 0;
  for (;;) {
    const sep = /^[\s\-–—,&/()]+/.exec(tail);
    if (sep) {
      // A hyphen with whitespace on BOTH sides is a SEPARATOR, not a compound joiner.
      // This is what structurally protects carrier hc-01 (*"…Coffee - Calgary Heritage
      // Roasting Co."*) and hc-12 (*"Single Origin - Mexico - …"*): a merchant's own
      // trade name after the claim can never be reached.
      if (/\s[-–—]\s/.test(sep[0])) return null;
      tail = tail.slice(sep[0].length); chars += sep[0].length;
    }
    const w = /^[a-z0-9][a-z0-9'\-]*/.exec(tail);
    if (!w) return null;                                            // nothing to read ⇒ decline
    // Hyphens are kept whole, so "farm-to-table" and "farmers'" are single UNMATCHED
    // tokens rather than an entity word plus a suffix.
    const word = w[0];
    if (ENTITY_HEAD.has(word)) {
      const rest = tail.slice(word.length);
      if (!FOLLOWER_OK.test(rest)) return null;                     // attributive ⇒ decline
      // PROPER-NAME DECLINE. A Title-Cased claim term followed by a Title-Cased head is a
      // NAME — "Blue Ridge Organic Farm", "Willow Creek Organic Farms". Every design named
      // this as its break class and none closed it. Measured cost on the corpus: ZERO (10
      // firings with it, 10 without), so it is pure insurance. Sentence-initial position is
      // excluded so ordinary capitalisation cannot disable the guard.
      const headAbs = offset + (clause.length - tail.length);
      const capHead = /^[A-Z]/.test(raw.slice(headAbs, headAbs + 1));
      const capTerm = m.index > 0 && /^[A-Z]/.test(raw.slice(m.index, m.index + 1));
      if (capHead && capTerm) return null;
      return LANDHOLDING.has(word) ? "referent-landholding" : "referent-party";
    }
    if (tokens >= MAX_BRIDGE_TOKENS) return null;
    if (chars + word.length > MAX_BRIDGE_CHARS) return null;
    if (!BRIDGE_WORD.has(word) && !/^\d+%?$/.test(word)) return null; // unknown token ⇒ decline
    tail = tail.slice(word.length); chars += word.length; tokens++;
  }
}
