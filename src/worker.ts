import "dotenv/config";
import process from "node:process";
import { hasPg, closePg } from "./db/pg.js";
import { startHealthServer } from "./health.js";
import { startWorker } from "./queue/runner.js";
import { registerCatalogJobs } from "./catalog/sync.js";
import { registerBenchmarkJobs } from "./benchmarks/execute.js";
import { registerDiagnosisJobs } from "./diagnosis/execute.js";
import { registerExperimentJobs } from "./experiments/execute.js";
import { registerMonitoringJobs } from "./monitoring/execute.js";

// Standalone worker process (PROCESS_MODE=worker / `npm run worker`). Thin wrapper
// around the shared worker loop; safe to run as multiple Railway replicas.

if (!hasPg()) {
  console.error("[worker] DATABASE_URL not set — cannot run the job queue. Exiting.");
  process.exit(1);
}

startHealthServer("worker"); // satisfy Railway's /healthz check (no Express here)
registerCatalogJobs(); // register job handlers before claiming
registerBenchmarkJobs();
registerDiagnosisJobs();
registerExperimentJobs();
registerMonitoringJobs();
const handle = startWorker("svc");

async function shutdown(sig: string) {
  console.log(`[worker] ${sig} — draining…`);
  handle.stop();
  setTimeout(async () => {
    await closePg().catch(() => {});
    process.exit(0);
  }, 1_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
