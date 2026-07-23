// ===========================================================================
// AGENTIC INSTRUMENT TEST — STAGE 1 (experiments/agentic-stage1/AUDIT.md)
// Shared contract for the snapshot/tool/agent/validator pipeline. New code only:
// nothing here is imported by production modules.
// ===========================================================================

export type EvidenceSurface =
  | "product_title"
  | "product_description"
  | "product_metafields"
  | "product_variants"
  | "product_options"
  | "structured_data"
  | "faq"
  | "shipping_policy"
  | "returns_policy";

export type ConstraintOperator =
  | "must_be_true"
  | "must_be_false"
  | "equals"
  | "less_than"
  | "greater_than"
  | "must_be_resolvable";

export type ConstraintStatus = "satisfied" | "violated" | "unresolvable" | "conflicting";

/** Stage 2 deterministic root causes (spec 4.1 mapping; Appendix B table). */
export type RootCauseCode =
  | "EVIDENCE_GAP"
  | "CONTRADICTION"
  | "INVENTORY_MISMATCH"
  | "STALE_STRUCTURED_DATA"
  | "PRICE_VIOLATION"
  | "POLICY_OPACITY"
  | "WRONG_PRODUCT";

export type JourneyOutcome =
  | "PASS"
  | "MISSING_EVIDENCE"
  | "CONTRADICTION"
  | "WRONG_PRODUCT_SELECTED"
  | "CONSTRAINT_VIOLATION"
  | "FALSE_CERTAINTY"
  | "TOOL_FAILURE"
  | "MODEL_FAILURE"
  | "BUDGET_EXHAUSTED";

/** Stage 2: a deterministic contradiction fixture — if retrieved evidence for a
 *  constraint matches BOTH sides, the validator forces status `conflicting`
 *  regardless of the model's declared status (spec 4.1). */
export interface ConflictTermPair {
  affirmative: string[];
  negative: string[];
}

export interface ShoppingConstraint {
  id: string;
  attribute: string;
  operator: ConstraintOperator;
  expectedValue?: unknown;
  /** Surfaces allowed to establish this fact. */
  acceptableSurfaces: EvidenceSurface[];
  /** Direct evidence required — inference is never acceptable. */
  evidenceRequired: boolean;
  /** Stage 2: contradiction pairs checked deterministically by the validator. */
  conflictTermPairs?: ConflictTermPair[];
}

export interface ShoppingTaskContract {
  id: string;
  version: string;
  objective: "select_purchase_ready_product";
  productScope: { shopId: string; productId: string; variantId?: string };
  hardConstraints: ShoppingConstraint[];
  /** Stage 2: observational constraints (e.g. returns_policy_consistent) —
   *  never serialized to the agent; only their conflict pairs are evaluated. */
  softConstraints?: ShoppingConstraint[];
  successConditions: {
    correctProductRequired: boolean;
    allHardConstraintsSatisfied: boolean;
    evidenceRequiredForEveryFact: boolean;
  };
  limits: { maxSteps: number; maxToolCalls: number; maxOutputTokens: number };
}

/** Evaluator-only ground truth. NEVER enters agent context (test-enforced). */
export interface MerchantGroundTruth {
  productId: string;
  facts: Record<string, unknown>;
  sources?: Array<{
    attribute: string;
    sourceType: "merchant_confirmed" | "certification" | "manufacturer_record";
    note?: string;
  }>;
}

// ---- snapshot -------------------------------------------------------------

export interface SnapshotVariant {
  variantId: string;
  title: string | null;
  sku: string | null;
  price: number | null;
  available: boolean | null;
  options: Array<{ name: string; value: string }>;
}

export interface SnapshotProduct {
  productId: string;
  handle: string | null;
  title: string | null;
  /** Plain text (HTML already stripped by the ingestion layer's normalizer). */
  description: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: string | null;
  metafields: Array<{ namespace: string; key: string; value: string; type: string | null }>;
  variants: SnapshotVariant[];
}

export interface SnapshotPage {
  pageId: string;
  surface: Extract<EvidenceSurface, "faq" | "structured_data">;
  title: string | null;
  text: string;
}

export interface SnapshotPolicy {
  policyId: string;
  surface: Extract<EvidenceSurface, "shipping_policy" | "returns_policy">;
  text: string;
}

/** One addressable piece of store text / structured value, with its stable id. */
export interface SnapshotEvidenceItem {
  evidenceId: string;
  surface: EvidenceSurface;
  sourceObjectId: string;
  exactText?: string;
  structuredValue?: unknown;
}

export interface StoreSnapshot {
  id: string;
  shopId: string;
  createdAt: string;
  sourceVersion: string;
  products: SnapshotProduct[];
  pages: SnapshotPage[];
  policies: SnapshotPolicy[];
  /** Surfaces the ingestion layer does not capture at all (AUDIT.md §2). */
  surfacesAbsent: EvidenceSurface[];
  /** Flat evidence index derived deterministically from the content above. */
  evidence: SnapshotEvidenceItem[];
  /** sha256 of canonical JSON of the content (see snapshot-service). */
  contentHash: string;
}

export interface EvidenceReference {
  evidenceId: string;
  surface: EvidenceSurface;
  sourceObjectId: string;
  exactText?: string;
  structuredValue?: unknown;
  snapshotId: string;
}

// ---- mutation -------------------------------------------------------------

export interface SnapshotMutation {
  mutationId: string;
  type:
    | "REMOVE_ATTRIBUTE_EVIDENCE"
    | "INJECT_CONTRADICTION"
    | "SET_VARIANT_UNAVAILABLE"
    | "SKEW_STRUCTURED_PRICE"
    | "REMOVE_POLICY_EVIDENCE"
    | "INSERT_SENTENCES";
  attribute: string;
  /** Stage 2 extras, present per mutation type. */
  injectedSentences?: Array<{ productId: string; sentence: string }>;
  targetVariantId?: string;
  priceSkew?: { sourceObjectId: string; from: string; to: string; substitutionNote?: string };
  removedEvidence: EvidenceReference[];
  /** Where each removed item lived, so RESTORED can re-insert it exactly.
   *  (Stage 1 shortcut — spec 4.4: restore into a copy of FAULTY, not via Fix Studio.) */
  restoreHints: Array<
    | { kind: "sentence"; productId: string; field: "title" | "description"; sentenceIndex: number; sentence: string }
    | { kind: "metafield"; productId: string; metafieldIndex: number; metafield: { namespace: string; key: string; value: string; type: string | null } }
    | { kind: "page_sentence"; pageId: string; sentenceIndex: number; sentence: string }
    | { kind: "policy_sentence"; policyId: string; sentenceIndex: number; sentence: string }
  >;
  originalSnapshotId: string;
  mutatedSnapshotId: string;
}

// ---- trace ----------------------------------------------------------------

export type TraceEventType =
  | "RUN_STARTED"
  | "TOOL_CALLED"
  | "TOOL_RESULT"
  | "PRODUCT_CONSIDERED"
  | "QUESTION_RAISED"
  | "CONSTRAINT_CHECKED"
  | "DECISION_MADE"
  | "RUN_COMPLETED"
  | "ERROR";

export interface TraceEvent {
  runId: string;
  timestamp: string;
  sequence: number;
  type: TraceEventType;
  payload: Record<string, unknown>;
  evidenceReferences?: EvidenceReference[];
  model?: { provider: string; model: string; promptVersion: string };
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
}

// ---- results --------------------------------------------------------------

/** Stage 3 trust ladder (spec 4.2): how a satisfied constraint earned it. */
export type ConfidenceTier = "EXPLICIT" | "SEMANTIC_VERIFIED";

export interface ConstraintEvaluation {
  constraintId: string;
  status: ConstraintStatus;
  /** Stage 3: set on satisfied constraints (EXPLICIT > SEMANTIC_VERIFIED). */
  confidenceTier?: ConfidenceTier;
  /** Stage 3: an explicit lexical match was vetoed as being about another
   *  subject (the TRAP fix); the constraint is NOT satisfied by it. */
  rejectedAboutness?: boolean;
  /** Stage 3: agent-claimed refs that are REAL, pinned, and in-scope but failed
   *  only the lexical support check — eligible for semantic-tier judgment. */
  pendingSemanticRefs?: EvidenceReference[];
  observedValue?: unknown;
  /** Resolved references for claimed ids that WERE returned by tools this run. */
  evidenceReferences: EvidenceReference[];
  /** Every evidence id the agent claimed, verbatim — including fabricated ones
   *  (kept separate so nothing is fabricated into a resolved reference). */
  claimedEvidenceIds?: string[];
  explanation: string;
}

export interface JourneyResult {
  runId: string;
  contractId: string;
  snapshotId: string;
  /** Content hash of the pinned snapshot (spec test 15: saved on every run). */
  snapshotContentHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  trialNumber: number;
  /** Deterministic adjudicated outcome (spec 4.9). */
  outcome: JourneyOutcome;
  /** What the model itself declared, kept separate from the adjudication. */
  modelDeclaredOutcome?: string;
  selectedProductId?: string;
  selectedVariantId?: string;
  constraintEvaluations: ConstraintEvaluation[];
  claimedEvidenceReferences: EvidenceReference[];
  traceEvents: TraceEvent[];
  totalToolCalls: number;
  totalSteps: number;
  estimatedCostUsd: number;
  /** Raw final model text, preserved for debugging (esp. FALSE_CERTAINTY). */
  rawFinalResponse?: string;
  /** Validator notes: every unsupported/rejected evidence claim, verbatim reasons. */
  validationNotes?: string[];
  /** Set by the validator when a satisfied-claim had no trace-backed valid support. */
  unsupportedPositiveClaim?: boolean;
  /** Stage 3: the HARD kind — a claim cited an id no tool returned (or from a
   *  different snapshot). Disables the semantic tier entirely (floor wins). */
  fabricatedEvidenceClaim?: boolean;
  /** Constraint ids whose satisfied-claims remain unsupported (semantic pass
   *  removes the ones it rescues with verified quotes). */
  unsupportedClaimConstraintIds?: string[];
  /** Stage 2: deterministic root cause assigned by the adjudicator (spec 4.1). */
  rootCauseCode?: RootCauseCode;
  /** Stage 2: validator-observed disagreement between price-bearing surfaces
   *  in THIS run's trace (the F4 / STALE_STRUCTURED_DATA signal). */
  priceSourcesDisagree?: boolean;
  /** Stage 3 (spec 4.4): retrieval coverage vs the Store Diagnostic Scan. */
  coverageRatio?: number;
  missedRelevantSurfaces?: EvidenceSurface[];
  /** Stage 3: count of semantic-tier candidates discarded as fabrications
   *  (non-substring quotes) during this run. */
  semanticFabricationsDiscarded?: number;
}

// ---- report ---------------------------------------------------------------

export interface Stage1Report {
  experimentId: string;
  snapshots: { baseId: string; faultyId: string; restoredId: string };
  aggregate: {
    basePasses: number;
    baseRuns: number;
    faultyCorrectFailures: number;
    faultyRuns: number;
    restoredPasses: number;
    restoredRuns: number;
    falseCertaintyCount: number;
    toolFailureCount: number;
    modelFailureCount: number;
  };
  byModel: Array<{
    provider: string;
    model: string;
    basePassRate: number;
    faultyMissingEvidenceRate: number;
    restoredPassRate: number;
  }>;
  acceptance: { passed: boolean; reasons: string[] };
  totalEstimatedCostUsd: number;
}
