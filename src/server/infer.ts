import { MODELS, estimateCostUsd } from "../engines/models.js";
import { postJson } from "../engines/http.js";

// "Auto-detect from store name/URL": exactly ONE OpenAI call, hard-capped output so
// cost stays well under the suggest cap. Lets a shopper start a free scan by typing
// just their store — we infer brand, category, competitors, and starter prompts.
// Pure best-effort: any field can come back empty and the UI lets the user fill it.

const MAX_TOKENS = 600;

export interface InferResult {
  brand?: string;
  storeUrl?: string;
  category?: string;
  competitors?: string[];
  prompts?: string[];
  costUsd: number;
  error?: string;
}

export async function inferStore(store: string, apiKey: string | undefined): Promise<InferResult> {
  if (!apiKey) return { costUsd: 0, error: "OPENAI_API_KEY not set" };

  const sys =
    "You identify an e-commerce brand from a store name or website, then describe its " +
    "competitive landscape for an AI-visibility scan. Return strictly JSON.";
  const user =
    `Store: "${store}". Identify the brand and respond as JSON with exactly these keys:\n` +
    `{"brand": "official brand name", "storeUrl": "https://… (the store's main URL, omit if unsure)", ` +
    `"category": "short product category a shopper would search, e.g. 'nonstick cookware'", ` +
    `"competitors": ["3-5 direct competitor brand names in the same category"], ` +
    `"prompts": ["5 realistic buyer-intent questions a shopper would ask an AI assistant when ` +
    `deciding what to buy in this category — mix comparison, budget, use-case, and alternatives"]}\n` +
    `No commentary, JSON only. If you cannot identify the store, return empty strings/arrays.`;

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
        max_completion_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
        temperature: 0.3,
      },
    });

    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = parseInference(content);
    const costUsd = estimateCostUsd(
      MODELS.openai,
      json.usage?.prompt_tokens ?? 0,
      json.usage?.completion_tokens ?? 0,
    );
    return { ...parsed, costUsd };
  } catch (err) {
    return { costUsd: 0, error: (err as Error).message };
  }
}

function parseInference(content: string): Omit<InferResult, "costUsd"> {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const arr = (v: unknown, max: number) =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim()).slice(0, max)
        : [];
    const url = str(obj.storeUrl);
    return {
      brand: str(obj.brand),
      // Only return a URL that actually looks like one, so it passes server validation.
      storeUrl: url && /\./.test(url) ? (/^https?:\/\//.test(url) ? url : `https://${url}`) : undefined,
      category: str(obj.category),
      competitors: arr(obj.competitors, 6),
      prompts: arr(obj.prompts, 8),
    };
  } catch {
    return { competitors: [], prompts: [] };
  }
}

interface ChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
