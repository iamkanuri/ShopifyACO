import "dotenv/config";

// Single Railway entrypoint. railway.json runs `npm run migrate && npm start` for every
// service built from this repo — CHAINED, not sequenced: `migrate.ts` exits 1 on failure,
// so a failed migration fails the deploy rather than booting the app against an
// unmigrated database. (This comment said `;` and called it non-fatal until v3.3;
// test/deployFacts.test.ts now reads railway.json so it cannot drift again.)
// This dispatcher then branches on PROCESS_MODE so the ONLY per-service difference in
// Railway is one variable:
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
