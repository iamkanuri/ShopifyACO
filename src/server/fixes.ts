import type { Request, Response } from "express";
import { getRun } from "../db/benchmarks.js";
import { listFindings } from "../db/crawler.js";
import { createProposal, getProductForFix, listProposals } from "../db/fixes.js";
import { proposeFixes } from "../fixes/propose.js";
import type { Finding } from "../diagnosis/diagnose.js";
import { applyProposal, approveProposal, dismissProposal, rollbackProposal } from "../fixes/apply.js";

// Shop-scoped Fix Studio API (Phase 6). requireShop sets req.shopDomain; every
// handler is tenant-isolated. Generating/approving proposals is free; APPLY is the
// only path that writes to the store and is gated (approval + write_products scope +
// conflict check inside applyProposal).

function shopOf(req: Request): string {
  return (req as Request & { shopDomain?: string }).shopDomain!;
}

/** Reconstruct the minimal Finding shape proposeFixes needs from a DB row. */
function rowToFinding(r: Record<string, unknown>): Finding {
  return {
    kind: (r.kind as Finding["kind"]) ?? "general_hygiene",
    signal: (r.signal as Finding["signal"]) ?? undefined,
    intent: (r.intent as string) ?? null,
    promptText: (r.prompt_text as string) ?? null,
    engine: (r.engine as string) ?? null,
    merchantBrand: (r.merchant_brand as string) ?? "",
    winningCompetitor: (r.winning_competitor as string) ?? null,
    aiAnswerSnippet: (r.ai_answer_snippet as string) ?? null,
    citations: Array.isArray(r.citations) ? (r.citations as string[]) : [],
    merchantGap: Array.isArray(r.merchant_gap) ? (r.merchant_gap as string[]) : [],
    competitorAdvantage: Array.isArray(r.competitor_advantage) ? (r.competitor_advantage as string[]) : [],
    confidenceLevel: (r.confidence_level as Finding["confidenceLevel"]) ?? "directional",
    basisN: Number(r.basis_n ?? 0),
    limits: (r.limits as string) ?? "",
    recommendedIntervention: (r.recommended_intervention as string) ?? "",
    expectedMechanism: (r.expected_mechanism as string) ?? "",
  };
}

/** POST /app/api/fixes/propose { runId, productGid } — generate proposals for a
 *  product from a run's findings. Writes nothing to the store. */
export async function proposeHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const runId = Number(req.body?.runId);
  const productGid = typeof req.body?.productGid === "string" ? req.body.productGid : "";
  if (!Number.isInteger(runId) || !productGid) {
    res.status(400).json({ error: "runId (number) and productGid (string) are required." });
    return;
  }
  const run = await getRun(runId);
  if (!run || run.shop_domain !== shop) {
    res.status(404).json({ error: "Run not found for this shop." });
    return;
  }
  const product = await getProductForFix(shop, productGid);
  if (!product) {
    res.status(404).json({ error: "Product not found in the synced catalog for this shop." });
    return;
  }
  const findings = (await listFindings(shop, { runId })).map(rowToFinding);
  const proposals = proposeFixes(product, findings);

  const ids: number[] = [];
  for (const p of proposals) ids.push(await createProposal(shop, runId, null, p));
  res.json({
    runId, productGid, created: ids.length,
    writeProducts: proposals.filter((p) => p.kind === "write_products").length,
    copyReady: proposals.filter((p) => p.kind === "copy_ready").length,
    proposalIds: ids,
  });
}

/** GET /app/api/fixes?runId=&status= — list proposals (write_products first). */
export async function listFixesHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const runId = req.query.runId != null ? Number(req.query.runId) : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const proposals = await listProposals(shop, { runId: Number.isInteger(runId) ? runId : undefined, status });
  res.json({ count: proposals.length, proposals });
}

function idParam(req: Request): number {
  return Number(req.params.id);
}

/** POST /app/api/fixes/:id/approve */
export async function approveHandler(req: Request, res: Response): Promise<void> {
  const out = await approveProposal(shopOf(req), idParam(req), "merchant");
  res.status(out.ok ? 200 : 409).json(out);
}

/** POST /app/api/fixes/:id/apply — the only store-writing route (gated + reversible). */
export async function applyHandler(req: Request, res: Response): Promise<void> {
  const out = await applyProposal(shopOf(req), idParam(req), "merchant");
  res.status(out.ok ? 200 : out.conflict ? 409 : 422).json(out);
}

/** POST /app/api/fixes/:id/rollback */
export async function rollbackHandler(req: Request, res: Response): Promise<void> {
  const out = await rollbackProposal(shopOf(req), idParam(req), "merchant");
  res.status(out.ok ? 200 : out.conflict ? 409 : 422).json(out);
}

/** POST /app/api/fixes/:id/dismiss */
export async function dismissHandler(req: Request, res: Response): Promise<void> {
  const out = await dismissProposal(shopOf(req), idParam(req), "merchant");
  res.status(out.ok ? 200 : 409).json(out);
}
