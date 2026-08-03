/**
 * ADV1 PROBE 3 — the two REAL stores whose JSON-LD offer price moved.
 * Dump the actual offers markup so "corrected downward" can be checked rather than
 * believed, and dump every readable price with the object it came from.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TARGETS = ["balancecoffee.co.uk", "templecoffee.com"];
const SNAP_DIRS = ["experiments/v2-9/snaps", "experiments/v3-2/snaps_coffee", "experiments/v3-5/publish/snaps_coffee100"].map((d) => path.join(ROOT, d));

let found = 0;
for (const dir of SNAP_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const host = f.replace(/\.json$/, "");
    if (!TARGETS.includes(host)) continue;
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const [u, r] of Object.entries<any>(snap.responses ?? {})) {
      if (!r || r.status !== 200 || !/html/i.test(r.contentType ?? "") || !/\/products\//.test(u)) continue;
      found++;
      console.log(`\n================ ${host}  (${dir.split(/[\\/]/).pop()}) ================`);
      console.log(`url: ${u}`);
      const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let m: RegExpExecArray | null; let blockIdx = 0;
      while ((m = re.exec(r.body)) !== null) {
        let parsed: any;
        try { parsed = JSON.parse((m[1] ?? "").trim()); } catch { continue; }
        const visit = (n: any): any[] => Array.isArray(n) ? n.flatMap(visit) : (n && typeof n === "object" ? [...(Array.isArray(n["@graph"]) ? n["@graph"].flatMap(visit) : []), n] : []);
        for (const node of visit(parsed)) {
          const t = [].concat(node["@type"] ?? []).map(String);
          if (!t.some((x) => /^(Product|ProductGroup)$/i.test(x))) continue;
          console.log(`  [block ${blockIdx}] @type=${t.join(",")} name=${JSON.stringify(node.name)}`);
          console.log(`  offers = ${JSON.stringify(node.offers, null, 2)?.slice(0, 2600)}`);
          break; // first Product node only — the one extractProduct selects
        }
        blockIdx++;
      }
      // also show whether a .json / .js tier was captured (would supply variant prices)
      const tiers = Object.keys(snap.responses).filter((k) => /\.(json|js)(\?|$)/.test(k));
      console.log(`  captured non-html tiers: ${tiers.length ? tiers.join(", ") : "(none)"}`);
      break;
    }
  }
}
console.log(found ? `\nRESOLUTION: DECISIVE — ${found} snapshots dumped.` : "\nRESOLUTION: INCOMPLETE — no target snapshot found.");
if (!found) process.exit(2);
