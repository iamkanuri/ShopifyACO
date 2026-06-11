import type { Config } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { createOpenAIAdapter } from "./openai.js";
import { createGeminiAdapter } from "./gemini.js";
import { createPerplexityAdapter } from "./perplexity.js";
import { createAnthropicAdapter } from "./anthropic.js";
import { createMockAdapter } from "./mock.js";

export interface ApiKeys {
  openai?: string;
  google?: string;
  perplexity?: string;
  anthropic?: string;
}

/**
 * The full adapter roster. Add a new engine (Claude, Copilot, ...) by adding one
 * line here — nothing else in the codebase needs to change.
 */
function allAdapters(keys: ApiKeys): EngineAdapter[] {
  return [
    createOpenAIAdapter(keys.openai),
    createGeminiAdapter(keys.google),
    createPerplexityAdapter(keys.perplexity),
    createAnthropicAdapter(keys.anthropic), // placeholder; isConfigured() === false
  ];
}

export interface BuildResult {
  adapters: EngineAdapter[];
  /** Engines requested in config but skipped (missing key / unknown name). */
  skipped: { name: string; reason: string }[];
}

/**
 * Resolve the active adapters for a run.
 *  - mock: deterministic fake engines (openai/gemini/perplexity), no keys needed.
 *  - live: real adapters that are both requested and configured.
 */
export function buildAdapters(cfg: Config, keys: ApiKeys, mock: boolean): BuildResult {
  const requested = cfg.engines ?? ["openai", "gemini", "perplexity"];

  if (mock) {
    const adapters = requested
      .filter((n) => ["openai", "gemini", "perplexity"].includes(n))
      .map((n) => createMockAdapter(n, cfg.brand, cfg.competitors));
    return { adapters, skipped: [] };
  }

  const roster = new Map(allAdapters(keys).map((a) => [a.name, a]));
  const adapters: EngineAdapter[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const name of requested) {
    const adapter = roster.get(name);
    if (!adapter) {
      skipped.push({ name, reason: "unknown engine" });
    } else if (!adapter.isConfigured()) {
      skipped.push({ name, reason: "no API key (or not implemented)" });
    } else {
      adapters.push(adapter);
    }
  }
  return { adapters, skipped };
}
