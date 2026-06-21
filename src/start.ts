import "dotenv/config";

// Single Railway entrypoint. railway.json runs `npm run migrate; npm start` for every
// service built from this repo; this dispatcher then branches on PROCESS_MODE so the
// ONLY per-service difference in Railway is one variable:
//   PROCESS_MODE=web        (default) → the Express app + viewer
//   PROCESS_MODE=worker     → the durable-queue worker loop
//   PROCESS_MODE=scheduler  → periodic maintenance + due monitoring schedules
const mode = (process.env.PROCESS_MODE ?? "web").trim().toLowerCase();
console.log(`[start] PROCESS_MODE=${mode}`);

const entry = mode === "worker" ? "./worker.js" : mode === "scheduler" ? "./scheduler.js" : "./server/index.js";
import(entry).catch((err) => {
  console.error(`[start] failed to start '${mode}':`, err);
  process.exit(1);
});
