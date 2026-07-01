// Non-cookware scan fixtures (fashion, supplement, furniture) built through the REAL
// detection module over realistic AI answer text, so analyzeRun() runs on genuine
// detections — not hand-faked ones. These are the QC gate that replaces the human who
// used to catch cookware-DNA leaks before a paying merchant saw them.
//
// Each fixture is shaped so a specific competitor genuinely out-recommends the brand with
// concrete, quotable reasons (materials, durability, third-party testing, …) — which is
// exactly what the evidence-driven prescription is supposed to surface.

import { detectMentions } from "../../src/detection/index.js";
import { aggregate } from "../../src/aggregate.js";
import type { Config, PromptEngineResult, RunMeta, RunResults } from "../../src/types.js";

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const MODEL: Record<string, string> = { openai: "gpt-5.4-mini", gemini: "gemini-2.5-flash", perplexity: "sonar" };

interface Row {
  prompt: string;
  template: string;
  engine: string;
  text: string;
}

function buildRun(config: Config, rows: Row[]): RunResults {
  const results: PromptEngineResult[] = rows.map((row) => ({
    prompt: row.prompt,
    template: row.template,
    engine: row.engine,
    model: MODEL[row.engine] ?? row.engine,
    groundingMode: "web_grounded",
    text: row.text,
    detections: detectMentions(row.text, config),
    usage: { inputTokens: 120, outputTokens: 220, costUsd: 0.001 },
  }));
  const agg = aggregate(results, config);
  const meta: RunMeta = {
    startedAt: "2026-07-01T00:00:00.000Z",
    finishedAt: "2026-07-01T00:01:00.000Z",
    mode: "live",
    engines: uniq(rows.map((r) => r.engine)),
    promptCount: uniq(rows.map((r) => r.prompt)).length,
    totalCalls: rows.length,
  };
  return { meta, config, results, aggregate: agg };
}

/** Expand one prompt into 3 engine rows with per-engine answer text. */
function fanOut(prompt: string, template: string, texts: [string, string, string]): Row[] {
  return [
    { prompt, template, engine: "openai", text: texts[0] },
    { prompt, template, engine: "gemini", text: texts[1] },
    { prompt, template, engine: "perplexity", text: texts[2] },
  ];
}

// ---- Fashion: Burberry losing to Prada in luxury handbags ------------------
export function fashionRun(): RunResults {
  const config: Config = {
    brand: { name: "Burberry" },
    category: "luxury handbags",
    competitors: [{ name: "Prada" }, { name: "Gucci" }, { name: "Saint Laurent" }],
    promptTemplates: [],
  };
  const rows: Row[] = [
    ...fanOut("What are the best luxury handbags for everyday use?", "everyday", [
      "For everyday luxury, the Prada Galleria is my top recommendation — its Saffiano leather is renowned for durability and craftsmanship, and Prada's heritage gives it timeless appeal. Gucci's GG Marmont is also a great pick for its iconic design. Burberry offers handbags too, though it's rarely the first name for everyday carry.",
      "I'd recommend Prada for everyday luxury handbags; reviewers consistently praise the quality of the leather and the craftsmanship. Saint Laurent is another excellent choice for a sleek, timeless look.",
      "The best everyday luxury handbags include Prada, widely recommended for its durable Saffiano leather and heritage, and Gucci, praised for its design. Burberry is known more for outerwear.",
    ]),
    ...fanOut("Which designer handbag holds up best over years of daily use?", "use_case", [
      "Prada is frequently recommended as the most durable — the Saffiano leather is scratch-resistant and built to last. Saint Laurent also holds up well over years.",
      "For longevity, I'd pick Prada; its craftsmanship and materials mean the bag lasts for years. Gucci is a solid runner-up.",
      "Prada tops most durability lists thanks to its hard-wearing leather. Burberry bags are elegant but appear less often in longevity comparisons.",
    ]),
    ...fanOut("Best luxury handbags under $2000?", "budget", [
      "Under $2000, Gucci and Prada are the top recommendations — both offer iconic design and strong resale value. Saint Laurent has options in this range too.",
      "In this budget, I'd recommend Prada for its craftsmanship and Gucci for its recognizable design.",
      "Prada and Gucci are the best value luxury handbags under $2000 in most buying guides.",
    ]),
    ...fanOut("What are good alternatives to Louis Vuitton handbags?", "alternatives", [
      "Great alternatives to Louis Vuitton include Prada, recommended for its understated heritage and craftsmanship, and Gucci for a bolder look.",
      "As alternatives to Louis Vuitton, I'd recommend Prada and Saint Laurent — both are acclaimed and offer timeless designs.",
      "Alternatives to Louis Vuitton often cited: Prada, Gucci, Saint Laurent. Burberry is occasionally mentioned for its heritage check pattern.",
    ]),
    ...fanOut("Which luxury brand is best for a timeless everyday tote?", "everyday", [
      "For a timeless everyday tote, Prada is my top pick — elegant design and durable leather. Burberry makes totes too but is rarely singled out here.",
      "I'd recommend Prada or Saint Laurent for a timeless everyday tote.",
      "Prada leads recommendations for timeless everyday totes, praised for its craftsmanship.",
    ]),
  ];
  return buildRun(config, rows);
}

// ---- Supplement: Ritual losing to Athletic Greens in multivitamins ---------
export function supplementRun(): RunResults {
  const config: Config = {
    brand: { name: "Ritual" },
    category: "multivitamins",
    competitors: [{ name: "Athletic Greens", aliases: ["AG1"] }, { name: "Seed" }, { name: "Olly" }],
    promptTemplates: [],
  };
  const rows: Row[] = [
    ...fanOut("What's the best daily multivitamin?", "buyer_intent", [
      "Athletic Greens (AG1) is widely recommended — it's third-party tested and NSF certified, with a clinically dosed formula. Seed is also recommended for its clinically studied strains. Ritual is a clean option but appears less often as the top pick.",
      "I'd recommend Athletic Greens for a daily multivitamin; it's praised for its comprehensive, clinically dosed formula and third-party testing. Seed is another strong choice.",
      "The best daily multivitamins are led by Athletic Greens, recommended for its tested, potent formula. Ritual is known for a clean label but is rarely the top recommendation.",
    ]),
    ...fanOut("Which multivitamin has the best quality ingredients?", "use_case", [
      "Ritual is known for traceable ingredients, but Athletic Greens is more often recommended for its comprehensive, clinically dosed formula. Seed is praised for its clean-label ingredients.",
      "For ingredient quality, I'd recommend Athletic Greens — reviewers highlight its potency and third-party testing.",
      "Athletic Greens tops ingredient-quality lists for its clinically dosed formula. Ritual is a solid clean-label alternative.",
    ]),
    ...fanOut("Best value multivitamin subscription?", "budget", [
      "Olly and Ritual offer affordable options, but Athletic Greens is frequently recommended despite the price for its potency and third-party testing.",
      "On value, I'd recommend Athletic Greens for the tested formula, with Olly as a budget-friendly runner-up.",
      "Athletic Greens is the most recommended subscription multivitamin for its clinically dosed formula; Olly is the better value.",
    ]),
    ...fanOut("Alternatives to Athletic Greens?", "alternatives", [
      "Alternatives to Athletic Greens include Seed, recommended for its clinically studied probiotics, and Ritual for its ingredient transparency.",
      "As alternatives to Athletic Greens, I'd recommend Seed for its clinically studied strains and clean label.",
      "Alternatives to Athletic Greens often cited: Seed and Ritual. Seed is praised for third-party testing.",
    ]),
    ...fanOut("Best multivitamin for everyday health?", "everyday", [
      "For everyday health, Athletic Greens and Seed are the top recommendations, both third-party tested. Ritual is a solid clean-label choice.",
      "I'd recommend Athletic Greens for everyday health thanks to its clinically dosed formula.",
      "Athletic Greens leads everyday-health recommendations for its tested, potent formula.",
    ]),
  ];
  return buildRun(config, rows);
}

// ---- Furniture: Burrow losing to Floyd in modular sofas --------------------
export function furnitureRun(): RunResults {
  const config: Config = {
    brand: { name: "Burrow" },
    category: "modular sofas",
    competitors: [{ name: "Floyd" }, { name: "West Elm" }, { name: "Maiden Home" }],
    promptTemplates: [],
  };
  const rows: Row[] = [
    ...fanOut("What's the best modular sofa?", "buyer_intent", [
      "Floyd is often recommended for its sturdy hardwood frame and modularity, and it's built to last. West Elm is praised for its wide range of styles and fabrics. Burrow makes modular sofas too but is less frequently the top pick.",
      "I'd recommend Floyd for a modular sofa; reviewers highlight the solid wood frame and durable construction. West Elm offers a wide selection of styles.",
      "The best modular sofas include Floyd, recommended for its hardwood frame and durability, and West Elm for its range of options. Burrow is comparable but appears less often.",
    ]),
    ...fanOut("Which sofa holds up best with kids and pets?", "use_case", [
      "For durability, Maiden Home is recommended for its kiln-dried hardwood frame and hard-wearing upholstery. Floyd also holds up well and is built to last.",
      "I'd recommend Floyd for homes with kids and pets — its sturdy frame and durable fabric last for years.",
      "Floyd and Maiden Home top durability lists for their solid wood frames. Burrow is well-reviewed but cited less often here.",
    ]),
    ...fanOut("Best affordable modular sofa under $2000?", "budget", [
      "Under $2000, West Elm and Floyd are recommended for the best value; both offer durable frames. Burrow is comparable but appears less often.",
      "On value, I'd recommend Floyd for the price-to-durability ratio, with West Elm as a stylish runner-up.",
      "Floyd is the most recommended affordable modular sofa for its sturdy build; West Elm offers the widest selection.",
    ]),
    ...fanOut("Alternatives to West Elm sofas?", "alternatives", [
      "Alternatives to West Elm include Floyd, recommended for its solid wood construction and lifetime warranty, and Maiden Home for craftsmanship.",
      "As alternatives to West Elm, I'd recommend Floyd for durability and Maiden Home for its hand-finished construction.",
      "Alternatives to West Elm often cited: Floyd and Maiden Home. Floyd is praised for its warranty and sturdy frame.",
    ]),
    ...fanOut("Best sofa for everyday lounging?", "everyday", [
      "For everyday lounging, Floyd and West Elm are the top recommendations, praised for comfort and durable materials. Burrow makes comfortable sofas but is rarely the first pick.",
      "I'd recommend Floyd for everyday lounging — durable, comfortable, and built to last.",
      "Floyd leads everyday-lounging recommendations for its comfort and sturdy hardwood frame.",
    ]),
  ];
  return buildRun(config, rows);
}

export const NON_COOKWARE_FIXTURES = [
  { name: "fashion", run: fashionRun, brand: "Burberry", expectedThreat: "Prada" },
  { name: "supplement", run: supplementRun, brand: "Ritual", expectedThreat: "Athletic Greens" },
  { name: "furniture", run: furnitureRun, brand: "Burrow", expectedThreat: "Floyd" },
];

/** Words that must NEVER appear in a non-cookware report/artifact (the QC gate). */
export const COOKWARE_VOCAB = /\b(coating|pfas|ptfe|pfoa|teflon|ceramic|oven[- ]?safe|induction|dishwasher|non[- ]?stick|nonstick|saucepan|cookware|skillet)\b/i;
