import type { Config, PromptEngineResult } from "../types.js";
import type { DiscoveredBrand } from "./types.js";
import { MODELS, estimateCostUsd } from "../engines/models.js";
import { postJson } from "../engines/http.js";
import { grounded } from "./util.js";

// ---------------------------------------------------------------------------
// Unlisted-competitor surfacing (paid-report Phase 0 hardening, Fix 1). Real scans
// show AI assistants overwhelmingly recommend brands the merchant DIDN'T configure
// (Loewe, Bottega, The Row for handbags; Huel, Bloom for supplements). The tool was
// blind to them because it only measures the configured competitor list. The data is
// already in the captured answer text — this parses it out and surfaces it.
//
// SCOPE (bounded parse-and-surface, NOT a competitor-scoring subsystem):
//   • Frequency-of-appearance ONLY — no mention/recommend rate, no rank.
//   • Never injected into the competitor list / leaderboard; never gets a "vs" card.
//   • Hallucination floor: a brand must appear in ≥2 answers to be surfaced, and the
//     extraction prompt only counts brands presented as RECOMMENDED options (not
//     dismissed / compared-against-negatively / passing mentions).
//
// This is the one analysis step that is ASYNC + costs money (a cheap per-answer
// gpt-5.4-mini pass over already-captured text). It is deliberately kept OUT of the pure
// analyzeRun — the scan orchestration calls it and attaches the result.
// ---------------------------------------------------------------------------

const MODEL = MODELS.openai; // gpt-5.4-mini — cheap, JSON-mode, plain chat (no web_search here)
const MAX_TOKENS = 220;
const MIN_ANSWERS = 2; // hallucination floor
const MAX_SURFACED = 6;
const MAX_TEXT_CHARS = 4000;

export interface DiscoverOptions {
  apiKey: string | undefined;
  concurrency?: number;
  /** Injectable per-answer extractor for tests ($0, no network). Defaults to the LLM pass. */
  extractor?: (text: string, category: string) => Promise<{ brands: string[]; cost: number }>;
}

export interface DiscoverResult {
  brands: DiscoveredBrand[];
  /** Total grounded answers considered (the "of M" in "seen in N of M answers"). */
  answersConsidered: number;
  costUsd: number;
}

export async function extractDiscoveredBrands(
  results: PromptEngineResult[],
  cfg: Config,
  opts: DiscoverOptions,
): Promise<DiscoverResult> {
  const answers = grounded(results).filter((r) => typeof r.text === "string" && r.text.length > 40);
  const total = answers.length;
  const extract = opts.extractor ?? ((text: string, category: string) => extractOne(text, category, opts.apiKey!));
  if ((!opts.apiKey && !opts.extractor) || total < MIN_ANSWERS) {
    return { brands: [], answersConsidered: total, costUsd: 0 };
  }

  const isKnown = buildKnownMatcher(cfg);

  const perAnswer = await mapConcurrent(answers, opts.concurrency ?? 4, (r) => extract(r.text, cfg.category));

  let costUsd = 0;
  const tally = new Map<string, { display: string; count: number }>();
  for (const { brands, cost } of perAnswer) {
    costUsd += cost;
    const seenThisAnswer = new Set<string>(); // count each brand at most once per answer
    for (const raw of brands) {
      const norm = normalize(raw);
      if (!norm || norm.length < 2 || isKnown(norm) || seenThisAnswer.has(norm)) continue;
      seenThisAnswer.add(norm);
      const cur = tally.get(norm) ?? { display: raw.trim(), count: 0 };
      cur.count += 1;
      tally.set(norm, cur);
    }
  }

  const brands = [...tally.values()]
    .filter((v) => v.count >= MIN_ANSWERS) // 2-answer floor: single hits are dropped
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .slice(0, MAX_SURFACED)
    .map((v) => ({ name: v.display, answers: v.count }));

  return { brands, answersConsidered: total, costUsd };
}

// ---- one-answer extraction -------------------------------------------------

interface ChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function extractOne(text: string, category: string, apiKey: string): Promise<{ brands: string[]; cost: number }> {
  const sys = "You extract brand names from a shopping answer. Respond with strict JSON only.";
  const user =
    `From the AI shopping answer below about "${category}", list ONLY the brand names that are presented ` +
    `as RECOMMENDED or SUGGESTED options to BUY in this category. ` +
    `EXCLUDE any brand mentioned only to dismiss it, to compare against negatively ("unlike X"), or in passing. ` +
    `EXCLUDE retailers/marketplaces (Amazon, Nordstrom) and generic terms. Use each brand's clean name, no product/model. ` +
    `Respond as JSON: {"brands": ["Brand A", "Brand B"]}. If none qualify, {"brands": []}.\n\n` +
    `ANSWER:\n"""${text.slice(0, MAX_TEXT_CHARS)}"""`;
  try {
    const json = await postJson<ChatPayload>({
      url: "https://api.openai.com/v1/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        max_completion_tokens: MAX_TOKENS,
        response_format: { type: "json_object" },
        temperature: 0.1,
      },
    });
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as { brands?: unknown };
    const brands = Array.isArray(parsed.brands)
      ? parsed.brands.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 20)
      : [];
    const cost = estimateCostUsd(MODEL, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0);
    return { brands, cost };
  } catch {
    return { brands: [], cost: 0 }; // best-effort: a failed answer just contributes nothing
  }
}

// ---- helpers ---------------------------------------------------------------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(inc|llc|co|company|brand)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exclude the merchant's own brand and every configured competitor (name + aliases + products). */
function buildKnownMatcher(cfg: Config): (norm: string) => boolean {
  const set = new Set<string>();
  const add = (v?: string) => {
    const n = v ? normalize(v) : "";
    if (n) set.add(n);
  };
  for (const b of [cfg.brand, ...cfg.competitors]) {
    add(b.name);
    (b.aliases ?? []).forEach(add);
    (b.products ?? []).forEach(add);
  }
  return (norm: string) => set.has(norm);
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}
