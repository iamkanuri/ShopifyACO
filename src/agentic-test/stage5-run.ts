import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePg } from "../db/pg.js";
import { PublicFetcher } from "./public-fetch.js";
import { buildPublicSnapshot } from "./public-catalog.js";
import { classifyProspects, extractBrandDomains } from "./prospect-finder.js";
import { loadBatteryFile } from "./stage5-battery.js";
import { DEODORANT_CATEGORY, type CategoryDescriptor } from "./categories/registry.js";
import { diagnoseProspect, scanWinnerEvidenceMap, buildWinnerContrast, type ProspectDiagnostic, type WinnerAttributeEvidence } from "./stage5-diagnose.js";
import { buildStage5Claims, lintCaseText, renderWinnerContrast, renderStage5Case, renderStage5CaseBody, renderStage5Plain } from "./stage5-case.js";
import type { JourneyResult, ShoppingTaskContract, StoreSnapshot } from "./types.js";

// ===========================================================================
// STAGE 5/6 orchestrator. battery → prospects → per-prospect snapshot+scan+
// journeys → severity rank → linted real-store cases (+ Stage 6.1 winner
// contrast). Parameterized by a CategoryDescriptor so ONE pipeline serves
// deodorant AND coffee; deodorant defaults reproduce the Stage 5 run exactly.
// All outputs land in the descriptor's gitignored out dir (real store names).
// A run persists `run-context.json` so cases can be RE-RENDERED offline ($0,
// no model calls) when only copy/format changes — the expensive journeys never
// re-run for a wording tweak.
// ===========================================================================

const MODELS_USED = "gpt-5.4-mini, gemini-2.5-flash";

export function slug(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/g, "").toLowerCase();
}

interface Competitor { brand: string; mentions: number; origin: string }
interface RenderContext {
  competitor: Competitor;
  winnerMap: Record<string, WinnerAttributeEvidence>;
  casesDir: string;
}
export interface RunContext {
  category: string;
  competitor: Competitor;
  winnerMap: Record<string, WinnerAttributeEvidence>;
  batteryTotal: number;
  diagnostics: Array<ProspectDiagnostic & { brand: string }>;
}

function makeJourneyRunner(outDir: string) {
  return async function journeyRunner(contract: ShoppingTaskContract, snapshot: StoreSnapshot): Promise<JourneyResult[]> {
    process.env.AGENTIC_STAGE1_RESULTS_DIR = outDir;
    const { createToolClient } = await import("./model-client.js");
    const { runShoppingAgent } = await import("./agent-runner.js");
    const { createGeminiSemanticClient } = await import("./semantic-tier.js");
    // Third-party PUBLIC snapshots: the runner's allowlist assertion is for OUR
    // stores, so bypass it with an explicit override — no store is written, only
    // read snapshots are scored.
    const env = { ...process.env, AGENTIC_INSTRUMENT_TEST_ENABLED: "true" };
    const out: JourneyResult[] = [];
    for (const provider of ["openai", "gemini"]) {
      for (let t = 1; t <= 2; t++) {
        const r = await runShoppingAgent({
          contract,
          snapshot,
          client: createToolClient(provider),
          trialNumber: t,
          promptVersion: "stage5-v1",
          semanticClient: createGeminiSemanticClient(),
          env,
          shopAllowlistOverride: [snapshot.shopId],
        });
        out.push(r);
      }
    }
    return out;
  };
}

/** Render ONE prospect's case (index.html + claims-map + provenance + message).
 *  Returns null when the case has no genuine gap or is blocked by the linter
 *  (both logged). Pure w.r.t. cost: no model/network calls here. */
function renderProspectCase(
  d: ProspectDiagnostic & { brand: string },
  ctx: RenderContext,
): { summaryLine: string; oneLineFinding: string; caseDir: string } | null {
  // Rule 4: only render with ≥1 GENUINE evidence gap. A store whose constraints
  // are all evidenced or merely readable-but-unmet has nothing honestly missing.
  const genuineGaps = d.findings.filter((f) => f.genuineEvidenceGap);
  if (genuineGaps.length === 0) {
    console.log(`[run] no genuine evidence gap for ${d.brand} — not rendered`);
    return null;
  }
  const contrast = buildWinnerContrast(d, ctx.winnerMap, ctx.competitor);
  const claims = buildStage5Claims(d, d.brand, ctx.competitor.brand, ctx.competitor.mentions, contrast);
  const contrastHtml = renderWinnerContrast(contrast, claims);
  const body = renderStage5CaseBody(claims, { contrastHtml });
  const lint = lintCaseText(body.replace(/<[^>]+>/g, " "), claims);
  if (!lint.ok) {
    console.log(`[run] case for ${d.brand} BLOCKED by linter: ${lint.violations.map((v) => v.pattern).join(", ")}`);
    return null;
  }
  const provenanceUrls = Object.values(d.fetchUrls);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>AI visibility — ${d.brand}</title><style>body{font-family:system-ui;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.6}h2{color:#0f766e;border-top:1px solid #e5e9ee;padding-top:1em;font-size:1rem}.disclosure{background:#fffbe8;border:1px solid #f2e2a0;padding:.7rem;border-radius:8px;font-size:.9rem}.prov{color:#5b6673;font-size:.8rem}blockquote{border-left:3px solid #0f766e;padding-left:.8rem;color:#333}ul{padding-left:1.1rem}li{margin:.35rem 0}</style></head><body>${renderStage5Case(claims, { modelsUsed: MODELS_USED, provenanceUrls, fetchedAt: d.fetchedAt, contrastHtml })}</body></html>`;
  const dir = join(ctx.casesDir, slug(d.origin));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf8");
  writeFileSync(join(dir, "claims-map.json"), JSON.stringify(claims, null, 2), "utf8");
  writeFileSync(join(dir, "provenance.json"), JSON.stringify({ origin: d.origin, fetchUrls: d.fetchUrls, fetchedAt: d.fetchedAt, models: MODELS_USED.split(", "), notInspectable: d.surfacesNotInspectable, winnerContrast: contrast }, null, 2), "utf8");
  writeFileSync(join(dir, "message.txt"), renderStage5Plain(claims, { provenanceUrls, fetchedAt: d.fetchedAt, contrast }), "utf8");
  const gapList = genuineGaps.map((f) => f.attribute.replace(/_/g, "-")).join(", ");
  console.log(`[run] rendered case → cases/${slug(d.origin)}/`);
  return {
    summaryLine: `- **${d.brand}** (severity ${d.severity}): public store can't evidence ${gapList}; ${ctx.competitor.brand} recommended ${ctx.competitor.mentions}× in the battery.`,
    oneLineFinding: `Public store data doesn't let an AI assistant verify ${gapList} — the exact thing shoppers asked for in the battery.`,
    caseDir: dir,
  };
}

/** Render all cases (severity-ranked) + prospects.json + summary.md from a run
 *  context. Shared by the live run and the offline re-render. */
export function renderAllCases(rc: RunContext, outDir: string, maxCases: number): number {
  const casesDir = join(outDir, "cases");
  mkdirSync(casesDir, { recursive: true });
  const ctx: RenderContext = { competitor: rc.competitor, winnerMap: rc.winnerMap, casesDir };
  const sorted = [...rc.diagnostics].sort((a, b) => b.severity - a.severity);

  const prospectsOut: unknown[] = [];
  const summaryLines: string[] = [];
  let rendered = 0;
  for (const d of sorted) {
    const contactUrl = `${d.origin.replace(/\/$/, "")}/pages/contact`; // URL string only; no PII
    prospectsOut.push({
      brand: d.brand, origin: d.origin, category: rc.category, severity: d.severity, contractId: d.contractId,
      battery: d.battery,
      genuineGaps: d.findings.filter((f) => f.genuineEvidenceGap).map((f) => f.attribute),
      absentAttributes: d.findings.filter((f) => f.scanVerdict === "absent").map((f) => f.attribute),
      notInspectable: d.surfacesNotInspectable, journeyOutcomes: d.journeyOutcomes.map((j) => j.outcome),
      contactUrl,
    });
    if (rendered >= maxCases) continue;
    const res = renderProspectCase(d, ctx);
    if (res) {
      summaryLines.push(res.summaryLine);
      rendered++;
    }
  }
  writeFileSync(join(outDir, "prospects.json"), JSON.stringify(prospectsOut, null, 2), "utf8");
  writeFileSync(join(outDir, "summary.md"), `# ${rc.category} shortlist (${rendered} rendered cases)\n\n${summaryLines.join("\n")}\n`, "utf8");
  return rendered;
}

export interface RunOpts {
  desc?: CategoryDescriptor;
  maxProspects?: number;
  /** Max cases to render (deodorant defaults to 5 for Stage 5 parity; coffee
   *  renders every linter-passing case up to this cap). */
  maxCases?: number;
}

export async function runStage5(opts: RunOpts = {}): Promise<{ diagnosed: number; rendered: number; outDir: string }> {
  const desc = opts.desc ?? DEODORANT_CATEGORY;
  const maxProspects = opts.maxProspects ?? 8;
  const maxCases = opts.maxCases ?? 5;
  // Point the fetch cache + results/spend dir at THIS category before anything runs.
  process.env.STAGE5_CACHE_DIR = desc.cacheDir;
  process.env.AGENTIC_STAGE1_RESULTS_DIR = desc.outDir;

  const records = loadBatteryFile(desc.batteryFile);
  if (!records.length) throw new Error(`no battery records for ${desc.key} — run the battery first (run-battery.ts ${desc.key})`);
  mkdirSync(join(desc.outDir, "cases"), { recursive: true });

  // Brands + domains + Shopify classification (public probes, rate-limited).
  const brands = extractBrandDomains(records, desc.extraBrandStopwords);
  const fetcher = new PublicFetcher();
  const classification = await classifyProspects(fetcher, brands);
  const topCompetitor = classification.winners[0] ?? brands[0]!;
  const topCompetitorMentions = topCompetitor?.mentions ?? 0;
  console.log(`[run:${desc.key}] winners: ${classification.winners.length}, candidates: ${classification.candidates.length}, skipped: ${classification.skipped.length}`);

  // Snapshot the top winners; scan the reference winner for the contrast block.
  const contractBase = desc.contract;
  const winnerSnaps = new Map<string, StoreSnapshot>();
  for (const w of classification.winners.slice(0, 2)) {
    const r = await buildPublicSnapshot({ fetcher, origin: w.origin, categoryKeywords: desc.categoryKeywords, wantStructuredData: true });
    if (r.snapshot) winnerSnaps.set(w.brand, r.snapshot);
  }
  const refWinner = classification.winners[0];
  const refWinnerSnap = refWinner ? winnerSnaps.get(refWinner.brand) : undefined;
  const winnerMap: Record<string, WinnerAttributeEvidence> = refWinnerSnap ? scanWinnerEvidenceMap(refWinnerSnap, contractBase) : {};
  if (refWinner) console.log(`[run:${desc.key}] winner-contrast reference: ${refWinner.brand} — evidences ${Object.entries(winnerMap).filter(([, v]) => v.evidences).map(([k]) => k).join(",") || "none"}`);
  const competitor: Competitor = { brand: topCompetitor.brand, mentions: topCompetitorMentions, origin: refWinner?.origin ?? "" };

  // Diagnose candidates (+ winners beyond the reference, for volume).
  const toDiagnose = [...classification.candidates, ...classification.winners.slice(1)].slice(0, maxProspects);
  const journeyRunner = makeJourneyRunner(desc.outDir);
  const diagnostics: Array<ProspectDiagnostic & { brand: string }> = [];
  for (const p of toDiagnose) {
    try {
      const snapRes = await buildPublicSnapshot({ fetcher, origin: p.origin, categoryKeywords: desc.categoryKeywords, wantStructuredData: true });
      if (!snapRes.snapshot) {
        console.log(`[run:${desc.key}] skip ${p.brand}: ${snapRes.reason}`);
        continue;
      }
      const d = await diagnoseProspect({
        snapshot: snapRes.snapshot,
        contract: contractBase,
        battery: { brandMentions: p.mentions, channels: p.channels, batteryTotal: records.length },
        topCompetitorMentions,
        runJourneys: journeyRunner,
      });
      diagnostics.push({ ...d, brand: p.brand });
      const gaps = d.findings.filter((f) => f.genuineEvidenceGap).map((f) => f.attribute);
      console.log(`[run:${desc.key}] diagnosed ${p.brand} (${p.origin}): severity ${d.severity}, gaps=${gaps.join(",") || "none"}`);
    } catch (err) {
      console.log(`[run:${desc.key}] error diagnosing ${p.brand}: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  const rc: RunContext = { category: desc.key, competitor, winnerMap, batteryTotal: records.length, diagnostics };
  writeFileSync(join(desc.outDir, "run-context.json"), JSON.stringify(rc, null, 2), "utf8");
  const rendered = renderAllCases(rc, desc.outDir, maxCases);
  writeFileSync(join(desc.outDir, "fetch-log.json"), JSON.stringify(fetcher.log, null, 2), "utf8");
  console.log(`[run:${desc.key}] complete: ${diagnostics.length} diagnosed, ${rendered} cases rendered → ${desc.outDir}`);
  return { diagnosed: diagnostics.length, rendered, outDir: desc.outDir };
}

/** Offline re-render ($0, no model/network): reload run-context.json and
 *  regenerate every case with the current renderer/copy. Use after a wording
 *  or format change so the expensive journeys never re-run. */
export function rerenderStage5(opts: { desc?: CategoryDescriptor; maxCases?: number } = {}): number {
  const desc = opts.desc ?? DEODORANT_CATEGORY;
  const ctxPath = join(desc.outDir, "run-context.json");
  if (!existsSync(ctxPath)) throw new Error(`no run-context.json in ${desc.outDir} — do a full run first`);
  const rc = JSON.parse(readFileSync(ctxPath, "utf8")) as RunContext;
  const rendered = renderAllCases(rc, desc.outDir, opts.maxCases ?? 5);
  console.log(`[rerender:${desc.key}] re-rendered ${rendered} cases from run-context.json ($0)`);
  return rendered;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/stage5-run.ts");
if (isMain) {
  runStage5({ maxProspects: Number(process.argv[2] ?? 8), maxCases: 5 })
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[run] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
