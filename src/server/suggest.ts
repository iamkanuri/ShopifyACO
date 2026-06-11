import type { ScanForm } from "../prompts/library.js";
import { MODELS, estimateCostUsd } from "../engines/models.js";
import { postJson } from "../engines/http.js";

// Optional "Suggest more with AI": exactly ONE OpenAI call, hard-capped output so
// cost stays under ~$0.02. Never loops. Falls back gracefully if the key is missing
// or the response can't be parsed.

const MAX_SUGGEST_TOKENS = 350; // bounds cost: 350 out + ~250 in on gpt-4o ≈ $0.004

export interface SuggestResult {
  prompts: string[];
  costUsd: number;
  error?: string;
}

export async function suggestPrompts(form: ScanForm, apiKey: string | undefined): Promise<SuggestResult> {
  if (!apiKey) return { prompts: [], costUsd: 0, error: "OPENAI_API_KEY not set" };

  const competitors = form.competitors.map((c) => c.name).join(", ") || "(none given)";
  const sys =
    "You generate realistic search prompts a shopper would type to an AI assistant " +
    "when deciding what to buy. Return strictly JSON.";
  const user =
    `Category: ${form.category}. Competitors: ${competitors}. ` +
    (form.persona ? `Buyer: ${form.persona}. ` : "") +
    (form.priceRange ? `Budget: ${form.priceRange}. ` : "") +
    `Propose 6 ADDITIONAL distinct buyer-intent prompts (comparison, budget, use-case, ` +
    `gift, alternatives). Respond as JSON: {"prompts": ["...", "..."]}. No commentary.`;

  try {
    const json = await postJson<ChatPayload>({
      url: "https://api.openai.com/v1/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model: MODELS.openai,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        max_tokens: MAX_SUGGEST_TOKENS,
        response_format: { type: "json_object" },
        temperature: 0.7,
      },
    });

    const content = json.choices?.[0]?.message?.content ?? "{}";
    const prompts = parsePrompts(content);
    const costUsd = estimateCostUsd(
      MODELS.openai,
      json.usage?.prompt_tokens ?? 0,
      json.usage?.completion_tokens ?? 0,
    );
    return { prompts, costUsd };
  } catch (err) {
    return { prompts: [], costUsd: 0, error: (err as Error).message };
  }
}

function parsePrompts(content: string): string[] {
  try {
    const obj = JSON.parse(content);
    const arr = Array.isArray(obj) ? obj : obj.prompts;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string").map((s) => s.trim()).slice(0, 8);
  } catch {
    return [];
  }
}

interface ChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
