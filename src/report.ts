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
import { buildSubstitutionFrame } from "./analysis/buildFrame.js";
import { clusterStanding } from "./analysis/queryClusters.js";
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
  // The substitution frame — how the report leads. Attached here (not in the pure analyzeRun) so it can
  // use the discovered rivals; covers both the public scan (scanJob) and the CLI, which share this path.
  analysis.substitutionFrame = buildSubstitutionFrame(
    analysis, results, cfg, (opts.discoveredBrands ?? []).map((b) => b.name),
  );
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

  // ---- Lead: the substitution frame (score DEMOTED below it) ---------------
  // The report leads with WHERE the merchant stands in AI's recommendation decision — naming who AI
  // recommends instead — not the abstract score. The frame copy is already severity-selected (a brutal
  // shutout leads with the stark number; a mild loss leads with the reframe), so the renderer just lays
  // it out. Falls back to the legacy score-led headline for pre-frame results.json (frame absent).
  const vs = analysis.visibilityScore;
  const runSizeLabel = { mini: "Mini scan", standard: "Standard scan", deep: "Deep scan" }[analysis.runSize];
  const frame = analysis.substitutionFrame;
  if (frame) {
    L.push(`## ${frame.headline}`);
    L.push("");
    L.push(`> **${frame.subline}**`);
    L.push("");
    L.push(
      `\`${runSizeLabel}\` · **${analysis.confidence.label}** ` +
        `(based on ${vs.basedOnResponses} grounded responses)`,
    );
    L.push("");
    L.push(`_${analysis.caveat}_`);
    L.push("");
    // The score, demoted to proof — the summary of the verdict above, not the lead.
    L.push(vs.score == null ? `### AI Visibility Score: not enough data` : `### AI Visibility Score: ${vs.score}/100`);
    L.push("");
    L.push(`_${frame.scoreProof}_`);
    L.push("");
  } else {
    L.push(vs.score == null ? `## AI Visibility Score: not enough data` : `## AI Visibility Score: ${vs.score}/100`);
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
  }
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

  // ---- Where a rival edged ahead ------------------------------------------
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
  // A category leader isn't being "beaten" wholesale — these are the few answers a rival edged ahead.
  const okCount = results.filter((r) => !r.error).length;
  L.push(
    analysis.ownLeadsCategory
      ? `## The few prompts where a rival edged ahead (${losses.length} of ${okCount})`
      : "## Top prompts where competitors beat us",
  );
  L.push("");
  if (analysis.ownLeadsCategory && losses.length) {
    L.push(`_You lead overall; these are the only answers a competitor out-ranked ${brandName} — your growth edges._`);
    L.push("");
  }
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
  if (analysis.ownLeadsCategory && analysis.categoryLeader) {
    // Winning brand: the merchant IS the leader — name the nearest challenger to watch, never crown a rival.
    L.push(
      `**${brandName} is the most-recommended brand in ${cfg.category}** — ` +
        `recommended ${fmtRateStat(analysis.mentionGap.recommendation)} across the scan, ahead of every competitor. ` +
        `Nearest challenger: **${analysis.categoryLeader.competitor}** (${fmtRateStat(analysis.categoryLeader.recommendation)}) — ` +
        `worth watching, but not out-recommending ${brandName} in this scan.`,
    );
    L.push("");
  } else if (analysis.categoryLeader) {
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
  } else {
    // Honest "no threat" — never a blank. When the brand leads, say so.
    L.push(
      `**Direct niche threat:** none — no competitor out-recommends ${brandName} in its own niche in this scan.` +
        (analysis.ownLeadsCategory ? ` ${brandName} leads the category.` : ""),
    );
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
    // Per-cluster STANDING (merchant vs top rival) — never "won by <rival>" on a cluster the merchant leads.
    const losing = transactional.filter((c) => {
      const s = clusterStanding(c);
      return s === "trails" || s === "absent";
    });
    const heading =
      losing.length === 0 && analysis.ownLeadsCategory
        ? "**Buyer-intent categories — you lead every one:**"
        : losing.length > 0 && analysis.ownLeadsCategory
          ? "**You lead overall — but a rival is ahead in these categories:**"
          : losing.length > 0
            ? "**Buyer-intent categories you're losing** (high-intent buying queries):"
            : "**Buyer-intent category performance:**";
    L.push(heading);
    L.push("");
    L.push("| Category | Responses | You recommended | Standing |");
    L.push("|---|---|---|---|");
    for (const c of transactional) {
      const s = clusterStanding(c);
      const rival = c.topWinners[0];
      const standing =
        s === "leads"
          ? `✅ you lead${rival ? ` (nearest: ${rival.brand} ${rival.recommendations}/${c.responses})` : ""}`
          : s === "trails"
            ? `⚠️ ${rival!.brand} ahead (${rival!.recommendations}/${c.responses} vs your ${c.brandRecommendation.count}/${c.responses})`
            : s === "absent"
              ? `❌ absent${rival ? ` (${rival.brand} ${rival.recommendations}/${c.responses})` : ""}`
              : `contested (tied ${c.brandRecommendation.count}/${c.responses})`;
      L.push(`| ${c.label} | ${c.responses} | ${fmtRateStat(c.brandRecommendation)} | ${standing} |`);
    }
    L.push("");
  }

  if (analysis.proofPoints.length) {
    // For a category leader this is the MINORITY of answers where a rival was picked — reframe it, and
    // suppress it when the data is too thin to say anything (no 1×/1× "reasons" contradicting a winner).
    const proofHits = analysis.proofPoints.reduce((s, p) => s + p.hits, 0);
    if (!(analysis.ownLeadsCategory && proofHits < 3)) {
      L.push(
        analysis.ownLeadsCategory
          ? "**In the answers where a rival was picked instead, AI cited** (by frequency):"
          : "**Reasons AI cited in answers where you weren't recommended** (by frequency):",
      );
      L.push("");
      for (const p of analysis.proofPoints.slice(0, 8)) {
        L.push(`- **${p.label}** — ${p.hits} answer(s)`);
      }
      L.push("");
    }
  }

  if (analysis.discoveredBrands?.length) {
    L.push(`**AI also recommended these brands you didn't list** (discovered, directional — of ${analysis.basedOnResponses} answers):`);
    L.push("");
    for (const b of analysis.discoveredBrands) {
      L.push(`- **${b.name}** — seen in ${b.answers} answer(s)`);
    }
    L.push("");
  }

  // Cited sources — the "AI trust graph" (observed, not causal).
  const cs = analysis.citedSources;
  if (cs && cs.onLostAnswers.n > 0 && cs.onLostAnswers.sources.length) {
    L.push(`**Where AI grounded its answers in the ${cs.onLostAnswers.n} query(s) you lost** — the third-party sources to earn proof on (assistants *cited* these while answering; observed, not proof they caused the pick):`);
    L.push("");
    for (const s of cs.onLostAnswers.sources.slice(0, 8)) {
      L.push(`- **${s.domain}** — cited in ${s.count} lost answer(s)`);
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
