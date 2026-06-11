import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Aggregate,
  BrandStats,
  BrandDetection,
  Config,
  PromptEngineResult,
  RunMeta,
  RunResults,
} from "./types.js";
import { aggregate } from "./aggregate.js";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Recommended=2, mentioned=1, absent=0 — used to decide "who won" a prompt. */
function score(d: BrandDetection | undefined): number {
  if (!d || !d.mentioned) return 0;
  return d.status === "recommended" ? 2 : 1;
}

export interface WriteOptions {
  outDir: string;
  meta: RunMeta;
}

export async function writeReports(
  results: PromptEngineResult[],
  cfg: Config,
  opts: WriteOptions,
): Promise<{ jsonPath: string; mdPath: string; agg: Aggregate }> {
  const agg = aggregate(results, cfg);
  await mkdir(opts.outDir, { recursive: true });

  const runResults: RunResults = { meta: opts.meta, config: cfg, results, aggregate: agg };
  const jsonPath = join(opts.outDir, "results.json");
  await writeFile(jsonPath, JSON.stringify(runResults, null, 2), "utf8");

  const mdPath = join(opts.outDir, "report.md");
  await writeFile(mdPath, buildMarkdown(results, cfg, agg, opts.meta), "utf8");

  return { jsonPath, mdPath, agg };
}

function buildMarkdown(
  results: PromptEngineResult[],
  cfg: Config,
  agg: Aggregate,
  meta: RunMeta,
): string {
  const brandName = cfg.brand.name;
  const own = agg.overall.find((b) => b.isOwn)!;
  const competitors = agg.overall.filter((b) => !b.isOwn);
  const L: string[] = [];

  // ---- Header --------------------------------------------------------------
  L.push(`# AI Visibility Report — ${brandName}`);
  L.push("");
  L.push(`**Category:** ${cfg.category}`);
  L.push(
    `**Run:** ${meta.mode.toUpperCase()} · ${meta.engines.join(", ")} · ` +
      `${meta.promptCount} prompts × ${meta.engines.length} engines = ${meta.totalCalls} calls`,
  );
  L.push(`**Generated:** ${meta.finishedAt}`);
  L.push("");

  // ---- Executive summary ---------------------------------------------------
  L.push("## Executive summary");
  L.push("");
  const rankByMention = [...agg.overall].sort((a, b) => b.mentionRate - a.mentionRate);
  const ownRank = rankByMention.findIndex((b) => b.isOwn) + 1;
  L.push(
    `- **${brandName}** was mentioned in **${pct(own.mentionRate)}** of answers and ` +
      `explicitly **recommended in ${pct(own.recommendationRate)}**.`,
  );
  L.push(
    `- That ranks **#${ownRank} of ${agg.overall.length}** by mention rate ` +
      `(brand + ${competitors.length} competitors).`,
  );
  const topComp = [...competitors].sort((a, b) => b.recommendationRate - a.recommendationRate)[0];
  if (topComp) {
    L.push(
      `- Top competitor by recommendation rate: **${topComp.name}** ` +
        `(${pct(topComp.recommendationRate)} recommended, ${pct(topComp.mentionRate)} mentioned).`,
    );
  }
  if (agg.hasUngroundedEngine) {
    L.push(
      `- ⚠️ **Some engines ran without web grounding** — see the grounding table; ` +
        `those results reflect model memory, not live shopping data.`,
    );
  }
  L.push("");

  // ---- Grounding -----------------------------------------------------------
  L.push("## Grounding status");
  L.push("");
  L.push("| Engine | Model | Grounding | Calls | Errors |");
  L.push("|---|---|---|---|---|");
  for (const g of agg.grounding) {
    const flag = g.groundingMode === "web_grounded" ? "✅ web_grounded" : `⚠️ ${g.groundingMode}`;
    L.push(`| ${g.engine} | ${g.model} | ${flag} | ${g.calls} | ${g.errors} |`);
  }
  L.push("");
  if (agg.hasUngroundedEngine) {
    L.push(
      "> ⚠️ **Warning:** at least one engine answered without live web access " +
        "(`api_model_only` or `unknown`). Web grounding matters most for shopping " +
        "queries; treat ungrounded numbers as a weaker signal.",
    );
    L.push("");
  }

  // ---- Share of voice: mention vs recommendation ---------------------------
  L.push("## Share of voice — mention rate vs recommendation rate");
  L.push("");
  L.push(brandTable(agg.overall));
  L.push("");

  // ---- Per engine ----------------------------------------------------------
  L.push("## Per-engine breakdown");
  L.push("");
  for (const [engine, stats] of Object.entries(agg.byEngine)) {
    L.push(`### ${engine}`);
    L.push("");
    L.push(brandTable(stats));
    L.push("");
  }

  // ---- Per prompt ----------------------------------------------------------
  L.push("## Per-prompt × engine results");
  L.push("");
  L.push(`| Prompt | Engine | ${brandName} | Competitors mentioned | Top competitor |`);
  L.push("|---|---|---|---|---|");
  for (const r of results) {
    if (r.error) {
      L.push(`| ${trunc(r.prompt, 50)} | ${r.engine} | ⚠️ error | — | ${trunc(r.error, 30)} |`);
      continue;
    }
    const ownD = r.detections.find((d) => d.isOwn);
    const comps = r.detections.filter((d) => !d.isOwn && d.mentioned);
    const best = [...comps].sort((a, b) => score(b) - score(a))[0];
    L.push(
      `| ${trunc(r.prompt, 50)} | ${r.engine} | ${statusBadge(ownD)} | ` +
        `${comps.length} | ${best ? `${best.name} (${best.status})` : "—"} |`,
    );
  }
  L.push("");

  // ---- Where competitors beat us ------------------------------------------
  L.push("## Top prompts where competitors beat us");
  L.push("");
  const losses = results
    .filter((r) => !r.error)
    .map((r) => {
      const ownD = r.detections.find((d) => d.isOwn);
      const comps = r.detections.filter((d) => !d.isOwn);
      const bestComp = [...comps].sort((a, b) => score(b) - score(a))[0];
      return { r, ownScore: score(ownD), bestComp, gap: score(bestComp) - score(ownD) };
    })
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  if (losses.length === 0) {
    L.push("_None — the brand was at least as visible as every competitor in all answers._");
  } else {
    L.push("| Prompt | Engine | Brand | Winning competitor |");
    L.push("|---|---|---|---|");
    for (const x of losses.slice(0, 15)) {
      const ownD = x.r.detections.find((d) => d.isOwn);
      L.push(
        `| ${trunc(x.r.prompt, 48)} | ${x.r.engine} | ${statusBadge(ownD)} | ` +
          `${x.bestComp!.name} (${x.bestComp!.status}) |`,
      );
    }
  }
  L.push("");

  // ---- Where brand is absent ----------------------------------------------
  L.push("## Prompts where the brand is absent");
  L.push("");
  const absent = results.filter((r) => {
    if (r.error) return false;
    const ownD = r.detections.find((d) => d.isOwn);
    return !ownD?.mentioned;
  });
  if (absent.length === 0) {
    L.push("_None — the brand appeared in every successful answer._");
  } else {
    for (const r of absent) L.push(`- _${r.engine}_: ${trunc(r.prompt, 90)}`);
  }
  L.push("");

  // ---- Snippets ------------------------------------------------------------
  L.push("## Mention snippets (brand)");
  L.push("");
  const snippets = results
    .filter((r) => !r.error)
    .map((r) => ({ r, d: r.detections.find((d) => d.isOwn) }))
    .filter((x) => x.d?.mentioned && x.d.snippet);
  if (snippets.length === 0) {
    L.push("_No brand mentions to quote._");
  } else {
    for (const x of snippets.slice(0, 12)) {
      L.push(`- **${x.r.engine}** (${x.d!.status}): "${x.d!.snippet}"`);
    }
  }
  L.push("");

  // ---- Cost ----------------------------------------------------------------
  L.push("## Cost & token usage (estimated)");
  L.push("");
  L.push("| Engine | Input tokens | Output tokens | Est. cost |");
  L.push("|---|---|---|---|");
  for (const [engine, c] of Object.entries(agg.cost)) {
    L.push(`| ${engine} | ${c.inputTokens} | ${c.outputTokens} | ${usd(c.costUsd)} |`);
  }
  L.push(
    `| **Total** | **${agg.totalCost.inputTokens}** | **${agg.totalCost.outputTokens}** | ` +
      `**${usd(agg.totalCost.costUsd)}** |`,
  );
  L.push("");
  L.push("_Costs are estimates from per-model pricing constants, not billing data._");
  L.push("");

  // ---- Fixes (stub) --------------------------------------------------------
  L.push("## Suggested fixes");
  L.push("");
  L.push(
    "_Fixes engine — week 2, requires store crawling. Out of scope for this build. " +
      "See CLAUDE.md._",
  );
  L.push("");

  return L.join("\n");
}

function brandTable(stats: BrandStats[]): string {
  const rows = [
    "| Brand | Mention rate | Recommendation rate | Avg list rank |",
    "|---|---|---|---|",
  ];
  for (const s of stats) {
    const label = s.isOwn ? `**${s.name}** (you)` : s.name;
    const rank = s.avgListRank !== null ? s.avgListRank.toFixed(1) : "—";
    rows.push(
      `| ${label} | ${pct(s.mentionRate)} (${s.mentions}/${s.responses}) | ` +
        `${pct(s.recommendationRate)} (${s.recommendations}/${s.responses}) | ${rank} |`,
    );
  }
  return rows.join("\n");
}

function statusBadge(d: BrandDetection | undefined): string {
  if (!d || !d.mentioned) return "absent";
  if (d.status === "recommended") return d.listRank ? `recommended #${d.listRank}` : "recommended";
  return "mentioned";
}
