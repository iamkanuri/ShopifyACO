import "dotenv/config";
import process from "node:process";
import { hasPg, closePg } from "./db/pg.js";
import { startWorker } from "./queue/runner.js";
import { registerCatalogJobs } from "./catalog/sync.js";

// Standalone worker process (PROCESS_MODE=worker / `npm run worker`). Thin wrapper
// around the shared worker loop; safe to run as multiple Railway replicas.

if (!hasPg()) {
  console.error("[worker] DATABASE_URL not set — cannot run the job queue. Exiting.");
  process.exit(1);
}

registerCatalogJobs(); // register job handlers before claiming
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
