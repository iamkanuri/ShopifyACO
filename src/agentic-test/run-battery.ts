import "dotenv/config";
import { runCategoryBattery } from "./stage5-battery.js";
import { categoryByKey } from "./categories/registry.js";

// ===========================================================================
// STAGE 6.2 — category-parameterized battery entrypoint. Runs ONE category's
// live probe battery (resume-safe, $25 breaker). Kept separate from the
// descriptor registry to avoid an import cycle.
//   npx tsx src/agentic-test/run-battery.ts coffee
// ===========================================================================

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/run-battery.ts");
if (isMain) {
  const key = process.argv[2] ?? "coffee";
  const desc = categoryByKey(key);
  runCategoryBattery(desc)
    .then(() => console.log(`[run-battery] ${key} battery complete → ${desc.batteryFile}`))
    .catch((err) => {
      console.error(`[run-battery] FAILED: ${(err as Error).message}`);
      process.exit(1);
    });
}
