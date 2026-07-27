// ===========================================================================
// A JSON SCHEMA VALIDATOR FOR THE SUBSET THIS GRAMMAR USES.
//
// WHY HAND-ROLLED. The repo's rule is minimal dependencies and raw primitives
// (CLAUDE.md, "Architecture & conventions"), and this session may not modify
// `package.json` at all — so adding `ajv` is not an option even if it were
// desirable. The subset actually used by schema.json is small and closed.
//
// ⚠️ THE HAZARD THIS FILE IS, AND HOW IT IS CONTAINED. A hand-written validator
// that silently accepts everything is exactly the instrument-fails-in-the-
// flattering-direction failure that `src/measure/completion.ts` exists to
// prevent: "0 validation errors" and "the validator did nothing" render
// identically. Two containments, both in `standards/__tests__`:
//
//   1. MUTATION FIXTURES. `standards/__tests__/fixtures.ts` holds one minimal
//      VALID standard plus one mutation per keyword schema.json actually uses.
//      Each mutation MUST produce an error with the expected keyword at the
//      expected path. A keyword whose mutation still validates is a keyword this
//      validator does not really implement. This is the same discipline as the
//      engine's own `experiments/v2-4/mutate.mjs`: a guard whose removal breaks
//      nothing is not a guard.
//   2. AN UNSUPPORTED-KEYWORD TRIPWIRE. `unsupportedKeywords()` walks the schema
//      and reports any keyword this validator does not implement. The test suite
//      asserts that list is EMPTY, so extending schema.json with a keyword the
//      validator ignores fails the build instead of silently weakening it.
//
// Pure: no network, no filesystem, no clock.
// ===========================================================================

export interface ValidationError {
  /** JSON-pointer-ish path into the instance, e.g. `entries/3/insufficient_evidence`. */
  path: string;
  /** The schema keyword that rejected it. */
  keyword: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** How many subschemas were actually evaluated. Zero means the validator did
   *  nothing, which must never read the same as "valid". */
  checksRun: number;
}

type Json = unknown;
interface Schema { [k: string]: Json }

/** Every keyword this validator implements. Anything else in schema.json is a
 *  silent no-op and the tripwire test fails the build for it. */
export const SUPPORTED_KEYWORDS = new Set([
  // structural / annotation only — no validation behaviour, safe to ignore
  "$schema", "$id", "title", "description", "$defs", "examples", "default",
  // implemented
  "$ref", "type", "required", "properties", "additionalProperties", "enum", "const",
  "items", "minItems", "maxItems", "minLength", "maxLength", "pattern",
  "minimum", "maximum", "uniqueItems",
  "anyOf", "allOf", "oneOf", "not", "if", "then", "else",
]);

/** Keywords present in the schema that this validator does not implement. */
export function unsupportedKeywords(schema: Json): string[] {
  const found = new Set<string>();
  const walk = (node: Json): void => {
    if (Array.isArray(node)) return void node.forEach(walk);
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Schema)) {
      if (!SUPPORTED_KEYWORDS.has(k)) found.add(k);
      // `properties` and `$defs` keys are NAMES, not keywords — descend into the
      // values only. Without this, a property legitimately called "format" would
      // be reported as an unimplemented keyword.
      if (k === "properties" || k === "$defs") {
        for (const sub of Object.values(v as Schema)) walk(sub);
      } else {
        walk(v);
      }
    }
  };
  walk(schema);
  return [...found].sort();
}

const typeOf = (v: Json): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v;

const typeMatches = (v: Json, t: string): boolean =>
  t === "integer" ? typeof v === "number" && Number.isInteger(v)
  : t === "number" ? typeof v === "number"
  : typeOf(v) === t;

const deepEqual = (a: Json, b: Json): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== "object") return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Schema)[k], (b as Schema)[k]));
};

export function validate(instance: Json, schema: Json): ValidationResult {
  const errors: ValidationError[] = [];
  let checksRun = 0;
  const root = schema;

  const resolve = (ref: string): Json => {
    if (!ref.startsWith("#/")) throw new Error(`only local $ref is supported, got ${ref}`);
    let node: Json = root;
    for (const seg of ref.slice(2).split("/")) {
      node = (node as Schema)?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (node === undefined) throw new Error(`unresolvable $ref ${ref}`);
    }
    return node;
  };

  /** Validate without recording errors — for anyOf/if branches. */
  const probe = (v: Json, s: Json): boolean => {
    const before = errors.length;
    check(v, s, "__probe__");
    const clean = errors.length === before;
    errors.length = before;
    return clean;
  };

  function check(v: Json, s: Json, path: string): void {
    if (s === true || s === undefined) return;
    if (s === false) {
      errors.push({ path, keyword: "false", message: "schema is `false` — nothing is valid here" });
      return;
    }
    if (typeof s !== "object" || s === null) return;
    const sch = s as Schema;
    checksRun++;

    if (typeof sch.$ref === "string") { check(v, resolve(sch.$ref), path); return; }

    // ---- type ----
    if (sch.type !== undefined) {
      const types = Array.isArray(sch.type) ? (sch.type as string[]) : [sch.type as string];
      if (!types.some((t) => typeMatches(v, t))) {
        errors.push({ path, keyword: "type", message: `expected ${types.join("|")}, got ${typeOf(v)}` });
        return; // every later keyword assumes the type held
      }
    }

    // ---- const / enum ----
    if ("const" in sch && !deepEqual(v, sch.const)) {
      errors.push({ path, keyword: "const", message: `must equal ${JSON.stringify(sch.const)}, got ${JSON.stringify(v)}` });
    }
    if (Array.isArray(sch.enum) && !sch.enum.some((e) => deepEqual(v, e))) {
      errors.push({ path, keyword: "enum", message: `${JSON.stringify(v)} is not one of ${JSON.stringify(sch.enum)}` });
    }

    // ---- strings ----
    if (typeof v === "string") {
      if (typeof sch.minLength === "number" && v.length < sch.minLength) {
        errors.push({ path, keyword: "minLength", message: `length ${v.length} < ${sch.minLength}` });
      }
      if (typeof sch.maxLength === "number" && v.length > sch.maxLength) {
        errors.push({ path, keyword: "maxLength", message: `length ${v.length} > ${sch.maxLength}` });
      }
      if (typeof sch.pattern === "string" && !new RegExp(sch.pattern).test(v)) {
        errors.push({ path, keyword: "pattern", message: `${JSON.stringify(v)} does not match /${sch.pattern}/` });
      }
    }

    // ---- numbers ----
    if (typeof v === "number") {
      if (typeof sch.minimum === "number" && v < sch.minimum) {
        errors.push({ path, keyword: "minimum", message: `${v} < ${sch.minimum}` });
      }
      if (typeof sch.maximum === "number" && v > sch.maximum) {
        errors.push({ path, keyword: "maximum", message: `${v} > ${sch.maximum}` });
      }
    }

    // ---- arrays ----
    if (Array.isArray(v)) {
      if (typeof sch.minItems === "number" && v.length < sch.minItems) {
        errors.push({ path, keyword: "minItems", message: `${v.length} items < ${sch.minItems}` });
      }
      if (typeof sch.maxItems === "number" && v.length > sch.maxItems) {
        errors.push({ path, keyword: "maxItems", message: `${v.length} items > ${sch.maxItems}` });
      }
      if (sch.uniqueItems === true) {
        for (let i = 0; i < v.length; i++) {
          for (let j = i + 1; j < v.length; j++) {
            if (deepEqual(v[i], v[j])) {
              errors.push({ path, keyword: "uniqueItems", message: `items ${i} and ${j} are equal` });
            }
          }
        }
      }
      if (sch.items !== undefined) {
        v.forEach((item, i) => check(item, sch.items, `${path}/${i}`));
      }
    }

    // ---- objects ----
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Schema;
      if (Array.isArray(sch.required)) {
        for (const key of sch.required as string[]) {
          if (!(key in obj)) {
            errors.push({ path, keyword: "required", message: `missing required property \`${key}\`` });
          }
        }
      }
      const props = (sch.properties ?? {}) as Schema;
      for (const [key, sub] of Object.entries(props)) {
        if (key in obj) check(obj[key], sub, path ? `${path}/${key}` : key);
      }
      if (sch.additionalProperties === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in props)) {
            errors.push({ path, keyword: "additionalProperties", message: `unknown property \`${key}\`` });
          }
        }
      } else if (sch.additionalProperties && typeof sch.additionalProperties === "object") {
        for (const key of Object.keys(obj)) {
          if (!(key in props)) check(obj[key], sch.additionalProperties, `${path}/${key}`);
        }
      }
    }

    // ---- combinators ----
    if (Array.isArray(sch.allOf)) {
      for (const sub of sch.allOf as Json[]) check(v, sub, path);
    }
    if (Array.isArray(sch.anyOf)) {
      if (!(sch.anyOf as Json[]).some((sub) => probe(v, sub))) {
        errors.push({ path, keyword: "anyOf", message: `matched none of the ${(sch.anyOf as Json[]).length} alternatives` });
      }
    }
    if (Array.isArray(sch.oneOf)) {
      const n = (sch.oneOf as Json[]).filter((sub) => probe(v, sub)).length;
      if (n !== 1) errors.push({ path, keyword: "oneOf", message: `matched ${n} alternatives, expected exactly 1` });
    }
    if (sch.not !== undefined && probe(v, sch.not)) {
      errors.push({ path, keyword: "not", message: "matched a schema it must not match" });
    }
    if (sch.if !== undefined) {
      const branch = probe(v, sch.if) ? sch.then : sch.else;
      if (branch !== undefined) check(v, branch, path);
    }
  }

  try {
    check(instance, root, "");
  } catch (e) {
    errors.push({ path: "", keyword: "$ref", message: (e as Error).message });
  }

  // A validator that ran nothing has not validated anything. Say so rather than
  // returning `ok: true` with an empty error list.
  if (checksRun === 0) {
    return { ok: false, errors: [{ path: "", keyword: "__internal__", message: "validator ran zero checks — this is not a pass" }], checksRun };
  }
  return { ok: errors.length === 0, errors, checksRun };
}

/** One-line render, deliberately never printing a bare "0 errors". */
export function renderResult(r: ValidationResult): string {
  return r.ok
    ? `VALID — ${r.checksRun} subschema checks run, 0 errors`
    : `INVALID — ${r.errors.length} error(s) over ${r.checksRun} checks:\n` +
      r.errors.map((e) => `  ${e.path || "<root>"} [${e.keyword}] ${e.message}`).join("\n");
}
