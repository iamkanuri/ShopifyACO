import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { postJson, HttpError } from "../engines/http.js";
import { ENV } from "../server/env.js";
import { MODELS, estimateCostUsd } from "../engines/models.js";
import type { EvidenceSurface, ShoppingConstraint, ShoppingTaskContract } from "./types.js";
import { DEV_SHOP_ID } from "./contract.js";
import { PRIMARY_PRODUCT_ID, SECONDARY_PRODUCT_ID, STAGE2_TERM_FIXTURES } from "./contract2.js";
import { stage2GroundTruth, stage2SecondaryGroundTruth, stage3ConfirmableFacts } from "./ground-truth.js";
import { assertPreregistered } from "./preregistration.js";
import { scanStore } from "./store-diagnostic.js";
import { loadStage3Snapshot, readStage3Manifest } from "./run-experiment3.js";
import { addSpend } from "./trace-recorder.js";
import { loadProbeRecords, type ProbeRecord } from "./probe-battery.js";

// ===========================================================================
// OBSERVATION-TO-TEST COMPILER v1 (Stage 3, spec 4.7). Pipeline per observed
// prompt-group: deterministic extraction → LLM intent extraction (strict JSON)
// → contract drafting in our vocabulary → grounding precheck via the Store
// Diagnostic Scan → auto-confirmation against seeded ground truth (the
// human-confirm stand-in) → rejection rules. A clean rejection with a stated
// reason is CORRECT compiler behavior. Real competitor names live only in the
// gitignored meta file; committed artifacts say "observed competitor A/B/…".
// ===========================================================================

const COMPILED_DIR = join(process.cwd(), "experiments", "agentic-stage3", "compiled");
const COMPETITOR_META = join(process.cwd(), "experiments", "agentic-stage3", "probes", "competitors-meta.json");

// ---- deterministic extraction ----------------------------------------------

const BRAND_STOPWORDS = new Set([
  "the", "a", "an", "best", "top", "natural", "deodorant", "deodorants", "soap", "soaps", "shave", "shaving",
  "aluminum", "aluminium", "free", "under", "for", "with", "without", "and", "or", "if", "it", "its", "their",
  "these", "those", "this", "that", "here", "some", "options", "option", "recommendation", "recommendations",
  "recommended", "recommend", "buy", "online", "us", "usa", "i", "you", "they", "both", "all", "also",
  "sensitive", "skin", "travel", "size", "vegan", "artisan", "handmade", "unscented", "price", "prices", "note",
  "available", "subscription", "shipping", "delivery", "returns", "yes", "no", "not", "sources", "source",
  // contractions (apostrophes normalized before this check)
  "i'd", "i'll", "i've", "i'm", "it's", "that's", "here's", "what's", "there's", "they're", "you're", "you'll",
  "we've", "don't", "doesn't", "won't", "can't", "isn't", "let's",
  // retailers/marketplaces/platforms — venues, not competitor BRANDS
  "amazon", "target", "walmart", "etsy", "ebay", "reddit", "youtube", "google", "sephora", "ulta", "cvs",
  "walgreens", "costco", "whole", "foods", "shopify",
  // discourse/formatting words that lead sentences or bullets
  "however", "overall", "based", "according", "consider", "look", "try", "check", "pros", "cons", "final",
  "verdict", "summary", "pick", "picks", "budget", "bonus", "update", "tip", "tips", "warning", "important",
  "remember", "why", "how", "where", "when", "which", "who", "avoid", "key", "quick", "great", "good", "solid",
]);

/** Capitalized-phrase brand candidates from AI answer text, frequency-ranked.
 *  Deterministic; the "brand list assembled from response text" of spec 4.7.1. */
export function extractBrandCandidates(records: ProbeRecord[]): Array<{ name: string; count: number; channels: string[] }> {
  const counts = new Map<string, { count: number; channels: Set<string> }>();
  for (const r of records) {
    const seenInThisResponse = new Set<string>();
    // Strip URLs and markdown emphasis; find Capitalized [Capitalized]{0,2} runs.
    const text = r.responseText.replace(/https?:\/\/\S+/g, " ").replace(/[*_#>`]/g, " ").replace(/’/g, "'");
    for (const m of text.matchAll(/\b([A-Z][a-zA-Z'&]+(?:\s+(?:[A-Z][a-zA-Z'&]+|&))*)/g)) {
      const phrase = m[1]!.trim();
      const words = phrase.split(/\s+/);
      if (words.length > 3) continue;
      if (words.every((w) => BRAND_STOPWORDS.has(w.toLowerCase()))) continue;
      // Drop leading/trailing stopwords ("Best Native" → "Native").
      while (words.length && BRAND_STOPWORDS.has(words[0]!.toLowerCase())) words.shift();
      while (words.length && BRAND_STOPWORDS.has(words[words.length - 1]!.toLowerCase())) words.pop();
      if (!words.length) continue;
      const name = words.join(" ");
      if (name.length < 3 || seenInThisResponse.has(name)) continue;
      seenInThisResponse.add(name);
      const entry = counts.get(name) ?? { count: 0, channels: new Set<string>() };
      entry.count++;
      entry.channels.add(r.channel);
      counts.set(name, entry);
    }
  }
  return [...counts.entries()]
    .filter(([, v]) => v.count >= 3 && v.channels.size >= 2) // named repeatedly, across channels
    .map(([name, v]) => ({ name, count: v.count, channels: [...v.channels].sort() }))
    .sort((a, b) => b.count - a.count);
}

export interface DeterministicExtraction {
  merchantPresent: boolean;
  /** Anonymized competitor aliases in rank order; real names only in the meta file. */
  competitors: Array<{ alias: string; count: number; channels: string[] }>;
  pricesMentioned: string[];
  citationHosts: Array<{ host: string; count: number; channels: string[] }>;
}

/** GLOBAL alias registry: brands ranked across the WHOLE battery so
 *  "observed competitor A" means the same brand in every committed artifact.
 *  The real-name mapping is written ONCE to the gitignored meta file. */
export function buildGlobalAliasMap(allRecords: ProbeRecord[]): Map<string, string> {
  const brands = extractBrandCandidates(allRecords);
  const mapping = brands.slice(0, 10).map((b, i) => ({ alias: `observed competitor ${String.fromCharCode(65 + i)}`, ...b }));
  mkdirSync(join(COMPETITOR_META, ".."), { recursive: true });
  writeFileSync(
    COMPETITOR_META,
    JSON.stringify({ note: "GITIGNORED — real names never enter committed artifacts (Rule 7)", mapping }, null, 2),
    "utf8",
  );
  return new Map(mapping.map((m) => [m.name, m.alias]));
}

export function extractDeterministic(records: ProbeRecord[], aliasMap: Map<string, string>): DeterministicExtraction {
  const brands = extractBrandCandidates(records).filter((b) => aliasMap.has(b.name));
  const merchantPresent = records.some((r) => /cedar hollow|harbor lane|aislelens/i.test(r.responseText));
  const prices = [...new Set(records.flatMap((r) => [...r.responseText.matchAll(/\$\d+(?:\.\d{2})?/g)].map((m) => m[0])))];
  const hostCounts = new Map<string, { count: number; channels: Set<string> }>();
  for (const r of records) {
    for (const url of r.citations) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, "");
        const e = hostCounts.get(host) ?? { count: 0, channels: new Set<string>() };
        e.count++;
        e.channels.add(r.channel);
        hostCounts.set(host, e);
      } catch {
        /* redirect-style or malformed URL — keep as opaque, skip host stats */
      }
    }
  }
  return {
    merchantPresent,
    competitors: brands.map((b) => ({ alias: aliasMap.get(b.name)!, count: b.count, channels: b.channels })),
    pricesMentioned: prices.slice(0, 20),
    citationHosts: [...hostCounts.entries()]
      .map(([host, v]) => ({ host, count: v.count, channels: [...v.channels].sort() }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  };
}

// ---- LLM intent extraction (spec 4.7.2) ------------------------------------

export interface IntentDraft {
  objective: string;
  targetBrand: string | null; // non-null ⇒ brand-navigational
  hardConstraints: Array<{ attribute: string; operator: string; value?: unknown; phrasing: string }>;
  softPreferences: string[];
  ambiguityFlags: string[];
  impossibleDataConstraints: string[];
}

export interface IntentExtractor {
  model: string;
  extract(promptText: string, category: string): Promise<{ draft: IntentDraft | null; costUsd: number }>;
}

const EXTRACT_SYSTEM = `You convert a shopper's question into a structured shopping-test intent. Reply with ONLY a JSON object (no prose, no fences):
{"objective": "<one sentence>", "targetBrand": <"BrandName" if the shopper has already decided on one specific brand and is just looking for where to buy it, else null>,
 "hardConstraints": [{"attribute": "<one of: aluminum_free | baking_soda_free | fragrance_free | vegan | tallow_free | subscription_required | variant_price | delivery_timing | required_variant_in_stock | returns_policy | other:<name>>", "operator": "must_be_true|must_be_false|less_than|greater_than|must_be_resolvable", "value": <number or boolean if applicable>, "phrasing": "<the shopper's words>"}],
 "softPreferences": ["<nice-to-haves>"], "ambiguityFlags": ["<anything unclear>"],
 "impossibleDataConstraints": ["<requirements no store's own data could ever answer, e.g. popularity among the shopper's friends>"]}
Rules: price caps → variant_price/less_than with the number. "no subscription"/"one-time purchase" → subscription_required/must_be_false. Delivery/shipping-speed asks → delivery_timing/must_be_resolvable. Travel size → required_variant_in_stock/must_be_true. Only constraints the shopper actually stated.`;

export function createOpenAIIntentExtractor(apiKey: string | undefined = ENV.keys.openai): IntentExtractor {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const model = MODELS.openai;
  return {
    model,
    async extract(promptText: string, category: string) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const json = await postJson<{
            choices?: Array<{ message?: { content?: string | null } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          }>({
            url: "https://api.openai.com/v1/chat/completions",
            headers: { authorization: `Bearer ${apiKey}` },
            body: {
              model,
              messages: [
                { role: "system", content: EXTRACT_SYSTEM },
                { role: "user", content: `Category: ${category}\nShopper question: ${promptText}` },
              ],
              response_format: { type: "json_object" },
              max_completion_tokens: 900,
            },
          });
          const text = json.choices?.[0]?.message?.content ?? "";
          const costUsd = estimateCostUsd(model, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0);
          try {
            const parsed = JSON.parse(text) as IntentDraft;
            if (!Array.isArray(parsed.hardConstraints)) throw new Error("bad shape");
            return { draft: parsed, costUsd };
          } catch {
            if (attempt === 3) return { draft: null, costUsd };
          }
        } catch (err) {
          const retryable = err instanceof HttpError ? err.retryable : true;
          if (!retryable || attempt === 3) return { draft: null, costUsd: 0 };
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      return { draft: null, costUsd: 0 };
    },
  };
}

// ---- drafting + grounding + confirmation + rejection ------------------------

const SURFACES_BY_ATTRIBUTE: Record<string, EvidenceSurface[]> = {
  aluminum_free: ["product_description", "product_metafields", "structured_data", "faq"],
  baking_soda_free: ["product_description", "product_metafields", "structured_data", "faq"],
  fragrance_free: ["product_description", "product_metafields", "structured_data", "faq"],
  vegan: ["product_description", "product_metafields", "structured_data", "faq"],
  tallow_free: ["product_description", "product_metafields", "structured_data", "faq"],
  subscription_required: ["product_description", "faq"],
  variant_price: ["product_variants", "structured_data"],
  delivery_timing: ["shipping_policy", "faq"],
  required_variant_in_stock: ["product_variants"],
};

const CONFIRMABLE_FACTS: Record<string, Record<string, unknown>> = {
  deodorant: { ...stage2GroundTruth.facts, ...stage3ConfirmableFacts.facts },
  shave_soap: { ...stage2SecondaryGroundTruth.facts },
};

const TRAVEL_VARIANT_ID = "gid://shopify/ProductVariant/45972061847654"; // Unscented / 1 oz Travel

export interface CompiledCase {
  sourcePromptId: string;
  category: string;
  status: "compiled" | "rejected";
  rejectionReason?: string;
  contract?: ShoppingTaskContract;
  unconfirmed: Array<{ attribute: string; phrasing: string; wouldHaveAskedMerchant: string }>;
  grounding: Array<{ constraintId: string; verdict: "grounded" | "unresolved" | "unresolvable_in_principle" }>;
  deterministic: DeterministicExtraction;
  ambiguityFlags: string[];
  extractionModel: string;
}

/** Deterministic drafting + rejection rules over the extracted intent (spec 4.7.3–5). */
export function draftContract(
  promptId: string,
  category: "deodorant" | "shave_soap",
  draft: IntentDraft,
  deterministic: DeterministicExtraction,
  extractionModel: string,
): CompiledCase {
  const base: Omit<CompiledCase, "status"> = {
    sourcePromptId: promptId,
    category,
    unconfirmed: [],
    grounding: [],
    deterministic,
    ambiguityFlags: draft.ambiguityFlags ?? [],
    extractionModel,
  };

  // Rejection rules (spec 4.7.5) — a clean rejection is correct behavior.
  if (draft.targetBrand) {
    return { ...base, status: "rejected", rejectionReason: `brand-navigational: shopper already chose "${draft.targetBrand}" (anonymized in committed artifacts)` };
  }
  const productId = category === "deodorant" ? PRIMARY_PRODUCT_ID : category === "shave_soap" ? SECONDARY_PRODUCT_ID : null;
  if (!productId) {
    return { ...base, status: "rejected", rejectionReason: "no resolvable product scope in the seeded catalog" };
  }
  const usable = (draft.hardConstraints ?? []).filter((c) => !c.attribute.startsWith("other:"));
  const impossible = (draft.hardConstraints ?? []).filter(
    (c) => c.attribute.startsWith("other:") && (draft.impossibleDataConstraints ?? []).some((i) => c.phrasing.includes(i) || i.includes(c.phrasing)),
  );
  if (usable.length === 0 && (draft.impossibleDataConstraints?.length ?? 0) > 0 && impossible.length >= (draft.hardConstraints?.length ?? 0)) {
    return { ...base, status: "rejected", rejectionReason: "constraints require data a store cannot possess" };
  }
  if (usable.length === 0) {
    return { ...base, status: "rejected", rejectionReason: "purely subjective objective with zero mappable hard constraints" };
  }

  // Auto-confirmation (spec 4.7.4): the human-confirm stand-in.
  const facts = CONFIRMABLE_FACTS[category] ?? {};
  const confirmed: typeof usable = [];
  const unconfirmed: CompiledCase["unconfirmed"] = [];
  for (const c of usable) {
    const factAttr = c.attribute === "required_variant_in_stock" || c.attribute === "variant_price" || c.attribute === "delivery_timing"
      ? c.attribute // structural attributes: confirmable from catalog/policy fixtures
      : c.attribute;
    if (factAttr in facts) confirmed.push(c);
    else {
      unconfirmed.push({
        attribute: c.attribute,
        phrasing: c.phrasing,
        wouldHaveAskedMerchant: `Is "${c.attribute}" true of this product across all variants? (shopper phrased it: "${c.phrasing}")`,
      });
    }
  }
  if (confirmed.length === 0) {
    return { ...base, status: "rejected", rejectionReason: "no confirmable hard constraints (all UNCONFIRMED)", unconfirmed };
  }

  const hardConstraints: ShoppingConstraint[] = confirmed.map((c, i) => {
    const id = safeConstraintId(c.attribute, i);
    if (c.attribute === "variant_price") {
      return { id, attribute: "variant_price", operator: "less_than", expectedValue: Number(c.value ?? 0) || 999, evidenceRequired: true, acceptableSurfaces: SURFACES_BY_ATTRIBUTE.variant_price! };
    }
    if (c.attribute === "delivery_timing") {
      return { id, attribute: "delivery_timing", operator: "must_be_resolvable", evidenceRequired: true, acceptableSurfaces: SURFACES_BY_ATTRIBUTE.delivery_timing! };
    }
    if (c.attribute === "subscription_required") {
      return { id, attribute: "subscription_required", operator: "must_be_false", expectedValue: false, evidenceRequired: true, acceptableSurfaces: SURFACES_BY_ATTRIBUTE.subscription_required! };
    }
    if (c.attribute === "required_variant_in_stock") {
      return { id, attribute: "required_variant_in_stock", operator: "must_be_true", expectedValue: true, evidenceRequired: true, acceptableSurfaces: SURFACES_BY_ATTRIBUTE.required_variant_in_stock! };
    }
    return {
      id,
      attribute: c.attribute,
      operator: "must_be_true",
      expectedValue: true,
      evidenceRequired: true,
      acceptableSurfaces: SURFACES_BY_ATTRIBUTE[c.attribute] ?? ["product_description", "product_metafields", "structured_data", "faq"],
    };
  });

  const wantsTravel = confirmed.some((c) => c.attribute === "required_variant_in_stock");
  const contract: ShoppingTaskContract = {
    id: `stage3-compiled-${promptId}`,
    version: "2",
    objective: "select_purchase_ready_product",
    productScope: {
      shopId: DEV_SHOP_ID,
      productId,
      ...(wantsTravel && category === "deodorant" ? { variantId: TRAVEL_VARIANT_ID } : {}),
    },
    hardConstraints,
    successConditions: { correctProductRequired: true, allHardConstraintsSatisfied: true, evidenceRequiredForEveryFact: true },
    limits: { maxSteps: 14, maxToolCalls: 12, maxOutputTokens: 3500 },
  };
  return { ...base, status: "compiled", contract, unconfirmed };
}

/** Round-trip-safe constraint id (Stage 4 fix for the Stage 3 Gemini finding:
 *  mixed hyphen/underscore ids got mangled in transcription). Lowercase
 *  alphanumerics ONLY — no separators for a model to convert — and ≤32 chars. */
export function safeConstraintId(attribute: string, index: number): string {
  return `x${index + 1}${attribute.toLowerCase().replace(/[^a-z0-9]/g, "")}`.slice(0, 32);
}

/** Schema validity used by test 33 and the compile step. */
export function validateCompiledContract(contract: ShoppingTaskContract): string[] {
  const problems: string[] = [];
  if (!contract.productScope.productId) problems.push("missing product scope");
  if (!contract.hardConstraints.length) problems.push("no hard constraints");
  for (const c of contract.hardConstraints) {
    if (!(c.attribute in STAGE2_TERM_FIXTURES) && !["variant_price", "required_variant_in_stock"].includes(c.attribute)) {
      problems.push(`unknown attribute ${c.attribute} (no deterministic fixture)`);
    }
    if (!c.acceptableSurfaces.length) problems.push(`${c.id}: no acceptable surfaces`);
  }
  return problems;
}

// ---- the full compile pass ---------------------------------------------------

export async function compileBattery(extractor?: IntentExtractor): Promise<CompiledCase[]> {
  assertPreregistered(); // Rule 5 — no probe reads without the manual arm committed
  const records = loadProbeRecords();
  if (!records.length) throw new Error("no probe records — run the battery first");
  const llm = extractor ?? createOpenAIIntentExtractor();

  const m = readStage3Manifest();
  const baseSnapshot = loadStage3Snapshot(m.snapshots.base);

  const aliasMap = buildGlobalAliasMap(records); // global, battery-wide aliases

  const byPrompt = new Map<string, ProbeRecord[]>();
  for (const r of records) {
    const list = byPrompt.get(r.promptId) ?? [];
    list.push(r);
    byPrompt.set(r.promptId, list);
  }

  const cases: CompiledCase[] = [];
  for (const [promptId, group] of [...byPrompt.entries()].sort()) {
    const deterministic = extractDeterministic(group, aliasMap);
    const first = group[0]!;
    const { draft, costUsd } = await llm.extract(first.promptText, first.category);
    if (costUsd > 0) addSpend(costUsd);
    if (!draft) {
      cases.push({
        sourcePromptId: promptId, category: first.category, status: "rejected",
        rejectionReason: "intent extraction failed strict-JSON parsing twice",
        unconfirmed: [], grounding: [], deterministic, ambiguityFlags: [], extractionModel: llm.model,
      });
      continue;
    }
    const compiled = draftContract(promptId, first.category as "deodorant" | "shave_soap", draft, deterministic, llm.model);
    if (compiled.status === "compiled" && compiled.contract) {
      const problems = validateCompiledContract(compiled.contract);
      if (problems.length) {
        cases.push({ ...compiled, status: "rejected", rejectionReason: `schema-invalid: ${problems.join("; ")}`, contract: undefined });
        continue;
      }
      // Grounding precheck (spec 4.7.3) via the Store Diagnostic Scan.
      const scan = scanStore(baseSnapshot, compiled.contract);
      compiled.grounding = scan.perConstraint.map((c) => ({
        constraintId: c.constraintId,
        verdict: c.verdict === "evidenced" ? "grounded" : c.verdict === "conflicted" ? "unresolved" : "unresolved",
      }));
    }
    cases.push(compiled);
  }

  mkdirSync(COMPILED_DIR, { recursive: true });
  writeFileSync(join(COMPILED_DIR, "compiled-contracts.json"), JSON.stringify(cases, null, 2), "utf8");
  const ok = cases.filter((c) => c.status === "compiled");
  console.log(`[compiler] ${ok.length} compiled, ${cases.length - ok.length} rejected (with reasons) → compiled-contracts.json`);
  for (const c of cases) {
    console.log(`  ${c.sourcePromptId} ${c.status}${c.rejectionReason ? ` — ${c.rejectionReason}` : ` — ${c.contract!.hardConstraints.length} constraints, ${c.unconfirmed.length} UNCONFIRMED, competitors: ${c.deterministic.competitors.slice(0, 3).map((x) => x.alias).join(", ") || "none"}`}`);
  }
  return cases;
}

export function loadCompiledCases(): CompiledCase[] {
  assertPreregistered();
  return JSON.parse(readFileSync(join(COMPILED_DIR, "compiled-contracts.json"), "utf8")) as CompiledCase[];
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/compiler.ts");
if (isMain) {
  compileBattery().catch((err) => {
    console.error(`[compiler] FAILED: ${(err as Error).message}`);
    process.exit(1);
  });
}
