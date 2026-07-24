import { estimateCostUsd } from "../engines/models.js";
import { HttpError } from "../engines/http.js";
import type {
  ConstraintEvaluation,
  EvidenceReference,
  JourneyResult,
  ShoppingTaskContract,
  StoreSnapshot,
} from "./types.js";
import { executeStoreTool } from "./store-tools.js";
import { TraceRecorder, addSpend, newRunId, CostBreakerTripped } from "./trace-recorder.js";
import { assertRunnable } from "./preflight.js";
import { validateEvidenceClaims } from "./evidence-validator.js";
import { adjudicate } from "./adjudicator.js";

// ===========================================================================
// Agent runner (spec 4.6/4.7). Drives one journey: system prompt + serialized
// contract → tool-calling loop against the PINNED snapshot → strict-schema
// final JSON → deterministic validation + adjudication. The model client is
// injected (real providers in model-client.ts, scripted agents in mock-model.ts).
//
// This module must NEVER import ground-truth.ts (spec test 16). The agent sees
// no ground truth, no mutation manifest, no expected outcome, and no
// BASE/FAULTY/RESTORED labels — snapshot ids are opaque hashes.
// ===========================================================================

export const PROMPT_VERSION_V1 = "stage1-v1";

export const SYSTEM_PROMPT_STAGE1_V1 = `You are testing whether a Shopify store provides enough explicit evidence to satisfy a shopping task. You are not predicting human behavior. You are not allowed to use general world knowledge to fill in missing product facts. You may rely only on evidence returned by the provided store tools.

For every hard constraint: (1) search the relevant store surfaces; (2) mark it "satisfied" only when direct retrieved evidence supports it; (3) mark it "violated" when direct evidence contradicts it; (4) mark it "unresolvable" when the store does not expose enough evidence; (5) mark it "conflicting" when store sources disagree.

Never infer that a product has an attribute because similar products usually do. Never turn uncertainty into certainty. Never cite evidence that was not returned by a tool.

When finished, return ONLY a structured JSON object (no prose, no code fences) of this exact shape:
{
  "selectedProductId": "<product id, or empty string if none>",
  "selectedVariantId": "<variant id, optional>",
  "constraints": [
    { "constraintId": "<id from the contract>", "status": "satisfied" | "violated" | "unresolvable" | "conflicting", "observedValue": <value or null>, "evidenceIds": ["<evidenceId returned by a tool>"], "explanation": "<one or two sentences>" }
  ],
  "outcome": "PASS" | "MISSING_EVIDENCE" | "CONTRADICTION",
  "explanation": "<concise overall explanation>"
}
A purchase-ready "PASS" requires every hard constraint satisfied with evidence. If required evidence is missing, return "MISSING_EVIDENCE".`;

/** Serialize the contract for the agent: the contract object itself carries no
 *  ground truth, expected outcomes, or snapshot labels — this is the ONLY task
 *  context the agent receives. Validator-only fixtures (conflictTermPairs) and
 *  observational softConstraints are STRIPPED — they belong to the evaluator. */
export function serializeContractForAgent(contract: ShoppingTaskContract): string {
  return (
    "Shopping task contract (verify every hard constraint against store evidence " +
    "using the provided store tools):\n" +
    JSON.stringify(
      {
        id: contract.id,
        objective: contract.objective,
        productScope: contract.productScope,
        hardConstraints: contract.hardConstraints.map(({ conflictTermPairs: _omit, ...rest }) => rest),
        successConditions: contract.successConditions,
        limits: contract.limits,
      },
      null,
      2,
    )
  );
}

// ---- model-client seam -----------------------------------------------------

export interface ModelToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ModelTurn {
  toolCalls: ModelToolCall[];
  finalText: string | null;
  usage: { inputTokens?: number; outputTokens?: number };
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: ModelToolCall[];
  /** Present on tool messages: which call this result answers. */
  toolCallId?: string;
  toolName?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelClient {
  provider: string;
  model: string;
  call(messages: AgentMessage[], tools: ToolSpec[], opts: { maxOutputTokens: number }): Promise<ModelTurn>;
}

export const STORE_TOOL_SPECS: ToolSpec[] = [
  {
    name: "search_store",
    description:
      "Lexical search across the store's product titles, descriptions, metafields, variants, options, and any FAQ/policy text. Returns matching objects with snippets and evidence references.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search terms." } },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description:
      "Fetch one product by id: title, plain-text description, price/variants with availability, options. Every field carries evidence references.",
    parameters: {
      type: "object",
      properties: { productId: { type: "string", description: "Product id, e.g. gid://shopify/Product/123" } },
      required: ["productId"],
    },
  },
  {
    name: "get_product_metafields",
    description: "Fetch a product's metafields (namespace, key, value, type), each with an evidence reference.",
    parameters: {
      type: "object",
      properties: { productId: { type: "string" } },
      required: ["productId"],
    },
  },
  {
    name: "get_faq_or_policy",
    description:
      "Fetch FAQ or store-policy text matching a topic. Returns an explicit empty result if the store exposes no such surface.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "e.g. 'shipping', 'materials', 'returns'" } },
      required: ["topic"],
    },
  },
];

// ---- final-answer schema validation (strict, one repair attempt) -----------

export interface AgentFinalAnswer {
  selectedProductId: string;
  selectedVariantId?: string;
  constraints: Array<{
    constraintId: string;
    status: "satisfied" | "violated" | "unresolvable" | "conflicting";
    observedValue?: unknown;
    evidenceIds: string[];
    explanation: string;
  }>;
  outcome: string;
  explanation: string;
}

const STATUSES = new Set(["satisfied", "violated", "unresolvable", "conflicting"]);

/** Strict parse of the agent's final JSON. Returns null when malformed. */
export function parseFinalAnswer(text: string, contract: ShoppingTaskContract): AgentFinalAnswer | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.selectedProductId !== "string") return null;
  if (typeof o.outcome !== "string" || typeof o.explanation !== "string") return null;
  if (!Array.isArray(o.constraints)) return null;
  const constraints: AgentFinalAnswer["constraints"] = [];
  for (const c of o.constraints) {
    if (!c || typeof c !== "object") return null;
    const cc = c as Record<string, unknown>;
    if (typeof cc.constraintId !== "string" || !STATUSES.has(String(cc.status))) return null;
    if (!Array.isArray(cc.evidenceIds) || !cc.evidenceIds.every((e) => typeof e === "string")) return null;
    constraints.push({
      constraintId: cc.constraintId,
      status: cc.status as AgentFinalAnswer["constraints"][number]["status"],
      observedValue: cc.observedValue,
      evidenceIds: cc.evidenceIds as string[],
      explanation: String(cc.explanation ?? ""),
    });
  }
  // Every hard constraint must be addressed exactly once.
  for (const hc of contract.hardConstraints) {
    if (constraints.filter((c) => c.constraintId === hc.id).length !== 1) return null;
  }
  return {
    selectedProductId: o.selectedProductId,
    selectedVariantId: typeof o.selectedVariantId === "string" ? o.selectedVariantId : undefined,
    constraints,
    outcome: o.outcome,
    explanation: o.explanation,
  };
}

// ---- the loop --------------------------------------------------------------

export interface RunAgentOptions {
  contract: ShoppingTaskContract;
  snapshot: StoreSnapshot;
  client: ModelClient;
  trialNumber: number;
  promptVersion?: string;
  systemPrompt?: string;
  env?: Record<string, string | undefined>;
  /** Stage 3: when present, the bounded semantic tier runs after deterministic
   *  validation and before adjudication (veto + quote-bounded grant, Rule 6). */
  semanticClient?: import("./semantic-tier.js").SemanticClient;
  /** Stage 5: score a READ-ONLY third-party PUBLIC snapshot. When set, the
   *  shop-allowlist gate accepts exactly these shop ids INSTEAD of the
   *  dev-store allowlist. This ONLY affects which snapshot may be READ/scored;
   *  there is no write path anywhere in the runner, so it cannot mutate a store. */
  shopAllowlistOverride?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callModelWithRetry(
  client: ModelClient,
  messages: AgentMessage[],
  tools: ToolSpec[],
  maxOutputTokens: number,
): Promise<ModelTurn> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await client.call(messages, tools, { maxOutputTokens });
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof HttpError ? err.retryable : true;
      if (!retryable || attempt === 3) break;
      await sleep(1000 * attempt * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function runShoppingAgent(options: RunAgentOptions): Promise<JourneyResult> {
  const { contract, snapshot, client, trialNumber } = options;
  const promptVersion = options.promptVersion ?? PROMPT_VERSION_V1;
  const systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT_STAGE1_V1;
  const env = options.env ?? process.env;

  // Hard rails BEFORE anything else (spec Rule 10 / 4.12). Stage 5 scores
  // read-only public snapshots of third-party stores: when an explicit
  // read-only override is supplied, the flag still gates but the shop-allowlist
  // is the override set (there is NO write path in the runner, so this only
  // governs which snapshot may be READ/scored).
  if (options.shopAllowlistOverride) {
    const { flagEnabled } = await import("./preflight.js");
    if (!flagEnabled(env)) throw new Error("refusing to run: feature flag not enabled");
    if (!options.shopAllowlistOverride.includes(contract.productScope.shopId)) {
      throw new Error(`refusing to run: shop '${contract.productScope.shopId}' not in the read-only override allowlist`);
    }
  } else {
    assertRunnable(env, contract.productScope.shopId);
  }
  if (snapshot.shopId !== contract.productScope.shopId) {
    throw new Error("refusing to run: snapshot shop does not match the contract's allowlisted shop");
  }

  const runId = newRunId();
  const recorder = new TraceRecorder(runId, { provider: client.provider, model: client.model, promptVersion });
  recorder.record("RUN_STARTED", {
    contractId: contract.id,
    snapshotId: snapshot.id,
    provider: client.provider,
    model: client.model,
    trialNumber,
  });

  const base: Omit<JourneyResult, "outcome"> = {
    runId,
    contractId: contract.id,
    snapshotId: snapshot.id,
    snapshotContentHash: snapshot.contentHash,
    provider: client.provider,
    model: client.model,
    promptVersion,
    trialNumber,
    constraintEvaluations: [],
    claimedEvidenceReferences: [],
    traceEvents: recorder.events,
    totalToolCalls: 0,
    totalSteps: 0,
    estimatedCostUsd: 0,
  };

  const finish = (partial: Partial<JourneyResult> & { outcome: JourneyResult["outcome"] }): JourneyResult => {
    const result: JourneyResult = { ...base, ...partial };
    recorder.record("RUN_COMPLETED", { outcome: result.outcome, totalToolCalls: result.totalToolCalls, totalSteps: result.totalSteps });
    return result;
  };

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: serializeContractForAgent(contract) },
  ];

  let toolCalls = 0;
  let steps = 0;
  let costUsd = 0;
  let repairUsed = false;

  while (steps < contract.limits.maxSteps) {
    steps++;
    let turn: ModelTurn;
    try {
      turn = await callModelWithRetry(client, messages, STORE_TOOL_SPECS, contract.limits.maxOutputTokens);
    } catch (err) {
      if (err instanceof CostBreakerTripped) throw err;
      recorder.record("ERROR", { kind: "model", message: (err as Error).message });
      return finish({ outcome: "MODEL_FAILURE", totalSteps: steps, totalToolCalls: toolCalls, estimatedCostUsd: costUsd });
    }

    const stepCost = estimateCostUsd(client.model, turn.usage.inputTokens ?? 0, turn.usage.outputTokens ?? 0);
    costUsd += stepCost;
    addSpend(stepCost); // throws CostBreakerTripped past $25 cumulative — hard abort

    if (turn.toolCalls.length > 0) {
      messages.push({ role: "assistant", content: "", toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        if (toolCalls >= contract.limits.maxToolCalls) {
          recorder.record("ERROR", { kind: "budget", message: `tool-call budget (${contract.limits.maxToolCalls}) exhausted` });
          return finish({ outcome: "BUDGET_EXHAUSTED", totalSteps: steps, totalToolCalls: toolCalls, estimatedCostUsd: costUsd });
        }
        recorder.record("TOOL_CALLED", { name: call.name, args: call.args });
        let output: unknown;
        let refs: EvidenceReference[] = [];
        try {
          try {
            ({ output, evidenceReferences: refs } = executeStoreTool(snapshot, call.name, call.args));
          } catch {
            // one retry (spec 4.5) — deterministic tools, but honor the protocol
            ({ output, evidenceReferences: refs } = executeStoreTool(snapshot, call.name, call.args));
          }
        } catch (err) {
          recorder.record("ERROR", { kind: "tool", tool: call.name, message: (err as Error).message });
          return finish({ outcome: "TOOL_FAILURE", totalSteps: steps, totalToolCalls: toolCalls, estimatedCostUsd: costUsd });
        }
        toolCalls++;
        recorder.record("TOOL_RESULT", { name: call.name, output }, { evidenceReferences: refs });
        if (call.name === "get_product" || call.name === "get_product_metafields") {
          recorder.record("PRODUCT_CONSIDERED", { productId: String(call.args.productId ?? "") });
        }
        messages.push({
          role: "tool",
          toolCallId: call.callId,
          toolName: call.name,
          content: JSON.stringify(output),
        });
      }
      continue;
    }

    if (turn.finalText !== null) {
      const parsed = parseFinalAnswer(turn.finalText, contract);
      if (!parsed) {
        if (!repairUsed) {
          repairUsed = true;
          messages.push({ role: "assistant", content: turn.finalText });
          messages.push({
            role: "user",
            content:
              "Your response was not valid JSON matching the required schema. Return ONLY the JSON object described in the instructions — no prose, no code fences.",
          });
          continue; // one repair attempt (spec 4.7)
        }
        recorder.record("ERROR", { kind: "model", message: "final answer failed strict schema validation twice" });
        return finish({
          outcome: "MODEL_FAILURE",
          totalSteps: steps,
          totalToolCalls: toolCalls,
          estimatedCostUsd: costUsd,
          rawFinalResponse: turn.finalText,
        });
      }

      // Resolve claimed evidence ids against what tools ACTUALLY returned.
      const returned = new Map<string, EvidenceReference>();
      for (const ev of recorder.events) {
        if (ev.type !== "TOOL_RESULT") continue;
        for (const r of ev.evidenceReferences ?? []) returned.set(r.evidenceId, r);
      }
      const evaluations: ConstraintEvaluation[] = parsed.constraints.map((c) => ({
        constraintId: c.constraintId,
        status: c.status,
        observedValue: c.observedValue,
        evidenceReferences: c.evidenceIds.flatMap((id) => {
          const r = returned.get(id);
          return r ? [r] : [];
        }),
        claimedEvidenceIds: c.evidenceIds,
        explanation: c.explanation,
      }));
      for (const ev of evaluations) {
        recorder.record("CONSTRAINT_CHECKED", {
          constraintId: ev.constraintId,
          status: ev.status,
          claimedEvidenceIds: ev.claimedEvidenceIds,
        }, { evidenceReferences: ev.evidenceReferences });
      }

      let result: JourneyResult = {
        ...base,
        outcome: "PASS", // provisional; validation + adjudication decide for real
        modelDeclaredOutcome: parsed.outcome,
        selectedProductId: parsed.selectedProductId || undefined,
        selectedVariantId: parsed.selectedVariantId,
        constraintEvaluations: evaluations,
        claimedEvidenceReferences: evaluations.flatMap((e) => e.evidenceReferences),
        totalToolCalls: toolCalls,
        totalSteps: steps,
        estimatedCostUsd: costUsd,
        rawFinalResponse: turn.finalText,
      };

      result = validateEvidenceClaims(result, recorder.events, contract);
      if (options.semanticClient) {
        const { applySemanticTier } = await import("./semantic-tier.js");
        const sem = await applySemanticTier(result, contract, options.semanticClient);
        result = sem.result;
        costUsd += sem.costUsd;
        result.estimatedCostUsd = costUsd;
        if (sem.costUsd > 0) addSpend(sem.costUsd);
        recorder.record("CONSTRAINT_CHECKED", {
          semanticPass: true,
          promptVersion: options.semanticClient.promptVersion,
          notes: sem.notes,
          fabricationsDiscarded: result.semanticFabricationsDiscarded ?? 0,
        });
      }
      const verdict = adjudicate(contract, result, recorder.events);
      result.outcome = verdict.outcome;
      result.rootCauseCode = verdict.rootCause;

      recorder.record("DECISION_MADE", {
        adjudicatedOutcome: result.outcome,
        rootCauseCode: result.rootCauseCode,
        modelDeclaredOutcome: parsed.outcome,
        selectedProductId: parsed.selectedProductId,
        selectedVariantId: parsed.selectedVariantId,
      });
      recorder.record("RUN_COMPLETED", { outcome: result.outcome, totalToolCalls: toolCalls, totalSteps: steps });
      return result;
    }

    // Neither tool calls nor final text — treat as a malformed model turn.
    recorder.record("ERROR", { kind: "model", message: "model returned neither tool calls nor final text" });
    return finish({ outcome: "MODEL_FAILURE", totalSteps: steps, totalToolCalls: toolCalls, estimatedCostUsd: costUsd });
  }

  recorder.record("ERROR", { kind: "budget", message: `step budget (${contract.limits.maxSteps}) exhausted` });
  return finish({ outcome: "BUDGET_EXHAUSTED", totalSteps: steps, totalToolCalls: toolCalls, estimatedCostUsd: costUsd });
}
