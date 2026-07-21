import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { EvidenceReference, JourneyResult, TraceEvent, TraceEventType } from "./types.js";

// ===========================================================================
// Trace recorder + persistence (spec 4.1/4.7). Every run appends its events to
// a JSONL file as they happen (crash-safe) and the finished JourneyResult is
// written as JSON, keyed by (contractId, snapshotId, provider, model,
// trialNumber, promptVersion) — all stamped inside the record (spec test 15).
// ===========================================================================

/** Results dir — env-overridable so tests can write to a scratch location. */
export function resultsDir(): string {
  return process.env.AGENTIC_STAGE1_RESULTS_DIR ?? join(process.cwd(), "experiments", "agentic-stage1", "results");
}

export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export class TraceRecorder {
  readonly runId: string;
  readonly events: TraceEvent[] = [];
  private seq = 0;
  private readonly file: string;
  private readonly modelInfo?: { provider: string; model: string; promptVersion: string };

  constructor(runId: string, modelInfo?: { provider: string; model: string; promptVersion: string }) {
    this.runId = runId;
    this.modelInfo = modelInfo;
    mkdirSync(resultsDir(), { recursive: true });
    this.file = join(resultsDir(), `${runId}.trace.jsonl`);
  }

  record(
    type: TraceEventType,
    payload: Record<string, unknown>,
    extras: {
      evidenceReferences?: EvidenceReference[];
      usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
    } = {},
  ): TraceEvent {
    const event: TraceEvent = {
      runId: this.runId,
      timestamp: new Date().toISOString(),
      sequence: this.seq++,
      type,
      payload,
      evidenceReferences: extras.evidenceReferences,
      model: this.modelInfo,
      usage: extras.usage,
    };
    this.events.push(event);
    appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }
}

/** Persist a finished journey. The result JSON carries snapshot id, snapshot
 *  content hash, and prompt version on every run — required by spec test 15. */
export function persistJourneyResult(result: JourneyResult): string {
  for (const field of ["snapshotId", "snapshotContentHash", "promptVersion"] as const) {
    if (!result[field]) throw new Error(`journey result missing required field: ${field}`);
  }
  mkdirSync(resultsDir(), { recursive: true });
  const file = join(resultsDir(), `${result.runId}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
  appendFileSync(
    join(resultsDir(), "index.jsonl"),
    `${JSON.stringify({
      runId: result.runId,
      contractId: result.contractId,
      snapshotId: result.snapshotId,
      snapshotContentHash: result.snapshotContentHash,
      provider: result.provider,
      model: result.model,
      trialNumber: result.trialNumber,
      promptVersion: result.promptVersion,
      outcome: result.outcome,
      estimatedCostUsd: result.estimatedCostUsd,
    })}\n`,
    "utf8",
  );
  return file;
}

// ---- cumulative cost circuit breaker (spec Rule 14) ------------------------

const spendFile = () => join(resultsDir(), "spend.json");
export const COST_BREAKER_USD = 25;

export class CostBreakerTripped extends Error {
  constructor(totalUsd: number) {
    super(
      `COST CIRCUIT BREAKER: cumulative estimated API spend $${totalUsd.toFixed(4)} ` +
        `would exceed the hard $${COST_BREAKER_USD} limit — experiment aborted (spec Rule 14)`,
    );
    this.name = "CostBreakerTripped";
  }
}

export function readCumulativeSpend(): number {
  if (!existsSync(spendFile())) return 0;
  try {
    const parsed = JSON.parse(readFileSync(spendFile(), "utf8")) as { totalUsd?: number };
    return Number(parsed.totalUsd ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Add spend; throws CostBreakerTripped when the cumulative total would exceed the cap. */
export function addSpend(usd: number): number {
  const total = readCumulativeSpend() + (Number.isFinite(usd) ? usd : 0);
  mkdirSync(resultsDir(), { recursive: true });
  writeFileSync(spendFile(), JSON.stringify({ totalUsd: total }, null, 2), "utf8");
  if (total > COST_BREAKER_USD) throw new CostBreakerTripped(total);
  return total;
}
