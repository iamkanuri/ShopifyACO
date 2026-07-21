import { postJson, HttpError } from "../engines/http.js";
import { ENV } from "../server/env.js";
import { MODELS } from "../engines/models.js";
import type { AgentMessage, ModelClient, ModelToolCall, ModelTurn, ToolSpec } from "./agent-runner.js";

// ===========================================================================
// Thin tool-calling adapters for the two Stage 1 model families (AUDIT.md §3).
// The repo's existing engine adapters are completion-only (web-grounded
// shopping answers), so these are NEW clients — same conventions: raw fetch
// via the shared postJson helper, no SDKs, keys from ENV only, never logged.
// Temperature is pinned to the minimum supported; a provider that rejects the
// parameter gets one retry without it (recorded in the turn, not hidden).
// ===========================================================================

// ---- OpenAI (chat completions + function tools) ---------------------------

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAIToolClient(apiKey: string | undefined = ENV.keys.openai): ModelClient {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = MODELS.openai;
  let temperatureSupported = true;

  return {
    provider: "openai",
    model,
    async call(messages: AgentMessage[], tools: ToolSpec[], opts: { maxOutputTokens: number }): Promise<ModelTurn> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map(toOpenAIMessage),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
        max_completion_tokens: opts.maxOutputTokens,
      };
      if (temperatureSupported) body.temperature = 0;

      let json: OpenAIChatResponse;
      try {
        json = await postJson<OpenAIChatResponse>({
          url: "https://api.openai.com/v1/chat/completions",
          headers: { authorization: `Bearer ${apiKey}` },
          body,
        });
      } catch (err) {
        // Some newer OpenAI models reject a pinned temperature — drop it once.
        if (err instanceof HttpError && err.status === 400 && /temperature/i.test(err.body) && temperatureSupported) {
          temperatureSupported = false;
          delete body.temperature;
          json = await postJson<OpenAIChatResponse>({
            url: "https://api.openai.com/v1/chat/completions",
            headers: { authorization: `Bearer ${apiKey}` },
            body,
          });
        } else {
          throw err;
        }
      }

      const msg = json.choices?.[0]?.message;
      const usage = {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      };
      const rawCalls = msg?.tool_calls ?? [];
      if (rawCalls.length > 0) {
        const toolCalls: ModelToolCall[] = rawCalls.map((tc, i) => ({
          callId: tc.id ?? `call-${i}`,
          name: tc.function?.name ?? "",
          args: safeParseArgs(tc.function?.arguments),
        }));
        return { toolCalls, finalText: null, usage };
      }
      return { toolCalls: [], finalText: msg?.content ?? "", usage };
    },
  };
}

function toOpenAIMessage(m: AgentMessage): Record<string, unknown> {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return { role: "user", content: m.content };
    case "assistant":
      if (m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.callId,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      return { role: "assistant", content: m.content };
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
}

function safeParseArgs(argsJson: string | undefined): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---- Gemini (generateContent + functionDeclarations) ----------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function createGeminiToolClient(apiKey: string | undefined = ENV.keys.google): ModelClient {
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not configured");
  const model = MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let thinkingConfigSupported = true;

  return {
    provider: "gemini",
    model,
    async call(messages: AgentMessage[], tools: ToolSpec[], opts: { maxOutputTokens: number }): Promise<ModelTurn> {
      const system = messages.find((m) => m.role === "system");
      const generationConfig: Record<string, unknown> = {
        temperature: 0,
        maxOutputTokens: opts.maxOutputTokens,
      };
      // Disable thinking for determinism + cost; dropped if the API rejects it.
      if (thinkingConfigSupported) generationConfig.thinkingConfig = { thinkingBudget: 0 };

      const body: Record<string, unknown> = {
        systemInstruction: system ? { parts: [{ text: system.content }] } : undefined,
        contents: toGeminiContents(messages),
        tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig,
      };

      let json: GeminiResponse;
      try {
        json = await postJson<GeminiResponse>({ url, headers: { "x-goog-api-key": apiKey }, body });
      } catch (err) {
        if (err instanceof HttpError && err.status === 400 && /thinking/i.test(err.body) && thinkingConfigSupported) {
          thinkingConfigSupported = false;
          delete generationConfig.thinkingConfig;
          json = await postJson<GeminiResponse>({ url, headers: { "x-goog-api-key": apiKey }, body });
        } else {
          throw err;
        }
      }

      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const usage = {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: (json.usageMetadata?.candidatesTokenCount ?? 0) + (json.usageMetadata?.thoughtsTokenCount ?? 0),
      };
      const calls = parts.filter((p) => p.functionCall?.name);
      if (calls.length > 0) {
        const toolCalls: ModelToolCall[] = calls.map((p, i) => ({
          callId: `call-${i}-${p.functionCall!.name}`,
          name: p.functionCall!.name!,
          args: p.functionCall!.args ?? {},
        }));
        return { toolCalls, finalText: null, usage };
      }
      const text = parts.map((p) => p.text ?? "").join("");
      return { toolCalls: [], finalText: text, usage };
    },
  };
}

function toGeminiContents(messages: AgentMessage[]): Array<Record<string, unknown>> {
  const contents: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    switch (m.role) {
      case "system":
        break; // sent as systemInstruction
      case "user":
        contents.push({ role: "user", parts: [{ text: m.content }] });
        break;
      case "assistant":
        if (m.toolCalls?.length) {
          contents.push({
            role: "model",
            parts: m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args } })),
          });
        } else {
          contents.push({ role: "model", parts: [{ text: m.content }] });
        }
        break;
      case "tool": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(m.content);
        } catch {
          parsed = { raw: m.content };
        }
        contents.push({
          role: "user",
          parts: [{ functionResponse: { name: m.toolName ?? "tool", response: { result: parsed } } }],
        });
        break;
      }
    }
  }
  return contents;
}

// ---- registry --------------------------------------------------------------

export function createToolClient(provider: string): ModelClient {
  switch (provider) {
    case "openai":
      return createOpenAIToolClient();
    case "gemini":
      return createGeminiToolClient();
    default:
      throw new Error(`unknown Stage 1 provider: ${provider} (expected openai | gemini)`);
  }
}
