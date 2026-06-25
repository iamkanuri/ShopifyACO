import { pgQuery } from "./pg.js";
import type { CatalogProduct } from "../fixes/propose.js";
import type { FixProposal } from "../fixes/propose.js";

// Persistence for Fix Studio (Phase 6). Proposals are shop-scoped; the lifecycle
// (proposed → approved → applied | failed | conflict | rolled_back | dismissed) is a
// status column. applied_snapshot holds the before-state for rollback.

export interface ProposalRow {
  id: number;
  shop_domain: string;
  run_id: number | null;
  finding_id: number | null;
  product_gid: string | null;
  kind: string;
  target: string;
  label: string;
  current_value: string | null;
  proposed_value: string;
  based_on: string | null;
  rationale: string | null;
  evidence: Record<string, unknown>;
  status: string;
  applied_snapshot: Record<string, unknown> | null;
  error: string | null;
}

export async function createProposal(shop: string, runId: number | null, findingId: number | null, p: FixProposal): Promise<number> {
  const { rows } = await pgQuery<{ id: string }>(
    `insert into fix_proposals
       (shop_domain, run_id, finding_id, product_gid, kind, target, label, current_value, proposed_value, based_on, rationale, evidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) returning id`,
    [shop, runId, findingId, p.productGid, p.kind, p.target, p.label, p.currentValue, p.proposedValue, p.basedOn, p.rationale, JSON.stringify(p.evidence)],
  );
  return Number(rows[0]!.id);
}

export async function getProposal(id: number): Promise<ProposalRow | null> {
  const { rows } = await pgQuery<ProposalRow & { id: string; run_id: string | null; finding_id: string | null }>(
    "select * from fix_proposals where id=$1",
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...r, id: Number(r.id), run_id: r.run_id != null ? Number(r.run_id) : null, finding_id: r.finding_id != null ? Number(r.finding_id) : null };
}

export async function listProposals(shop: string, opts: { runId?: number; status?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const { rows } = await pgQuery(
    `select id, run_id, finding_id, product_gid, kind, target, label, current_value, proposed_value,
            rationale, evidence, status, error, created_at, applied_at
       from fix_proposals
      where shop_domain=$1
        and ($2::bigint is null or run_id=$2)
        and ($3::text is null or status=$3)
      order by (kind='write_products') desc, created_at desc
      limit $4`,
    [shop, opts.runId ?? null, opts.status ?? null, limit],
  );
  return rows;
}

/** Count fix proposals for a shop (optionally filtered by status, e.g. 'proposed'). */
export async function countProposals(shop: string, opts: { status?: string } = {}): Promise<number> {
  const { rows } = await pgQuery<{ n: string }>(
    "select count(*)::int as n from fix_proposals where shop_domain=$1 and ($2::text is null or status=$2)",
    [shop, opts.status ?? null],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Apply a status transition + optional fields. Returns the updated row count. */
export async function updateProposal(
  id: number,
  fields: { status?: string; appliedSnapshot?: Record<string, unknown> | null; error?: string | null; actor?: string; markApproved?: boolean; markApplied?: boolean },
): Promise<void> {
  await pgQuery(
    `update fix_proposals set
       status = coalesce($2, status),
       applied_snapshot = case when $3::boolean then $4::jsonb else applied_snapshot end,
       error = case when $9::boolean then $5 else error end,
       actor = coalesce($6, actor),
       approved_at = case when $7::boolean then now() else approved_at end,
       applied_at = case when $8::boolean then now() else applied_at end,
       updated_at = now()
     where id=$1`,
    [id, fields.status ?? null, fields.appliedSnapshot !== undefined, fields.appliedSnapshot != null ? JSON.stringify(fields.appliedSnapshot) : null,
     fields.error ?? null, fields.actor ?? null, Boolean(fields.markApproved), Boolean(fields.markApplied), "error" in fields],
  );
}

/** Load the catalog data needed to propose fixes for one product (incl. a price). */
export async function getProductForFix(shop: string, productGid: string): Promise<CatalogProduct | null> {
  const { rows } = await pgQuery<{
    product_gid: string; title: string | null; description: string | null; vendor: string | null;
    product_type: string | null; online_url: string | null; seo_title: string | null; seo_description: string | null; price: string | null;
  }>(
    `select p.product_gid, p.title, p.description, p.vendor, p.product_type, p.online_url, p.seo_title, p.seo_description,
            (select min(v.price) from product_variants v where v.shop_domain=p.shop_domain and v.product_gid=p.product_gid) as price
       from products p where p.shop_domain=$1 and p.product_gid=$2`,
    [shop, productGid],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    productGid: r.product_gid, title: r.title, description: r.description, vendor: r.vendor,
    productType: r.product_type, onlineUrl: r.online_url, seoTitle: r.seo_title, seoDescription: r.seo_description,
    price: r.price != null ? Number(r.price) : null, currency: "USD",
  };
}
