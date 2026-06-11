import type { EngineResult } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { MAX_OUTPUT_TOKENS, MODELS, estimateCostUsd } from "./models.js";
import { HttpError, SHOPPING_SYSTEM_PROMPT, postJson } from "./http.js";

/**
 * Google Gemini adapter.
 *  - Preferred: generateContent with the `google_search` grounding tool -> web_grounded.
 *  - Fallback (tool unsupported / 4xx): plain generateContent -> api_model_only.
 */
export function createGeminiAdapter(apiKey: string | undefined): EngineAdapter {
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = () => ({ "x-goog-api-key": apiKey ?? "" });

  return {
    name: "gemini",
    model,
    preferredGrounding: "web_grounded",
    isConfigured: () => Boolean(apiKey),

    async generate(prompt, signal): Promise<EngineResult> {
      try {
        return await call(prompt, true, signal);
      } catch (err) {
        if (err instanceof HttpError && err.retryable) throw err;
        return await call(prompt, false, signal);
      }
    },
  };

  async function call(prompt: string, grounded: boolean, signal?: AbortSignal): Promise<EngineResult> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: SHOPPING_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    };
    if (grounded) body.tools = [{ google_search: {} }];

    const json = await postJson<GeminiPayload>({ url, headers: headers(), body, signal });

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    const inputTokens = json.usageMetadata?.promptTokenCount;
    const outputTokens = json.usageMetadata?.candidatesTokenCount;

    // If we asked for grounding, confirm the model actually grounded; otherwise
    // it silently answered from parametric memory -> report honestly as unknown.
    let mode: EngineResult["groundingMode"];
    if (!grounded) mode = "api_model_only";
    else mode = json.candidates?.[0]?.groundingMetadata ? "web_grounded" : "unknown";

    return {
      engine: "gemini",
      model,
      text,
      groundingMode: mode,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(model, inputTokens ?? 0, outputTokens ?? 0),
      },
      raw: json,
    };
  }
}

interface GeminiPayload {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: unknown;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
