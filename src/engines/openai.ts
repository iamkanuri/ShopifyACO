import type { EngineResult } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { MAX_OUTPUT_TOKENS, MODELS, estimateCostUsd } from "./models.js";
import { HttpError, SHOPPING_SYSTEM_PROMPT, postJson } from "./http.js";
import { dedupeHttpUrls } from "./citations.js";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";

/**
 * OpenAI adapter.
 *  - Preferred: Responses API with the hosted `web_search` tool -> web_grounded.
 *  - Fallback (tool unsupported / 4xx): chat completions -> api_model_only.
 * Retryable errors (429/5xx) bubble up so the runner can back off and retry.
 */
export function createOpenAIAdapter(apiKey: string | undefined): EngineAdapter {
  const model = MODELS.openai;
  const headers = () => ({ authorization: `Bearer ${apiKey}` });

  return {
    name: "openai",
    model,
    preferredGrounding: "web_grounded",
    isConfigured: () => Boolean(apiKey),

    async generate(prompt, signal): Promise<EngineResult> {
      try {
        return await grounded(prompt, signal);
      } catch (err) {
        if (err instanceof HttpError && err.retryable) throw err; // let runner retry
        // Tool unsupported or other non-retryable 4xx — degrade to ungrounded.
        return await ungrounded(prompt, signal);
      }
    },
  };

  async function grounded(prompt: string, signal?: AbortSignal): Promise<EngineResult> {
    const json = await postJson<ResponsesPayload>({
      url: RESPONSES_URL,
      headers: headers(),
      signal,
      body: {
        model,
        instructions: SHOPPING_SYSTEM_PROMPT,
        input: prompt,
        tools: [{ type: "web_search" }],
        max_output_tokens: MAX_OUTPUT_TOKENS,
      },
    });
    return toResult(extractResponsesText(json), json.usage, "web_grounded", json, extractResponsesCitations(json));
  }

  async function ungrounded(prompt: string, signal?: AbortSignal): Promise<EngineResult> {
    const json = await postJson<ChatPayload>({
      url: CHAT_URL,
      headers: headers(),
      signal,
      body: {
        model,
        messages: [
          { role: "system", content: SHOPPING_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
      },
    });
    const text = json.choices?.[0]?.message?.content ?? "";
    return toResult(text, json.usage, "api_model_only", json);
  }

  function toResult(
    text: string,
    usage: OpenAIUsage | undefined,
    grounding: "web_grounded" | "api_model_only",
    raw: unknown,
    citations: string[] = [],
  ): EngineResult {
    const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens;
    const outputTokens = usage?.output_tokens ?? usage?.completion_tokens;
    return {
      engine: "openai",
      model,
      text,
      groundingMode: grounding,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(model, inputTokens ?? 0, outputTokens ?? 0),
      },
      citations,
      raw,
    };
  }
}

// ---- response shapes (only the fields we read) ----------------------------

interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface ResponsesPayload {
  output_text?: string;
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string; annotations?: Array<{ type?: string; url?: string }> }>;
  }>;
  usage?: OpenAIUsage;
}

/** Web-search citations come back as `url_citation` annotations on the output_text parts. */
export function extractResponsesCitations(json: ResponsesPayload): string[] {
  const urls: string[] = [];
  for (const item of json.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      for (const a of c.annotations ?? []) {
        if (a.type === "url_citation" && a.url) urls.push(a.url);
      }
    }
  }
  return dedupeHttpUrls(urls);
}

interface ChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: OpenAIUsage;
}

function extractResponsesText(json: ResponsesPayload): string {
  if (typeof json.output_text === "string" && json.output_text.length > 0) {
    return json.output_text;
  }
  const parts: string[] = [];
  for (const item of json.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  return parts.join("\n");
}
