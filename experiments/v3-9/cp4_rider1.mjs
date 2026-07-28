// v3.9 CP-4 rider 1 — is any of v3.8's 11 surviving general defects THIS class?
//
// "This class" is specifically: a NON-NUMERIC string in `variants[].price` that
// `priceToUsd`'s json tier turns into a stated number. It is NOT the same as P-19's
// "$0.00 is a price", which is a store publishing a real 0 or no readable variant at all.
// Conflating them would let CP-4 claim a defect it does not close.
import fs from "node:fs";
import path from "node:path";

const rem = JSON.parse(fs.readFileSync("experiments/v3-8/out/remeasure.json", "utf8"));
const survivors = rem.survived;
const priceSurvivors = survivors.filter((s) => s.kind === "price_under");

const DIRS = ["experiments/v2-9/snaps", "experiments/v3-0/snaps_coffee",
  "experiments/v3-1/snaps_coffee", "experiments/v3-2/snaps_coffee"];

function findSnap(host) {
  for (const d of DIRS) {
    const p = path.join(d, `${host}.json`);
    if (fs.existsSync(p)) return p;
  }
  for (const d of DIRS) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.replace(/\.json$/, "").replace(/^www\./, "") === host.replace(/^www\./, "")) return path.join(d, f);
    }
  }
  return null;
}

const isProductEndpoint = (u) => /\/products\/[^/?#]+\.(json|js)(\?|$)/i.test(u);
const rows = [];
for (const s of priceSurvivors) {
  const p = findSnap(s.host);
  if (!p) { rows.push({ ...s, snapshot: null, verdict: "INCOMPLETE — no snapshot" }); continue; }
  const snap = JSON.parse(fs.readFileSync(p, "utf8"));
  const seen = [];
  for (const [url, resp] of Object.entries(snap.responses ?? {})) {
    if (!isProductEndpoint(url) || !resp || typeof resp.body !== "string") continue;
    let body; try { body = JSON.parse(resp.body); } catch { continue; }
    if (!body || typeof body !== "object") continue;
    const prod = body.product ?? body;
    if (!Array.isArray(prod?.variants)) continue;
    const tier = /\.js(\?|$)/i.test(url) ? "js" : "json";
    for (const v of prod.variants) {
      if (!("price" in v)) continue;
      seen.push({ tier, raw: v.price, type: typeof v.price, title: v.title ?? null, available: v.available });
    }
  }
  const anyNonNumericString = seen.some(
    (x) => x.type === "string" && !/^\d+(\.\d+)?$/.test(String(x.raw).trim()),
  );
  const allZero = seen.length > 0 && seen.every((x) => Number(String(x.raw).replace(/[^0-9.]/g, "")) === 0);
  rows.push({
    ...s, snapshot: p, variantPricesSeen: seen.length,
    distinctRaw: [...new Set(seen.map((x) => `${x.tier}:${JSON.stringify(x.raw)}`))].slice(0, 8),
    anyNonNumericString, allZero,
    verdict: seen.length === 0
      ? "no variant price field in the captured bytes — NOT CP-4's class (nothing for priceToUsd to mis-parse)"
      : anyNonNumericString
        ? "*** CP-4 CLASS — a non-numeric price string is present ***"
        : allZero
          ? "P-19's class (a real zero), NOT CP-4's"
          : "neither — prices parse cleanly",
  });
}

const hits = rows.filter((r) => r.anyNonNumericString);
const out = {
  survivors_total: survivors.length,
  price_survivors: priceSurvivors.length,
  rows,
  cp4_class_hits: hits.length,
  rider1_answer: hits.length === 0
    ? "NO — none of the 11 surviving general defects is CP-4's class. The same-push re-measurement invariant does NOT fire."
    : "YES — the same-push re-measurement invariant FIRES; a third sidecar block is owed.",
  completion: rows.some((r) => r.verdict.startsWith("INCOMPLETE")) ? "INCOMPLETE" : "VERIFIED_CLEAN",
};
fs.writeFileSync("experiments/v3-9/out/cp4_rider1.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
