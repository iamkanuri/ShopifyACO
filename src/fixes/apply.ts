import { ENV } from "../server/env.js";
import { getAccessToken, getShop, audit } from "../db/shops.js";
import { getProposal, updateProposal, type ProposalRow } from "../db/fixes.js";
import { writableField, type WritableField } from "./propose.js";
import { buildProductInput, productUpdate, rereadProduct } from "./source.js";
import { hasScope } from "../shopify/scopes.js";
import { upsertProduct } from "../db/catalog.js";
import type { NormalizedProduct } from "../catalog/normalize.js";

/** Best-effort: mirror a just-written product back into the synced catalog so every
 *  screen (Fix Studio live values, Catalog) agrees with the Shopify admin IMMEDIATELY
 *  after our own write — the products/update webhook is the eventual backstop. */
async function mirrorToCatalog(shop: string, product: NormalizedProduct | null | undefined): Promise<void> {
  if (!product) return;
  try {
    await upsertProduct(shop, product);
  } catch (err) {
    console.error(`[fixes] post-write catalog mirror failed for ${shop}:`, (err as Error).message);
  }
}

// ===========================================================================
// Fix Studio write-back engine (Phase 6). The ONLY place this app mutates a
// merchant's store. Every write is:
//   • merchant-APPROVED first (status must be 'approved'),
//   • SCOPE-gated (write_products must be granted),
//   • CONFLICT-checked (re-read the live product; abort if it changed since the
//     proposal was made — never blindly overwrite),
//   • SNAPSHOTTED (before-state stored for one-click rollback),
//   • AUDITED, with partial-failure (userErrors) surfaced verbatim.
// mock mode runs the whole lifecycle with no network/credentials. Live writes hit
// the Shopify Admin API — gated, and only ever reformat data the merchant has.
// ===========================================================================

export interface ApplyOutcome {
  ok: boolean;
  status: "approved" | "dismissed" | "applied" | "failed" | "conflict" | "rolled_back" | "rejected";
  detail?: string;
  conflict?: boolean;
}

/** write_products requires the granted scope. (mock simulates a granted store but we
 *  still honor the shop's recorded scopes so the gate is exercised honestly.) Delegates to
 *  the canonical scope parser so this gate can't drift from what Settings reports. */
export function hasWriteScope(scopes: string | null | undefined): boolean {
  return hasScope(scopes, "write_products");
}

/** Load a proposal and confirm it belongs to this shop (tenant isolation). */
async function loadOwned(shop: string, id: number): Promise<ProposalRow | null> {
  const p = await getProposal(id);
  return p && p.shop_domain === shop ? p : null;
}
const NOT_FOUND: ApplyOutcome = { ok: false, status: "rejected", detail: "Proposal not found for this shop." };

/** Merchant approval gate — only a 'proposed' write_products change can be approved. */
export async function approveProposal(shop: string, id: number, actor: string): Promise<ApplyOutcome> {
  const p = await loadOwned(shop, id);
  if (!p) return NOT_FOUND;
  if (p.status !== "proposed") return { ok: false, status: "rejected", detail: `cannot approve a '${p.status}' proposal` };
  await updateProposal(id, { status: "approved", actor, markApproved: true, error: null });
  return { ok: true, status: "approved", detail: "approved" };
}

export async function dismissProposal(shop: string, id: number, actor: string): Promise<ApplyOutcome> {
  const p = await loadOwned(shop, id);
  if (!p) return NOT_FOUND;
  await updateProposal(id, { status: "dismissed", actor, error: null });
  return { ok: true, status: "dismissed", detail: "dismissed" };
}

/** Apply an APPROVED write_products proposal to the live store (gated + reversible). */
export async function applyProposal(shop: string, id: number, actor: string): Promise<ApplyOutcome> {
  const p = await loadOwned(shop, id);
  if (!p) return NOT_FOUND;

  if (p.kind !== "write_products") return { ok: false, status: "rejected", detail: "only write_products proposals can be applied; copy_ready is manual" };
  // Allow (re)applying an approved proposal, or RETRYING one that previously failed (e.g. a
  // transient Shopify error) — without forcing the merchant to regenerate. The conflict
  // re-read below still protects against clobbering a value that changed in the meantime.
  if (p.status !== "approved" && p.status !== "failed") return { ok: false, status: "rejected", detail: `proposal must be approved first (is '${p.status}')` };
  const field = writableField(p.target);
  if (!field || !p.product_gid) return { ok: false, status: "rejected", detail: `target '${p.target}' is not directly writable` };

  // Scope gate.
  const shopRow = await getShop(shop);
  if (!hasWriteScope(shopRow?.scopes)) {
    await updateProposal(id, { status: "approved", error: "write_products scope not granted" });
    return { ok: false, status: "rejected", detail: "write_products scope not granted — reconnect the app with write access first." };
  }

  const token = await getAccessToken(shop);
  if (!token) return { ok: false, status: "rejected", detail: "no access token — shop not connected." };

  // Re-read the live product for the conflict check.
  let live;
  try {
    live = await rereadProduct(shop, token, p.product_gid);
  } catch (err) {
    await updateProposal(id, { status: "failed", error: (err as Error).message });
    return { ok: false, status: "failed", detail: (err as Error).message };
  }
  if (!live) {
    await updateProposal(id, { status: "failed", error: "product no longer exists" });
    return { ok: false, status: "failed", detail: "product no longer exists" };
  }

  const liveValue = (live[field] as string | null) ?? null;
  // Conflict: the field changed since we based the proposal on it. Never clobber.
  if ((liveValue ?? "") !== (p.based_on ?? "")) {
    await updateProposal(id, { status: "conflict", error: `live value changed since proposal (now: ${truncErr(liveValue)})` });
    return { ok: false, status: "conflict", conflict: true, detail: "the live value changed since this was proposed; re-review before applying." };
  }

  // Snapshot before-state for rollback, then write.
  const snapshot: { field: WritableField; target: string; before: string | null; applied?: string | null } = { field, target: p.target, before: liveValue };
  try {
    const input = buildProductInput(p.product_gid, field, p.proposed_value);
    const result = await productUpdate(shop, token, input);
    if (!result.ok) {
      const detail = result.userErrors.map((e) => e.message).join("; ") || "productUpdate reported no success";
      await updateProposal(id, { status: "failed", error: detail });
      return { ok: false, status: "failed", detail };
    }
    // Record what the store ACTUALLY holds after the write. Shopify normalizes SEO fields (it
    // can trim, re-encode, or report a value equal to the page default differently than we
    // sent it), so the stored value often isn't byte-identical to proposed_value. Rollback
    // compares against THIS (via the same read path), so only a genuine later merchant edit —
    // not Shopify's own normalization — counts as a conflict.
    let verified = false; // re-read succeeded, so snapshot.applied is the store's real value
    try {
      const after = await rereadProduct(shop, token, p.product_gid);
      snapshot.applied = (after?.[field] as string | null) ?? null;
      verified = true;
      await mirrorToCatalog(shop, after);
    } catch {
      snapshot.applied = p.proposed_value; // best effort if the verify re-read fails
    }
    // The mutation response proves Shopify ACCEPTED the write, not that anything changed.
    // If the verified post-write value equals the pre-write value (e.g. Shopify normalized
    // it back to the default), the fix had no observable effect — report that instead of
    // claiming success. This is the structural guard against placebo fixes (the App Store
    // 2.1.4 lesson): "applied" must always mean "the store now holds something different."
    if (verified && (snapshot.applied ?? "") === (liveValue ?? "")) {
      await updateProposal(id, { status: "failed", error: "write accepted but the store value is unchanged (no observable effect)" });
      return { ok: false, status: "failed", detail: "Shopify accepted the write but the store's value is unchanged — this change would have no observable effect, so it was not marked applied." };
    }
    await updateProposal(id, { status: "applied", appliedSnapshot: snapshot, markApplied: true, error: null });
    // Audit the value the store ACTUALLY holds (the verified re-read), not the raw intent —
    // Shopify normalizes SEO fields, so the two can legitimately differ.
    await audit(shop, actor, "fix_applied", "product", { target: p.target, before: liveValue }, { after: snapshot.applied ?? p.proposed_value });
    return { ok: true, status: "applied", detail: `${p.target} updated` };
  } catch (err) {
    await updateProposal(id, { status: "failed", error: (err as Error).message });
    return { ok: false, status: "failed", detail: (err as Error).message };
  }
}

/** Reverse an applied write_products proposal using its snapshot. Conflict-checked
 *  so we don't clobber a newer merchant edit. */
export async function rollbackProposal(shop: string, id: number, actor: string): Promise<ApplyOutcome> {
  const p = await loadOwned(shop, id);
  if (!p) return NOT_FOUND;
  if (p.status !== "applied") return { ok: false, status: "rejected", detail: `only an applied proposal can be rolled back (is '${p.status}')` };
  const snap = p.applied_snapshot as { field?: WritableField; before?: string | null; applied?: string | null } | null;
  if (!snap?.field || !p.product_gid) return { ok: false, status: "rejected", detail: "no rollback snapshot" };

  const token = await getAccessToken(shop);
  if (!token) return { ok: false, status: "rejected", detail: "no access token — shop not connected." };

  let live;
  try {
    live = await rereadProduct(shop, token, p.product_gid);
  } catch (err) {
    return { ok: false, status: "failed", detail: (err as Error).message };
  }
  // Only roll back if the field still holds what WE left it as (else the merchant edited it
  // after us — don't overwrite their newer edit). Compare against the value the store actually
  // held right after apply (snap.applied), NOT the raw proposed value: Shopify normalizes SEO
  // fields, so proposed_value rarely matches the stored form byte-for-byte. Fall back to
  // proposed_value for snapshots written before snap.applied existed.
  const liveValue = (live?.[snap.field] as string | null) ?? null;
  const expected = snap.applied !== undefined ? snap.applied : (p.proposed_value ?? null);
  if ((liveValue ?? "") !== (expected ?? "")) {
    await updateProposal(id, { status: "conflict", error: `value changed after apply (live: ${truncErr(liveValue)}, expected: ${truncErr(expected)})` });
    return { ok: false, status: "conflict", conflict: true, detail: `the field changed after we applied it; rollback aborted. (live: "${truncErr(liveValue)}", expected: "${truncErr(expected)}")` };
  }

  try {
    const input = buildProductInput(p.product_gid, snap.field, snap.before ?? "");
    const result = await productUpdate(shop, token, input);
    if (!result.ok) {
      const detail = result.userErrors.map((e) => e.message).join("; ") || "rollback productUpdate failed";
      return { ok: false, status: "failed", detail };
    }
    await updateProposal(id, { status: "rolled_back", error: null });
    try {
      await mirrorToCatalog(shop, await rereadProduct(shop, token, p.product_gid));
    } catch { /* webhook backstop will re-sync */ }
    await audit(shop, actor, "fix_rolled_back", "product", { after: p.proposed_value }, { restored: snap.before });
    return { ok: true, status: "rolled_back", detail: `${p.target} restored` };
  } catch (err) {
    return { ok: false, status: "failed", detail: (err as Error).message };
  }
}

function truncErr(v: string | null): string {
  if (v == null) return "empty";
  return v.length > 40 ? v.slice(0, 40) + "…" : v;
}
