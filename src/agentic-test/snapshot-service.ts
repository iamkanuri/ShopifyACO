import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NormalizedProduct } from "../catalog/normalize.js";
import { loadNormalizedProducts } from "../db/catalog.js";
import type {
  EvidenceSurface,
  SnapshotEvidenceItem,
  SnapshotPage,
  SnapshotPolicy,
  SnapshotProduct,
  StoreSnapshot,
} from "./types.js";
import { canonicalJson, sha256Hex, splitSentences } from "./util.js";

// ===========================================================================
// Snapshot service (spec 4.3). A snapshot is built ONCE from the existing
// ingestion layer (DB rows written by `syncCatalog` → read back through
// `loadNormalizedProducts`) and then pinned: agents and tools read ONLY the
// snapshot — never the DB, never Shopify. Base snapshots are immutable once
// hashed (the mutator deep-clones; tests enforce it).
// ===========================================================================

/** Surfaces the AisleLens ingestion layer does not capture (AUDIT.md §2).
 *  Recorded as absent rather than silently missing — get_faq_or_policy returns
 *  an explicit empty result for them. */
export const SURFACES_ABSENT: EvidenceSurface[] = [
  "structured_data",
  "faq",
  "shipping_policy",
  "returns_policy",
];

const evidenceId = (surface: EvidenceSurface, sourceObjectId: string, content: string): string =>
  `ev-${sha256Hex(`${surface}|${sourceObjectId}|${content}`).slice(0, 16)}`;

/** Derive the flat evidence index. Deterministic given the content: every distinct
 *  piece of text (title, each description sentence, each metafield, each variant,
 *  each option, each page/policy sentence) gets a stable content-hashed id. */
export function deriveEvidence(
  products: SnapshotProduct[],
  pages: SnapshotPage[],
  policies: SnapshotPolicy[],
): SnapshotEvidenceItem[] {
  const items: SnapshotEvidenceItem[] = [];

  for (const p of products) {
    if (p.title) {
      items.push({
        evidenceId: evidenceId("product_title", p.productId, p.title),
        surface: "product_title",
        sourceObjectId: p.productId,
        exactText: p.title,
      });
    }
    if (p.description) {
      for (const sentence of splitSentences(p.description)) {
        items.push({
          evidenceId: evidenceId("product_description", p.productId, sentence),
          surface: "product_description",
          sourceObjectId: p.productId,
          exactText: sentence,
        });
      }
    }
    for (const m of p.metafields) {
      const key = `${p.productId}#${m.namespace}.${m.key}`;
      items.push({
        evidenceId: evidenceId("product_metafields", key, canonicalJson(m)),
        surface: "product_metafields",
        sourceObjectId: key,
        exactText: m.value,
        structuredValue: m,
      });
    }
    for (const v of p.variants) {
      items.push({
        evidenceId: evidenceId("product_variants", v.variantId, canonicalJson(v)),
        surface: "product_variants",
        sourceObjectId: v.variantId,
        exactText: v.title ?? undefined,
        structuredValue: v,
      });
      for (const o of v.options) {
        items.push({
          evidenceId: evidenceId("product_options", `${v.variantId}#${o.name}`, canonicalJson(o)),
          surface: "product_options",
          sourceObjectId: `${v.variantId}#${o.name}`,
          exactText: `${o.name}: ${o.value}`,
          structuredValue: o,
        });
      }
    }
  }

  for (const page of pages) {
    for (const sentence of splitSentences(page.text)) {
      items.push({
        evidenceId: evidenceId(page.surface, page.pageId, sentence),
        surface: page.surface,
        sourceObjectId: page.pageId,
        exactText: sentence,
      });
    }
  }
  for (const pol of policies) {
    for (const sentence of splitSentences(pol.text)) {
      items.push({
        evidenceId: evidenceId(pol.surface, pol.policyId, sentence),
        surface: pol.surface,
        sourceObjectId: pol.policyId,
        exactText: sentence,
      });
    }
  }
  return items;
}

export function toSnapshotProduct(p: NormalizedProduct): SnapshotProduct {
  return {
    productId: p.productGid,
    handle: p.handle,
    title: p.title,
    description: p.description,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    status: p.status,
    metafields: p.metafields.map((m) => ({ namespace: m.namespace, key: m.key, value: m.value, type: m.type })),
    variants: p.variants.map((v) => ({
      variantId: v.variantGid,
      title: v.title,
      sku: v.sku,
      price: v.price,
      available: v.available,
      options: v.options,
    })),
  };
}

/** Content hash: sha256 of canonical JSON of everything except id/createdAt/hash. */
export function computeContentHash(
  shopId: string,
  sourceVersion: string,
  products: SnapshotProduct[],
  pages: SnapshotPage[],
  policies: SnapshotPolicy[],
  surfacesAbsent: EvidenceSurface[],
  evidence: SnapshotEvidenceItem[],
): string {
  return sha256Hex(canonicalJson({ shopId, sourceVersion, products, pages, policies, surfacesAbsent, evidence }));
}

/** Snapshot ids are opaque + deterministic: derived from content hash AND parent id,
 *  so a RESTORED snapshot whose content equals BASE still gets its own id, and no
 *  id carries a BASE/FAULTY/RESTORED label the agent could see. */
export function deriveSnapshotId(contentHash: string, parentSnapshotId: string): string {
  return `snap-${sha256Hex(`v1|${contentHash}|${parentSnapshotId}`).slice(0, 16)}`;
}

/** Pure snapshot builder — the DB-backed `createStoreSnapshot` and all tests go
 *  through this. `parentSnapshotId` is "" for a base snapshot. `surfacesAbsent`
 *  defaults to the Stage 1 set; Stage 2 snapshots pass their own (fixture pages
 *  make faq + shipping_policy present). */
export function buildSnapshot(
  shopId: string,
  sourceVersion: string,
  products: SnapshotProduct[],
  pages: SnapshotPage[] = [],
  policies: SnapshotPolicy[] = [],
  parentSnapshotId = "",
  createdAt: string = new Date().toISOString(),
  surfacesAbsent: EvidenceSurface[] = SURFACES_ABSENT,
): StoreSnapshot {
  const evidence = deriveEvidence(products, pages, policies);
  const contentHash = computeContentHash(shopId, sourceVersion, products, pages, policies, surfacesAbsent, evidence);
  return {
    id: deriveSnapshotId(contentHash, parentSnapshotId),
    shopId,
    createdAt,
    sourceVersion,
    products,
    pages,
    policies,
    surfacesAbsent: [...surfacesAbsent],
    evidence,
    contentHash,
  };
}

/** Spec 4.3: load the store through the EXISTING ingestion layer and snapshot it.
 *  The whole (7-product) test-store catalog is captured — the task targets one
 *  product, but the agent must be able to SEARCH the store and could select the
 *  wrong product (the WRONG_PRODUCT_SELECTED outcome requires alternatives). */
export async function createStoreSnapshot(shopId: string, productId: string): Promise<StoreSnapshot> {
  const normalized = await loadNormalizedProducts(shopId);
  if (!normalized.length) throw new Error(`no synced catalog for ${shopId} — run the seed step first`);
  const products = normalized.map(toSnapshotProduct);
  if (!products.some((p) => p.productId === productId)) {
    throw new Error(`product ${productId} not found in the synced catalog for ${shopId}`);
  }
  const sync = products.length; // sourceVersion carries provenance, not secrets
  return buildSnapshot(shopId, `local-mock-catalog(products=${sync})+merchant-edit-v1`, products);
}

// ---- Stage 2: fixture-carried pages + real-ingestion snapshot ---------------

/** Surfaces absent from a STAGE 2 snapshot: fixture pages provide faq +
 *  shipping_policy; returns content lives inside the FAQ text (returns_policy
 *  as a distinct surface stays absent); no structured data is ingested. */
export const STAGE2_SURFACES_ABSENT: EvidenceSurface[] = ["structured_data", "returns_policy"];

export interface StorePagesFixture {
  provenance: string;
  faq: { title: string; text: string };
  shippingPolicy: { text: string };
}

const PAGES_FIXTURE_FILE = join(
  process.cwd(), "experiments", "agentic-stage2", "fixtures", "store-pages.json",
);

/** Load the seeded FAQ/shipping text (Amendment 1 §C.1: fixture-carried because
 *  catalog ingestion has no pages/policies path; provenance disclosed). */
export function loadStorePagesFixture(): { pages: SnapshotPage[]; policies: SnapshotPolicy[]; provenance: string } {
  const fixture = JSON.parse(readFileSync(PAGES_FIXTURE_FILE, "utf8")) as StorePagesFixture;
  return {
    pages: [{ pageId: "page:faq", surface: "faq", title: fixture.faq.title, text: fixture.faq.text }],
    policies: [{ policyId: "policy:shipping", surface: "shipping_policy", text: fixture.shippingPolicy.text }],
    provenance: fixture.provenance,
  };
}

/** Stage 2 BASE: the WHOLE real catalog through the existing ingestion read
 *  path, plus the fixture-carried faq/shipping surfaces. */
export async function createStage2Snapshot(shopId: string, primaryProductId: string): Promise<StoreSnapshot> {
  const normalized = await loadNormalizedProducts(shopId);
  if (!normalized.length) throw new Error(`no synced catalog for ${shopId} — run sync-dev-catalog first`);
  const products = normalized.map(toSnapshotProduct);
  if (!products.some((p) => p.productId === primaryProductId)) {
    throw new Error(`primary product ${primaryProductId} not found in the synced catalog for ${shopId}`);
  }
  const { pages, policies } = loadStorePagesFixture();
  return buildSnapshot(
    shopId,
    `real-ingestion(products=${products.length})+pages-fixture-v1`,
    products,
    pages,
    policies,
    "",
    new Date().toISOString(),
    STAGE2_SURFACES_ABSENT,
  );
}

// ---- persistence (filesystem JSON — spec 4.3.6) ---------------------------

export const SNAPSHOT_DIR = join(process.cwd(), "experiments", "agentic-stage1", "snapshots");

export function saveSnapshot(snapshot: StoreSnapshot, dir: string = SNAPSHOT_DIR): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${snapshot.id}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  return file;
}

export function loadSnapshot(snapshotId: string, dir: string = SNAPSHOT_DIR): StoreSnapshot {
  const file = join(dir, `${snapshotId}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as StoreSnapshot;
  // Integrity: recompute the hash so a hand-edited snapshot can't silently drift.
  const recomputed = computeContentHash(
    parsed.shopId, parsed.sourceVersion, parsed.products, parsed.pages, parsed.policies,
    parsed.surfacesAbsent, parsed.evidence,
  );
  if (recomputed !== parsed.contentHash) {
    throw new Error(`snapshot ${snapshotId} failed content-hash verification`);
  }
  return parsed;
}
