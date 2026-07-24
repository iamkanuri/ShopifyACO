import type { Request, Response } from "express";
import { shopOf } from "./shopify.js";
import {
  claimPublicTest, claimPublicTestByHost, createBuyerTest, getBuyerTest, latestBuyerTest,
  listBuyerTests, listTestRuns, recordConfirmation, recordTestRun, latestConfirmations,
  setBuyerTestProductGid, updateBuyerTestResult, linkProposalToConfirmation, listProposalsForTest,
  type BuyerTestContract, type BuyerTestRow, type ConfirmAnswer,
} from "../db/buyerTests.js";
import { createProposal, getProductForFix } from "../db/fixes.js";
import { proposeClaimStatement } from "../fixes/propose.js";
import { loadNormalizedProducts, getStorefrontUrl } from "../db/catalog.js";
import type { NormalizedProduct } from "../catalog/normalize.js";
import { contractVersion, ENGINE_VERSION, type Assertion, type Requirement } from "./productTest.js";
import { runAuthenticatedTest, unprovenClaimRows, type AuthenticatedTestResult } from "./authenticatedTest.js";

// ===========================================================================
// V2 CP2/CP3 — the AUTHENTICATED Buyer Test surface.
//
// This is the seam the whole V2 exists to close. A merchant who ran a public test
// arrives here holding a token; their first authenticated screen is THAT test,
// re-run with full store access, with the rows that said "requires store access"
// resolved. No token (a direct install) gets a product picker — never a dashboard.
//
// Tenancy: every route is behind `requireShop`, and every read re-checks
// `shop_domain`. A buyer test is never visible across tenants.
// ===========================================================================

const bad = (res: Response, code: number, error: string): void => { res.status(code).json({ error }); };

/** Match a public test's product URL to a synced catalog product. The public test
 *  knows only a storefront URL; the catalog is keyed by GID. Handle is the join. */
export function matchProductByUrl(products: NormalizedProduct[], productUrl: string): NormalizedProduct | null {
  let handle = "";
  try {
    const m = new URL(productUrl).pathname.match(/\/products\/([^/?#]+)/i);
    handle = decodeURIComponent(m?.[1] ?? "").toLowerCase();
  } catch { /* an unparsable URL simply won't match */ }
  if (!handle) return null;
  return products.find((p) => (p.handle ?? "").toLowerCase() === handle) ?? null;
}

async function authContext(shop: string): Promise<{ storefrontUrl: string | null }> {
  const storefrontUrl = await getStorefrontUrl(shop).catch(() => null);
  return { storefrontUrl };
}

/** Assertions from a stored result blob (public or authenticated). */
function assertionsOf(result: unknown): Assertion[] {
  const r = result as { assertions?: Assertion[] } | null;
  return Array.isArray(r?.assertions) ? r!.assertions! : [];
}

// ---------------------------------------------------------------------------
// POST /app/api/buyer-tests/claim  { token }
// The install-continuity handshake. Binds a public test to this shop, re-runs it
// with authenticated data, and returns both runs so the UI can show what changed.
// ---------------------------------------------------------------------------
export async function claimTestHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const raw = typeof (req.body as { token?: unknown })?.token === "string" ? (req.body as { token: string }).token : "";
  const token = /^t_[a-f0-9]{20}$/.test(raw) ? raw : "";

  // Two ways in. An exact token (our own OAuth redirect, or a same-origin visit),
  // or — for the App Store install path, where no token can survive — the most
  // recent unclaimed test run against THIS store's own storefront host.
  let claimed = token ? await claimPublicTest(token, shop) : null;
  if (!claimed) {
    const storefront = await getStorefrontUrl(shop).catch(() => null);
    const hosts = [shop];
    if (storefront) { try { hosts.push(new URL(storefront).host); } catch { /* ignore */ } }
    claimed = await claimPublicTestByHost(shop, hosts);
  }
  if (!claimed) {
    // Expired, already owned by another shop, or nothing to import. All are
    // honestly "nothing for you here" — we never reveal which, and never re-bind
    // a test another shop already claimed.
    return bad(res, 404, "We couldn't find a recent public test to import for this store.");
  }

  // Idempotent: re-claiming an already-imported token returns the existing test
  // rather than creating a duplicate on every page refresh.
  const existing = await latestBuyerTest(shop, claimed.product_url);
  if (existing && existing.origin_token === token) {
    res.json({ ok: true, testId: existing.id, test: view(existing), alreadyImported: true });
    return;
  }

  const publicResult = claimed.result as unknown as { task?: string; assertions?: Assertion[]; productName?: string };
  const contract = contractFromPublicResult(claimed.result);
  const testId = await createBuyerTest({
    shop,
    productUrl: claimed.product_url,
    productTitle: publicResult.productName ?? null,
    contract,
    contractVersion: contractVersion(contract.requirements),
    engineVersion: ENGINE_VERSION,
    source: "public",
    originToken: token,
    baselineResult: claimed.result,
  });
  await recordTestRun({
    shop, testId, mode: "public", result: claimed.result,
    contractVersion: contractVersion(contract.requirements), engineVersion: ENGINE_VERSION, trigger: "public",
  });

  const row = await getBuyerTest(shop, testId);
  res.json({ ok: true, testId, test: row ? view(row) : null, alreadyImported: false });
}

/**
 * Rebuild the pinned contract from a rendered public result.
 *
 * The public result stores rendered ASSERTIONS, not the Requirement objects that
 * produced them, so the contract is reconstructed from the labels. This is exact
 * for every kind whose parameters are recoverable from the label (claims, price
 * caps, variant options) and falls back to a labelled requirement otherwise —
 * which still pins the SAME question, which is what the rerun guard needs.
 */
export function contractFromPublicResult(result: unknown): BuyerTestContract {
  const r = result as { task?: string; assertions?: Assertion[]; deferred?: Assertion[] };
  const rows = [...(r.assertions ?? []), ...(r.deferred ?? [])];
  const requirements: Requirement[] = rows.map((a, i) => {
    const label = a.label;
    const priceMatch = /price under \$([\d.]+)/i.exec(label);
    if (priceMatch) return { id: `price${i}`, kind: "price_under", label, capUsd: Number(priceMatch[1]) };
    const optionMatch = /^(.+) option available$/i.exec(label);
    if (optionMatch) return { id: `variant${i}`, kind: "variant_option", label, optionValue: optionMatch[1]! };
    if (/in stock/i.test(label)) return { id: `stock${i}`, kind: "in_stock", label };
    if (/one-time purchase/i.test(label)) return { id: `sub${i}`, kind: "no_subscription", label };
    if (/ships|deliver/i.test(label)) return { id: `delivery${i}`, kind: "delivery", label };
    return { id: `claim${i}`, kind: "claim", label, claim: claimKeyFromLabel(label) };
  });
  return { summary: r.task ?? "", requirements };
}

/** Reverse the CLAIM_LABEL mapping ("Fragrance-free / unscented" → fragrance_free). */
export function claimKeyFromLabel(label: string): string {
  return label
    .split("/")[0]!
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function view(row: BuyerTestRow) {
  return {
    id: row.id,
    productUrl: row.product_url,
    productTitle: row.product_title,
    productGid: row.product_gid,
    name: row.name,
    contract: row.contract,
    contractVersion: row.contract_version,
    engineVersion: row.engine_version,
    source: row.source,
    baseline: row.baseline_result,
    latest: row.latest_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// GET /app/api/buyer-tests  — the Tests list (primary navigation, CP4)
// ---------------------------------------------------------------------------
export async function listTestsHandler(req: Request, res: Response): Promise<void> {
  const rows = await listBuyerTests(shopOf(req));
  res.json({ count: rows.length, tests: rows.map(view) });
}

// ---------------------------------------------------------------------------
// GET /app/api/buyer-tests/:id  — one test + its run history
// ---------------------------------------------------------------------------
export async function getTestHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, 400, "A numeric test id is required.");
  const row = await getBuyerTest(shop, id);
  if (!row) return bad(res, 404, "Test not found for this shop.");
  const [runs, confirmations] = await Promise.all([
    listTestRuns(shop, id),
    latestConfirmations(shop, id),
  ]);
  res.json({
    test: view(row),
    runs,
    confirmations: Object.fromEntries([...confirmations].map(([k, v]) => [k, v.answer])),
  });
}

// ---------------------------------------------------------------------------
// POST /app/api/buyer-tests/:id/run  — re-run the PINNED contract (CP3 §4.4)
// ---------------------------------------------------------------------------
export async function runTestHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, 400, "A numeric test id is required.");
  const row = await getBuyerTest(shop, id);
  if (!row) return bad(res, 404, "Test not found for this shop.");

  const outcome = await executeAuthenticatedRun(shop, row, (req.body as { trigger?: string })?.trigger);
  if ("failed" in outcome) return bad(res, outcome.status, outcome.error);
  res.json(outcome);
}

/** `failed` is an explicit discriminant: `AuthenticatedTestResult` already carries an
 *  optional `error`, so an `"error" in x` check would not narrow correctly. */
export interface RunFailure { failed: true; error: string; status: number }

/**
 * Execute a pinned contract against authenticated data.
 *
 * THE GUARD (§4.4): a re-run is refused when the contract or the engine version
 * differs from the one the test was defined under. A before/after that quietly
 * changed its own question — or its evaluator — is not evidence of anything, and
 * showing it as a comparison would be the most persuasive lie the product could tell.
 */
export async function executeAuthenticatedRun(
  shop: string,
  row: BuyerTestRow,
  trigger?: string,
): Promise<(AuthenticatedTestResult & { testId: number; previousRun: unknown }) | RunFailure> {
  const contract = row.contract;
  const currentVersion = contractVersion(contract.requirements);
  if (currentVersion !== row.contract_version) {
    return { failed: true, status: 409, error: "This test's contract changed since it was saved, so a before/after comparison wouldn't be valid. Save it as a new test to measure from here." };
  }
  if (ENGINE_VERSION !== row.engine_version) {
    return { failed: true, status: 409, error: `This test was recorded on engine ${row.engine_version} and we now run ${ENGINE_VERSION}. Results across engine versions aren't comparable, so we won't present them as a before/after. Save it as a new test to measure from here.` };
  }

  const products = await loadNormalizedProducts(shop, { cap: 5_000 });
  const product = row.product_gid
    ? products.find((p) => p.productGid === row.product_gid) ?? matchProductByUrl(products, row.product_url)
    : matchProductByUrl(products, row.product_url);
  if (!product) {
    return { failed: true, status: 404, error: "We couldn't find this product in your synced catalog. Sync your catalog, then run the test again." };
  }
  if (!row.product_gid) await setBuyerTestProductGid(shop, row.id, product.productGid);

  const ctx = await authContext(shop);
  // The before/after baseline is the most recent run of THIS test — on the first
  // authenticated run that is the public result the merchant already saw.
  const previous = assertionsOf(row.latest_result ?? row.baseline_result);
  const result = runAuthenticatedTest({
    product,
    ctx,
    requirements: contract.requirements,
    summary: contract.summary,
    previous,
    productUrl: row.product_url,
  });

  await recordTestRun({
    shop, testId: row.id, mode: "authenticated", result,
    contractVersion: currentVersion, engineVersion: ENGINE_VERSION, trigger: trigger ?? "manual",
  });
  await updateBuyerTestResult(shop, row.id, result);
  return { ...result, testId: row.id, previousRun: row.latest_result ?? row.baseline_result };
}

// ---------------------------------------------------------------------------
// POST /app/api/buyer-tests  { productGid }  — start a test from the picker
// ---------------------------------------------------------------------------
export async function createTestHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const productGid = typeof (req.body as { productGid?: unknown })?.productGid === "string"
    ? (req.body as { productGid: string }).productGid : "";
  if (!productGid) return bad(res, 400, "productGid (string) is required.");

  const products = await loadNormalizedProducts(shop, { cap: 5_000 });
  const product = products.find((p) => p.productGid === productGid);
  if (!product) return bad(res, 404, "Product not found in the synced catalog for this shop.");

  const ctx = await authContext(shop);
  const first = runAuthenticatedTest({ product, ctx, productUrl: product.onlineUrl ?? "" });
  const contract: BuyerTestContract = {
    summary: first.task,
    requirements: rebuildRequirements(first),
  };
  const testId = await createBuyerTest({
    shop,
    productUrl: product.onlineUrl ?? `https://${shop}/products/${product.handle ?? ""}`,
    productGid: product.productGid,
    productTitle: product.title,
    contract,
    contractVersion: first.contractVersion,
    engineVersion: first.engineVersion,
    source: "picker",
  });
  await recordTestRun({
    shop, testId, mode: "authenticated", result: first,
    contractVersion: first.contractVersion, engineVersion: first.engineVersion, trigger: "first_run",
  });
  await updateBuyerTestResult(shop, testId, first);
  res.json({ ok: true, testId, result: { ...first, testId } });
}

/** The requirements a fresh authenticated run generated, recovered for pinning. */
function rebuildRequirements(result: AuthenticatedTestResult): Requirement[] {
  return contractFromPublicResult({ task: result.task, assertions: result.assertions }).requirements;
}

// ---------------------------------------------------------------------------
// GET /app/api/buyer-tests/:id/confirm  — the questions only the merchant can answer
// POST /app/api/buyer-tests/:id/confirm { requirementId, answer }
// ---------------------------------------------------------------------------
export async function confirmQuestionsHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, 400, "A numeric test id is required.");
  const row = await getBuyerTest(shop, id);
  if (!row) return bad(res, 404, "Test not found for this shop.");

  const assertions = assertionsOf(row.latest_result ?? row.baseline_result);
  const rows = unprovenClaimRows(assertions, row.contract.requirements);
  const answered = await latestConfirmations(shop, id);

  res.json({
    testId: id,
    questions: rows.map(({ requirement, assertion }) => ({
      requirementId: requirement.id,
      label: requirement.label,
      // Framed as a question about the PRODUCT, which only they can answer — the
      // test never asserts the answer, it asks for it.
      question: `Is this product ${requirement.label.toLowerCase()}?`,
      detail: assertion.detail,
      answer: answered.get(requirement.id)?.answer ?? null,
    })),
  });
}

export async function confirmHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, 400, "A numeric test id is required.");
  const body = (req.body ?? {}) as { requirementId?: unknown; answer?: unknown };
  const requirementId = typeof body.requirementId === "string" ? body.requirementId : "";
  const answer = body.answer as ConfirmAnswer;
  if (!requirementId) return bad(res, 400, "requirementId (string) is required.");
  if (answer !== "yes" && answer !== "no" && answer !== "unsure") {
    return bad(res, 400, "answer must be one of: yes, no, unsure.");
  }

  const row = await getBuyerTest(shop, id);
  if (!row) return bad(res, 404, "Test not found for this shop.");
  const requirement = row.contract.requirements.find((r) => r.id === requirementId);
  if (!requirement) return bad(res, 404, "That requirement isn't part of this test.");

  const confirmationId = await recordConfirmation({
    shop, testId: id, requirementId,
    requirementLabel: requirement.label, answer, actor: "merchant",
  });

  // A "no" CLOSES the requirement. There is nothing to fix: an AI buyer that can't
  // verify a claim the product doesn't make is behaving correctly, and writing that
  // claim into the store would be manufacturing a false statement.
  const closed = answer === "no";
  res.json({
    ok: true,
    confirmationId,
    closed,
    proposalEligible: answer === "yes",
    message: closed
      ? "Closed — an AI buyer is right not to verify this, and no fix is needed."
      : answer === "unsure"
      ? "Noted. We won't propose any store change until you can confirm this."
      : "Confirmed. You can now generate a proposed change for your review.",
  });
}

// ---------------------------------------------------------------------------
// POST /app/api/buyer-tests/:id/propose  { requirementId }
// Turn a CONFIRMED claim into a reviewable proposal. This is the single point
// where an evidence-availability finding becomes a store change, and it is gated
// on the merchant's own "yes" — never on our inability to verify something.
// ---------------------------------------------------------------------------
export async function proposeFromTestHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, 400, "A numeric test id is required.");
  const requirementId = typeof (req.body as { requirementId?: unknown })?.requirementId === "string"
    ? (req.body as { requirementId: string }).requirementId : "";
  if (!requirementId) return bad(res, 400, "requirementId (string) is required.");

  const row = await getBuyerTest(shop, id);
  if (!row) return bad(res, 404, "Test not found for this shop.");
  const requirement = row.contract.requirements.find((r) => r.id === requirementId);
  if (!requirement) return bad(res, 404, "That requirement isn't part of this test.");
  if (requirement.kind !== "claim") {
    return bad(res, 422, "Only attribute claims can be closed by a copy change. Price, stock and variant rows are facts about your store, not statements in your copy.");
  }

  // THE GATE. No confirmation, or anything other than "yes", produces no proposal.
  // We know only that a claim could not be VERIFIED; writing it into a merchant's
  // store on that basis would be manufacturing a product fact we cannot stand behind.
  const confirmations = await latestConfirmations(shop, id);
  const confirmation = confirmations.get(requirementId);
  if (!confirmation || confirmation.answer !== "yes") {
    return bad(res, 409, "Confirm this is true of your product before we propose any change to your store.");
  }

  if (!row.product_gid) return bad(res, 409, "Run this test against your connected catalog first so we know which product to change.");
  const product = await getProductForFix(shop, row.product_gid);
  if (!product) return bad(res, 404, "Product not found in the synced catalog for this shop.");

  const proposals = proposeClaimStatement(product, {
    claimKey: requirement.claim ?? claimKeyFromLabel(requirement.label),
    label: requirement.label,
    confirmationId: confirmation.id,
    buyerTestId: id,
  });
  if (!proposals.length) {
    return bad(res, 422, "Your product description already states this, so there's nothing to change here. The gap is in a surface we couldn't read publicly.");
  }

  const ids: number[] = [];
  for (const p of proposals) {
    const pid = await createProposal(shop, null, null, p);
    await linkProposalToConfirmation(pid, confirmation.id, id);
    ids.push(pid);
  }
  res.json({ ok: true, created: ids.length, proposalIds: ids, proposals });
}

// ---------------------------------------------------------------------------
// GET /app/api/buyer-tests/:id/proposals — the proposals raised from this test
// ---------------------------------------------------------------------------
export async function testProposalsHandler(req: Request, res: Response): Promise<void> {
  const shop = shopOf(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return bad(res, 400, "A numeric test id is required.");
  const proposals = await listProposalsForTest(shop, id);
  res.json({ count: proposals.length, proposals });
}
