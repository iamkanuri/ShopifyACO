import type { EngineResult, GroundingMode } from "../types.js";

/**
 * The single contract every engine implements. Detection / runner / report code
 * depends ONLY on this interface, so new engines (Claude, Copilot, ...) can be
 * added by dropping in a new file + one registry line — nothing else changes.
 */
export interface EngineAdapter {
  /** Stable id used everywhere (config, results, report). */
  readonly name: string;
  readonly model: string;
  /** Grounding mode this adapter will attempt (actual achieved mode is per-result). */
  readonly preferredGrounding: GroundingMode;
  /** True when the required API key (or mock) is available. */
  isConfigured(): boolean;
  /** Ask the engine the prompt. Should resolve even on API error? No — throw; the
   *  runner wraps calls with retry + graceful per-engine capture. */
  generate(prompt: string, signal?: AbortSignal): Promise<EngineResult>;
}
