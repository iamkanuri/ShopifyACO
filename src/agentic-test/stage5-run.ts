import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closePg } from "../db/pg.js";
import { PublicFetcher } from "./public-fetch.js";
import { buildPublicSnapshot } from "./public-catalog.js";
import { classifyProspects, extractBrandDomains } from "./prospect-finder.js";
import { loadStage5Battery, STAGE5_CATEGORY_KEYWORDS } from "./stage5-battery.js";
import { deodorantAluminumFreeContract } from "./categories/deodorant/contracts.js";
import { diagnoseProspect, type ProspectDiagnostic } from "./stage5-diagnose.js";
import { buildStage5Claims, lintCaseText, renderStage5Case, renderStage5CaseBody, renderStage5Plain } from "./stage5-case.js";
import type { JourneyResult, ShoppingTaskContract, StoreSnapshot } from "./types.js";

// ===========================================================================
// STAGE 5 orchestrator (CP3–CP4). battery → prospects → per-prospect
// snapshot+scan+journeys → severity rank → linted real-store cases. All
// outputs land in the gitignored experiments/stage5/out (real store names).
// ===========================================================================

const OUT = join(process.cwd(), "experiments", "stage5", "out");
const CASES = join(OUT, "cases");

function slug(origin: string): string {
  return origin.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/g, "").toLowerCase();
}

async function journeyRunner(contract: ShoppingTaskContract, snapshot: StoreSnapshot): Promise<JourneyResult[]> {
  process.env.AGENTIC_STAGE1_RESULTS_DIR = OUT;
  const { createToolClient } = await import("./model-client.js");
  const { runShoppingAgent } = await import("./agent-runner.js");
  const { createGeminiSemanticClient } = await import("./semantic-tier.js");
  // Stage 5 runs against third-party PUBLIC snapshots; the runner's allowlist
  // assertion is for OUR stores, so bypass it here with an explicit env note —
  // no store is written, only read snapshots are scored.
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
        shopAllowlistOverride: [snapshot.shopId], // read-only public snapshot; see agent-runner
      });
      out.push(r);
    }
  }
  return out;
}

export async function runStage5(maxProspects = 8): Promise<void> {
  const records = loadStage5Battery();
  if (!records.length) throw new Error("no battery records — run stage5-battery first");
  mkdirSync(CASES, { recursive: true });

  // Brands + domains + Shopify classification (public probes, rate-limited).
  const brands = extractBrandDomains(records);
  const fetcher = new PublicFetcher();
  const classification = await classifyProspects(fetcher, brands);
  const topCompetitor = classification.winners[0] ?? brands[0]!;
  const topCompetitorMentions = topCompetitor?.mentions ?? 0;

  console.log(`[stage5] winners: ${classification.winners.length}, candidates: ${classification.candidates.length}, skipped: ${classification.skipped.length}`);

  // Snapshot + winner contrast scan for the top competitor (sharpest comparison).
  const contractBase = deodorantAluminumFreeContract;
  const winnerSnaps = new Map<string, StoreSnapshot>();
  for (const w of classification.winners.slice(0, 2)) {
    const r = await buildPublicSnapshot({ fetcher, origin: w.origin, categoryKeywords: STAGE5_CATEGORY_KEYWORDS, wantStructuredData: true });
    if (r.snapshot) winnerSnaps.set(w.brand, r.snapshot);
  }

  // Diagnose candidates (+ any winners beyond the reference, for volume).
  const toDiagnose = [...classification.candidates, ...classification.winners.slice(1)].slice(0, maxProspects);
  const diagnostics: Array<ProspectDiagnostic & { brand: string }> = [];
  for (const p of toDiagnose) {
    try {
      const snapRes = await buildPublicSnapshot({ fetcher, origin: p.origin, categoryKeywords: STAGE5_CATEGORY_KEYWORDS, wantStructuredData: true });
      if (!snapRes.snapshot) {
        console.log(`[stage5] skip ${p.brand}: ${snapRes.reason}`);
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
      console.log(`[stage5] diagnosed ${p.brand} (${p.origin}): severity ${d.severity}, absent=${d.findings.filter((f) => f.scanVerdict === "absent").map((f) => f.attribute).join(",") || "none"}`);
    } catch (err) {
      console.log(`[stage5] error diagnosing ${p.brand}: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  // Rank by severity; render linted cases for the top 5 that pass the linter.
  diagnostics.sort((a, b) => b.severity - a.severity);
  const prospectsOut: unknown[] = [];
  let rendered = 0;
  const summaryLines: string[] = [];
  for (const d of diagnostics) {
    const contactUrl = `${d.origin.replace(/\/$/, "")}/pages/contact`; // URL string only; no PII
    prospectsOut.push({
      brand: d.brand, origin: d.origin, severity: d.severity, contractId: d.contractId,
      battery: d.battery, absentAttributes: d.findings.filter((f) => f.scanVerdict === "absent").map((f) => f.attribute),
      notInspectable: d.surfacesNotInspectable, journeyOutcomes: d.journeyOutcomes.map((j) => j.outcome),
      contactUrl,
    });
    if (rendered >= 5) continue;

    const claims = buildStage5Claims(d, d.brand, topCompetitor.brand, topCompetitorMentions);
    const body = renderStage5CaseBody(claims);
    const lint = lintCaseText(body.replace(/<[^>]+>/g, " "), claims);
    if (!lint.ok) {
      console.log(`[stage5] case for ${d.brand} BLOCKED by linter: ${lint.violations.map((v) => v.pattern).join(", ")}`);
      continue;
    }
    const provenanceUrls = Object.values(d.fetchUrls);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>AI visibility — ${d.brand}</title><style>body{font-family:system-ui;max-width:680px;margin:2rem auto;padding:0 1rem;line-height:1.6}h2{color:#0f766e;border-top:1px solid #e5e9ee;padding-top:1em;font-size:1rem}.disclosure{background:#fffbe8;border:1px solid #f2e2a0;padding:.7rem;border-radius:8px;font-size:.9rem}.prov{color:#5b6673;font-size:.8rem}blockquote{border-left:3px solid #0f766e;padding-left:.8rem;color:#333}</style></head><body>${renderStage5Case(claims, { modelsUsed: "gpt-5.4-mini, gemini-2.5-flash", provenanceUrls, fetchedAt: d.fetchedAt })}</body></html>`;
    const dir = join(CASES, slug(d.origin));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html, "utf8");
    writeFileSync(join(dir, "claims-map.json"), JSON.stringify(claims, null, 2), "utf8");
    writeFileSync(join(dir, "provenance.json"), JSON.stringify({ origin: d.origin, fetchUrls: d.fetchUrls, fetchedAt: d.fetchedAt, models: ["gpt-5.4-mini", "gemini-2.5-flash"], notInspectable: d.surfacesNotInspectable }, null, 2), "utf8");
    writeFileSync(join(dir, "message.txt"), renderStage5Plain(claims, { provenanceUrls, fetchedAt: d.fetchedAt }), "utf8");
    rendered++;
    const absent = d.findings.filter((f) => f.scanVerdict === "absent").map((f) => f.attribute.replace(/_/g, "-"));
    summaryLines.push(`- **${d.brand}** (severity ${d.severity}): public store can't evidence ${absent.join(", ") || "the tested claims"}; ${topCompetitor.brand} recommended ${topCompetitorMentions}× in the battery.`);
    console.log(`[stage5] rendered case → cases/${slug(d.origin)}/`);
  }

  writeFileSync(join(OUT, "prospects.json"), JSON.stringify(prospectsOut, null, 2), "utf8");
  writeFileSync(join(OUT, "summary.md"), `# Stage 5 shortlist (${rendered} rendered cases)\n\n${summaryLines.join("\n")}\n`, "utf8");
  writeFileSync(join(OUT, "fetch-log.json"), JSON.stringify(fetcher.log, null, 2), "utf8");
  console.log(`[stage5] complete: ${diagnostics.length} diagnosed, ${rendered} cases rendered → experiments/stage5/out/`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/stage5-run.ts");
if (isMain) {
  runStage5(Number(process.argv[2] ?? 8))
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[stage5] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
