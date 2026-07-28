// v3.9 CP-4 — the NATURAL-FREQUENCY read over the captured corpus.
//
// The question is narrow and must stay narrow: how often does a real store put a value in
// `variants[].price` that the CURRENT `priceToUsd` turns into a stated number it should
// have refused? That is the exact field the engine reads (`productTest.ts:1356`), on the
// exact two tiers it reads it from. Counting `price` anywhere in the bytes would inflate
// the number with fields no code path touches — the v3.5 scope error, which this repo
// has now made twice.
import fs from "node:fs";
import path from "node:path";

const DIRS = [
  ["general", "experiments/v2-9/snaps"],
  ["coffee-v3.0", "experiments/v3-0/snaps_coffee"],
  ["coffee-v3.1", "experiments/v3-1/snaps_coffee"],
  ["coffee-v3.2", "experiments/v3-2/snaps_coffee"],
];

// The parser under test, transcribed to match productTest.ts:907-919 exactly.
const CLEAN_DECIMAL = /^\d+(\.\d+)?$/;
function currentJsonTier(p) {
  if (typeof p === "number") return Number.isFinite(p) ? p : null;
  if (typeof p === "string") { const n = Number(p.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
}
function currentJsTier(p) {
  if (typeof p !== "number" || !Number.isFinite(p) || !Number.isInteger(p) || p < 0) return null;
  return p / 100;
}

const out = {
  dirs: [], filesScanned: 0, productBodies: 0, variantPriceFields: 0,
  offenders: [], byShape: {}, byHost: {},
};

const isProductEndpoint = (u) => /\/products\/[^/?#]+\.(json|js)(\?|$)/i.test(u);
const tierOf = (u) => (/\.js(\?|$)/i.test(u) ? "js" : "json");

for (const [label, dir] of DIRS) {
  if (!fs.existsSync(dir)) { out.dirs.push({ label, dir, present: false }); continue; }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  out.dirs.push({ label, dir, present: true, files: files.length });
  for (const f of files) {
    out.filesScanned++;
    let snap;
    try { snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    const host = snap.host ?? f.replace(/\.json$/, "");
    for (const [url, resp] of Object.entries(snap.responses ?? {})) {
      if (!isProductEndpoint(url)) continue;
      if (!resp || typeof resp.body !== "string") continue;
      let body;
      try { body = JSON.parse(resp.body); } catch { continue; }
      if (!body || typeof body !== "object") continue; // a body of literal `null` parses fine
      const prod = body.product ?? body;
      const variants = Array.isArray(prod?.variants) ? prod.variants : null;
      if (!variants) continue;
      out.productBodies++;
      const tier = tierOf(url);
      for (const v of variants) {
        if (!("price" in v)) continue;
        out.variantPriceFields++;
        const raw = v.price;
        const parsed = tier === "js" ? currentJsTier(raw) : currentJsonTier(raw);
        // "should have refused": a value that is not a clean positive decimal string
        // (json tier) or not a non-negative integer (js tier), yet still yields a number.
        const cleanForTier = tier === "js"
          ? (typeof raw === "number" && Number.isInteger(raw) && raw >= 0)
          : (typeof raw === "number" ? Number.isFinite(raw) : typeof raw === "string" && CLEAN_DECIMAL.test(raw.trim()));
        if (parsed !== null && !cleanForTier) {
          const s = String(raw);
          const shape = /^[A-Za-z]{3}$/.test(s) ? "currency_code"
            : s.trim() === "" ? "empty_or_whitespace"
              : !/\d/.test(s) ? "no_digits"
                : /^-/.test(s) ? "negative"
                  : /[eE]/.test(s) ? "exponent"
                    : /,/.test(s) ? "thousands_separator"
                      : "other_with_digits";
          out.offenders.push({ host, url, tier, raw, rawType: typeof raw, parsed, rendersAs: `$${parsed.toFixed(2)}`, shape });
          out.byShape[shape] = (out.byShape[shape] || 0) + 1;
          out.byHost[host] = (out.byHost[host] || 0) + 1;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TWO-SIDED LIVENESS CANARY. `offenders: 0` is the flattering answer, and a predicate
// that never fires returns it just as readily as a clean corpus does. Run the SAME
// classification over synthetic variants with known-different answers.
// ---------------------------------------------------------------------------
function classify(raw, tier) {
  const parsed = tier === "js" ? currentJsTier(raw) : currentJsonTier(raw);
  const cleanForTier = tier === "js"
    ? (typeof raw === "number" && Number.isInteger(raw) && raw >= 0)
    : (typeof raw === "number" ? Number.isFinite(raw) : typeof raw === "string" && CLEAN_DECIMAL.test(String(raw).trim()));
  return parsed !== null && !cleanForTier;
}
const canary = {
  must_fire: [["USD", "json"], ["", "json"], ["-5.00", "json"], ["1e5", "json"], ["1,299.00", "json"]]
    .map(([r, t]) => ({ raw: r, tier: t, flagged: classify(r, t) })),
  must_not_fire: [["19.99", "json"], ["1299.00", "json"], [1999, "js"], [0, "js"]]
    .map(([r, t]) => ({ raw: r, tier: t, flagged: classify(r, t) })),
};
canary.live = canary.must_fire.every((c) => c.flagged) && canary.must_not_fire.every((c) => !c.flagged);
out.canary = canary;

out.completion =
  !canary.live ? "INCOMPLETE — the offender predicate failed its two-sided canary; `offenders: 0` proves nothing"
  : out.filesScanned === 0 ? "INCOMPLETE — no snapshot files read"
    : out.productBodies === 0 ? "INCOMPLETE — read files but parsed zero product bodies; the endpoint matcher is wrong"
      : out.variantPriceFields === 0 ? "INCOMPLETE — parsed products but saw zero variant price fields"
        : out.offenders.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN";

fs.writeFileSync("experiments/v3-9/out/cp4_freq.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  dirs: out.dirs, filesScanned: out.filesScanned, productBodies: out.productBodies,
  variantPriceFields: out.variantPriceFields, offenders: out.offenders.length,
  byShape: out.byShape, distinctHosts: Object.keys(out.byHost).length,
  examples: out.offenders.slice(0, 12), canary: out.canary, completion: out.completion,
}, null, 2));
