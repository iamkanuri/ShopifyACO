// adv2 — EXACTLY WHAT IS MISSING FROM node_modules, so the damage report is a fact.
import fs from "node:fs";
import path from "node:path";
const REPO = path.resolve("C:/Users/iamka/Documents/projects/ShopifyACO");
const NM = path.join(REPO, "node_modules");
const lock = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
const want = new Set();
for (const k of Object.keys(lock.packages ?? {})) {
  if (!k.startsWith("node_modules/")) continue;
  const rest = k.slice("node_modules/".length);
  if (rest.includes("/node_modules/")) continue;           // nested, not top level
  want.add(rest);
}
const missing = [], present = [];
for (const w of [...want].sort()) (fs.existsSync(path.join(NM, w)) ? present : missing).push(w);
const binDir = path.join(NM, ".bin");
console.log(JSON.stringify({
  top_level_packages_in_lock: want.size,
  present: present.length,
  MISSING: missing,
  dot_bin_exists: fs.existsSync(binDir),
  dot_bin_entries: fs.existsSync(binDir) ? fs.readdirSync(binDir).length : 0,
  // the two binaries this repo's own scripts invoke
  tsx_dir: fs.existsSync(path.join(NM, "tsx")),
  typescript_bin_tsc: fs.existsSync(path.join(NM, "typescript", "bin", "tsc")),
}, null, 2));
