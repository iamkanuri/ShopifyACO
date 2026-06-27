import "dotenv/config";
import process from "node:process";
import { ENV } from "./server/env.js";
import { hasPg, closePg } from "./db/pg.js";
import { startHealthServer } from "./health.js";
import { recoverAbandoned, touchHeartbeat } from "./queue/jobs.js";
import { runDueSchedules } from "./monitoring/execute.js";
import { runRetentionPurge } from "./retention/purge.js";

// Scheduler process (PROCESS_MODE=scheduler / `npm run scheduler`). Runs periodic
// maintenance: recovers abandoned jobs and (in later phases) enqueues due recurring
// benchmark schedules. Single instance is sufficient; it only enqueues, never claims.

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 30_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stopping = false;

async function tick(): Promise<void> {
  const recovered = await recoverAbandoned(ENV.queue.recoverGraceSec);
  if (recovered) console.log(`[scheduler] recovered ${recovered} abandoned job(s)`);
  // Phase 8: enqueue due monitoring schedules (mock unless MONITORING_LIVE=1).
  const sched = await runDueSchedules({ mock: !ENV.monitoringLive });
  if (sched.processed) console.log(`[scheduler] enqueued ${sched.processed} due schedule(s)`);
  // Data-retention purge (compliance): once/day, deletes pixel_events past the window.
  const purge = await runRetentionPurge();
  if (purge.ran) console.log(`[scheduler] retention purge: removed ${purge.pixelEventsDeleted ?? 0} expired pixel_event(s)`);
  await touchHeartbeat("scheduler", { tickMs: TICK_MS });
}

async function main(): Promise<void> {
  if (!hasPg()) {
    console.error("[scheduler] DATABASE_URL not set — cannot run. Exiting.");
    process.exit(1);
  }
  startHealthServer("scheduler"); // satisfy Railway's /healthz check (no Express here)
  console.log(`[scheduler] starting (tick ${TICK_MS}ms)`);
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      console.error("[scheduler] tick error:", (err as Error).message);
    }
    await sleep(TICK_MS);
  }
  await closePg();
  console.log("[scheduler] stopped cleanly");
}

function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[scheduler] ${sig} received — exiting…`);
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("[scheduler] fatal:", (err as Error).message);
  process.exit(1);
});
