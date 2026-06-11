import "dotenv/config";
import process from "node:process";
import { CliArgs, confirm, estimateMaxCost, helpText, parseArgs } from "./cli.js";
import { loadConfig } from "./config.js";
import { expandPrompts } from "./prompts.js";
import { buildAdapters, type ApiKeys } from "./engines/index.js";
import { runScan } from "./runner.js";
import { writeReports } from "./report.js";
import type { RunMeta } from "./types.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if (parsed === "help") {
    console.log(helpText());
    return;
  }
  const args: CliArgs = parsed;

  const cfg = await loadConfig(args.configPath);

  // ---- Expand prompts ------------------------------------------------------
  const { prompts: allPrompts, warnings } = expandPrompts(cfg);
  for (const w of warnings) console.warn(`⚠️  ${w}`);
  const prompts =
    args.limitPrompts && args.limitPrompts > 0 ? allPrompts.slice(0, args.limitPrompts) : allPrompts;

  // ---- Resolve engines -----------------------------------------------------
  const keys: ApiKeys = {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_AI_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  const { adapters, skipped } = buildAdapters(cfg, keys, args.mock);
  for (const s of skipped) console.warn(`⚠️  Skipping engine "${s.name}": ${s.reason}`);

  // ---- Dry run -------------------------------------------------------------
  if (args.dryRun) {
    console.log(`\nDRY RUN — ${prompts.length} expanded prompt(s):\n`);
    prompts.forEach((p, i) => console.log(`  ${String(i + 1).padStart(3)}. ${p.prompt}`));
    console.log(`\nEngines that would run: ${adapters.map((a) => a.name).join(", ") || "(none)"}`);
    console.log(`Total calls would be: ${prompts.length * adapters.length}`);
    return;
  }

  if (adapters.length === 0) {
    console.error("No engines available to run. Check your API keys or --mock. Aborting.");
    process.exitCode = 1;
    return;
  }

  // ---- Pre-run summary + cost guard + confirmation -------------------------
  const totalCalls = prompts.length * adapters.length;
  const engineNames = adapters.map((a) => a.name);
  const mode = args.mock ? "mock" : "live";

  if (!args.mock) {
    const estMax = estimateMaxCost(prompts.length, adapters);
    console.log("\n=== Pre-run summary ===");
    console.log(`  Brand:        ${cfg.brand.name}  (category: ${cfg.category})`);
    console.log(`  Prompts:      ${prompts.length}`);
    console.log(`  Engines:      ${engineNames.join(", ")}`);
    console.log(`  Total calls:  ${totalCalls}`);
    console.log(`  Est. MAX cost: $${estMax.toFixed(4)} (worst case, all max tokens)`);

    if (args.maxCostUsd !== undefined && estMax > args.maxCostUsd) {
      console.error(
        `\nAborting: estimated max cost $${estMax.toFixed(4)} exceeds --max-cost-usd ${args.maxCostUsd}.`,
      );
      process.exitCode = 1;
      return;
    }

    if (!args.yes) {
      const ok = await confirm("Proceed with the LIVE run?");
      if (!ok) {
        console.log("Cancelled.");
        return;
      }
    }
  }

  // ---- Run -----------------------------------------------------------------
  const startedAt = new Date().toISOString();
  console.log(`\nRunning ${mode} scan...\n`);
  const results = await runScan(prompts, adapters, cfg, {
    concurrency: args.concurrency ?? cfg.concurrency ?? 4,
    maxCostUsd: args.maxCostUsd,
    saveRaw: args.saveRaw,
    onProgress: (m) => console.log("  " + m),
  });
  const finishedAt = new Date().toISOString();

  // ---- Report --------------------------------------------------------------
  const meta: RunMeta = {
    startedAt,
    finishedAt,
    mode,
    engines: engineNames,
    promptCount: prompts.length,
    totalCalls,
  };
  const { jsonPath, mdPath, agg } = await writeReports(results, cfg, { outDir: args.outDir, meta });

  const own = agg.overall.find((b) => b.isOwn)!;
  console.log("\n=== Done ===");
  console.log(
    `  ${cfg.brand.name}: mentioned ${(own.mentionRate * 100).toFixed(0)}%, ` +
      `recommended ${(own.recommendationRate * 100).toFixed(0)}%`,
  );
  console.log(`  Est. cost: $${agg.totalCost.costUsd.toFixed(4)}`);
  if (agg.hasUngroundedEngine) console.log("  ⚠️  Some engines ran without web grounding.");
  console.log(`  Report:  ${mdPath}`);
  console.log(`  Results: ${jsonPath}`);
}

main().catch((err) => {
  console.error(`\nError: ${(err as Error).message}`);
  process.exitCode = 1;
});
