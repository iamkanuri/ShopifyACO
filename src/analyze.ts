import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import type { RunResults } from "./types.js";
import { writeReports } from "./report.js";

/**
 * Offline re-analysis: read an existing results.json and regenerate report.md +
 * results.json (with refreshed analysis). No API calls — pure recompute.
 *
 *   npm run analyze -- results/results.json
 */
async function main(): Promise<void> {
  const path = process.argv[2] ?? "results/results.json";
  const abs = resolve(path);
  const run = JSON.parse(await readFile(abs, "utf8")) as RunResults;

  if (!run.results || !run.config || !run.meta) {
    throw new Error(`Not a valid results.json: ${abs}`);
  }
  // Back-compat: older fixtures may lack the per-result `text` field.
  for (const r of run.results) if (r.text === undefined) r.text = "";

  const outDir = dirname(abs);
  const { jsonPath, mdPath, analysis } = await writeReports(run.results, run.config, {
    outDir,
    meta: run.meta,
  });

  console.log(`Re-analyzed ${run.results.length} results (offline, no API calls).`);
  console.log(`  AI Visibility Score: ${analysis.visibilityScore.score}/100`);
  console.log(`  Fix cards: ${analysis.fixCards.length}`);
  console.log(`  Report:  ${mdPath}`);
  console.log(`  Results: ${jsonPath}`);
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exitCode = 1;
});
