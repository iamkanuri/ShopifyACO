// ===========================================================================
// ISSUE COFFEE STANDARD v1.1 — as a MECHANICAL TRANSFORM of v1.0, not by hand.
//
// WHY A NEW VERSION AND NOT AN EDIT. Two of the four clauses in v1.0's posture went
// false the day it was published, and both fail in the direction that UNDERSTATES the
// work:
//
//   "written to a publishable bar and IS NOT PUBLISHED"  -> false: it is published at
//       stable URLs, in sitemap.xml and in llms.txt.
//   "every failure rate in it is a PREDICTION, not a measurement" -> false for the ten
//       executable entries: measured on 100 real coffee products.
//   "has never been applied to a real store BY ANYONE"   -> false: we applied it.
//       What is STILL true, and the part that matters, is that no SECOND PARTY has.
//   independently_applied: false                          -> still true, and stays false.
//
// A document that is wrong about itself is the failure mode this project treats as
// unrecoverable, and it does not become acceptable because the error is modest about
// itself. The fix is a new version rather than an edit because `standard_hash` is what
// a citation resolves through: editing v1.0 in place would silently invalidate every
// citation made against it. Reissuing also DEMONSTRATES the versioning mechanism this
// product sells, which is worth more than the edit would have been — and it is cheapest
// now, one day after publication, with no external citations outstanding.
//
// WHY A SCRIPT AND NOT AN EDITOR. 42 entries, each with a dozen nested fields. Retyping
// them loses one, mangles another, and nothing catches it — the same class of failure
// as a hand-copied number on a published page. This transform reads v1.0, applies a
// declared delta, and writes v1.1; every entry that is not explicitly changed is carried
// across byte-for-byte, and `verify_v1_1.ts` proves it.
//
// WHY THE MEASUREMENT GOES *INSIDE* THIS DOCUMENT, when v1.0's went in a sidecar.
// The sidecar rule is not "measurements live outside the document" — it is "a
// measurement taken AFTER a version is published must not change that version's bytes,
// because a citation resolves through its hash." v1.0's measurement was taken after
// v1.0 shipped, so it had to be a sidecar. v1.1's is taken BEFORE v1.1 exists, so it
// belongs in the document, where it is covered by the hash and cannot drift from it.
// Same rule, opposite outcome, and stating it that way is the difference between a
// principle and a habit.
//
// Run: npx tsx standards/coffee/issue_v1_1.ts
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import { standardHash, hashMatches } from "../hash.js";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SRC = path.join(here, "v1.0");
const OUT = path.join(here, "v1.1");

const V10_HASH = "334389c4eb6145112deec621e667f11142fb204c66bedd314fc12662d09acec5";

interface Entry { id: string; tier: string; predicted_discrimination: { predicted_fail_rate_band: string; measured: boolean; [k: string]: unknown }; [k: string]: unknown }
interface Doc { grammar_version: string; version: string; status: string; title: string; entries: Entry[]; changelog: unknown[]; standard_hash: { algorithm: string; canonicalisation: string; value: string }; posture: { independently_applied: boolean; statement: string }; [k: string]: unknown }

const raw = fs.readFileSync(path.join(SRC, "standard.json"), "utf8");
const v10 = JSON.parse(raw) as Doc;

// ---- gate: v1.0 must be exactly the text every existing citation resolves to -------
const check = hashMatches(v10);
if (!check.ok || check.computed !== V10_HASH) {
  console.error(`ABORT — v1.0 is not the frozen text.\n  expected ${V10_HASH}\n  computed ${check.computed}`);
  process.exit(2);
}

// ---- the measured record, read from the sidecar it was published in ---------------
// Not retyped. The numbers on the published page, in the sidecar, and in this document
// have to be the same numbers, and the only way to guarantee that is one source.
const fitness = JSON.parse(fs.readFileSync(path.join(SRC, "fitness.json"), "utf8")) as {
  measured_at: string; engine_version: string;
  samples: Array<Record<string, unknown>>;
  entry_discrimination: { n_products: number; bands_held: number; entries: Array<{ id: string; asked: number; fail_pct: number; predicted_band: string; verdict: string; note?: string }> };
};

const BAND_LO = 15, BAND_HI = 85;   // the grammar's own target band
const measuredById = new Map(fitness.entry_discrimination.entries.map((e) => [e.id, e]));

// The four defect classes behind the ten wrong passes, each with the example sentence
// that produced it. `addressed_by_a_guard: false` on the last one is the point of
// publishing the list: no mechanism in the engine addresses a `single-origin` term
// inside a sentence describing a blend, and v3.1's sample did not contain the class at
// all. Saying so is cheaper than being asked.
const DEFECT_CLASSES = [
  {
    klass: "A brewing recipe or a caffeine dose per serving, read as the product's own net weight",
    count: 3,
    example: "15g medium ground coffee 250ml water at 203°F",
    addressed_by_a_guard: false,
  },
  {
    klass: "A store-local Shopify product id or a byte-copy of the SKU, published in `mpn` and accepted as an external identifier",
    count: 3,
    example: "\"sku\":\"100754\",\"mpn\":\"100754\" — the store-local SKU the requirement explicitly excludes, because a SKU cannot match a product to an EXTERNAL catalogue",
    addressed_by_a_guard: false,
  },
  {
    klass: "The soil-science sense of `organic`, read as an organic certification claim",
    count: 2,
    example: "organic soils and abundant rainfall",
    addressed_by_a_guard: false,
  },
  {
    klass: "`single-origin` inside a sentence describing a BLEND — the term is present and the sentence asserts the opposite of the requirement",
    count: 2,
    example: "our Cold Brew Blend features a washed single-origin from Guatemala and a natural from Ethiopia",
    addressed_by_a_guard: false,
  },
];

const coffee = fitness.samples.find((s) => s.name === "coffee")!;
const general = fitness.samples.find((s) => s.name === "general")!;
const pick = (s: Record<string, unknown>, keys: string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (s[k] !== undefined) out[k] = s[k];
  return out;
};
const SAMPLE_KEYS = [
  "name", "label", "description", "stores", "products_evaluated", "pass_rows_audited",
  "confirmed_false_positives", "borderline_counted_as_passes", "point_estimate_pct",
  "bound_95_naive_pct", "bound_95_cluster_icc02_pct", "rows_per_store", "deff_icc02",
  "is_floor", "supersedes", "method", "source",
];

const measured_fitness = {
  measured_at: fitness.measured_at,
  engine_version: fitness.engine_version,
  bands_held: fitness.entry_discrimination.bands_held,
  bands_total: fitness.entry_discrimination.entries.length,
  samples: [
    { ...pick(coffee, SAMPLE_KEYS), defect_classes: DEFECT_CLASSES },
    pick(general, SAMPLE_KEYS),
  ],
};

// ---- the rewritten posture, stating exactly the four clauses ----------------------
const POSTURE = [
  "This version has been applied to real stores by its author and by nobody else.",
  "Coffee Standard v1.0 was executed against 100 real coffee products across 77 storefronts on 2026-07-27, and every one of the 162 requirements it reported as proven was audited individually against the store's full page text; ten of those passes were wrong.",
  "So three things this document used to say about itself are no longer true, and all three were wrong in the direction that understates the work: it IS published, at stable URLs a citation resolves against; its failure rates for the ten executable entries are MEASURED, not predicted; and it HAS been applied to real stores.",
  "What remains true is the part that matters: no second party has applied it without us, `independently_applied` is therefore still false, and this document is a rubric with a versioned changelog and a measured error rate rather than a settled standard.",
  "The status may only become `published` once a second party has run this document without the authoring party's involvement — the same bar as `independently_applied`, and the document's own bar must survive its own promotion.",
].join(" ");

// ---- transform --------------------------------------------------------------------
const idOf = (v10id: string) => v10id.replace("-1.0-", "-1.1-");

const entries = v10.entries.map((e) => {
  const next: Record<string, unknown> = { ...e };
  next.id = idOf(e.id);
  next.supersedes = e.id;

  const m = measuredById.get(e.id);
  if (m) {
    // BOTH are published. The band stays exactly as authored — a document that shows
    // its own hypothesis failing nine times in ten is making the strongest possible
    // case that its numbers are measured, and quietly rewriting the prediction to
    // match the outcome would destroy that.
    next.predicted_discrimination = { ...e.predicted_discrimination, measured: true };
    next.measured_discrimination = {
      fail_rate_pct: m.fail_pct,
      asked: m.asked,
      verdict: m.verdict,
      carries_information: m.fail_pct >= BAND_LO && m.fail_pct <= BAND_HI,
      ...(m.note ? { note: m.note } : {}),
      source: "experiments/v3-2/CATEGORY_BOUND.md — 100 coffee products, 77 storefronts, 2026-07-27",
    };
  }
  // Key order is irrelevant to the hash (canonicalisation sorts keys) but matters to a
  // human reading the artifact, so `supersedes` sits next to `id`.
  const ordered: Record<string, unknown> = {};
  for (const k of ["id", "supersedes", ...Object.keys(next).filter((k) => k !== "id" && k !== "supersedes")]) {
    ordered[k] = next[k];
  }
  return ordered;
});

const tierCount = (t: string) => v10.entries.filter((e) => e.tier === t).length;

const v11: Record<string, unknown> = {
  ...v10,
  grammar_version: "1.1",
  version: "1.1",
  status: "applied_by_author",
  title: v10.title.replace("v1.0", "v1.1"),
  posture: { independently_applied: false, statement: POSTURE },
  measured_fitness,
  withdrawn_entries: [],
  entries,
  changelog: [
    {
      version: "1.1",
      date: "2026-07-27",
      summary:
        `Reissued because v1.0's posture had become false about itself in three ways, all of them understating the work. Same ${v10.entries.length} entries, same questions, same evidence rules, same assertions — every v1.0 entry is carried forward and names its predecessor in \`supersedes\`, and nothing is withdrawn. What is new is honesty about what has happened to the document since: status applied_by_author, a measured fail rate beside every executable entry's predicted band, and the engine's measured false-positive rate while executing this standard, with its method and its four defect classes.`,
      changes: [
        {
          entry_id: idOf("ALS-COFFEE-1.0-WEIGHT-001"),
          // `editorial` and not `strengthened`/`weakened`: the requirement, the
          // assertion, the accepted and insufficient evidence and the conflict rules
          // are byte-identical to v1.0. What was added is an annotation of what
          // happened when the entry was run. The bar did not move.
          change_type: "editorial",
          rationale:
            "Measured 49.0% fail on 100 products against a predicted band of 15-40%. Above its band and yet the single most informative entry in the standard: 49% is almost exactly the even split where an answer carries the most information. It measured 48.8% on 43 brands and 49.0% on 100 — the most stable figure in the document. The band was wrong; the entry is the best one here, and the prediction is kept beside the measurement rather than rewritten to match it.",
        },
        {
          entry_id: idOf("ALS-COFFEE-1.0-DELIV-001"),
          // `editorial` and not `strengthened`/`weakened`: the requirement, the
          // assertion, the accepted and insufficient evidence and the conflict rules
          // are byte-identical to v1.0. What was added is an annotation of what
          // happened when the entry was run. The bar did not move.
          change_type: "editorial",
          rationale:
            "Measured 45.0% fail against a predicted band of 50-80% — below band, and the only other entry that carries real information. Together with WEIGHT-001 these two are the standard's discriminators; the other eight are legitimate requirements that almost every store fails, which makes them useless for telling stores apart and no less valid as requirements.",
        },
        {
          entry_id: idOf("ALS-COFFEE-1.0-CERT-002"),
          // `editorial` and not `strengthened`/`weakened`: the requirement, the
          // assertion, the accepted and insufficient evidence and the conflict rules
          // are byte-identical to v1.0. What was added is an annotation of what
          // happened when the entry was run. The bar did not move.
          change_type: "editorial",
          rationale:
            "Measured 96.0% fail against a predicted band of 40-75%. Named here as the clearest case of the discrimination-versus-conformance split: 96 of 100 coffee pages state no fair-trade scheme claim in machine-readable form, so the row separates nobody from anybody and is retained anyway, because whether the page states it is still the question a buyer needs settled.",
        },
        {
          entry_id: idOf("ALS-COFFEE-1.0-SOURCE-001"),
          // `editorial` and not `strengthened`/`weakened`: the requirement, the
          // assertion, the accepted and insufficient evidence and the conflict rules
          // are byte-identical to v1.0. What was added is an annotation of what
          // happened when the entry was run. The bar did not move.
          change_type: "editorial",
          rationale:
            "Measured 89.0% fail against a predicted band of 40-75%, and it owns the defect class no guard in the engine addresses: `single-origin` occurring inside a sentence that describes a BLEND. The term is present and the sentence asserts the opposite of the requirement. Two of the ten wrong passes are this shape, v1.0's own sample did not contain the class, and it is published here rather than waiting for a fix.",
        },
        {
          entry_id: idOf("ALS-COFFEE-1.0-IDENT-001"),
          // `editorial` and not `strengthened`/`weakened`: the requirement, the
          // assertion, the accepted and insufficient evidence and the conflict rules
          // are byte-identical to v1.0. What was added is an annotation of what
          // happened when the entry was run. The bar did not move.
          change_type: "editorial",
          rationale:
            "Measured 94.7% fail on the 76 products where the page publishes readable Product structured data. Three of the ten wrong passes are this entry accepting a store-local Shopify product id or a byte-copy of the SKU as an `mpn`. The row renders NO QUOTE, so a human reading rendered evidence has nothing to be suspicious of; it took a mechanical check against captured bytes to find them, and the same class corrected a false-positive rate this project had published about itself for weeks.",
        },
      ],
    },
    ...(v10.changelog as unknown[]),
  ],
};

// The hash cannot cover itself; recompute after everything else is final.
delete (v11 as { standard_hash?: unknown }).standard_hash;
const value = standardHash(v11);
(v11 as { standard_hash: unknown }).standard_hash = {
  algorithm: "sha256",
  canonicalisation: "json-sorted-keys-no-hash-field",
  value,
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "standard.json"), `${JSON.stringify(v11, null, 2)}\n`);

// ---- the applicability sidecar, remapped ------------------------------------------
const sidecar = JSON.parse(fs.readFileSync(path.join(SRC, "applicability.json"), "utf8")) as {
  standard_id: string; version: string; rules: Array<{ entry: string; [k: string]: unknown }>; [k: string]: unknown;
};
sidecar.version = "1.1";
sidecar.rules = sidecar.rules.map((r) => ({ ...r, entry: idOf(r.entry) }));
fs.writeFileSync(path.join(OUT, "applicability.json"), `${JSON.stringify(sidecar, null, 2)}\n`);

// ---- the vocabulary files, copied verbatim ----------------------------------------
const vocabSrc = path.join(SRC, "vocabulary");
const vocabOut = path.join(OUT, "vocabulary");
fs.mkdirSync(vocabOut, { recursive: true });
for (const f of fs.readdirSync(vocabSrc)) fs.copyFileSync(path.join(vocabSrc, f), path.join(vocabOut, f));

// ---- report -----------------------------------------------------------------------
console.log(`v1.0 hash (unchanged) : ${V10_HASH}`);
console.log(`v1.1 hash             : ${value}`);
console.log(`grammar               : ${v10.grammar_version} -> 1.1`);
console.log(`status                : ${v10.status} -> applied_by_author`);
console.log(`entries               : ${entries.length} (all carried forward, 0 withdrawn)`);
console.log(`  executable          : ${tierCount("executable")}`);
console.log(`  blocked             : ${tierCount("blocked")}`);
console.log(`  advisory            : ${tierCount("advisory")}`);
console.log(`  not_discriminating  : ${tierCount("not_discriminating")}`);
console.log(`measured entries      : ${entries.filter((e) => e.measured_discrimination).length}`);
console.log(`  carrying information: ${entries.filter((e) => (e.measured_discrimination as { carries_information?: boolean } | undefined)?.carries_information).length}`);
console.log(`bands held            : ${measured_fitness.bands_held}/${measured_fitness.bands_total}`);
console.log(`vocabulary files      : ${fs.readdirSync(vocabOut).length}`);
console.log(`wrote                 : standards/coffee/v1.1/{standard.json,applicability.json,vocabulary/}`);
