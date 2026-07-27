// ===========================================================================
// THE CATEGORY CONTEXT — the only place category knowledge is allowed to live.
//
// The generator is category-agnostic and a test enforces that by scanning
// `templates.ts` and `generate.ts` for category vocabulary. Everything a coffee
// attack sentence needs that a tyre attack sentence would need differently is
// here, in data.
//
// `adjacentDomains` is the field that matters most, and it is the field the
// generator cannot fill. See `README.md` §4.
//
// Pure: no network, no filesystem at module scope, no clock.
// ===========================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CategoryContext } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The neutral default.
 *
 * Deliberately bland, and deliberately usable: a category with no context file
 * still gets seven of the eight classes in full, which is the point of
 * mechanising them. The one class it degrades is `adjacent_vocabulary`, and the
 * coverage report says so per term rather than passing quietly.
 *
 * `competitor` is a fictional name on purpose. Generated copy asserts things
 * about a named company — "X uses methylene chloride for their decaf" — and
 * manufacturing that about a real business, in a file that is committed to a
 * repository, is not a thing a generator should do by default.
 */
export const DEFAULT_CONTEXT: CategoryContext = {
  id: "generic",
  productNoun: "product",
  productPlural: "products",
  unitNoun: "batch",
  siblingDescriptor: "other",
  competitor: "Northbank",
  bundleNoun: "gift set",
  packagingNoun: "carton",
  facilityNoun: "warehouse",
  specLabels: ["Specification", "Method"],
  adjacentDomains: [],
};

const REQUIRED_STRING_FIELDS: Array<keyof CategoryContext> = [
  "id", "productNoun", "productPlural", "unitNoun", "siblingDescriptor",
  "competitor", "bundleNoun", "packagingNoun", "facilityNoun",
];

/**
 * Parse a context, filling anything absent from the default.
 *
 * Returns the problems rather than throwing, so a caller can report a bad
 * context file as a named failure instead of as an empty result.
 */
export function parseContext(raw: unknown): { context: CategoryContext; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { context: DEFAULT_CONTEXT, problems: ["context is not an object — falling back to the generic default"] };
  }
  const o = raw as Record<string, unknown>;
  const ctx: CategoryContext = { ...DEFAULT_CONTEXT };

  for (const f of REQUIRED_STRING_FIELDS) {
    const val = o[f];
    if (typeof val === "string" && val.trim()) (ctx as unknown as Record<string, unknown>)[f] = val.trim();
    else if (val !== undefined) problems.push(`${f}: not a non-empty string, using the default ${JSON.stringify(DEFAULT_CONTEXT[f])}`);
  }

  if (Array.isArray(o.specLabels) && o.specLabels.every((s) => typeof s === "string")) {
    ctx.specLabels = (o.specLabels as string[]).filter((s) => s.trim());
  } else if (o.specLabels !== undefined) {
    problems.push("specLabels: not an array of strings, using the default");
  }

  ctx.adjacentDomains = [];
  if (Array.isArray(o.adjacentDomains)) {
    (o.adjacentDomains as unknown[]).forEach((d, i) => {
      const dd = d as Record<string, unknown>;
      const ok =
        dd && typeof dd === "object" &&
        typeof dd.domain === "string" &&
        Array.isArray(dd.collidesWith) && dd.collidesWith.every((s) => typeof s === "string") &&
        Array.isArray(dd.sentences) && dd.sentences.every((s) => typeof s === "string") &&
        typeof dd.why === "string";
      if (!ok) { problems.push(`adjacentDomains[${i}]: malformed, dropped — class 2 coverage is REDUCED, not merely different`); return; }
      ctx.adjacentDomains.push({
        domain: dd.domain as string,
        collidesWith: dd.collidesWith as string[],
        sentences: dd.sentences as string[],
        why: dd.why as string,
      });
    });
  } else if (o.adjacentDomains !== undefined) {
    problems.push("adjacentDomains: not an array — the non-mechanisable half of class 2 is empty for every term");
  }

  return { context: ctx, problems };
}

/** Load `contexts/{id}.json`. A missing file must never read as "no context
 *  needed", so it is reported rather than swallowed. */
export function loadContext(id: string): { context: CategoryContext; problems: string[] } {
  const path = join(HERE, "contexts", `${id}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return { context: DEFAULT_CONTEXT, problems: [`cannot read ${path}: ${(e as Error).message} — running on the generic default, so class 2 has no domain collisions`] };
  }
  try {
    return parseContext(JSON.parse(raw));
  } catch (e) {
    return { context: DEFAULT_CONTEXT, problems: [`${path} is not valid JSON: ${(e as Error).message}`] };
  }
}
