import type { ConstraintDiagnostic, StoreDiagnostic } from "./store-diagnostic.js";
import { scanStore, computeCoverage } from "./store-diagnostic.js";
import type { JourneyResult, ShoppingTaskContract, StoreSnapshot } from "./types.js";
import { bindContractToPublicSnapshot } from "./categories/deodorant/contracts.js";

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

const SEVERITY_WEIGHT: Record<string, number> = {
  absent: 3, // store does not evidence a required, inspectable claim
  conflicted: 2,
  evidenced: 0,
};

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
    return {
      id: hc.id,
      attribute: hc.attribute,
      scanVerdict: d.verdict,
      evidence: [...d.explicitHits, ...d.conflictHits.map((ch) => ({ surface: ch.affirmativeSurface, quote: ch.affirmativeQuote }))]
        .slice(0, 4)
        .map((h) => ("surface" in h ? { surface: (h as { surface: string }).surface, quote: (h as { quote: string }).quote ?? "" } : { surface: "", quote: "" })),
      journeyStatuses,
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
  const base = findings.reduce((s, f) => s + (SEVERITY_WEIGHT[f.scanVerdict] ?? 0), 0);
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
