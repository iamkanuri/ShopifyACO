import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_SHOP_ID } from "./contract.js";
import { PRIMARY_PRODUCT_ID } from "./contract2.js";
import { assertRunnable } from "./preflight.js";

// ===========================================================================
// STAGE 4 REAL-STORE FAULT MECHANISM (spec 4.2 + Rule 4, critical safety):
//   • the `pending-revert` marker — exact restoration content, object ids,
//     timestamps — is persisted BEFORE any live write (test 36 enforces the
//     ordering mechanically via injectable IO);
//   • a standalone `revert-fault` restores the exact marker content;
//   • the session may never end with the store faulted — every failure path
//     calls revert first.
// Ground truth is untouched throughout: the product REMAINS truthfully
// aluminum-free; only the STORE's evidence of it is removed.
// ===========================================================================

export const MARKER_FILE = join(process.cwd(), "experiments", "agentic-stage4", "pending-revert.json");
const REVERT_LOG = join(process.cwd(), "experiments", "agentic-stage4", "revert-log.jsonl");
export const FAULT_TAG = "agentic-stage4-fault";

/** The dev-store product's truthful aluminum-free sentence (Stage 2 seed kit, verbatim). */
export const CEDAR_ALUMINUM_SENTENCE =
  "Our aluminum-free formula uses arrowroot and magnesium hydroxide to keep you fresh through a Tampa summer, with no baking soda to irritate sensitive skin.";

export interface PendingRevertMarker {
  tag: typeof FAULT_TAG;
  createdAt: string;
  shopId: string;
  productGid: string;
  restore: {
    descriptionHtml: string; // verbatim pre-fault HTML
    metafield: { namespace: string; key: string; value: string; type: string };
  };
  faultedDescriptionHtml: string; // what the fault writes (for verification)
  status: "pending";
}

/** IO seam so ordering (test 36) and restoration content (test 37) are testable
 *  without any network. The real IO talks to the dev store via dev-store-client. */
export interface FaultIO {
  writeMarker(marker: PendingRevertMarker): void;
  writeDescription(productGid: string, html: string): Promise<void>;
  setMetafield(productGid: string, mf: { namespace: string; key: string; value: string; type: string }): Promise<void>;
  deleteMetafield(productGid: string, namespace: string, key: string): Promise<void>;
}

export function defaultMarkerWriter(marker: PendingRevertMarker): void {
  mkdirSync(join(MARKER_FILE, ".."), { recursive: true });
  writeFileSync(MARKER_FILE, JSON.stringify(marker, null, 2), "utf8");
}

/** Compute the faulted description: the aluminum sentence removed whole. Throws
 *  if the sentence is not present verbatim (fault would be a no-op — invalid). */
export function computeFaultedHtml(descriptionHtml: string, sentence: string): string {
  if (!descriptionHtml.includes(sentence)) {
    throw new Error("fault invalid: the aluminum-free sentence is not present verbatim in the live description");
  }
  return descriptionHtml.replace(sentence, "").replace(/\s{2,}/g, " ").replace(/<p>\s+/g, "<p>").trim();
}

/** Inject the fault. MARKER IS WRITTEN FIRST — mechanically testable ordering. */
export async function injectFault(
  io: FaultIO,
  live: { descriptionHtml: string; metafield: { namespace: string; key: string; value: string; type: string } | null },
  now: string = new Date().toISOString(),
): Promise<PendingRevertMarker> {
  assertRunnable(process.env, DEV_SHOP_ID);
  if (!live.metafield) throw new Error("fault invalid: custom.aluminum_free metafield not present pre-fault");
  const faultedDescriptionHtml = computeFaultedHtml(live.descriptionHtml, CEDAR_ALUMINUM_SENTENCE);

  const marker: PendingRevertMarker = {
    tag: FAULT_TAG,
    createdAt: now,
    shopId: DEV_SHOP_ID,
    productGid: PRIMARY_PRODUCT_ID,
    restore: { descriptionHtml: live.descriptionHtml, metafield: live.metafield },
    faultedDescriptionHtml,
    status: "pending",
  };
  io.writeMarker(marker); // ← BEFORE any store write (Rule 4; test 36)
  await io.writeDescription(PRIMARY_PRODUCT_ID, faultedDescriptionHtml);
  await io.deleteMetafield(PRIMARY_PRODUCT_ID, live.metafield.namespace, live.metafield.key);
  return marker;
}

/** Standalone revert: restore EXACT content from the marker, then clear it. */
export async function revertFault(io: FaultIO, marker: PendingRevertMarker): Promise<void> {
  await io.writeDescription(marker.productGid, marker.restore.descriptionHtml);
  await io.setMetafield(marker.productGid, marker.restore.metafield);
}

export function readMarker(): PendingRevertMarker | null {
  if (!existsSync(MARKER_FILE)) return null;
  return JSON.parse(readFileSync(MARKER_FILE, "utf8")) as PendingRevertMarker;
}

/** Clear the marker AFTER verified restoration, appending to the audit log. */
export function clearMarker(how: string): void {
  const marker = readMarker();
  if (!marker) return;
  appendFileSync(REVERT_LOG, `${JSON.stringify({ clearedAt: new Date().toISOString(), how, marker })}\n`, "utf8");
  unlinkSync(MARKER_FILE);
}

// ---- final-state assertion (spec test 43 / Gate C criterion 5) -------------

export interface StateCheck {
  ok: boolean;
  problems: string[];
}

/** Does the live product state match the truthful ground-truth baseline? */
export function assertStateMatchesGroundTruth(state: {
  descriptionHtml: string;
  metafield: { key: string; value: string } | null;
}): StateCheck {
  const problems: string[] = [];
  if (!state.descriptionHtml.includes(CEDAR_ALUMINUM_SENTENCE)) {
    problems.push("description is missing the truthful aluminum-free sentence");
  }
  if (!state.metafield || state.metafield.key !== "aluminum_free" || String(state.metafield.value).toLowerCase() !== "true") {
    problems.push("custom.aluminum_free metafield is missing or not 'true'");
  }
  return { ok: problems.length === 0, problems };
}
