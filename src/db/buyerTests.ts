import { randomBytes } from "node:crypto";
import { pgQuery } from "./pg.js";
import type { Requirement } from "../server/productTest.js";

// ===========================================================================
// V2 — persistence for the Buyer Test walk (public → install → fix → rerun).
// Every function is shop-scoped where a shop exists; the public-token functions
// are deliberately NOT, because they run before any shop is known.
// ===========================================================================

/** Unclaimed public results are short-lived — long enough to install, no longer. */
export const PUBLIC_TEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PublicTestRow {
  token: string;
  product_url: string;
  store_host: string | null;
  result: Record<string, unknown>;
  shop_domain: string | null;
  claimed_at: string | null;
}

export interface BuyerTestContract {
  summary: string;
  requirements: Requirement[];
}

export interface BuyerTestRow {
  id: number;
  shop_domain: string;
  product_gid: string | null;
  product_url: string;
  product_title: string | null;
  name: string | null;
  contract: BuyerTestContract;
  contract_version: string;
  engine_version: string;
  source: string;
  origin_token: string | null;
  baseline_result: Record<string, unknown> | null;
  latest_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ---- public tests (pre-install) ---------------------------------------------

/** 80 bits of entropy, same standard as report ids — a token must not be guessable
 *  because it carries a merchant's result to whoever holds it. */
export function newTestToken(): string {
  return `t_${randomBytes(10).toString("hex")}`;
}

/** Persist a rendered public result so it can survive the install redirect. */
export async function storePublicTest(
  token: string,
  productUrl: string,
  storeHost: string | null,
  result: unknown,
  now: number = Date.now(),
): Promise<void> {
  await pgQuery(
    `insert into public_tests (token, product_url, store_host, result, expires_at)
     values ($1,$2,$3,$4::jsonb,$5)
     on conflict (token) do nothing`,
    [token, productUrl, storeHost, JSON.stringify(result), new Date(now + PUBLIC_TEST_TTL_MS).toISOString()],
  );
}

/** Read an unexpired public test. Does NOT consume it — claiming is separate, so a
 *  failed install can be retried without losing the merchant's result. */
export async function getPublicTest(token: string): Promise<PublicTestRow | null> {
  const { rows } = await pgQuery<PublicTestRow>(
    `select token, product_url, store_host, result, shop_domain, claimed_at
       from public_tests where token=$1 and expires_at > now()`,
    [token],
  );
  return rows[0] ?? null;
}

/** Bind a public test to the shop that just installed. Idempotent, and refuses to
 *  re-bind a token already claimed by a DIFFERENT shop. */
export async function claimPublicTest(token: string, shop: string): Promise<PublicTestRow | null> {
  const { rows } = await pgQuery<PublicTestRow>(
    `update public_tests
        set shop_domain=$2, claimed_at=coalesce(claimed_at, now())
      where token=$1 and expires_at > now()
        and (shop_domain is null or shop_domain=$2)
      returning token, product_url, store_host, result, shop_domain, claimed_at`,
    [token, shop],
  );
  return rows[0] ?? null;
}

/**
 * Bind the most recent UNCLAIMED public test for a storefront host to this shop.
 *
 * This is the App-Store install path, and it is not a convenience — it is the only
 * mechanism that actually works there. Shopify App Store rule 2.3.1 forbids manual
 * shop-domain entry, so the public funnel cannot start our OAuth `/install?t=…`
 * redirect; installs begin on Shopify's own surface and never carry our token. And
 * localStorage can't rescue it either: the embedded app runs in an iframe under
 * admin.shopify.com, where storage partitioning hides anything written while our
 * site was the top-level page.
 *
 * Binding by host is legitimate because installing the app on a store IS proof of
 * control over that store. We still only ever bind tests nobody has claimed.
 */
export async function claimPublicTestByHost(shop: string, hosts: string[], sinceMs = 30 * 24 * 60 * 60 * 1000): Promise<PublicTestRow | null> {
  const candidates = [...new Set(hosts.filter(Boolean).map((h) => h.toLowerCase().replace(/^www\./, "")))];
  if (!candidates.length) return null;
  const { rows } = await pgQuery<PublicTestRow>(
    `update public_tests set shop_domain=$1, claimed_at=now()
      where token = (
        select token from public_tests
         where shop_domain is null
           and expires_at > now()
           and created_at > now() - make_interval(secs => $3)
           and regexp_replace(lower(coalesce(store_host,'')), '^www\\.', '') = any($2::text[])
         order by created_at desc limit 1
      )
      returning token, product_url, store_host, result, shop_domain, claimed_at`,
    [shop, candidates, Math.floor(sinceMs / 1000)],
  );
  return rows[0] ?? null;
}

// ---- buyer tests (post-install, shop-owned) ---------------------------------

export async function createBuyerTest(args: {
  shop: string;
  productUrl: string;
  productGid?: string | null;
  productTitle?: string | null;
  name?: string | null;
  contract: BuyerTestContract;
  contractVersion: string;
  engineVersion: string;
  source?: string;
  originToken?: string | null;
  baselineResult?: unknown;
}): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into buyer_tests
       (shop_domain, product_gid, product_url, product_title, name, contract,
        contract_version, engine_version, source, origin_token, baseline_result)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb)
     returning id`,
    [
      args.shop, args.productGid ?? null, args.productUrl, args.productTitle ?? null,
      args.name ?? null, JSON.stringify(args.contract), args.contractVersion,
      args.engineVersion, args.source ?? "public", args.originToken ?? null,
      args.baselineResult ? JSON.stringify(args.baselineResult) : null,
    ],
  );
  return Number(rows[0]!.id);
}

/** Shop-scoped by construction — a test is never readable across tenants. */
export async function getBuyerTest(shop: string, id: number): Promise<BuyerTestRow | null> {
  const { rows } = await pgQuery<BuyerTestRow & { id: string }>(
    `select * from buyer_tests where id=$1 and shop_domain=$2`,
    [id, shop],
  );
  const r = rows[0];
  return r ? { ...r, id: Number(r.id) } : null;
}

/** The most recent test for a shop, optionally for one product. */
export async function latestBuyerTest(shop: string, productUrl?: string): Promise<BuyerTestRow | null> {
  const { rows } = await pgQuery<BuyerTestRow & { id: string }>(
    `select * from buyer_tests
      where shop_domain=$1 and ($2::text is null or product_url=$2)
      order by updated_at desc limit 1`,
    [shop, productUrl ?? null],
  );
  const r = rows[0];
  return r ? { ...r, id: Number(r.id) } : null;
}

export async function listBuyerTests(shop: string, limit = 50): Promise<BuyerTestRow[]> {
  const { rows } = await pgQuery<BuyerTestRow & { id: string }>(
    `select * from buyer_tests where shop_domain=$1 order by updated_at desc limit $2`,
    [shop, Math.min(200, Math.max(1, limit))],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function updateBuyerTestResult(shop: string, id: number, latestResult: unknown): Promise<void> {
  await pgQuery(
    `update buyer_tests set latest_result=$3::jsonb, updated_at=now()
      where id=$1 and shop_domain=$2`,
    [id, shop, JSON.stringify(latestResult)],
  );
}

export async function setBuyerTestProductGid(shop: string, id: number, productGid: string): Promise<void> {
  await pgQuery(`update buyer_tests set product_gid=$3, updated_at=now() where id=$1 and shop_domain=$2`, [id, shop, productGid]);
}

// ---- run history -------------------------------------------------------------

export async function recordTestRun(args: {
  shop: string;
  testId: number;
  mode: "public" | "authenticated";
  result: unknown;
  contractVersion: string;
  engineVersion: string;
  trigger?: string;
}): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into buyer_test_runs (test_id, shop_domain, mode, result, contract_version, engine_version, trigger)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7) returning id`,
    [args.testId, args.shop, args.mode, JSON.stringify(args.result), args.contractVersion, args.engineVersion, args.trigger ?? "manual"],
  );
  return Number(rows[0]!.id);
}

export async function listTestRuns(shop: string, testId: number, limit = 20): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery<Record<string, unknown>>(
    `select id, mode, contract_version, engine_version, trigger, result, created_at
       from buyer_test_runs where test_id=$1 and shop_domain=$2
      order by created_at desc limit $3`,
    [testId, shop, Math.min(100, Math.max(1, limit))],
  );
  return rows;
}

// ---- merchant confirmations --------------------------------------------------

export type ConfirmAnswer = "yes" | "no" | "unsure";

export async function recordConfirmation(args: {
  shop: string;
  testId: number | null;
  requirementId: string;
  requirementLabel: string;
  answer: ConfirmAnswer;
  actor?: string;
}): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into requirement_confirmations
       (shop_domain, test_id, requirement_id, requirement_label, answer, actor)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [args.shop, args.testId, args.requirementId, args.requirementLabel, args.answer, args.actor ?? "merchant"],
  );
  return Number(rows[0]!.id);
}

/** The latest answer per requirement for a test — a merchant may change their mind. */
export async function latestConfirmations(shop: string, testId: number): Promise<Map<string, { id: number; answer: ConfirmAnswer }>> {
  const { rows } = await pgQuery<{ id: string; requirement_id: string; answer: ConfirmAnswer }>(
    `select distinct on (requirement_id) id, requirement_id, answer
       from requirement_confirmations
      where shop_domain=$1 and test_id=$2
      order by requirement_id, created_at desc`,
    [shop, testId],
  );
  return new Map(rows.map((r) => [r.requirement_id, { id: Number(r.id), answer: r.answer }]));
}

/** Tie a proposal to the confirmation that authorized it — the audit trail showing
 *  the merchant asserted the fact, not us. */
export async function linkProposalToConfirmation(proposalId: number, confirmationId: number, buyerTestId: number | null): Promise<void> {
  await pgQuery(
    `update fix_proposals set confirmation_id=$2, buyer_test_id=$3 where id=$1`,
    [proposalId, confirmationId, buyerTestId],
  );
}

/** Proposals raised from a given buyer test, newest first. */
export async function listProposalsForTest(shop: string, testId: number): Promise<Array<Record<string, unknown>>> {
  const { rows } = await pgQuery<Record<string, unknown>>(
    `select id, product_gid, kind, target, label, current_value, proposed_value,
            rationale, status, error, confirmation_id, created_at, applied_at
       from fix_proposals
      where shop_domain=$1 and buyer_test_id=$2
      order by created_at desc`,
    [shop, testId],
  );
  return rows;
}

export async function getConfirmation(shop: string, id: number): Promise<{ id: number; test_id: number | null; requirement_id: string; requirement_label: string; answer: ConfirmAnswer } | null> {
  const { rows } = await pgQuery<{ id: string; test_id: string | null; requirement_id: string; requirement_label: string; answer: ConfirmAnswer }>(
    `select id, test_id, requirement_id, requirement_label, answer
       from requirement_confirmations where id=$1 and shop_domain=$2`,
    [id, shop],
  );
  const r = rows[0];
  return r ? { ...r, id: Number(r.id), test_id: r.test_id == null ? null : Number(r.test_id) } : null;
}
