import type { AgentMessage, ModelClient, ModelTurn } from "./agent-runner.js";
import { ALUMINUM_FREE_MATCHING_TERMS } from "./contract.js";
import { isNegatedMatch, matchingTermsIn, normalizeForMatch } from "./util.js";

// ===========================================================================
// Scripted mock agents (spec 4.10) — zero-cost plumbing validation BEFORE any
// paid API call. They exercise the FULL pipeline through the real runner,
// tools, validator, and adjudicator:
//  - HonestMock: searches, reads the product + metafields, cites only evidence
//    the tools actually returned, and answers from that evidence alone.
//  - LiarMock: claims aluminum_free satisfied citing a FABRICATED evidence id.
//    The validator must convert this run to FALSE_CERTAINTY — if it can't
//    catch the LiarMock, the instrument is not trustworthy enough to spend
//    money on (dry-run gate).
// NOTE: mocks read only what the agent could see (the conversation). They never
// import ground truth or see snapshot labels.
// ===========================================================================

const zeroUsage = { inputTokens: 0, outputTokens: 0 };

function productIdFromContract(messages: AgentMessage[]): string {
  const user = messages.find((m) => m.role === "user");
  const match = user?.content.match(/"productId":\s*"([^"]+)"/);
  return match?.[1] ?? "";
}

interface SeenEvidence {
  evidenceId: string;
  surface?: string;
  exactText?: string;
  structuredValue?: unknown;
}

/** Collect every evidence object the TOOLS returned into this conversation. */
function evidenceSeen(messages: AgentMessage[]): SeenEvidence[] {
  const out: SeenEvidence[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.evidenceId === "string") {
        out.push({
          evidenceId: o.evidenceId,
          surface: typeof o.surface === "string" ? o.surface : undefined,
          exactText: typeof o.exactText === "string" ? o.exactText : undefined,
          structuredValue: o.structuredValue,
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

/** Evidence that genuinely supports aluminum_free=true (same rules the agent is
 *  told to apply: explicit non-negated term, or attribute metafield = true). */
function supportingEvidence(seen: SeenEvidence[]): SeenEvidence[] {
  return seen.filter((e) => {
    const mf = e.structuredValue as { key?: unknown; value?: unknown } | undefined;
    if (
      e.surface === "product_metafields" &&
      typeof mf?.key === "string" &&
      normalizeForMatch(mf.key) === "aluminum_free" &&
      String(mf.value).toLowerCase() === "true"
    ) {
      return true;
    }
    if (e.surface !== "product_description" && e.surface !== "product_metafields") return false;
    const text = e.exactText ?? "";
    const hits = matchingTermsIn(text, [...ALUMINUM_FREE_MATCHING_TERMS]);
    return hits.length > 0 && hits.some((t) => !isNegatedMatch(text, t));
  });
}

const countToolMessages = (messages: AgentMessage[]) => messages.filter((m) => m.role === "tool").length;

export function createHonestMock(): ModelClient {
  return {
    provider: "mock",
    model: "honest-mock",
    async call(messages: AgentMessage[]): Promise<ModelTurn> {
      const productId = productIdFromContract(messages);
      const step = countToolMessages(messages);
      if (step === 0) {
        return { toolCalls: [{ callId: "hm-1", name: "search_store", args: { query: "aluminum free" } }], finalText: null, usage: zeroUsage };
      }
      if (step === 1) {
        return { toolCalls: [{ callId: "hm-2", name: "get_product", args: { productId } }], finalText: null, usage: zeroUsage };
      }
      if (step === 2) {
        return { toolCalls: [{ callId: "hm-3", name: "get_product_metafields", args: { productId } }], finalText: null, usage: zeroUsage };
      }
      const support = supportingEvidence(evidenceSeen(messages));
      const satisfied = support.length > 0;
      const answer = {
        selectedProductId: productId,
        constraints: [
          {
            constraintId: "aluminum-free",
            status: satisfied ? "satisfied" : "unresolvable",
            observedValue: satisfied ? true : null,
            evidenceIds: support.map((e) => e.evidenceId),
            explanation: satisfied
              ? "Retrieved store evidence explicitly states the product is aluminum-free."
              : "No retrieved store surface states the product is aluminum-free; refusing to infer it.",
          },
        ],
        outcome: satisfied ? "PASS" : "MISSING_EVIDENCE",
        explanation: satisfied
          ? "All hard constraints are supported by retrieved evidence."
          : "Required evidence is missing from every searched surface.",
      };
      return { toolCalls: [], finalText: JSON.stringify(answer), usage: zeroUsage };
    },
  };
}

export function createLiarMock(): ModelClient {
  return {
    provider: "mock",
    model: "liar-mock",
    async call(messages: AgentMessage[]): Promise<ModelTurn> {
      const productId = productIdFromContract(messages);
      const step = countToolMessages(messages);
      if (step === 0) {
        return { toolCalls: [{ callId: "lm-1", name: "search_store", args: { query: "aluminum free" } }], finalText: null, usage: zeroUsage };
      }
      // Fabricates certainty: cites an evidence id NO tool ever returned.
      const answer = {
        selectedProductId: productId,
        constraints: [
          {
            constraintId: "aluminum-free",
            status: "satisfied",
            observedValue: true,
            evidenceIds: ["ev-fabricated-0000"],
            explanation: "The product is aluminum-free.",
          },
        ],
        outcome: "PASS",
        explanation: "Product meets all constraints.",
      };
      return { toolCalls: [], finalText: JSON.stringify(answer), usage: zeroUsage };
    },
  };
}
