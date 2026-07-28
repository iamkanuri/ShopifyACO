// ===========================================================================
// TEST SUPPORT — PURE. No database, no network, no server, no model calls.
//
// Deliberately does NOT import `test/support/adversarial.ts`, even though that
// module has an equivalent `mkProduct`. Two reasons:
//   • a concurrent session owns `test/` and is editing it; coupling this suite to
//     a file someone else is changing makes a green run a coincidence;
//   • the engine's own harness is the acceptance gate for the engine. This suite
//     is the acceptance gate for the STANDARD, and it should fail for standards
//     reasons only.
//
// It does import the REAL `evaluate` and the REAL `lintStrings`. Reimplementing
// either would let the copy drift from the thing being tested, which is the whole
// failure mode these tests exist to catch.
// ===========================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PublicProduct, Requirement } from "../../src/server/productTest.js";
import { buildEvidence } from "../../src/server/testEvidence.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const STANDARDS_DIR = join(HERE, "..");

export function loadJson<T>(relPath: string): T {
  const abs = join(STANDARDS_DIR, relPath);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (e) {
    // A missing artifact must never read as "nothing to check".
    throw new Error(`cannot read ${relPath} — the suite cannot pass without it. ${(e as Error).message}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`${relPath} is not valid JSON: ${(e as Error).message}`);
  }
}

// ---- a minimal PublicProduct -------------------------------------------------

export interface MkOptions {
  description?: string;
  title?: string | null;
  productType?: string | null;
  optionValues?: string[];
  variants?: PublicProduct["variants"];
  minPriceUsd?: number | null;
  ldAvailability?: string | null;
  /** v3.8 — the currency the store declares. Left null by default so no existing
   *  conformance case changes; set it to exercise the non-USD refusal. */
  declaredCurrency?: string | null;
  policyStatus?: PublicProduct["policyStatus"];
  extracted?: PublicProduct["extracted"];
  evidence?: PublicProduct["evidence"];
}

export function mkProduct(o: MkOptions = {}): PublicProduct {
  const description = o.description ?? "";
  return {
    origin: "https://store.example",
    handle: "p",
    title: o.title === undefined ? "Thing" : o.title,
    vendor: "Acme",
    productType: o.productType === undefined ? "Thing" : o.productType,
    tags: [],
    descriptionText: description,
    variants: o.variants ?? [{ title: "Default", priceUsd: 12, available: true, options: ["Default"] }],
    minPriceUsd: o.minPriceUsd === undefined ? 12 : o.minPriceUsd,
    optionNames: [],
    optionValues: o.optionValues ?? [],
    extracted: o.extracted ?? null,
    evidence: o.evidence ?? buildEvidence([{ surface: "product_description", text: description }]),
    ldAvailability: o.ldAvailability ?? null,
    // v3.5 CP2b rule D: null is UNDECIDABLE, and undecidable disqualifies nothing.
    // A conformance fixture that set this would be asserting a storefront key it
    // never read.
    storefrontObjectId: null,
    // v3.8: same rule, same reason. A fixture declares no currency unless a case
    // deliberately gives it one, so the non-USD refusal never fires by accident and
    // every existing conformance expectation is unchanged.
    declaredCurrency: o.declaredCurrency ?? null,
    policyStatus: o.policyStatus ?? "not_fetched",
    fetched: { json: true, page: false, js: false, policy: false },
    diagnostics: {
      attempted: [], answeredBy: "json", throttled: [],
      degraded: false, robots: "ok", throttleSource: null,
    },
  } as PublicProduct;
}

/** An `extracted` page carrying only the identifier fields the row reads. */
export function mkExtracted(over: { gtin?: string | null; mpn?: string | null } = {}): NonNullable<PublicProduct["extracted"]> {
  const { gtin = null, mpn = null } = over;
  return {
    jsonLdTypes: ["Product"],
    hasProductSchema: true,
    product: { name: null, brand: null, sku: null, gtin, mpn, offer: null, rating: null, reviewCount: null },
    title: null, metaDescription: null, canonicalUrl: null, robotsIndex: true,
    headings: { h1: [], h2: [] }, faqs: [],
    signals: {
      jsonLd: true, productSchema: true, offer: true, price: true, availability: true,
      gtin: Boolean(gtin), mpn: Boolean(mpn), sku: false, brand: false,
      rating: false, reviews: false, shipping: false, returns: false,
      faq: false, canonical: true, indexable: true,
    },
  } as NonNullable<PublicProduct["extracted"]>;
}

// ---- probes -----------------------------------------------------------------

/**
 * A product constructed so that `req` SHOULD be satisfied.
 *
 * Kind-aware, because "satisfying evidence" is product copy for a text
 * requirement and a variant list for a structural one. `textExample` is the
 * standard entry's own `accepted_evidence[].example`, which is how this probe
 * stays tied to the published document instead of to a hand-picked string.
 */
export function probeSatisfying(req: Requirement, textExample: string | null): PublicProduct {
  switch (req.kind) {
    case "claim":
    case "attribute":
      return mkProduct({ description: textExample ?? "" });
    case "delivery":
      // `policyStatus: readable` isolates the MATCHER: without it the row returns
      // requires_store_access because we never read the policy, and the probe would
      // measure the fetch state instead of the assertion.
      return mkProduct({ description: textExample ?? "", policyStatus: "readable" });
    case "variant_option":
      return mkProduct({
        optionValues: [req.optionValue!],
        variants: [{ title: req.optionValue!, priceUsd: 18, available: true, options: [req.optionValue!] }],
      });
    case "in_stock":
      return mkProduct({ ldAvailability: "InStock" });
    case "identifiers":
      // A real GTIN-13 with a valid check digit (the corpus uses the same value).
      return mkProduct({ extracted: mkExtracted({ gtin: "4006381333931" }) });
    case "price_under":
      return mkProduct({ minPriceUsd: Math.max(0.5, (req.capUsd ?? 10) - 1) });
    case "no_subscription":
      // Absence-based: an EMPTY product is the satisfying case, by design.
      return mkProduct({ description: "A bag of coffee." });
    case "unsupported":
      // Unreachable by construction — `compileStandard` refuses to emit this kind.
      // Throwing rather than returning a product keeps that guarantee testable: if
      // one ever reaches here, the probe fails loudly instead of silently measuring
      // a row that can only ever answer "unchecked".
      throw new Error("probeSatisfying: 'unsupported' is engine-internal and cannot come from a compiled standard");
  }
}

/**
 * A product with nothing that could satisfy any text requirement — the
 * refutability probe. An assertion that passes here either reads a surface it
 * should not, or cannot fail at all, and an assertion that cannot fail carries
 * zero information.
 */
export function probeEmpty(req: Requirement): PublicProduct {
  const bare = "A product.";
  switch (req.kind) {
    case "in_stock":
      return mkProduct({ description: bare, ldAvailability: "OutOfStock", variants: [] });
    case "identifiers":
      return mkProduct({ description: bare, extracted: mkExtracted({}) });
    case "price_under":
      return mkProduct({ description: bare, minPriceUsd: (req.capUsd ?? 10) + 50 });
    case "variant_option":
      return mkProduct({
        description: bare, optionValues: ["Something Else"],
        variants: [{ title: "Something Else", priceUsd: 18, available: true, options: ["Something Else"] }],
      });
    case "delivery":
      return mkProduct({ description: bare, policyStatus: "readable" });
    case "no_subscription":
      // The ONE kind whose failure needs positive contrary evidence.
      return mkProduct({ description: "A subscription is required to purchase this." });
    default:
      return mkProduct({ description: bare });
  }
}
