import type { Config } from "./types.js";

export interface ExpandedPrompt {
  template: string;
  prompt: string;
}

const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

/** Placeholder names that are auto-filled from top-level config fields. */
function singleValueFills(cfg: Config): Record<string, string> {
  const fills: Record<string, string> = { category: cfg.category };
  if (cfg.buyerPersona) fills.buyerPersona = cfg.buyerPersona;
  if (cfg.location) fills.location = cfg.location;
  if (cfg.priceRange) fills.priceRange = cfg.priceRange;
  return fills;
}

function placeholdersIn(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) found.add(m[1]!);
  return [...found];
}

/**
 * Expand every template into concrete prompts by taking the cartesian product
 * of the value lists for each placeholder it references. Single-value fills
 * (category, buyerPersona, location, priceRange) are treated as 1-element lists.
 * Unknown placeholders are left intact and reported via `warnings`.
 */
export function expandPrompts(cfg: Config): { prompts: ExpandedPrompt[]; warnings: string[] } {
  const singles = singleValueFills(cfg);
  const lists = cfg.placeholderValues ?? {};
  const warnings: string[] = [];
  const prompts: ExpandedPrompt[] = [];
  const unknownReported = new Set<string>();

  for (const template of cfg.promptTemplates) {
    const names = placeholdersIn(template);

    // Build the list of value-sets to cross-product.
    const axes: { name: string; values: string[] }[] = [];
    for (const name of names) {
      if (name in lists) axes.push({ name, values: lists[name]! });
      else if (name in singles) axes.push({ name, values: [singles[name]!] });
      else {
        if (!unknownReported.has(name)) {
          warnings.push(`Template placeholder {${name}} has no value; left literal.`);
          unknownReported.add(name);
        }
        // Leave unknown placeholder as a literal by giving it itself as the value.
        axes.push({ name, values: [`{${name}}`] });
      }
    }

    for (const combo of cartesian(axes)) {
      let prompt = template;
      for (const [name, value] of Object.entries(combo)) {
        prompt = prompt.replaceAll(`{${name}}`, value);
      }
      prompts.push({ template, prompt });
    }
  }

  return { prompts, warnings };
}

function cartesian(axes: { name: string; values: string[] }[]): Record<string, string>[] {
  let acc: Record<string, string>[] = [{}];
  for (const axis of axes) {
    const next: Record<string, string>[] = [];
    for (const partial of acc) {
      for (const value of axis.values) {
        next.push({ ...partial, [axis.name]: value });
      }
    }
    acc = next;
  }
  return acc;
}
