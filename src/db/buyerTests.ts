import { randomBytes } from "node:crypto";
import { pgQuery } from "./pg.js";
import type { Requirement } from "../server/productTest.js";

// ===========================================================================
// V2 — persistence for the Buyer Test walk (public → install → fix → rerun).
// Every function is shop-scoped where a shop exists; the public-token functions
// are deliberately NOT, because they run before any shop is known.
// ===========================================================================

/**
 * The CLAIM window — long enough to install, no longer.
 *
 * ⚠️ THIS IS NOT A RETENTION POLICY, AND READING IT AS ONE IS WHAT MADE "PERMANENT" FALSE.
 * `expires_at` bounds how long an unclaimed result may still be bound to a shop through
 * OAuth. It never had anything to do with whether a human can read the result, but every
 * read filtered on it, so a result became unreadable after seven days. v4.2 separates the
 * two: claims still expire here; rendering goes through `getStoredResult`, which does not
 * consult this at all. Nothing deletes a `public_tests` row — there is no purge job for
 * this table and adding one would break the permanent URL.
 */
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

/** Provenance a permanent result URL must state, and which the result blob cannot supply. */
export interface StoredResultMeta {
  kind?: "general" | "standard";
  engineVersion?: string | null;
  standardSlug?: string | null;
  standardVersion?: string | null;
  standardHash?: string | null;
  contractVersion?: string | null;
  /** The token this run re-runs. Append-only: the new row points back, never overwrites. */
  rerunOf?: string | null;
  ranAt?: number;
}

/** Persist a rendered public result so it can survive the install redirect — and, since
 *  v4.2, so it can be served forever at its own URL. */
export async function storePublicTest(
  token: string,
  productUrl: string,
  storeHost: string | null,
  result: unknown,
  now: number = Date.now(),
  meta: StoredResultMeta = {},
): Promise<void> {
  await pgQuery(
    `insert into public_tests
       (token, product_url, store_host, result, expires_at,
        ran_at, engine_version, kind, standard_slug, standard_version, standard_hash,
        contract_version, rerun_of)
     values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (token) do nothing`,
    [
      token, productUrl, storeHost, JSON.stringify(result),
      new Date(now + PUBLIC_TEST_TTL_MS).toISOString(),
      new Date(meta.ranAt ?? now).toISOString(),
      meta.engineVersion ?? null,
      meta.kind ?? "general",
      meta.standardSlug ?? null,
      meta.standardVersion ?? null,
      meta.standardHash ?? null,
      meta.contractVersion ?? null,
      meta.rerunOf ?? null,
    ],
  );
  // The older result learns that a newer one exists. This is the ONLY field a later run
  // may write on an earlier row, and it is a pointer rather than a verdict — the same
  // shape as the supersession notice a byte-frozen standard gets from its renderer.
  // Never `do update` on the result itself: results are append-only.
  if (meta.rerunOf) {
    await pgQuery(`update public_tests set superseded_by=$2 where token=$1`, [meta.rerunOf, token]);
  }
}

/** A stored result row, as the permanent URL needs it. */
export interface StoredResultRow extends PublicTestRow {
  kind: string;
  ran_at: string | null;
  engine_version: string | null;
  standard_slug: string | null;
  standard_version: string | null;
  standard_hash: string | null;
  contract_version: string | null;
  shared_at: string | null;
  rerun_of: string | null;
  superseded_by: string | null;
  created_at: string;
}

/**
 * Read a stored result FOR RENDERING. Deliberately does not filter on `expires_at`.
 *
 * ⚠️ NOT A LOOSENING OF `getPublicTest` — a separate question. `getPublicTest` answers
 * "may this result still be bound to a shop through OAuth?", which is time-limited and
 * stays time-limited; this answers "what did we say about this page, and when?", which a
 * citation requires to be permanent. Widening the existing function would have quietly
 * extended the claim window too, which is a security-relevant behaviour change nobody
 * asked for.
 */
export async function getStoredResult(token: string): Promise<StoredResultRow | null> {
  const { rows } = await pgQuery<StoredResultRow>(
    `select token, product_url, store_host, result, shop_domain, claimed_at,
            kind, ran_at, engine_version, standard_slug, standard_version, standard_hash,
            contract_version, shared_at, rerun_of, superseded_by, created_at
       from public_tests where token=$1`,
    [token],
  );
  return rows[0] ?? null;
}

/** Mark a result shareable. Idempotent, and it never un-shares — a link already sent
 *  cannot be recalled, so offering a button that pretends otherwise would be a lie. */
export async function markResultShared(token: string): Promise<string | null> {
  const { rows } = await pgQuery<{ shared_at: string }>(
    `update public_tests set shared_at = coalesce(shared_at, now())
      where token=$1 returning shared_at`,
    [token],
  );
  return rows[0]?.shared_at ?? null;
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

/**
 * READ-ONLY: is there an unclaimed public test this shop could import by host match?
 *
 * Deliberately does not claim. Reconciliation happens later and lazily, when the
 * merchant first opens /app and `claimTestHandler` runs; claiming here would set
 * `shop_domain` and make that handler report "nothing to import", breaking the
 * first authenticated screen. So this answers the narrower, honest question —
 * *was a prior test matchable at install time* — which is what the install
 * telemetry records. Same predicate as `claimPublicTestByHost`, minus the update.
 */
export async function hasMatchablePublicTest(hosts: string[], sinceMs = 30 * 24 * 60 * 60 * 1000): Promise<boolean> {
  const candidates = [...new Set(hosts.filter(Boolean).map((h) => h.toLowerCase().replace(/^www\./, "")))];
  if (!candidates.length) return false;
  const { rows } = await pgQuery<{ token: string }>(
    `select token from public_tests
      where shop_domain is null
        and expires_at > now()
        and created_at > now() - make_interval(secs => $2)
        and regexp_replace(lower(coalesce(store_host,'')), '^www\\.', '') = any($1::text[])
      limit 1`,
    [candidates, Math.floor(sinceMs / 1000)],
  );
  return rows.length > 0;
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
