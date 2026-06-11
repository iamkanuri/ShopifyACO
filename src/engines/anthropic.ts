import type { EngineResult } from "../types.js";
import type { EngineAdapter } from "./types.js";
import { MODELS } from "./models.js";

/**
 * PLACEHOLDER — Anthropic / Claude adapter is NOT implemented yet.
 *
 * It exists to prove the extension point: implementing this fully is a matter of
 * filling in `generate()` (Messages API + web_search tool for grounding) and
 * registering it in ./index.ts — no other module changes. See CLAUDE.md TODO.
 * Copilot will follow the same shape.
 */
export function createAnthropicAdapter(apiKey: string | undefined): EngineAdapter {
  return {
    name: "anthropic",
    model: MODELS.anthropic,
    preferredGrounding: "web_grounded",
    // Always false for now so the registry never activates it.
    isConfigured: () => false,
    async generate(): Promise<EngineResult> {
      void apiKey;
      throw new Error("Anthropic adapter not implemented (see CLAUDE.md TODO).");
    },
  };
}
