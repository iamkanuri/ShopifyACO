import type { Config, PromptEngineResult } from "../types.js";
import type { MerchantAnalysis } from "../analysis/types.js";
import { MODELS, estimateCostUsd } from "../engines/models.js";
import { postJson } from "../engines/http.js";
import type { Artifact, ArtifactBundle } from "./types.js";

// The done-for-you artifact generator (paid-report Phase 2). See ./types.ts for the rules.
// LLM drafting (comparison page + buying guide) is gated on `live` + an apiKey; without it,
// a deterministic structural draft is produced so the pipeline runs at $0 and tests are pure.
// llms.txt + Product JSON-LD are deterministic scaffolds (no fabrication risk, no cost).

const MODEL = MODELS.openai; // gpt-5.4-mini (chat, max_completion_tokens)
const DRAFT_TOKENS = 1100;

export interface GenerateOptions {
  apiKey?: string;
  live?: boolean; // false → deterministic templates only ($0)
}

export async function generateArtifacts(
  analysis: MerchantAnalysis,
  results: PromptEngineResult[],
  cfg: Config,
  opts: GenerateOptions,
): Promise<ArtifactBundle> {
  const brand = analysis.brand;
  const artifacts: Artifact[] = [];
  let costUsd = 0;
  const useLlm = Boolean(opts.live && opts.apiKey);

  // 1. Comparison page — ONLY when a real threat out-recommends the brand (restraint: no
  //    manufactured "vs" when the merchant is winning).
  const cmp = analysis.fixCards.find((c) => c.id === "cmp_threat");
  if (analysis.threat && cmp) {
    const competitor = analysis.threat.competitor;
    const reasons = reasonLabels(analysis, competitor);
    const prompts = cmp.relatedPrompts.slice(0, 5);
    const evidence = cmp.relatedSnippets.slice(0, 4);
    const drafted = useLlm
      ? await draftComparison(brand, competitor, cfg.category, reasons, prompts, evidence, opts.apiKey!)
      : null;
    costUsd += drafted?.cost ?? 0;
    const body = drafted?.body ?? templateComparison(brand, competitor, cfg.category, reasons, prompts, evidence);
    artifacts.push(mkArtifact({
      id: "comparison_page", kind: "comparison_page",
      title: `${brand} vs ${competitor} — comparison page`,
      format: "markdown", filename: `${slug(brand)}-vs-${slug(competitor)}.md`,
      body, drafted: drafted ? "llm" : "template",
      groundedIn: { prompts, competitor },
    }));
  }

  // 2. Buying guide — the top transactional cluster the brand is absent/weak in, answering
  //    the REAL lost prompt (e.g. "best modular sofa under $2000").
  const guideCard = analysis.fixCards.find((c) => c.id.startsWith("cluster_"));
  if (guideCard) {
    const q = guideCard.relatedPrompts[0] ?? guideCard.title;
    const others = (analysis.discoveredBrands ?? []).slice(0, 4).map((b) => b.name);
    const drafted = useLlm ? await draftGuide(brand, cfg.category, q, others, opts.apiKey!) : null;
    costUsd += drafted?.cost ?? 0;
    const body = drafted?.body ?? templateGuide(brand, cfg.category, q, others);
    artifacts.push(mkArtifact({
      id: "buying_guide", kind: "buying_guide",
      title: `Buying guide: "${humanize(q)}"`,
      format: "markdown", filename: `${slug(cfg.category)}-buying-guide.md`,
      body, drafted: drafted ? "llm" : "template",
      groundedIn: { prompts: [q] },
    }));
  }

  // 3. llms.txt + 4. Product JSON-LD — deterministic scaffolds (always).
  artifacts.push(mkArtifact({
    id: "llms_txt", kind: "llms_txt", title: `llms.txt for ${brand}`,
    format: "text", filename: "llms.txt", drafted: "template",
    body: buildLlmsTxt(brand, cfg.category, topLabels(analysis, 4)),
  }));
  artifacts.push(mkArtifact({
    id: "product_schema", kind: "product_schema", title: "Product JSON-LD scaffold (per PDP)",
    format: "json", filename: "product-schema.json", drafted: "template",
    body: buildProductSchema(brand, cfg.category, topLabels(analysis, 4)),
  }));

  return { artifacts, bridge: bridgeCopy(brand), costUsd };
}

// ---- LLM drafting ----------------------------------------------------------

const SYS =
  "You are an expert e-commerce content writer drafting honest, publish-ready pages. " +
  "You NEVER invent facts about the merchant's own products — wherever a store-specific claim is " +
  "needed, insert a [BRACKETED PLACEHOLDER] for the merchant to fill. Statements about competitors " +
  "must reflect ONLY the evidence provided. Output clean Markdown with no preamble or sign-off.";

async function draftComparison(
  brand: string, competitor: string, category: string, reasons: string[], prompts: string[], evidence: string[], apiKey: string,
): Promise<{ body: string; cost: number } | null> {
  const user =
    `Draft a "${brand} vs ${competitor}" comparison page (~350–500 words) for shoppers asking things like:\n` +
    prompts.map((p) => `- ${p}`).join("\n") +
    `\n\nAI assistants currently recommend ${competitor} over ${brand} for these, leaning on: ${reasons.join(", ") || "several factors"}.\n` +
    `Evidence — what assistants actually said about ${competitor} (use only this for ${competitor}'s claims):\n` +
    evidence.map((e) => `- "${e}"`).join("\n") +
    `\n\nStructure: (1) open with the real buyer question; (2) an honest side-by-side covering ${reasons.join(", ") || "the key factors"} — ` +
    `state ${competitor}'s strengths from the evidence, and give ${brand} a fair side using [PLACEHOLDERS] where a ${brand} product fact is needed; ` +
    `(3) a "Where ${brand} wins" section that is ALL [PLACEHOLDERS] for the merchant's real advantages. ` +
    `Be truthful and non-defamatory. No call-to-action or footer.`;
  return llmDraft(user, apiKey);
}

async function draftGuide(
  brand: string, category: string, question: string, others: string[], apiKey: string,
): Promise<{ body: string; cost: number } | null> {
  const user =
    `Draft a buying guide titled to answer this exact shopper question: "${question}" (~300–450 words), for ${category}.\n` +
    `It must INCLUDE ${brand} as a genuine option (honestly, using [PLACEHOLDERS] for any ${brand} product fact you can't verify). ` +
    (others.length ? `Other brands AI assistants recommend here (mention naturally, no invented claims): ${others.join(", ")}.\n` : "") +
    `Structure: a short intro to the buyer's need, then how to choose (the criteria that matter for ${category}), then a shortlist that ` +
    `positions ${brand} fairly among the options. Truthful, helpful, non-promotional. No call-to-action or footer.`;
  return llmDraft(user, apiKey);
}

interface ChatPayload {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function llmDraft(user: string, apiKey: string): Promise<{ body: string; cost: number } | null> {
  try {
    const json = await postJson<ChatPayload>({
      url: "https://api.openai.com/v1/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model: MODEL,
        messages: [{ role: "system", content: SYS }, { role: "user", content: user }],
        max_completion_tokens: DRAFT_TOKENS,
        temperature: 0.5,
      },
    });
    const body = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!body) return null;
    const cost = estimateCostUsd(MODEL, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0);
    return { body, cost };
  } catch {
    return null; // best-effort: fall back to the deterministic template
  }
}

// ---- deterministic templates ($0 fallback + always for llms/schema) --------

function templateComparison(brand: string, competitor: string, category: string, reasons: string[], prompts: string[], evidence: string[]): string {
  const rlist = reasons.length ? reasons : ["quality", "value"];
  return [
    `# ${brand} vs ${competitor}`,
    ``,
    `Shoppers ask AI assistants questions like *"${prompts[0] ?? `best ${category}`}"* — and today they're pointed to ${competitor} over ${brand}. This page answers that head-on.`,
    ``,
    `## How they compare`,
    ...rlist.map((r) => `### ${cap(r)}\n- **${competitor}:** [reflect what buyers hear — e.g. ${evidence[0] ? `"${evidence[0]}"` : `${competitor}'s ${r}`}]\n- **${brand}:** [Your ${r} — fill in the specific, verifiable detail.]`),
    ``,
    `## Where ${brand} wins`,
    `- [Your strongest genuine advantage over ${competitor}.]`,
    `- [A second real advantage — only claim what's true.]`,
    ``,
    `*Draft generated from your AI-visibility scan. Fill every [placeholder] with real, verifiable facts before publishing.*`,
  ].join("\n");
}

function templateGuide(brand: string, category: string, question: string, others: string[]): string {
  return [
    `# ${humanize(question)}`,
    ``,
    `A quick, honest guide to choosing ${category} — including where ${brand} fits.`,
    ``,
    `## What to look for`,
    `- [The 3–4 criteria that matter most for ${category} — fill in from your expertise.]`,
    ``,
    `## Options worth considering`,
    `- **${brand}** — [Your honest pitch for this use case; fill in the specifics.]`,
    ...others.map((o) => `- **${o}** — commonly recommended by AI assistants for this query.`),
    ``,
    `*Draft generated from your AI-visibility scan. Fill every [placeholder] before publishing.*`,
  ].join("\n");
}

function buildLlmsTxt(brand: string, category: string, labels: string[]): string {
  return [
    `# ${brand}`,
    `> [One factual sentence: what ${brand} sells in ${category}.]`,
    ``,
    `${brand} is a ${category} brand. This is a canonical, AI-readable summary for assistants that ground answers about ${brand}.`,
    ``,
    `## Products`,
    `- [List your main product lines, one factual sentence each.]`,
    ``,
    `## What makes ${brand} different`,
    ...(labels.length ? labels.map((l) => `- ${cap(l)}: [state your specific, verifiable detail].`) : [`- [Your key differentiators.]`]),
    ``,
    `## Details assistants look for`,
    `- Price range: [fill in]`,
    `- Materials / ingredients: [fill in]`,
    `- Third-party testing / awards, if any: [fill in]`,
    `- Shipping & returns: [fill in]`,
    ``,
    `## Where to buy`,
    `- [Your store URL]`,
    ``,
    `<!-- Generated by AisleLens from an AI-visibility scan. Replace every [placeholder] with real, verifiable facts before publishing. -->`,
  ].join("\n");
}

function buildProductSchema(brand: string, category: string, labels: string[]): string {
  const obj = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "[Product name]",
    brand: { "@type": "Brand", name: brand },
    category,
    description: `[Product description — include the details assistants quote${labels.length ? `: ${labels.join(", ")}` : ""}].`,
    sku: "[SKU]",
    offers: {
      "@type": "Offer",
      price: "[price]",
      priceCurrency: "[USD]",
      availability: "https://schema.org/InStock",
      url: "[product URL]",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "[average rating, only if real]",
      reviewCount: "[review count, only if real]",
    },
  };
  return JSON.stringify(obj, null, 2);
}

function bridgeCopy(brand: string): string {
  return (
    `These fixes need to be applied to your store — and kept current as AI answers shift week to week. ` +
    `The AisleLens Shopify app does that automatically: it applies the approved changes, re-scans on a schedule, ` +
    `and tells you when your visibility (or a competitor's) moves. This one-time report is your starting line; ` +
    `the app keeps ${brand} in the answer.`
  );
}

// ---- helpers ---------------------------------------------------------------

function reasonLabels(analysis: MerchantAnalysis, competitor: string): string[] {
  const forComp = analysis.proofPoints.filter((p) => p.competitors.includes(competitor));
  const src = forComp.length ? forComp : analysis.proofPoints;
  return src.slice(0, 3).map((p) => p.label.toLowerCase());
}

function topLabels(analysis: MerchantAnalysis, n: number): string[] {
  return analysis.proofPoints.slice(0, n).map((p) => p.label.toLowerCase());
}

function mkArtifact(a: Omit<Artifact, "placeholders">): Artifact {
  return { ...a, placeholders: extractPlaceholders(a.body) };
}

export function extractPlaceholders(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\[([^\]\n]{2,80})\]/g)) out.add(m[1]!.trim());
  return [...out];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function humanize(p: string): string {
  return p.trim().replace(/[?.!]+$/, "").replace(/^(what are the|what'?s the|what is the|which|what)\s+/i, "").trim();
}
