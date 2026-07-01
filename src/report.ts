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
import { analyzeRun } from "./analysis/index.js";
import { sanitizeSnippet } from "./analysis/text.js";
import type { FixCard, MerchantAnalysis, RateStat } from "./analysis/types.js";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fmtRateStat = (r: RateStat) => `${Math.round(r.rate * 100)}% (${r.count}/${r.total})`;
const usd = (x: number) => `$${x.toFixed(4)}`;
/** Collapse whitespace/newlines and escape pipes so text is safe inside a table cell. */
const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
const trunc = (s: string, n: number) => {
  const c = clean(s);
  return c.length > n ? c.slice(0, n - 1) + "…" : c;
};

/** Recommended=2, mentioned=1, absent=0 — used to decide "who won" a prompt. */
function score(d: BrandDetection | undefined): number {
  if (!d || !d.mentioned) return 0;
  return d.status === "recommended" ? 2 : 1;
}

export interface WriteOptions {
  outDir: string;
  meta: RunMeta;
  /** Fix 1: unlisted-competitor brands, computed by the live scan orchestration (async LLM pass)
   *  and attached to the otherwise-pure analysis before persisting. */
  discoveredBrands?: import("./analysis/types.js").DiscoveredBrand[];
}

export async function writeReports(
  results: PromptEngineResult[],
  cfg: Config,
  opts: WriteOptions,
): Promise<{ jsonPath: string; mdPath: string; agg: Aggregate; analysis: MerchantAnalysis }> {
  const agg = aggregate(results, cfg);
  await mkdir(opts.outDir, { recursive: true });

  const runResults: RunResults = { meta: opts.meta, config: cfg, results, aggregate: agg };
  const analysis = analyzeRun(runResults);
  if (opts.discoveredBrands?.length) analysis.discoveredBrands = opts.discoveredBrands;
  runResults.analysis = analysis;

  const jsonPath = join(opts.outDir, "results.json");
  await writeFile(jsonPath, JSON.stringify(runResults, null, 2), "utf8");

  const mdPath = join(opts.outDir, "report.md");
  await writeFile(mdPath, buildMarkdown(results, cfg, agg, opts.meta, analysis), "utf8");

  return { jsonPath, mdPath, agg, analysis };
}

function buildMarkdown(
  results: PromptEngineResult[],
  cfg: Config,
  agg: Aggregate,
  meta: RunMeta,
  analysis: MerchantAnalysis,
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

  // ---- AI Visibility Score + executive insight (analysis-driven) -----------
  const vs = analysis.visibilityScore;
  const runSizeLabel = { mini: "Mini scan", standard: "Standard scan", deep: "Deep scan" }[analysis.runSize];
  L.push(`## AI Visibility Score: ${vs.score}/100`);
  L.push("");
  L.push(`> **${analysis.headline}**`);
  L.push("");
  L.push(
    `\`${runSizeLabel}\` · **${analysis.confidence.label}** ` +
      `(based on ${vs.basedOnResponses} grounded responses)`,
  );
  L.push("");
  L.push(`_${analysis.caveat}_`);
  L.push("");
  L.push("| Component | Weight | Value | Points | Detail |");
  L.push("|---|---|---|---|---|");
  for (const c of vs.components) {
    L.push(
      `| ${c.label} | ${pct(c.weight)} | ${pct(c.value)} | ${c.contribution.toFixed(1)} | ${clean(c.detail)} |`,
    );
  }
  L.push("");
  L.push(`> Formula: \`${vs.formula}\``);
  L.push("");
  L.push("## Executive insight");
  L.push("");
  L.push(analysis.executiveInsight);
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
      L.push(`- **${x.r.engine}** (${x.d!.status}): "${sanitizeSnippet(x.d!.snippet)}"`);
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

  // ---- Gap analysis --------------------------------------------------------
  L.push("## Gap analysis");
  L.push("");
  if (analysis.categoryLeader) {
    L.push(
      `**Category leader (overall):** ${analysis.categoryLeader.competitor} — ` +
        `recommended ${fmtRateStat(analysis.categoryLeader.recommendation)} across the whole scan.`,
    );
    L.push("");
  }
  if (analysis.threat) {
    L.push(`**Direct niche threat:** ${analysis.threat.summary}`);
    L.push(`_Basis: ${analysis.threat.basisLabel}. ${analysis.threat.confidence.label}_`);
    L.push("");
  }
  L.push(`**Mention → recommendation gap:** ${analysis.mentionGap.summary}`);
  L.push("");
  if (analysis.weakestEngine) {
    L.push(`**Weakest engine:** ${analysis.weakestEngine}.`);
    L.push("");
    L.push("| Engine | Mentions you | Recommends you | Avg rank |");
    L.push("|---|---|---|---|");
    for (const e of analysis.engineWeakness) {
      const rank = e.avgRankWhenMentioned != null ? e.avgRankWhenMentioned.toFixed(1) : "—";
      const tag = e.isWeakest ? " ⚠️" : "";
      L.push(`| ${e.engine}${tag} | ${fmtRateStat(e.mention)} | ${fmtRateStat(e.recommendation)} | ${rank} |`);
    }
    L.push("");
  }

  const transactional = analysis.clusters.filter((c) => c.transactional);
  if (transactional.length) {
    L.push("**Query categories lost** (high-intent buying queries):");
    L.push("");
    L.push("| Category | Responses | You mentioned | You recommended | Status |");
    L.push("|---|---|---|---|---|");
    for (const c of transactional) {
      const status = c.absent ? "❌ absent" : c.brandRecommendation.count > 0 ? "partial" : "mention-only";
      L.push(
        `| ${c.label} | ${c.responses} | ${fmtRateStat(c.brandMention)} | ${fmtRateStat(c.brandRecommendation)} | ${status} |`,
      );
    }
    L.push("");
  }

  if (analysis.proofPoints.length) {
    L.push("**Reasons AI cited in answers where you weren't recommended** (by frequency):");
    L.push("");
    for (const p of analysis.proofPoints.slice(0, 8)) {
      L.push(`- **${p.label}** — ${p.hits} answer(s)`);
    }
    L.push("");
  }

  if (analysis.discoveredBrands?.length) {
    L.push(`**AI also recommended these brands you didn't list** (discovered, directional — of ${analysis.basedOnResponses} answers):`);
    L.push("");
    for (const b of analysis.discoveredBrands) {
      L.push(`- **${b.name}** — seen in ${b.answers} answer(s)`);
    }
    L.push("");
  }

  // ---- Recommended next steps ----------------------------------------------
  L.push("## Recommended next steps");
  L.push("");
  const evidence = analysis.fixCards.filter((c) => c.tier === "evidence_backed");
  const hygiene = analysis.fixCards.filter((c) => c.tier === "general_hygiene");

  L.push("### Evidence-backed (cite this scan's lost prompts)");
  L.push("");
  if (evidence.length === 0) L.push("_No evidence-backed steps triggered._");
  for (const card of evidence) L.push(...renderFixCard(card));

  L.push("### General hygiene — not checked against your live store");
  L.push("");
  for (const card of hygiene) L.push(...renderFixCard(card));

  return L.join("\n");
}

function renderFixCard(card: FixCard): string[] {
  const out: string[] = [];
  out.push(`#### [${card.impact.toUpperCase()}] ${card.title}`);
  out.push("");
  out.push(`- **Why:** ${card.why}`);
  out.push(`- **Suggested step:** ${card.suggestedFix}`);
  if (card.relatedPrompts.length) {
    out.push(`- **Triggered by prompts:** ${card.relatedPrompts.map((p) => `_${trunc(p, 60)}_`).join("; ")}`);
  }
  if (card.relatedSnippets.length) {
    out.push(`- **Evidence:** ${card.relatedSnippets.map((s) => `"${trunc(s, 120)}"`).join(" / ")}`);
  }
  if (card.verifyNote) out.push(`- ⚠️ **Verify before publishing:** ${card.verifyNote}`);
  out.push("");
  return out;
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
