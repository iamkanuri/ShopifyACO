import type { Config } from "../types.js";
import type { ApiKeys } from "../engines/index.js";
import { registerHandler } from "../queue/handlers.js";
import { generatePaidReport } from "./generate.js";
import { getPaidReportBySession, markGenerating, markComplete, markHeld } from "../db/paidReports.js";
import { alertOwner } from "./notify.js";

// The `paid_report_generate` queue handler (Phase 2). Runs on the WORKER. Idempotent on
// session_id (Stripe re-sends), and on failure it HOLDS the report + alerts the owner, then
// throws so the queue retries with backoff. The time-based auto-refund fallback is a separate
// scheduler task (see src/paid/refundSweep.ts) so a stuck report never silently strands a payment.

export const PAID_REPORT_JOB = "paid_report_generate";

function keysFromEnv(): ApiKeys {
  return {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
}

export function registerPaidReportJobs(): void {
  registerHandler(PAID_REPORT_JOB, async (payload) => {
    const sessionId = String(payload.sessionId ?? "");
    const runId = String(payload.runId ?? "");
    const config = payload.config as Config | undefined;
    const mock = Boolean(payload.mock);
    if (!sessionId || !runId || !config) throw new Error("paid_report_generate: missing sessionId/runId/config");

    // Idempotency: a re-delivered event (or a duplicate enqueue) must not regenerate/recharge.
    const existing = await getPaidReportBySession(sessionId);
    if (existing?.status === "complete") return { ok: true, skipped: "already_complete" };

    await markGenerating(sessionId);
    try {
      // TEST-ONLY failure injection. Exercises the held→alert→auto-refund path WITHOUT setting a
      // real budget knob (PAID_SPEND_CAP_USD=0) to a dangerous value on a live service — which is
      // indistinguishable from a catastrophic misconfig and, if left on, fails EVERY buyer. This
      // flag is unambiguously a test trigger, and scoping it to a specific runId/sessionId means a
      // left-on flag can only ever fail the one test order, never a real customer. Unset in prod.
      // ("1" is a blunt fail-ALL escape hatch — avoid it on a live service.)
      const forceFail = process.env.PAID_FORCE_FAIL;
      if (forceFail && (forceFail === "1" || forceFail === runId || forceFail === sessionId)) {
        throw new Error(`PAID_FORCE_FAIL: forced failure for failure-path testing (run=${runId}). No generation attempted.`);
      }
      const out = await generatePaidReport({ runId, config, keys: keysFromEnv(), mock });
      await markComplete(sessionId, out.report, out.artifacts, out.costUsd);
      return { ok: true, costUsd: out.costUsd, artifacts: out.artifacts.artifacts.length };
    } catch (err) {
      const msg = (err as Error).message;
      await markHeld(sessionId, msg).catch(() => {});
      // Alert immediately — the owner gets a window to hand-fix before the auto-refund fallback.
      await alertOwner(
        `Paid report generation failed (held) — ${sessionId}`,
        `run=${runId} failed to generate: ${msg}. It's HELD; re-run it or it auto-refunds after the window.`,
      );
      throw err; // let the queue retry/backoff/dead-letter
    }
  });
}
