import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { closePg } from "../db/pg.js";
import { ALUMINUM_FREE_MATCHING_TERMS, DEV_SHOP_ID } from "./contract.js";
import {
  ALUMINUM_CONFLICT_PAIR,
  DELIVERY_TIMING_TERMS,
  NO_SUBSCRIPTION_TERMS,
  PRIMARY_PRODUCT_ID,
  REQUIRED_VARIANT_ID,
  RETURNS_CONFLICT_PAIR,
  SECONDARY_PRODUCT_ID,
  VEGAN_TERMS,
  stage2PrimaryContract,
  stage2SecondaryContract,
} from "./contract2.js";
import { stage2GroundTruth, stage2SecondaryGroundTruth } from "./ground-truth.js";
import { assertRunnable } from "./preflight.js";
import { createStage2Snapshot, loadSnapshot, saveSnapshot } from "./snapshot-service.js";
import {
  evidenceMatches,
  injectContradiction,
  insertSentences,
  removeAttributeEvidence,
  removePolicyEvidence,
  restoreEvidence,
  setVariantUnavailable,
  skewStructuredPrice,
} from "./snapshot-mutator.js";
import { matchingTermsIn } from "./util.js";
import type { SnapshotMutation, StoreSnapshot } from "./types.js";

// ===========================================================================
// STAGE 2 CLI (spec S2 §3/4). Dev-only; flag + allowlist gated. Snapshot
// variant labels (BASE, F1..F5, RESTORED-F1, PARA, TRAP) exist ONLY here and
// in the report layer — snapshots carry opaque ids, and nothing label-shaped
// reaches agent context, tools, or the validator/adjudicator (Rule 6).
//
//   prepare2 — build + persist all 9 snapshots, assert every fault invariant
// ===========================================================================

const EXPERIMENT_DIR = join(process.cwd(), "experiments", "agentic-stage2");
const MANIFEST_FILE = join(EXPERIMENT_DIR, "experiment-manifest.json");

export type Stage2Role =
  | "base" | "f1" | "f2" | "f3" | "f4" | "f5" | "restored-f1" | "para" | "trap";

export interface Stage2Manifest {
  experimentId: string;
  shopId: string;
  primaryProductId: string;
  requiredVariantId: string;
  secondaryProductId: string;
  snapshots: Record<Stage2Role, string>;
  mutationIds: Partial<Record<Stage2Role, string>>;
  createdAt: string;
}

/** F2 contradiction sentence — Appendix B, verbatim. */
export const F2_CONTRADICTION_SENTENCE = "Please note: all natural products are final sale.";

/** PARA paraphrases — spec 4.2, verbatim, one sentence each. */
export const PARA_SENTENCES = [
  "Formulated without aluminum salts of any kind.",
  "Contains no aluminum compounds.",
  "Zero aluminum in the formula.",
];

/** TRAP sentence — lexically matches the c1 term list but is a PACKAGING claim. */
export const TRAP_SENTENCE = "Ships in 100% aluminum-free recyclable packaging.";

const c1 = stage2PrimaryContract.hardConstraints.find((c) => c.id === "c1-aluminum-free")!;
const c5 = stage2PrimaryContract.hardConstraints.find((c) => c.id === "c5-delivery-resolvable")!;

function assertStage2Invariants(snap: Record<Stage2Role, StoreSnapshot>): void {
  const fail = (msg: string): never => {
    throw new Error(`EXPERIMENT INVALID: ${msg}`);
  };
  const terms = [...ALUMINUM_FREE_MATCHING_TERMS];
  const primary = (s: StoreSnapshot) => s.products.find((p) => p.productId === PRIMARY_PRODUCT_ID)!;
  const requiredVariant = (s: StoreSnapshot) =>
    primary(s).variants.find((v) => v.variantId === REQUIRED_VARIANT_ID);
  const textOn = (s: StoreSnapshot, surfaces: string[]) =>
    s.evidence.filter((e) => surfaces.includes(e.surface)).map((e) => e.exactText ?? "");

  // Ground truth untouched + frozen.
  if (stage2GroundTruth.facts.aluminum_free !== true) fail("ground truth altered");

  // BASE: every constraint's evidence present; no conflicts; prices agree.
  const base = snap.base;
  if (evidenceMatches(base, c1.acceptableSurfaces, terms, "aluminum_free") < 1) fail("BASE lacks c1 evidence");
  if (!textOn(base, ["product_description", "faq"]).some((t) => matchingTermsIn(t, [...NO_SUBSCRIPTION_TERMS]).length)) fail("BASE lacks c4 evidence");
  if (!textOn(base, ["shipping_policy", "faq"]).some((t) => matchingTermsIn(t, [...DELIVERY_TIMING_TERMS]).length && /\d/.test(t))) fail("BASE lacks c5 timing+digit evidence");
  if (requiredVariant(base)?.available !== true) fail("BASE required variant not available");
  if (requiredVariant(base)?.price !== 14.0) fail("BASE required variant price is not 14.00");
  const baseMf = primary(base).metafields.find((m) => m.key === "price");
  if (baseMf?.value !== "$14.00") fail("BASE custom.price metafield is not $14.00");
  const baseTexts = textOn(base, ["product_description", "faq", "returns_policy"]);
  if (baseTexts.some((t) => matchingTermsIn(t, RETURNS_CONFLICT_PAIR.negative).length)) fail("BASE already contains a returns contradiction");
  if (baseTexts.some((t) => matchingTermsIn(t, ALUMINUM_CONFLICT_PAIR.negative).length)) fail("BASE already contains an aluminum contradiction");
  // Secondary product present with its evidence.
  const b = base.products.find((p) => p.productId === SECONDARY_PRODUCT_ID) ?? fail("BASE lacks secondary product");
  if (!matchingTermsIn(b.description ?? "", [...VEGAN_TERMS]).length) fail("BASE secondary lacks vegan evidence");
  if (stage2SecondaryGroundTruth.facts.vegan !== true) fail("secondary ground truth altered");

  // F1: zero c1 matches on acceptable surfaces.
  if (evidenceMatches(snap.f1, c1.acceptableSurfaces, terms, "aluminum_free") !== 0) fail("F1 still has c1 evidence");

  // F2: BOTH sides of the returns pair present.
  const f2Texts = textOn(snap.f2, ["product_description", "faq", "returns_policy"]);
  if (!f2Texts.some((t) => matchingTermsIn(t, RETURNS_CONFLICT_PAIR.affirmative).length)) fail("F2 lost the affirmative returns statement");
  if (!f2Texts.some((t) => matchingTermsIn(t, RETURNS_CONFLICT_PAIR.negative).length)) fail("F2 lacks the injected contradiction");

  // F3: required variant out of stock, ≥1 sibling in stock.
  if (requiredVariant(snap.f3)?.available !== false) fail("F3 required variant still available");
  if (!primary(snap.f3).variants.some((v) => v.variantId !== REQUIRED_VARIANT_ID && v.available === true)) fail("F3 has no in-stock sibling");

  // F4: metafield price skewed to $24.00, variant price still 14.00.
  const f4Mf = primary(snap.f4).metafields.find((m) => m.key === "price");
  if (f4Mf?.value !== "$24.00") fail("F4 metafield price not skewed to $24.00");
  if (requiredVariant(snap.f4)?.price !== 14.0) fail("F4 variant price changed (must stay 14.00)");

  // F5: zero c5 timing matches in policy/faq.
  if (textOn(snap.f5, [...c5.acceptableSurfaces]).some((t) => matchingTermsIn(t, [...DELIVERY_TIMING_TERMS]).length)) fail("F5 still has timing evidence");

  // RESTORED-F1: c1 evidence back (content equals BASE).
  if (evidenceMatches(snap["restored-f1"], c1.acceptableSurfaces, terms, "aluminum_free") < 1) fail("RESTORED-F1 lacks c1 evidence");
  if (snap["restored-f1"].contentHash !== base.contentHash) fail("RESTORED-F1 is not the exact inverse of F1");

  // PARA: the three EXACT spec paraphrases are present and truth is still true.
  // FIXTURE REALITY (disclosed in AUDIT.md + report): the spec's assertion "no
  // term-list match present" is unsatisfiable with its own verbatim sentences —
  // "without aluminum (salts)" and "(contains) no aluminum" ARE term-list
  // bigrams. The sentences win (spec says "exactly these three"); we assert the
  // measurable version: the metafield/original evidence is gone, sentence 3 is
  // genuinely invisible to the lexical tier, and we record the per-sentence
  // split for the observational report.
  const paraDesc = primary(snap.para).description ?? "";
  if (!PARA_SENTENCES.every((s) => paraDesc.includes(s))) fail("PARA paraphrases missing");
  const paraSentenceMatches = PARA_SENTENCES.map((s) => matchingTermsIn(s, terms).length > 0);
  if (paraSentenceMatches[2]) fail("PARA sentence 3 unexpectedly matches the term list — probe would measure nothing");
  if (primary(snap.para).metafields.some((m) => m.key === "aluminum_free")) fail("PARA still carries the aluminum_free metafield");
  console.log(
    `[prepare2] PARA fixture note: per-sentence lexical match vs c1 term list = ` +
      `${PARA_SENTENCES.map((s, i) => `"${s.slice(0, 30)}…"=${paraSentenceMatches[i]}`).join(", ")}`,
  );

  // TRAP: term list DOES match (the packaging sentence), and no genuine
  // product-level claim exists (the only match is the trap sentence).
  const trapMatches = snap.trap.evidence.filter(
    (e) => c1.acceptableSurfaces.includes(e.surface) && e.exactText && matchingTermsIn(e.exactText, terms).length > 0,
  );
  if (trapMatches.length < 1) fail("TRAP does not lexically match the term list");
  if (!trapMatches.every((e) => e.exactText!.includes("recyclable packaging"))) fail("TRAP contains a genuine product-level claim");
}

export async function prepare2(): Promise<Stage2Manifest> {
  assertRunnable(process.env, DEV_SHOP_ID);

  const base = await createStage2Snapshot(DEV_SHOP_ID, PRIMARY_PRODUCT_ID);

  const f1r = removeAttributeEvidence(base, "aluminum_free", [...ALUMINUM_FREE_MATCHING_TERMS]);
  const f2r = injectContradiction(base, PRIMARY_PRODUCT_ID, F2_CONTRADICTION_SENTENCE);
  const f3r = setVariantUnavailable(base, REQUIRED_VARIANT_ID);
  const f4r = skewStructuredPrice(base, PRIMARY_PRODUCT_ID, "$24.00");
  const f5r = removePolicyEvidence(base, [...DELIVERY_TIMING_TERMS]);
  const restored = restoreEvidence(f1r.snapshot, f1r.mutation);

  // Probes: remove explicit c1 terms, then insert exact sentences.
  const paraBaseline = removeAttributeEvidence(base, "aluminum_free", [...ALUMINUM_FREE_MATCHING_TERMS]);
  const parar = insertSentences(paraBaseline.snapshot, PRIMARY_PRODUCT_ID, PARA_SENTENCES);
  const trapBaseline = removeAttributeEvidence(base, "aluminum_free", [...ALUMINUM_FREE_MATCHING_TERMS]);
  const trapr = insertSentences(trapBaseline.snapshot, PRIMARY_PRODUCT_ID, [TRAP_SENTENCE]);

  const snapshots: Record<Stage2Role, StoreSnapshot> = {
    base,
    f1: f1r.snapshot,
    f2: f2r.snapshot,
    f3: f3r.snapshot,
    f4: f4r.snapshot,
    f5: f5r.snapshot,
    "restored-f1": restored,
    para: parar.snapshot,
    trap: trapr.snapshot,
  };
  assertStage2Invariants(snapshots);

  mkdirSync(join(EXPERIMENT_DIR, "snapshots"), { recursive: true });
  for (const s of Object.values(snapshots)) saveSnapshot(s, join(EXPERIMENT_DIR, "snapshots"));
  const mutations: Array<[Stage2Role, SnapshotMutation]> = [
    ["f1", f1r.mutation], ["f2", f2r.mutation], ["f3", f3r.mutation],
    ["f4", f4r.mutation], ["f5", f5r.mutation], ["para", parar.mutation], ["trap", trapr.mutation],
  ];
  for (const [role, m] of mutations) {
    writeFileSync(join(EXPERIMENT_DIR, "snapshots", `mutation-${m.mutationId}.json`), JSON.stringify({ role, ...m }, null, 2), "utf8");
  }

  const manifest: Stage2Manifest = {
    experimentId: `agentic-stage2-${new Date().toISOString().slice(0, 10)}`,
    shopId: DEV_SHOP_ID,
    primaryProductId: PRIMARY_PRODUCT_ID,
    requiredVariantId: REQUIRED_VARIANT_ID,
    secondaryProductId: SECONDARY_PRODUCT_ID,
    snapshots: Object.fromEntries(
      Object.entries(snapshots).map(([role, s]) => [role, s.id]),
    ) as Record<Stage2Role, string>,
    mutationIds: Object.fromEntries(mutations.map(([role, m]) => [role, m.mutationId])),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  for (const [role, s] of Object.entries(snapshots)) {
    console.log(`[prepare2] ${role.padEnd(11)} ${s.id} (hash ${s.contentHash.slice(0, 12)}…)`);
  }
  console.log("[prepare2] all Stage 2 pre-run invariants hold");
  return manifest;
}

export function readStage2Manifest(): Stage2Manifest {
  return JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as Stage2Manifest;
}

export function loadStage2Snapshot(id: string): StoreSnapshot {
  return loadSnapshot(id, join(EXPERIMENT_DIR, "snapshots"));
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/run-experiment2.ts");
if (isMain) {
  const cmd = process.argv[2] ?? "";
  const main = async () => {
    switch (cmd) {
      case "prepare2":
        await prepare2();
        break;
      default:
        console.error("usage: npx tsx src/agentic-test/run-experiment2.ts <prepare2>");
        process.exitCode = 2;
    }
  };
  main()
    .then(() => closePg())
    .catch(async (err) => {
      console.error(`[run-experiment2] FAILED: ${(err as Error).message}`);
      await closePg();
      process.exit(1);
    });
}
