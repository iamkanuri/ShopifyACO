import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrandConfig, Config } from "./types.js";

/**
 * Load and validate a scan config from a JSON file.
 * Hand-written validation (no schema lib) — keeps deps minimal and errors clear.
 */
export async function loadConfig(path: string): Promise<Config> {
  const abs = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(abs, "utf8"));
  } catch (err) {
    throw new Error(`Could not read/parse config at ${abs}: ${(err as Error).message}`);
  }
  return validateConfig(parsed, abs);
}

function fail(msg: string, where: string): never {
  throw new Error(`Invalid config (${where}): ${msg}`);
}

function asBrand(value: unknown, where: string): BrandConfig {
  if (typeof value !== "object" || value === null) fail("expected an object", where);
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim() === "") fail("missing 'name'", where);
  const brand: BrandConfig = { name: v.name };
  if (v.storeUrl !== undefined) {
    if (typeof v.storeUrl !== "string") fail("'storeUrl' must be a string", where);
    brand.storeUrl = v.storeUrl;
  }
  if (v.aliases !== undefined) {
    if (!isStringArray(v.aliases)) fail("'aliases' must be string[]", where);
    brand.aliases = v.aliases;
  }
  if (v.products !== undefined) {
    if (!isStringArray(v.products)) fail("'products' must be string[]", where);
    brand.products = v.products;
  }
  return brand;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function validateConfig(value: unknown, where: string): Config {
  if (typeof value !== "object" || value === null) fail("root must be an object", where);
  const v = value as Record<string, unknown>;

  const brand = asBrand(v.brand, `${where} > brand`);

  if (typeof v.category !== "string" || v.category.trim() === "") {
    fail("missing 'category'", where);
  }

  if (!Array.isArray(v.competitors) || v.competitors.length === 0) {
    fail("'competitors' must be a non-empty array", where);
  }
  const competitors = v.competitors.map((c, i) => asBrand(c, `${where} > competitors[${i}]`));

  if (!isStringArray(v.promptTemplates) || v.promptTemplates.length === 0) {
    fail("'promptTemplates' must be a non-empty string[]", where);
  }

  let placeholderValues: Record<string, string[]> | undefined;
  if (v.placeholderValues !== undefined) {
    if (typeof v.placeholderValues !== "object" || v.placeholderValues === null) {
      fail("'placeholderValues' must be an object of string[]", where);
    }
    placeholderValues = {};
    for (const [k, val] of Object.entries(v.placeholderValues as Record<string, unknown>)) {
      if (!isStringArray(val)) fail(`'placeholderValues.${k}' must be string[]`, where);
      placeholderValues[k] = val;
    }
  }

  let engines: string[] | undefined;
  if (v.engines !== undefined) {
    if (!isStringArray(v.engines)) fail("'engines' must be string[]", where);
    engines = v.engines;
  }

  let concurrency: number | undefined;
  if (v.concurrency !== undefined) {
    if (typeof v.concurrency !== "number" || v.concurrency < 1) {
      fail("'concurrency' must be a positive number", where);
    }
    concurrency = v.concurrency;
  }

  const cfg: Config = {
    brand,
    category: v.category as string,
    competitors,
    promptTemplates: v.promptTemplates as string[],
  };
  if (typeof v.buyerPersona === "string") cfg.buyerPersona = v.buyerPersona;
  if (typeof v.location === "string") cfg.location = v.location;
  if (typeof v.priceRange === "string") cfg.priceRange = v.priceRange;
  if (placeholderValues) cfg.placeholderValues = placeholderValues;
  if (engines) cfg.engines = engines;
  if (concurrency) cfg.concurrency = concurrency;
  return cfg;
}
