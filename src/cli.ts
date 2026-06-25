import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { EngineAdapter } from "./engines/types.js";
import { ASSUMED_INPUT_TOKENS, MAX_OUTPUT_TOKENS, estimateCostUsd, fixedCostPerCall } from "./engines/models.js";

export interface CliArgs {
  configPath: string;
  mock: boolean;
  dryRun: boolean;
  limitPrompts?: number;
  maxCostUsd?: number;
  saveRaw: boolean; // default ON
  yes: boolean;
  outDir: string;
  concurrency?: number;
}

const HELP = `
ShopifyACO — AI visibility scanner

Usage:
  npm run scan -- <config.json> [flags]

Flags:
  --mock               Deterministic fake engines, zero API spend
  --dry-run            Expand prompts + print the plan only, no calls
  --limit-prompts N    Cap the number of expanded prompts
  --max-cost-usd X     Abort if est. max cost exceeds X; hard-stop mid-run if exceeded
  --no-save-raw        Don't keep raw API payloads in results.json (default: keep)
  --yes                Skip the confirmation prompt before a live run
  --out DIR            Output directory (default: ./results)
  --concurrency N      Max concurrent engine calls (overrides config)
  -h, --help           Show this help
`;

export function parseArgs(argv: string[]): CliArgs | "help" {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) return "help";

  let configPath = "";
  const out: CliArgs = {
    configPath: "",
    mock: false,
    dryRun: false,
    saveRaw: true,
    yes: false,
    outDir: "results",
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case "--mock": out.mock = true; break;
      case "--dry-run": out.dryRun = true; break;
      case "--yes": case "-y": out.yes = true; break;
      case "--no-save-raw": out.saveRaw = false; break;
      case "--save-raw": out.saveRaw = true; break;
      case "--limit-prompts": out.limitPrompts = Number(args[++i]); break;
      case "--max-cost-usd": out.maxCostUsd = Number(args[++i]); break;
      case "--out": out.outDir = args[++i]!; break;
      case "--concurrency": out.concurrency = Number(args[++i]); break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        configPath = a;
    }
  }

  if (!configPath) throw new Error("Missing config file path. See --help.");
  out.configPath = configPath;
  return out;
}

export function helpText(): string {
  return HELP;
}

/** Worst-case cost: every call uses max output tokens, across every adapter, PLUS each
 *  engine's fixed per-call (grounded-search) fee so the reservation isn't undercount. */
export function estimateMaxCost(promptCount: number, adapters: EngineAdapter[]): number {
  let total = 0;
  for (const a of adapters) {
    total += promptCount * (estimateCostUsd(a.model, ASSUMED_INPUT_TOKENS, MAX_OUTPUT_TOKENS) + fixedCostPerCall(a.model));
  }
  return total;
}

export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
