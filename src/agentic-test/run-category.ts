import "dotenv/config";
import { closePg } from "../db/pg.js";
import { runStage5, rerenderStage5 } from "./stage5-run.js";
import { categoryByKey } from "./categories/registry.js";

// ===========================================================================
// STAGE 6.2 — full-pipeline entrypoint for ANY category descriptor.
//   npx tsx src/agentic-test/run-category.ts coffee 10 20        # live run
//   npx tsx src/agentic-test/run-category.ts coffee --rerender   # offline ($0)
//   npx tsx src/agentic-test/run-category.ts deodorant --rerender 5
// ===========================================================================

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/run-category.ts");
if (isMain) {
  const key = process.argv[2] ?? "coffee";
  const desc = categoryByKey(key);
  if (process.argv.includes("--rerender")) {
    const capArg = process.argv.find((a, i) => i >= 3 && /^\d+$/.test(a));
    try {
      rerenderStage5({ desc, maxCases: capArg ? Number(capArg) : key === "deodorant" ? 5 : 20 });
    } catch (err) {
      console.error(`[run-category] rerender FAILED: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    const maxProspects = Number(process.argv[3] ?? 10);
    const maxCases = Number(process.argv[4] ?? 20);
    runStage5({ desc, maxProspects, maxCases })
      .then((r) => {
        console.log(`[run-category] ${key}: diagnosed ${r.diagnosed}, rendered ${r.rendered}`);
        return closePg();
      })
      .catch(async (err) => {
        console.error(`[run-category] FAILED: ${(err as Error).message}`);
        await closePg();
        process.exit(1);
      });
  }
}
