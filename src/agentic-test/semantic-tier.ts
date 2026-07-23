import { postJson, HttpError } from "../engines/http.js";
import { ENV } from "../server/env.js";
import { MODELS, estimateCostUsd } from "../engines/models.js";
import type {
  ConstraintEvaluation,
  EvidenceReference,
  JourneyResult,
  ShoppingConstraint,
  ShoppingTaskContract,
} from "./types.js";
import { normalizeForMatch } from "./util.js";
import { referenceSupportsConstraint } from "./evidence-validator.js";

// ===========================================================================
// SEMANTIC EVIDENCE TIER (Stage 3, spec 4.2) — bounded model judgment above
// the deterministic floor. Safety asymmetry (Rule 6):
//   GRANT:  only with a verbatim-substring-verified quote (quote-bounded).
//   VETO:   only demotes an explicit lexical match whose containing sentence
//           is judged to be about another subject (conservative — withholds
//           credit, never invents it).
// The deterministic floor's guarantee — no fabricated citation survives — is
// preserved: every non-substring quote is DISCARDED and counted as a
// semantic-tier fabrication; an agent-level unsupported claim (FALSE_CERTAINTY
// path) disables all grants for the run.
// ===========================================================================

/** sem-v2: the single allowed prompt revision (recorded; both versions'
 *  Gate A results reported). sem-v1 defined support as asserting the attribute
 *  "for THE PRODUCT ITSELF", which made the judge veto LEGITIMATE store-policy
 *  evidence (delivery timing's proper subject IS the shipping policy) —
 *  caught by the BASE regression cell. sem-v2 scopes the legitimate subject by
 *  attribute kind; packaging-style lookalikes are still rejected. */
export const SEM_PROMPT_VERSION = "sem-v2";

export interface SemanticCandidate {
  exactQuote: string;
  verdict: "supports" | "contradicts" | "about_other_subject";
  subject: string;
}

export interface SemanticProposal {
  candidates: SemanticCandidate[];
  costUsd: number;
}

export interface SemanticClient {
  provider: string;
  model: string;
  promptVersion: string;
  propose(surfaceText: string, constraint: ShoppingConstraint): Promise<SemanticProposal>;
}

// ---- deterministic verification wrapper ------------------------------------

/** Keep only candidates whose exactQuote is a VERBATIM substring of the
 *  normalized surface text; everything else is a counted fabrication. */
export function verifySemanticCandidates(
  surfaceText: string,
  candidates: SemanticCandidate[],
): { verified: SemanticCandidate[]; fabrications: number } {
  const haystack = normalizeForMatch(surfaceText);
  const verified: SemanticCandidate[] = [];
  let fabrications = 0;
  for (const c of candidates) {
    const quote = String(c.exactQuote ?? "").trim();
    if (quote && haystack.includes(normalizeForMatch(quote))) {
      verified.push({ ...c, exactQuote: quote });
    } else {
      fabrications++;
    }
  }
  return { verified, fabrications };
}

// ---- the semantic pass (runs AFTER deterministic validation) ---------------

export interface SemanticPassOutcome {
  result: JourneyResult;
  costUsd: number;
  notes: string[];
}

const isTextEvidence = (r: EvidenceReference): boolean => Boolean(r.exactText && r.exactText.trim());

/** Rule 6 veto scope: ONLY explicit LEXICAL (term-based) matches are vetoable.
 *  Structured support (variant availability, prices, keyed metafields) is not
 *  an aboutness question — sending it to the judge caused the Gate A c3 bug. */
function isVetoableTextSupport(
  ref: EvidenceReference,
  constraint: ShoppingConstraint,
  scope: { productId?: string; variantId?: string },
): boolean {
  if (!isTextEvidence(ref)) return false;
  const verdict = referenceSupportsConstraint(ref, constraint, scope);
  return verdict.supports && verdict.reason.startsWith("text matches");
}

/** Apply claim-rescue + veto + grant per Rule 6. Never touches
 *  violated/conflicting statuses or deterministic overrides. Disabled entirely
 *  when the run cited FABRICATED evidence (nonexistent / foreign-snapshot ids)
 *  — the deterministic floor wins outright there. */
export async function applySemanticTier(
  result: JourneyResult,
  contract: ShoppingTaskContract,
  client: SemanticClient,
): Promise<SemanticPassOutcome> {
  const notes: string[] = [];
  let costUsd = 0;
  let fabrications = 0;

  if (result.fabricatedEvidenceClaim) {
    return { result, costUsd: 0, notes: ["semantic tier skipped: run cited fabricated evidence (floor wins)"] };
  }

  const retrieved = result.traceEvents
    .filter((e) => e.type === "TOOL_RESULT")
    .flatMap((e) => e.evidenceReferences ?? []);
  const dedupById = new Map(retrieved.map((r) => [r.evidenceId, r]));
  const allRetrieved = [...dedupById.values()];

  let evaluations: ConstraintEvaluation[] = [...result.constraintEvaluations];
  const rescued = new Set<string>();
  const scope = contract.productScope;

  for (const constraint of contract.hardConstraints) {
    const idx = evaluations.findIndex((e) => e.constraintId === constraint.id);
    if (idx === -1) continue;
    const evaluation = evaluations[idx]!;

    // ---- CLAIM-RESCUE path: the agent cited REAL in-scope refs that failed
    // only the lexical check (e.g. genuine paraphrases). Quote-bounded
    // semantic judgment decides whether the claim was honest. --------------
    if (evaluation.status === "unresolvable" && evaluation.pendingSemanticRefs?.length) {
      const pending = evaluation.pendingSemanticRefs.filter(isTextEvidence).slice(0, 16);
      if (pending.length) {
        const joined = pending.map((r) => r.exactText!).join("\n");
        const proposal = await client.propose(joined, constraint);
        costUsd += proposal.costUsd;
        const { verified, fabrications: f } = verifySemanticCandidates(joined, proposal.candidates);
        fabrications += f;
        const supports = verified.filter((c) => c.verdict === "supports");
        const grantedRefs = pending.filter((r) =>
          supports.some((c) => normalizeForMatch(r.exactText!).includes(normalizeForMatch(c.exactQuote))),
        );
        if (grantedRefs.length) {
          rescued.add(constraint.id);
          notes.push(`constraint '${constraint.id}': agent's claim RESCUED at SEMANTIC_VERIFIED (quote "${supports[0]!.exactQuote.slice(0, 60)}…")`);
          evaluations[idx] = {
            ...evaluation,
            status: "satisfied",
            confidenceTier: "SEMANTIC_VERIFIED",
            evidenceReferences: grantedRefs,
            pendingSemanticRefs: undefined,
            explanation: `${evaluation.explanation} [SEMANTIC RESCUE: quote-verified support for the agent's citation]`,
          };
          continue;
        }
      }
      notes.push(`constraint '${constraint.id}': claim NOT rescued — semantic tier found no verified support`);
      continue;
    }

    // ---- VETO path: explicit satisfied → aboutness check on LEXICAL matches --
    if (evaluation.status === "satisfied") {
      const textRefs = evaluation.evidenceReferences.filter((r) => isVetoableTextSupport(r, constraint, scope));
      const structuredRefs = evaluation.evidenceReferences.filter((r) => !textRefs.includes(r));
      if (textRefs.length === 0) {
        evaluations[idx] = { ...evaluation, confidenceTier: "EXPLICIT" };
        continue; // structured support (availability/price/keyed metafields) — aboutness does not apply
      }
      const joined = textRefs.map((r) => r.exactText!).join("\n");
      const proposal = await client.propose(joined, constraint);
      costUsd += proposal.costUsd;
      const { verified, fabrications: f } = verifySemanticCandidates(joined, proposal.candidates);
      fabrications += f;

      const keptRefs = textRefs.filter((r) => {
        const sentence = normalizeForMatch(r.exactText!);
        const aboutOther = verified.some(
          (c) => c.verdict === "about_other_subject" && sentence.includes(normalizeForMatch(c.exactQuote)),
        );
        const alsoSupports = verified.some(
          (c) => c.verdict === "supports" && sentence.includes(normalizeForMatch(c.exactQuote)),
        );
        // Conservative veto: demote ONLY when judged about another subject and
        // NOT also judged supporting.
        return !(aboutOther && !alsoSupports);
      });
      const demoted = textRefs.length - keptRefs.length;
      if (demoted > 0) notes.push(`constraint '${constraint.id}': ${demoted} explicit match(es) vetoed as about another subject`);

      const remaining = [...keptRefs, ...structuredRefs];
      if (remaining.length === 0) {
        evaluations[idx] = {
          ...evaluation,
          status: "unresolvable",
          evidenceReferences: [],
          rejectedAboutness: true,
          confidenceTier: undefined,
          explanation: `${evaluation.explanation} [SEMANTIC VETO: every explicit match is about another subject]`,
        };
      } else {
        evaluations[idx] = { ...evaluation, evidenceReferences: remaining, confidenceTier: "EXPLICIT" };
      }
      continue;
    }

    // ---- GRANT path: unresolvable → quote-bounded semantic support ---------
    if (evaluation.status === "unresolvable" && constraint.evidenceRequired) {
      const candidatesRefs = allRetrieved
        .filter((r) => constraint.acceptableSurfaces.includes(r.surface) && isTextEvidence(r))
        .slice(0, 16);
      if (candidatesRefs.length === 0) continue;
      const joined = candidatesRefs.map((r) => r.exactText!).join("\n");
      const proposal = await client.propose(joined, constraint);
      costUsd += proposal.costUsd;
      const { verified, fabrications: f } = verifySemanticCandidates(joined, proposal.candidates);
      fabrications += f;

      const supports = verified.filter((c) => c.verdict === "supports");
      if (supports.length === 0) continue;
      // Map each verified supporting quote back to the retrieved ref(s) whose
      // sentence contains it — grants stay trace-backed.
      const grantedRefs = candidatesRefs.filter((r) =>
        supports.some((c) => normalizeForMatch(r.exactText!).includes(normalizeForMatch(c.exactQuote))),
      );
      if (grantedRefs.length === 0) continue;
      notes.push(
        `constraint '${constraint.id}': SEMANTIC_VERIFIED grant from quote "${supports[0]!.exactQuote.slice(0, 60)}…"`,
      );
      evaluations[idx] = {
        ...evaluation,
        status: "satisfied",
        confidenceTier: "SEMANTIC_VERIFIED",
        evidenceReferences: grantedRefs,
        rejectedAboutness: undefined,
        explanation: `${evaluation.explanation} [SEMANTIC GRANT: quote-verified paraphrase support]`,
      };
    }
  }

  // Recompute the FALSE_CERTAINTY flag: rescued claims are no longer
  // unsupported; fabricated claims can never be rescued (early return above).
  const remainingUnsupported = (result.unsupportedClaimConstraintIds ?? []).filter((id) => !rescued.has(id));

  return {
    result: {
      ...result,
      constraintEvaluations: evaluations,
      claimedEvidenceReferences: evaluations.flatMap((e) => e.evidenceReferences),
      validationNotes: [...(result.validationNotes ?? []), ...notes],
      semanticFabricationsDiscarded: (result.semanticFabricationsDiscarded ?? 0) + fabrications,
      unsupportedClaimConstraintIds: remainingUnsupported,
      unsupportedPositiveClaim: Boolean(result.fabricatedEvidenceClaim) || remainingUnsupported.length > 0,
    },
    costUsd,
    notes,
  };
}

// ---- real client (designated inexpensive model: gemini-2.5-flash) ----------

const SEM_SYSTEM = `You judge whether STORE TEXT provides evidence about an attribute. Reply with ONLY a JSON array (no prose, no fences). For each relevant claim in the text output an object:
{"exactQuote": "<VERBATIM substring copied character-for-character from the text>", "verdict": "supports" | "contradicts" | "about_other_subject", "subject": "<what the quoted claim is about>"}
Rules: "supports" ONLY if the quote asserts the attribute about the LEGITIMATE SUBJECT stated in the request. If the attribute is asserted about anything else (packaging, wrappers, shipping materials, a different product), the verdict is "about_other_subject" and subject names that thing. "contradicts" if the quote asserts the attribute does NOT hold for the legitimate subject. Output [] if nothing in the text is relevant. Never paraphrase inside exactQuote.`;

/** The attribute's legitimate subject, derived deterministically from the
 *  constraint: policy-surface attributes are properly about the store's
 *  applicable policy, not the product formula. */
export function legitimateSubject(constraint: ShoppingConstraint): string {
  const policyish = constraint.acceptableSurfaces.some((s) => s === "shipping_policy" || s === "returns_policy");
  return policyish
    ? "the store's applicable policy or service terms (e.g. shipping/delivery/returns) for its products"
    : "the product itself (its formula/contents/properties)";
}

export function createGeminiSemanticClient(apiKey: string | undefined = ENV.keys.google): SemanticClient {
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured");
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  return {
    provider: "gemini",
    model,
    promptVersion: SEM_PROMPT_VERSION,
    async propose(surfaceText: string, constraint: ShoppingConstraint): Promise<SemanticProposal> {
      const user =
        `Attribute: ${constraint.attribute} (${constraint.operator}${constraint.expectedValue !== undefined ? ` ${JSON.stringify(constraint.expectedValue)}` : ""})\n` +
        `LEGITIMATE SUBJECT: ${legitimateSubject(constraint)}\n` +
        `STORE TEXT:\n${surfaceText}`;
      let json:
        | {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
          }
        | null = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          json = await postJson({
            url,
            headers: { "x-goog-api-key": apiKey },
            body: {
              systemInstruction: { parts: [{ text: SEM_SYSTEM }] },
              contents: [{ role: "user", parts: [{ text: user }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
            },
          });
          break;
        } catch (err) {
          const retryable = err instanceof HttpError ? err.retryable : true;
          if (!retryable || attempt === 4) {
            // Conservative degradation: no judgment → no veto, no grant. Loudly
            // logged so a degraded run is never mistaken for a clean one.
            console.warn(`[semantic-tier] propose failed after ${attempt} attempt(s): ${(err as Error).message.slice(0, 140)} — returning no judgment`);
            return { candidates: [], costUsd: 0 };
          }
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
      if (!json) return { candidates: [], costUsd: 0 };
      const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const costUsd = estimateCostUsd(
        model,
        json.usageMetadata?.promptTokenCount ?? 0,
        (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0),
      );
      return { candidates: parseCandidates(text), costUsd };
    },
  };
}

/** Strict-ish parse: JSON array of candidate objects; anything else → []. */
export function parseCandidates(text: string): SemanticCandidate[] {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(stripped.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((c) => {
      const o = c as Record<string, unknown>;
      const verdict = String(o.verdict ?? "");
      if (typeof o.exactQuote !== "string" || !["supports", "contradicts", "about_other_subject"].includes(verdict)) return [];
      return [{ exactQuote: o.exactQuote, verdict: verdict as SemanticCandidate["verdict"], subject: String(o.subject ?? "") }];
    });
  } catch {
    return [];
  }
}

// ---- scripted mocks ($0 plumbing validation) --------------------------------

/** Deterministic scripted judgment from text content only (no labels): the
 *  attribute term asserted of packaging/shipping materials → about_other_subject;
 *  common "we don't use X" paraphrase shapes → supports, quoting the sentence. */
export function createScriptedSemanticMock(): SemanticClient {
  return {
    provider: "mock",
    model: "scripted-semantic-mock",
    promptVersion: "sem-mock",
    async propose(surfaceText: string, constraint: ShoppingConstraint): Promise<SemanticProposal> {
      const attr = constraint.attribute.replace(/_/g, " ").split(" ")[0]!; // e.g. "aluminum"
      const out: SemanticCandidate[] = [];
      for (const sentence of surfaceText.split("\n").map((s) => s.trim()).filter(Boolean)) {
        const lower = sentence.toLowerCase();
        if (!lower.includes(attr)) continue;
        if (/(packaging|wrapper|box|shipping material)/.test(lower)) {
          out.push({ exactQuote: sentence, verdict: "about_other_subject", subject: "packaging" });
        } else if (
          new RegExp(`won't find ${attr}|${attr} never|skip the ${attr}|no ${attr}|without ${attr}|${attr}[ -]free|free of ${attr}`).test(lower)
        ) {
          out.push({ exactQuote: sentence, verdict: "supports", subject: "the product formula" });
        }
      }
      return { candidates: out, costUsd: 0 };
    },
  };
}

/** SemanticLiarMock (spec 4.2): proposes a PLAUSIBLE quote that is NOT a
 *  substring of the surface text — the wrapper must discard it. */
export function createSemanticLiarMock(): SemanticClient {
  return {
    provider: "mock",
    model: "semantic-liar-mock",
    promptVersion: "sem-mock",
    async propose(_surfaceText: string, constraint: ShoppingConstraint): Promise<SemanticProposal> {
      return {
        candidates: [
          {
            exactQuote: `This product is certified 100% ${constraint.attribute.replace(/_/g, "-")} by an independent laboratory.`,
            verdict: "supports",
            subject: "the product",
          },
        ],
        costUsd: 0,
      };
    },
  };
}
