// ===========================================================================
// v4.0 CP-1a STEP 1 — MEASURE BEFORE EDITING.
//
// The question: across the 349-URL replay corpus, how many claim rows currently
// `pass_evidenced` because a SUPPORTING term the collision author filed as a false
// equivalence matched — `plant-based`/`plant based` carried for `vegan`, and
// `unscented` carried for `fragrance_free`?
//
// ⚠️ WHY THIS CANNOT BE ANSWERED BY GREPPING THE RENDERED QUOTE. P-22: the engine
// matches on the FULL evidence sentence and renders a quote truncated at 180 chars,
// so a row can rest on a term the quote does not contain. Reading the quote would
// undercount in the flattering direction. This probe re-derives the MATCHED TERM
// through `findSupport` — the engine's own function — and then PROVES the
// re-derivation is faithful by requiring `presentableQuote(hit.sentence)` to equal
// the quote `evaluate` itself rendered on the same row. A mismatch is INCOMPLETE,
// never a silent skip.
//
// ⚠️ TWO POPULATIONS, REPORTED SEPARATELY.
//   CAPABILITY   all 349 products × 13 claim keys — what the matcher does.
//   CONSEQUENCE  only the claim rows `buildBuyerTask` actually asks — what a
//                merchant sees. These are the rows a false equivalence misleads.
// Conflating them is the occurrence/consequence error G-15 records under
// `site_wide`: two populations, opposite answers, one name.
//
// Also emits the NATURAL-FREQUENCY read the brief calls unmeasured: how many
// evidence sentences in the corpus contain each term at all, through the engine's
// own splitter and normaliser rather than a re-implementation.
//
// Pure replay: no network, no model calls (PRODUCT_TEST_SEMANTIC=0), no database.
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import {
  fetchPublicProduct, buildBuyerTask, evaluate,
  type PublicProduct, type Requirement,
} from "../../src/server/productTest.js";
import {
  findSupport, presentableQuote, normalize, termMatches,
  type EvidenceSentence,
} from "../../src/server/testEvidence.js";
import { lintStrings } from "../../src/server/claimLinter.js";
import { __resetCaches } from "../../src/server/productTestCache.js";

process.env.PRODUCT_TEST_SEMANTIC = "0";

const REPO = "C:/Users/iamka/Documents/projects/ShopifyACO";
const SNAP_DIRS = [
  `${REPO}/experiments/v2-9/snaps`,
  `${REPO}/experiments/v3-0/snaps_coffee`,
  `${REPO}/experiments/v3-1/snaps_coffee`,
  `${REPO}/experiments/v3-2/snaps_coffee`,
];
const OUT = `${REPO}/experiments/v4-0/out/term_measure.json`;

// ---- the dictionary, lifted from the engine's own bytes -------------------
// Same anchored, brace-balanced lift the G-14 gate uses. A regex would also match
// the copy in vocabulary.engine.test.ts and could not tell them apart, and a
// silently-empty dictionary reports a perfect sweep.
interface ClaimTermsView { support: string[]; violating: string[] }
function liftClaimTerms(): Record<string, ClaimTermsView> {
  const src = fs.readFileSync(`${REPO}/src/server/productTest.ts`, "utf8");
  const anchor = "const CLAIM_TERMS: Record<string, ClaimTerms> = {";
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error("CLAIM_TERMS' typed declaration is gone — repair this probe, do not run it");
  const open = start + anchor.length - 1;
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error("CLAIM_TERMS is not brace-balanced — refusing to guess");
  // eslint-disable-next-line no-new-func
  return new Function(`return ${src.slice(open, end)};`)() as Record<string, ClaimTermsView>;
}
const CLAIM_TERMS = liftClaimTerms();
const KEYS = Object.keys(CLAIM_TERMS);

/** The terms under investigation, by the key they are carried for. */
const UNDER_TEST: Record<string, string[]> = {
  vegan: ["plant-based", "plant based"],
  fragrance_free: ["unscented"],
};

// ---- two-sided liveness canary -------------------------------------------
function synthetic(text: string): PublicProduct {
  return {
    origin: "https://canary.example", handle: "c", title: "Canary", vendor: "V",
    productType: "Thing", tags: [],
    descriptionText: text,
    variants: [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: 12, optionNames: [], optionValues: [], extracted: null,
    evidence: [{ surface: "product_description", text }] as EvidenceSentence[],
    ldAvailability: null, storefrontObjectId: null, policyStatus: "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: { attempted: [], answeredBy: "json", throttled: [], degraded: false, robots: "ok", throttleSource: null },
  } as unknown as PublicProduct;
}
const claimReq = (key: string): Requirement =>
  ({ id: "c0", kind: "claim", claim: key, label: key } as Requirement);

const canaryPos = evaluate(synthetic("This product is vegan."), claimReq("vegan")).status;
const canaryNeg = evaluate(synthetic("This product ships on Tuesday."), claimReq("vegan")).status;
const canaryLive = canaryPos === "pass_evidenced" && canaryNeg !== "pass_evidenced";
if (!canaryLive) {
  console.error(`INCOMPLETE — two-sided canary COLLAPSED (pos=${canaryPos} neg=${canaryNeg}).`);
  process.exit(2);
}
// Mechanism confirmation — NOT a canary, because it is one-sided and it is the
// thing under test. Recorded so the writeup does not have to assert it.
const mechanism = {
  vegan_on_plant_based: evaluate(synthetic("Our formula is plant-based."), claimReq("vegan")).status,
  fragrance_free_on_unscented: evaluate(synthetic("This soap is unscented."), claimReq("fragrance_free")).status,
};

// ---- replay ---------------------------------------------------------------
interface Recorded { status: number; contentType: string | null; body: string }
interface Snap { host: string; url: string; responses: Record<string, Recorded> }

const files: Array<[string, string]> = [];
for (const d of SNAP_DIRS) {
  if (!fs.existsSync(d)) { console.error(`INCOMPLETE — snapshot dir missing: ${d}`); process.exit(2); }
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json")).sort()) files.push([d, f]);
}

interface Row {
  host: string; url: string; claim: string; asked: boolean;
  status: string; surface: string | null;
  matchedTerm: string | null;
  underTest: boolean;
  sentence: string | null;      // FULL, untruncated — the adjudication unit
  quote: string | null;         // what the merchant is shown
  quoteOmitsTerm: boolean | null;
  detail: string | null;
}

const rows: Row[] = [];
const problems: string[] = [];
const seen = new Set<string>();
let evaluated = 0, failed = 0, sentencesTotal = 0;
const termSentenceHits: Record<string, Set<string>> = {};
for (const ts of Object.values(UNDER_TEST).flat()) termSentenceHits[ts] = new Set();

for (const [dir, f] of files) {
  const snap: Snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (seen.has(snap.url)) continue;   // dedupe by URL — the census rule (P-16)
  seen.add(snap.url);
  const replay = async (url: string): Promise<Recorded> => {
    const r = snap.responses[url];
    if (!r) throw new Error(`REPLAY MISS: ${url}`);
    return r;
  };
  // ⚠️ PER-SNAPSHOT CACHE RESET — the same line `ab_probe_tpl.ts` carries. Without
  // it the process-wide egress budget (20 fetches/min) and the per-host throttle
  // treat a replay as real crawling: the first run of this probe built 7 products
  // and refused 342 with `rate_limited`, which the completion rule correctly
  // resolved INCOMPLETE rather than reporting as "0 rows rest on these terms".
  __resetCaches();
  let p: PublicProduct | null = null;
  let ferr: string | null = null;
  try {
    const got = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} } as never);
    p = got.product ?? null;
    ferr = got.error ? `${got.error.kind}: ${got.error.message}` : null;
  } catch (e) {
    failed++; problems.push(`${snap.url}: ${(e as Error).message}`); continue;
  }
  if (!p) { failed++; problems.push(`${snap.url}: no product built (${ferr ?? "no error reported"})`); continue; }
  evaluated++;

  // natural frequency, through the engine's own evidence sentences
  for (const ev of p.evidence) {
    sentencesTotal++;
    const n = normalize(ev.text);
    for (const ts of Object.values(UNDER_TEST).flat()) {
      if (termMatches(n, [ts], true).length) termSentenceHits[ts]!.add(`${snap.url}\u0000${ev.text}`);
    }
  }

  const askedClaims = new Set(
    buildBuyerTask(p).requirements.filter((r) => r.kind === "claim" && r.claim).map((r) => r.claim!),
  );

  // The engine's own quotable filter, quoted from the claim branch of `evaluate`.
  const quotable = p.evidence.filter((e) => e.surface !== "shipping_policy" && lintStrings([e.text]).ok);

  for (const key of KEYS) {
    const a = evaluate(p, claimReq(key));
    let matchedTerm: string | null = null;
    let sentence: string | null = null;
    if (a.status === "pass_evidenced") {
      const hit = findSupport(quotable, CLAIM_TERMS[key]!.support, { wholeWord: true });
      if (!hit) {
        problems.push(`${snap.url} ${key}: evaluate() passed but findSupport re-derivation found nothing`);
      } else {
        // FIDELITY PROOF. If the re-derived hit is not the row the engine rendered,
        // every matchedTerm below is a guess. Refuse rather than guess.
        //
        // ⚠️ THE SPAN IS NOT OPTIONAL, and this line caught itself. After CP-1b closed P-22
        // the engine renders a WINDOWED quote; calling `presentableQuote(sentence)` bare
        // reproduces the old head cut, and the check correctly refused on two rows rather
        // than mis-attributing them. Re-derive the span the way `findSupport` does.
        const nrm = normalize(hit.sentence);
        const spans = termMatches(nrm, [hit.term], true);
        const reQuote = presentableQuote(hit.sentence, spans[0]);
        const engQuote = a.evidenceQuote ?? null;
        if ((reQuote ?? null) !== engQuote) {
          problems.push(`${snap.url} ${key}: re-derived quote != engine quote\n  re : ${reQuote}\n  eng: ${engQuote}`);
        }
        matchedTerm = hit.term;
        sentence = hit.sentence;
      }
    }
    const under = matchedTerm != null && (UNDER_TEST[key] ?? []).includes(matchedTerm);
    rows.push({
      host: snap.host, url: snap.url, claim: key,
      asked: askedClaims.has(key),
      status: a.status, surface: a.evidenceSurface ?? null,
      matchedTerm, underTest: under, sentence,
      quote: a.evidenceQuote ?? null,
      quoteOmitsTerm: matchedTerm == null ? null
        : !normalize(a.evidenceQuote ?? "").includes(normalize(matchedTerm)),
      detail: a.detail ?? null,
    });
  }
}

const passRows = rows.filter((r) => r.status === "pass_evidenced");
const hits = passRows.filter((r) => r.underTest);
const summary = {
  canary: { pos: canaryPos, neg: canaryNeg, live: canaryLive },
  mechanism,
  corpus: { snapshotFiles: files.length, distinctUrls: seen.size, evaluated, failed, evidenceSentences: sentencesTotal },
  capability: {
    rowsEvaluated: rows.length,
    passRows: passRows.length,
    restingOnTermsUnderTest: hits.length,
    byTerm: Object.fromEntries(
      Object.values(UNDER_TEST).flat().map((t) => [t, hits.filter((h) => h.matchedTerm === t).length]),
    ),
    stores: [...new Set(hits.map((h) => h.host))].length,
  },
  consequence: {
    askedClaimRows: rows.filter((r) => r.asked).length,
    askedPassRows: passRows.filter((r) => r.asked).length,
    askedRestingOnTermsUnderTest: hits.filter((h) => h.asked).length,
    stores: [...new Set(hits.filter((h) => h.asked).map((h) => h.host))].length,
  },
  natural_frequency: Object.fromEntries(
    Object.values(UNDER_TEST).flat().map((t) => [t, termSentenceHits[t]!.size]),
  ),
  problems,
  completion: problems.length ? "INCOMPLETE" : "VERIFIED_CLEAN",
};

fs.writeFileSync(OUT, JSON.stringify({ summary, hits, allPassRows: passRows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log("\n--- rows resting on a term under test ---");
for (const h of hits) {
  console.log(`${h.asked ? "ASKED " : "unasked"} ${h.host} ${h.claim} <= "${h.matchedTerm}" [${h.surface}]`);
  console.log(`   SENTENCE: ${h.sentence}`);
  console.log(`   QUOTE   : ${h.quote}${h.quoteOmitsTerm ? "   *** QUOTE OMITS THE TERM (P-22) ***" : ""}`);
}
