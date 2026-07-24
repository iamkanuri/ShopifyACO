import type { ConstraintDiagnostic, StoreDiagnostic } from "./store-diagnostic.js";
import { scanStore, computeCoverage } from "./store-diagnostic.js";
import type { JourneyResult, ShoppingTaskContract, StoreSnapshot } from "./types.js";
import { bindContractToPublicSnapshot } from "./categories/deodorant/contracts.js";
import { fixturesFor } from "./evidence-validator.js";
import { matchingTermsIn, normalizeForMatch, splitSentences } from "./util.js";

// ===========================================================================
// STAGE 5 — per-prospect diagnostic (spec 4.5). snapshot → Store Diagnostic
// Scan → 1 contract × 2 models × 2 trials → per-prospect record. All verdicts
// are scoped to EVIDENCE AVAILABILITY (Rule 4): a constraint the scan finds
// `absent` means "your store does not state X in an AI-verifiable form", never
// "your product lacks X". Journeys reuse the Stage 1–4 runner/validator/
// adjudicator/semantic tier unchanged.
// ===========================================================================

export interface ConstraintFinding {
  id: string;
  attribute: string;
  scanVerdict: ConstraintDiagnostic["verdict"];
  /** Quoted evidence the scan found (with the surface it was on). */
  evidence: Array<{ surface: string; quote: string }>;
  /** Journey adjudication summary for this constraint across the 4 runs. */
  journeyStatuses: string[];
  /** Rule 4 CRITICAL: the store DOES expose readable evidence for this
   *  constraint, but its VALUE does not meet the shopper's ask (e.g. price is
   *  public but above the cap). This is NOT an evidence gap and must never be
   *  reported as "your store does not state X" — the store states it fine. */
  readableButUnmet: boolean;
  /** A GENUINE public-data evidence gap: nothing readable supports OR contradicts
   *  the constraint on an inspectable surface. Only these may be surfaced as
   *  "not stated in an AI-verifiable form". */
  genuineEvidenceGap: boolean;
}

export interface ProspectDiagnostic {
  origin: string;
  productHandle?: string;
  contractId: string;
  provenance: "public";
  surfacesNotInspectable: string[];
  demotedConstraints: Array<{ id: string; attribute: string; reason: string }>;
  findings: ConstraintFinding[];
  journeyOutcomes: Array<{ provider: string; trial: number; outcome: string; rootCause?: string; coverageRatio: number }>;
  /** Battery appearance stats for this store's brand. */
  battery: { brandMentions: number; channels: string[]; batteryTotal: number };
  fetchUrls: Record<string, string>;
  fetchedAt: string;
  /** Severity: count + weight of unresolvable hard constraints × peer-beat factor. */
  severity: number;
}

export interface RunProspectOpts {
  snapshot: StoreSnapshot;
  contract: ShoppingTaskContract;
  battery: { brandMentions: number; channels: string[]; batteryTotal: number };
  topCompetitorMentions: number; // how often the category peer beat them (peer-beat factor)
  runJourneys: (contract: ShoppingTaskContract, snapshot: StoreSnapshot) => Promise<JourneyResult[]>;
}

export async function diagnoseProspect(opts: RunProspectOpts): Promise<ProspectDiagnostic> {
  const { snapshot } = opts;
  const bound = bindContractToPublicSnapshot(opts.contract, snapshot);
  const diagnostic: StoreDiagnostic = scanStore(snapshot, bound.contract);
  const journeys = await opts.runJourneys(bound.contract, snapshot);

  const findings: ConstraintFinding[] = bound.contract.hardConstraints.map((hc) => {
    const d = diagnostic.perConstraint.find((c) => c.constraintId === hc.id)!;
    const journeyStatuses = journeys.map((j) => j.constraintEvaluations.find((e) => e.constraintId === hc.id)?.status ?? "n/a");
    // Readable-but-unmet: the scan found CONTRARY evidence (value present, ask
    // not met — e.g. price public but over cap). Store states it fine (Rule 4).
    const readableButUnmet = d.contraryHits.length > 0 && d.explicitHits.length === 0;
    const genuineEvidenceGap = d.verdict === "absent" && !readableButUnmet;
    return {
      id: hc.id,
      attribute: hc.attribute,
      scanVerdict: d.verdict,
      evidence: [...d.explicitHits, ...d.conflictHits.map((ch) => ({ surface: ch.affirmativeSurface, quote: ch.affirmativeQuote }))]
        .slice(0, 4)
        .map((h) => ("surface" in h ? { surface: (h as { surface: string }).surface, quote: (h as { quote: string }).quote ?? "" } : { surface: "", quote: "" })),
      journeyStatuses,
      readableButUnmet,
      genuineEvidenceGap,
    };
  });

  const journeyOutcomes = journeys.map((j) => {
    const cov = computeCoverage(diagnostic, j);
    return { provider: j.provider, trial: j.trialNumber, outcome: j.outcome, rootCause: j.rootCauseCode, coverageRatio: cov.coverageRatio };
  });

  // Severity: sum of weighted hard-constraint verdicts, scaled by how strongly a
  // category peer beat this store in the battery (a store that peers beat often,
  // and that can't evidence the category's core claims, is the sharpest case).
  const peerFactor = 1 + Math.min(2, opts.topCompetitorMentions / Math.max(1, opts.battery.batteryTotal / 6));
  // Severity counts GENUINE evidence gaps (weight 3) and conflicts (weight 2)
  // only — a readable-but-unmet value is not a store-evidence problem (Rule 4).
  const base = findings.reduce((s, f) => s + (f.genuineEvidenceGap ? 3 : f.scanVerdict === "conflicted" ? 2 : 0), 0);
  const severity = Math.round(base * peerFactor * 100) / 100;

  const fetchUrls = (snapshot as StoreSnapshot & { fetchUrls?: Record<string, string> }).fetchUrls ?? {};
  return {
    origin: snapshot.shopId,
    productHandle: opts.contract.productScope.productId || undefined,
    contractId: opts.contract.id,
    provenance: "public",
    surfacesNotInspectable: snapshot.surfacesNotInspectable ?? [],
    demotedConstraints: bound.demoted,
    findings,
    journeyOutcomes,
    battery: opts.battery,
    fetchUrls,
    fetchedAt: snapshot.createdAt,
    severity,
  };
}

// ===========================================================================
// STAGE 6.1 — WINNER-CONTRAST (evidence-availability, both directions). For the
// category's most-recommended store we run the SAME bound scan and, per the
// PROSPECT's genuine gap, record whether the winner's PUBLIC data evidences the
// same attribute (with a verbatim quote) or also lacks it. All quotes are
// verbatim substrings of the winner's public evidence (deterministic floor /
// semantic asymmetry: a grant needs a real quote; a veto is conservative). NO
// product-truth is ever asserted about either store.
// ===========================================================================

/** Per-attribute evidence availability on ONE store's public snapshot. */
export interface WinnerAttributeEvidence {
  evidences: boolean;
  /** Verbatim (sentence-scoped, length-capped) quote when evidenced on a TEXT
   *  surface. Absent for numeric/structured evidence (e.g. a price) so a raw
   *  JSON blob never renders as a "quote". */
  quote?: string;
  surface?: string;
}

/** Pick the shortest verbatim sentence in `text` that contains a support term
 *  for `attribute` (falls back to a capped prefix). The result is ALWAYS a
 *  substring of `text` — never paraphrased or re-assembled. */
export function focusedEvidenceQuote(text: string, attribute: string, maxLen = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const terms = [...(fixturesFor(attribute).supportTerms ?? [])];
  const sentences = splitSentences(clean);
  const withTerm = terms.length
    ? sentences.filter((s) => matchingTermsIn(s, terms).length > 0)
    : [];
  const pick = (withTerm.length ? withTerm : sentences).sort((a, b) => a.length - b.length)[0] ?? clean;
  if (pick.length <= maxLen) return pick;
  // Cap at a word boundary, still a verbatim prefix of the chosen sentence.
  const cut = pick.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Scan the winner's public snapshot with the SAME base contract → per-attribute
 *  evidence availability. Only text-surface grants carry a quote. */
export function scanWinnerEvidenceMap(
  winnerSnapshot: StoreSnapshot,
  baseContract: ShoppingTaskContract,
): Record<string, WinnerAttributeEvidence> {
  const bound = bindContractToPublicSnapshot(baseContract, winnerSnapshot);
  const diagnostic = scanStore(winnerSnapshot, bound.contract);
  const out: Record<string, WinnerAttributeEvidence> = {};
  for (const hc of bound.contract.hardConstraints) {
    const d = diagnostic.perConstraint.find((c) => c.constraintId === hc.id);
    if (!d || d.verdict !== "evidenced" || d.explicitHits.length === 0) {
      out[hc.attribute] = { evidences: false };
      continue;
    }
    const textHit = d.explicitHits.find((h) => typeof h.quote === "string" && /[a-z]/i.test(h.quote) && h.surface !== "product_variants");
    out[hc.attribute] = textHit
      ? { evidences: true, quote: focusedEvidenceQuote(textHit.quote, hc.attribute), surface: textHit.surface }
      : { evidences: true, surface: d.explicitHits[0]!.surface };
  }
  return out;
}

/** One rendered-ready contrast fact for a single prospect gap attribute. */
export interface WinnerContrastFact {
  attribute: string;
  winnerEvidences: boolean;
  winnerQuote?: string;
  winnerSurface?: string;
}

export interface WinnerContrast {
  brand: string;
  mentions: number;
  /** Whether the winner is a DIFFERENT store than the prospect (self-contrast is
   *  suppressed — a store can't be contrasted with itself). */
  distinct: boolean;
  facts: WinnerContrastFact[];
}

/** Project the winner's evidence map onto a prospect's GENUINE gaps → the
 *  contrast facts the case renders. Pure. */
export function buildWinnerContrast(
  prospect: ProspectDiagnostic,
  winnerMap: Record<string, WinnerAttributeEvidence>,
  winner: { brand: string; mentions: number; origin: string },
): WinnerContrast {
  const distinct = normalizeForMatch(winner.origin) !== normalizeForMatch(prospect.origin);
  const facts: WinnerContrastFact[] = prospect.findings
    .filter((f) => f.genuineEvidenceGap)
    .map((f) => {
      const w = winnerMap[f.attribute];
      return {
        attribute: f.attribute,
        winnerEvidences: Boolean(w?.evidences),
        winnerQuote: w?.evidences ? w.quote : undefined,
        winnerSurface: w?.evidences ? w.surface : undefined,
      };
    });
  return { brand: winner.brand, mentions: winner.mentions, distinct, facts };
}
