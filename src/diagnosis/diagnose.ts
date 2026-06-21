import type { CrawledPage } from "../crawler/crawl.js";
import type { ExtractedPage, SignalKey } from "../crawler/extract.js";

// ===========================================================================
// Evidence & diagnosis engine (Phase 5) — PURE. Joins three things:
//   1. benchmark observations  → WHERE the merchant lost (intent, engine, the AI
//      answer snippet, the sources the assistant cited)
//   2. the merchant's crawled product page → what the merchant DOES/DOESN'T expose
//   3. the cited competitor pages → what the winner exposes that the merchant lacks
//
// Output: findings that pair the lost shopper moment (evidence) with a structural
// gap, a recommended intervention, and the EXPECTED MECHANISM by which it might
// help — never a guaranteed outcome, and never inferring causation from the mere
// correlation of "the winner has X." Every finding ships with a confidence level,
// the sample size it rests on, and explicit limits. Two tiers, mirroring the
// existing analysis layer: EVIDENCE_BACKED (tied to specific lost queries +
// citations) and GENERAL_HYGIENE (structural deficiencies, not tied to a query).
// ===========================================================================

export interface DiagnosisObservation {
  responseId: string | null;
  engine: string;
  intent: string | null;
  promptText: string;
  targetBrand: string;
  recommendationStatus: string;
  rank: number | null;
  citations: string[];
  evidenceSnippet: string | null;
}

export type ConfidenceLevel = "strong" | "moderate" | "directional";
export type FindingKind = "evidence_backed" | "general_hygiene";

export interface Finding {
  kind: FindingKind;
  /** The structural signal this finding is about (drives Phase-6 fix proposals). */
  signal?: SignalKey | "reachability";
  intent: string | null;
  promptText: string | null;
  engine: string | null;
  merchantBrand: string;
  winningCompetitor: string | null;
  aiAnswerSnippet: string | null;
  citations: string[];
  merchantGap: string[];
  competitorAdvantage: string[];
  confidenceLevel: ConfidenceLevel;
  basisN: number;
  limits: string;
  recommendedIntervention: string;
  expectedMechanism: string;
}

interface MechanismEntry {
  gap: string;
  advantage: (page: ExtractedPage) => string;
  intervention: string;
  mechanism: string;
}

// The mechanism is phrased as a plausible pathway, explicitly hedged. We never
// promise a recommendation-rate increase — that is what Phase 7's verification
// benchmark exists to MEASURE.
const MECHANISMS: Partial<Record<SignalKey, MechanismEntry>> = {
  reviews: {
    gap: "No review count / rating in structured data (AggregateRating)",
    advantage: (p) => `Exposes ${p.product?.reviewCount ?? "many"} reviews${p.product?.rating ? ` at ${p.product.rating}★` : ""} in AggregateRating schema`,
    intervention: "Publish Product + AggregateRating JSON-LD reflecting your real, verifiable review counts and average rating.",
    mechanism:
      "Shopping assistants frequently cite ratings and review volume as a decision factor and preferentially draw from pages that expose them in machine-readable schema. Making your real review data visible MAY raise the chance an assistant surfaces and cites you. This is a mechanism, not a guarantee, and not a claim that reviews alone caused the competitor to win.",
  },
  shipping: {
    gap: "Shipping terms are not in the Offer (no shippingDetails)",
    advantage: () => "Declares shipping terms (e.g. free shipping) in OfferShippingDetails",
    intervention: "Add OfferShippingDetails to your Offer schema so shipping cost/speed is machine-readable.",
    mechanism:
      "Buyer-intent answers often compare shipping; assistants can only weigh terms they can read. Structuring yours MAY make you eligible for shipping-sensitive answers you're currently absent from — a mechanism to test, not a promised lift.",
  },
  returns: {
    gap: "Return policy is not in the Offer (no hasMerchantReturnPolicy)",
    advantage: () => "Declares a return policy in MerchantReturnPolicy schema",
    intervention: "Add hasMerchantReturnPolicy (return window/conditions) to your Offer schema.",
    mechanism:
      "Returns/guarantees are a common trust signal in purchase-intent answers. Exposing yours in schema MAY let assistants factor it in. Mechanism only — verify with a follow-up benchmark.",
  },
  gtin: {
    gap: "No global product identifier (GTIN) in structured data",
    advantage: (p) => `Publishes a GTIN (${p.product?.gtin ?? "present"}) for catalog matching`,
    intervention: "Add the product's GTIN/UPC/EAN to your Product schema.",
    mechanism:
      "Global identifiers help retrieval and product-feed layers match your item to the right catalog entry. Adding yours MAY improve how reliably assistants associate answers with your product — a mechanism, not a ranking guarantee.",
  },
  faq: {
    gap: "No FAQ structured data (FAQPage)",
    advantage: (p) => `Answers ${p.faqs.length} common questions in FAQPage schema`,
    intervention: "Add FAQPage JSON-LD for the questions shoppers actually ask about this product.",
    mechanism:
      "Assistants mine Q&A content to answer specific shopper questions and cite the source. Structuring your answers MAY make you the cited source for those sub-questions. Mechanism, not a guarantee.",
  },
  productSchema: {
    gap: "No Product structured data on the page at all",
    advantage: () => "Publishes full Product schema",
    intervention: "Add Product JSON-LD (name, brand, offers, identifiers) to the product page.",
    mechanism:
      "Structured product data is the most machine-readable form of your catalog. Without it, retrieval layers rely on guessing from prose. Adding it MAY improve how accurately and often you're surfaced — a mechanism to measure.",
  },
  indexable: {
    gap: "Product page is set to noindex (excluded from indexing)",
    advantage: () => "Page is indexable (index,follow)",
    intervention: "Remove the noindex directive so the product page can be indexed and retrieved.",
    mechanism:
      "Content excluded from indexing generally cannot be retrieved or cited by assistants that rely on indexed sources. Making the page indexable is a precondition for visibility — necessary, though on its own not sufficient.",
  },
};

// Evidence-backed gaps are checked in this priority order; the first few drive the
// headline findings. indexable/productSchema also surface as hygiene if not tied
// to a specific loss.
const EVIDENCE_SIGNALS: SignalKey[] = ["reviews", "shipping", "returns", "gtin", "faq"];
const HYGIENE_SIGNALS: SignalKey[] = ["indexable", "productSchema"];

const norm = (s: string) => s.trim().toLowerCase();
const isRecommended = (s: string) => s === "recommended";

function confidenceFor(n: number): ConfidenceLevel {
  if (n >= 30) return "strong";
  if (n >= 12) return "moderate";
  return "directional";
}

function limitsText(n: number): string {
  return `Based on ${n} lost response${n === 1 ? "" : "s"} in this scan. AI answers vary run-to-run, and a competitor exposing this signal is correlation, not proof of cause. Treat as a diagnostic hypothesis and verify the effect with a follow-up (verification) benchmark.`;
}

interface Loss {
  responseId: string;
  engine: string;
  intent: string | null;
  promptText: string;
  winner: string;
  winnerRank: number;
  snippet: string | null;
  citations: string[];
}

/** Reduce observations to the responses the merchant LOST (merchant not
 *  recommended, a competitor was), with the winning competitor + AI evidence. */
export function findLosses(observations: DiagnosisObservation[], merchantBrand: string): Loss[] {
  const brand = norm(merchantBrand);
  const byResponse = new Map<string, DiagnosisObservation[]>();
  for (const o of observations) {
    if (!o.responseId) continue;
    const list = byResponse.get(o.responseId) ?? byResponse.set(o.responseId, []).get(o.responseId)!;
    list.push(o);
  }

  const losses: Loss[] = [];
  for (const [responseId, group] of byResponse) {
    const merchantRec = group.some((o) => norm(o.targetBrand) === brand && isRecommended(o.recommendationStatus));
    if (merchantRec) continue;
    const winners = group
      .filter((o) => norm(o.targetBrand) !== brand && isRecommended(o.recommendationStatus))
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    if (winners.length === 0) continue; // nobody won → not a competitive loss

    const w = winners[0]!;
    const citations = [...new Set(group.flatMap((o) => o.citations).filter(Boolean))];
    losses.push({
      responseId,
      engine: w.engine,
      intent: w.intent,
      promptText: w.promptText,
      winner: w.targetBrand,
      winnerRank: w.rank ?? 0,
      snippet: w.evidenceSnippet,
      citations,
    });
  }
  return losses;
}

export interface DiagnoseInput {
  merchantBrand: string;
  observations: DiagnosisObservation[];
  merchantPage: CrawledPage | null;
  /** Crawled competitor/cited pages, keyed by final URL. */
  competitorPages: Map<string, CrawledPage>;
}

/** Produce evidence-backed + hygiene findings. Deterministic and side-effect free. */
export function diagnose(input: DiagnoseInput): Finding[] {
  const { merchantBrand, observations, merchantPage } = input;
  const losses = findLosses(observations, merchantBrand);
  const findings: Finding[] = [];

  // If a merchant page was attempted but couldn't be crawled, say so explicitly —
  // an empty result must not be mistaken for "no gaps found".
  if (merchantPage && !merchantPage.ok) {
    findings.push({
      kind: "general_hygiene",
      signal: "reachability",
      intent: null, promptText: null, engine: null, merchantBrand,
      winningCompetitor: null, aiAnswerSnippet: null, citations: [],
      merchantGap: [`Merchant page could not be crawled (${merchantPage.error ?? "unknown error"})`],
      competitorAdvantage: [],
      confidenceLevel: "directional", basisN: 0,
      limits: "Diagnosis could not assess the merchant page itself, so structural gaps are unknown — this is a fetch/availability problem, not a clean bill of health.",
      recommendedIntervention: "Make the product page publicly reachable (HTTP 200, not blocked by robots.txt or noindex) so it can be assessed and indexed by assistants.",
      expectedMechanism: "A page that cannot be retrieved cannot be evaluated, indexed, or cited. Reachability is a precondition for visibility — necessary, though not on its own sufficient.",
    });
  }

  const merchantExtract = merchantPage?.ok ? merchantPage.extracted : null;
  // The "winner advantage" is the union of signals exposed by any cited competitor
  // page — i.e. what at least one winning source exposes.
  const competitorExtracts = [...input.competitorPages.values()].filter((p) => p.ok && p.extracted).map((p) => p.extracted!);

  // Group losses by winning competitor to find the dominant pattern + basis n.
  const byWinner = new Map<string, Loss[]>();
  for (const l of losses) {
    const k = norm(l.winner);
    (byWinner.get(k) ?? byWinner.set(k, []).get(k)!).push(l);
  }
  const winnersSorted = [...byWinner.entries()].sort((a, b) => b[1].length - a[1].length);

  // ---- evidence-backed findings: gap signals tied to real lost queries ------
  if (winnersSorted.length > 0 && merchantExtract) {
    const [, topLosses] = winnersSorted[0]!;
    const winnerName = topLosses[0]!.winner;
    const basisN = topLosses.length;
    const exemplar = topLosses[0]!;
    const allCitations = [...new Set(topLosses.flatMap((l) => l.citations))];

    for (const sig of EVIDENCE_SIGNALS) {
      const mech = MECHANISMS[sig];
      if (!mech) continue;
      const merchantHas = merchantExtract.signals[sig];
      const competitorWithIt = competitorExtracts.find((c) => c.signals[sig]);
      // Evidence-backed requires we CONFIRMED the gap on both sides via crawl.
      if (!merchantHas && competitorWithIt) {
        findings.push({
          kind: "evidence_backed",
          signal: sig,
          intent: exemplar.intent,
          promptText: exemplar.promptText,
          engine: exemplar.engine,
          merchantBrand,
          winningCompetitor: winnerName,
          aiAnswerSnippet: exemplar.snippet,
          citations: allCitations,
          merchantGap: [mech.gap],
          competitorAdvantage: [mech.advantage(competitorWithIt)],
          confidenceLevel: confidenceFor(basisN),
          basisN,
          limits: limitsText(basisN),
          recommendedIntervention: mech.intervention,
          expectedMechanism: mech.mechanism,
        });
      }
    }
  }

  // ---- general hygiene: structural deficiencies on the merchant page --------
  if (merchantExtract) {
    for (const sig of HYGIENE_SIGNALS) {
      const mech = MECHANISMS[sig];
      if (!mech) continue;
      if (!merchantExtract.signals[sig]) {
        findings.push({
          kind: "general_hygiene",
          signal: sig,
          intent: null,
          promptText: null,
          engine: null,
          merchantBrand,
          winningCompetitor: null,
          aiAnswerSnippet: null,
          citations: [],
          merchantGap: [mech.gap],
          competitorAdvantage: [],
          confidenceLevel: "directional",
          basisN: 0,
          limits:
            "General readiness item, not checked against a specific lost query. Best practice for machine readability; measure impact with a verification benchmark.",
          recommendedIntervention: mech.intervention,
          expectedMechanism: mech.mechanism,
        });
      }
    }
  }

  return findings;
}

/** Headline summary for the diagnosis (used by the API + admin). */
export function summarizeFindings(findings: Finding[]): {
  total: number;
  evidenceBacked: number;
  hygiene: number;
  topIntervention: string | null;
} {
  const evidenceBacked = findings.filter((f) => f.kind === "evidence_backed");
  const ranked = [...evidenceBacked].sort((a, b) => b.basisN - a.basisN);
  return {
    total: findings.length,
    evidenceBacked: evidenceBacked.length,
    hygiene: findings.filter((f) => f.kind === "general_hygiene").length,
    topIntervention: ranked[0]?.recommendedIntervention ?? findings[0]?.recommendedIntervention ?? null,
  };
}
