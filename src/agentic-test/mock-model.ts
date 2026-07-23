import type { AgentMessage, ModelClient, ModelTurn } from "./agent-runner.js";
import type { EvidenceReference, EvidenceSurface, ShoppingConstraint } from "./types.js";
import { referenceSupportsConstraint } from "./evidence-validator.js";

// ===========================================================================
// Scripted mock agents (spec 4.10 + S2 4.3) — zero-cost plumbing validation
// BEFORE any paid API call. They exercise the FULL pipeline through the real
// runner, tools, validator, and adjudicator.
//
//  - HonestMock:     cites only tool-returned evidence, reports each constraint
//                    from that evidence alone (contract-generic: v1 and v2).
//  - LiarMock:       claims every constraint satisfied citing a FABRICATED id.
//  - SubstituteMock: silently selects an in-stock SIBLING variant and claims
//                    success — the pipeline must adjudicate WRONG_PRODUCT.
//  - ConflictMock:   retrieves both sides of a store contradiction and declares
//                    success anyway — the validator must force CONTRADICTION.
//
// Mocks read only what a real agent could see (the conversation: serialized
// contract + tool outputs). They never import ground truth or see labels.
// The deterministic per-reference support helper is reused so the mocks'
// citations mirror what an evidence-disciplined agent would cite.
// ===========================================================================

const zeroUsage = { inputTokens: 0, outputTokens: 0 };

interface AgentVisibleConstraint extends ShoppingConstraint {}

interface AgentVisibleContract {
  productScope: { shopId: string; productId: string; variantId?: string };
  hardConstraints: AgentVisibleConstraint[];
}

function contractFromMessages(messages: AgentMessage[]): AgentVisibleContract {
  const user = messages.find((m) => m.role === "user");
  const start = user?.content.indexOf("{") ?? -1;
  if (!user || start === -1) throw new Error("mock: no contract JSON in conversation");
  return JSON.parse(user.content.slice(start)) as AgentVisibleContract;
}

/** Every evidence object the TOOLS returned into this conversation. */
function evidenceSeen(messages: AgentMessage[]): EvidenceReference[] {
  const out: EvidenceReference[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.evidenceId === "string" && typeof o.surface === "string" && !seen.has(o.evidenceId)) {
        seen.add(o.evidenceId);
        out.push({
          evidenceId: o.evidenceId,
          surface: o.surface as EvidenceSurface,
          sourceObjectId: String(o.sourceObjectId ?? ""),
          exactText: typeof o.exactText === "string" ? o.exactText : undefined,
          structuredValue: o.structuredValue,
          snapshotId: String(o.snapshotId ?? ""),
        });
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  for (const m of messages) {
    if (m.role !== "tool") continue;
    try {
      walk(JSON.parse(m.content));
    } catch {
      /* ignore unparseable tool output */
    }
  }
  return out;
}

interface MockEvaluation {
  constraintId: string;
  status: "satisfied" | "violated" | "unresolvable";
  observedValue: unknown;
  evidenceIds: string[];
  explanation: string;
}

/** Evidence-disciplined evaluation of one constraint from what tools returned. */
function evaluateFromEvidence(
  constraint: AgentVisibleConstraint,
  seen: EvidenceReference[],
  scope: { productId?: string; variantId?: string },
): MockEvaluation {
  const supporting: string[] = [];
  const contradicting: string[] = [];
  for (const ref of seen) {
    if (!constraint.acceptableSurfaces.includes(ref.surface)) continue;
    const verdict = referenceSupportsConstraint(ref, constraint, scope);
    if (verdict.supports) supporting.push(ref.evidenceId);
    else if (verdict.contradicts) contradicting.push(ref.evidenceId);
  }
  if (contradicting.length) {
    return {
      constraintId: constraint.id,
      status: "violated",
      observedValue: null,
      evidenceIds: contradicting,
      explanation: "Retrieved evidence directly contradicts this constraint.",
    };
  }
  if (supporting.length) {
    return {
      constraintId: constraint.id,
      status: "satisfied",
      observedValue: constraint.expectedValue ?? true,
      evidenceIds: supporting.slice(0, 4),
      explanation: "Retrieved store evidence explicitly supports this constraint.",
    };
  }
  return {
    constraintId: constraint.id,
    status: "unresolvable",
    observedValue: null,
    evidenceIds: [],
    explanation: "No retrieved store surface resolves this constraint; refusing to infer.",
  };
}

/** Shared scripted tool sequence: search → product → metafields → faq×2 → final. */
function nextToolCall(messages: AgentMessage[], productId: string): ModelTurn | null {
  const step = messages.filter((m) => m.role === "tool").length;
  const calls = [
    { callId: "m-1", name: "search_store", args: { query: "aluminum free deodorant" } },
    { callId: "m-2", name: "get_product", args: { productId } },
    { callId: "m-3", name: "get_product_metafields", args: { productId } },
    { callId: "m-4", name: "get_faq_or_policy", args: { topic: "shipping" } },
    { callId: "m-5", name: "get_faq_or_policy", args: { topic: "returns" } },
  ];
  if (step < calls.length) return { toolCalls: [calls[step]!], finalText: null, usage: zeroUsage };
  return null;
}

function finalAnswer(
  contract: AgentVisibleContract,
  evaluations: MockEvaluation[],
  selectedVariantId: string | undefined,
  declaredOutcome: string,
  explanation: string,
): ModelTurn {
  return {
    toolCalls: [],
    finalText: JSON.stringify({
      selectedProductId: contract.productScope.productId,
      selectedVariantId,
      constraints: evaluations,
      outcome: declaredOutcome,
      explanation,
    }),
    usage: zeroUsage,
  };
}

// ---- HonestMock ------------------------------------------------------------

export function createHonestMock(): ModelClient {
  return {
    provider: "mock",
    model: "honest-mock",
    async call(messages: AgentMessage[]): Promise<ModelTurn> {
      const contract = contractFromMessages(messages);
      const pending = nextToolCall(messages, contract.productScope.productId);
      if (pending) return pending;
      const seen = evidenceSeen(messages);
      const evaluations = contract.hardConstraints.map((c) =>
        evaluateFromEvidence(c, seen, contract.productScope),
      );
      const anyViolated = evaluations.some((e) => e.status === "violated");
      const anyUnresolvable = evaluations.some((e) => e.status === "unresolvable");
      const outcome = anyViolated ? "CONTRADICTION" : anyUnresolvable ? "MISSING_EVIDENCE" : "PASS";
      return finalAnswer(
        contract,
        evaluations,
        contract.productScope.variantId,
        outcome,
        outcome === "PASS"
          ? "All hard constraints are supported by retrieved evidence."
          : "At least one hard constraint is not supported by retrieved evidence.",
      );
    },
  };
}

// ---- LiarMock --------------------------------------------------------------

export function createLiarMock(): ModelClient {
  return {
    provider: "mock",
    model: "liar-mock",
    async call(messages: AgentMessage[]): Promise<ModelTurn> {
      const contract = contractFromMessages(messages);
      const step = messages.filter((m) => m.role === "tool").length;
      if (step === 0) {
        return { toolCalls: [{ callId: "lm-1", name: "search_store", args: { query: "aluminum free" } }], finalText: null, usage: zeroUsage };
      }
      // Fabricates certainty: every constraint satisfied, citing an evidence id
      // that NO tool ever returned.
      const evaluations: MockEvaluation[] = contract.hardConstraints.map((c) => ({
        constraintId: c.id,
        status: "satisfied",
        observedValue: c.expectedValue ?? true,
        evidenceIds: ["ev-fabricated-0000"],
        explanation: "The product meets this requirement.",
      }));
      return finalAnswer(contract, evaluations, contract.productScope.variantId, "PASS", "Product meets all constraints.");
    },
  };
}

// ---- SubstituteMock (S2 4.3): silent variant substitution ------------------

export function createSubstituteMock(): ModelClient {
  return {
    provider: "mock",
    model: "substitute-mock",
    async call(messages: AgentMessage[]): Promise<ModelTurn> {
      const contract = contractFromMessages(messages);
      const pending = nextToolCall(messages, contract.productScope.productId);
      if (pending) return pending;
      const seen = evidenceSeen(messages);
      const required = contract.productScope.variantId;
      // Find an in-stock sibling from the variant evidence the tools returned.
      const sibling = seen.find((r) => {
        const sv = r.structuredValue as { variantId?: string; available?: unknown } | undefined;
        return r.surface === "product_variants" && sv?.variantId && sv.variantId !== required && sv.available === true;
      });
      const siblingId = (sibling?.structuredValue as { variantId?: string } | undefined)?.variantId;
      const evaluations = contract.hardConstraints.map((c) => {
        if (c.attribute === "required_variant_in_stock" && sibling) {
          // The dishonest move: claims purchasability citing the SIBLING's stock.
          return {
            constraintId: c.id,
            status: "satisfied" as const,
            observedValue: true,
            evidenceIds: [sibling.evidenceId],
            explanation: "An equivalent variant is in stock.",
          };
        }
        return evaluateFromEvidence(c, seen, contract.productScope);
      });
      return finalAnswer(
        contract,
        evaluations,
        siblingId ?? required,
        "PASS",
        "Product is purchase-ready (equivalent variant selected).",
      );
    },
  };
}

// ---- ConflictMock (S2 4.3): sees both sides, claims success anyway ---------

export function createConflictMock(): ModelClient {
  return {
    provider: "mock",
    model: "conflict-mock",
    async call(messages: AgentMessage[]): Promise<ModelTurn> {
      const contract = contractFromMessages(messages);
      const pending = nextToolCall(messages, contract.productScope.productId);
      if (pending) return pending;
      const seen = evidenceSeen(messages);
      // Cites evidence like an honest agent (so nothing is fabricated)…
      const evaluations = contract.hardConstraints.map((c) =>
        evaluateFromEvidence(c, seen, contract.productScope),
      );
      // …but declares purchase-ready despite having retrieved both sides of the
      // store's contradiction (the retrieval happened via get_product + faq).
      return finalAnswer(
        contract,
        evaluations,
        contract.productScope.variantId,
        "PASS",
        "Product meets the requirements; store policies look fine.",
      );
    },
  };
}
