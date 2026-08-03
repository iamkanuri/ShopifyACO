// v4.5 A3 — WHICH HARNESSES WOULD SPEND MONEY IF RUN ON A KEYED MACHINE?
//
//   node experiments/v4-5/spend_audit.mjs
//
// The semantic tier is pinned off on production's two public routes (v4.4), but that pin
// lives in the ROUTES. A harness that imports `runProductTest` directly gets the module
// default, which reads `PRODUCT_TEST_SEMANTIC` from the environment — so on a developer
// machine with a model key set, a harness that does not explicitly opt out will make paid
// calls, and its output will be non-deterministic (v4.4 measured the tier answering
// differently on 11% of claim rows across identical runs).
//
// Most harnesses already set `process.env.PRODUCT_TEST_SEMANTIC = "0"` at the top. This
// finds the ones that DO NOT and still reach a path that can invoke the tier.
//
// ⚠️ ENTRYPOINTS ONLY. A file that merely defines helpers cannot spend; a file that is
// executed can. The discriminator used here is top-level await / a top-level driver, which
// is imperfect and is reported as such rather than presented as exact.
//
// ⚠️ TWO-SIDED CANARY: the audit must find BOTH files that opt out and files that do not.
// If every file looks identical the classifier is not reading the source.
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.join(HERE, "..");

/** Reaching any of these can end in a model call unless the tier is pinned off. */
const REACHES_ENGINE = /\b(runProductTest|runStandardTest|applySemanticTier|judgeClaims)\b/;
const OPTS_OUT = /PRODUCT_TEST_SEMANTIC\s*=\s*["'`]0["'`]/;
/** A file with no driver cannot spend on its own. Imperfect, and reported as imperfect. */
const IS_ENTRYPOINT = /^\s*(?:await\s|const\s+\w+\s*=\s*await\s|for\s*\(|process\.exit|console\.log)/m;

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|[\\/]out$|snaps/.test(p)) walk(p, out); }
    else if (/\.(ts|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

/**
 * ⚠️ VENDORED SOURCE TREES ARE NOT HARNESSES, and the first run of this audit counted
 * them: it reported 59 "exposed" files where the handoff had said four. Past sessions
 * checked WHOLE COPIES of `src/` into `experiments/` so an A/B could run two engines from
 * two worktrees (`inst-src`, `rev-src`, `zk_pre_tree/src`, `attack-recall/base/src`).
 * Those files are the engine, not something that runs it — `productTest.ts` naturally
 * mentions `runProductTest` and naturally does not pin an env var. Counting them turned a
 * four-file cleanup into a 59-file phantom. Excluded by path, and the exclusion is stated
 * rather than silent, because a filter that quietly drops files is how a sweep reports
 * clean over a real one.
 */
const VENDORED = /(^|\/)(inst-src|rev-src)\//.source + "|" + /_pre_tree\//.source + "|" + /attack-recall\/base\//.source + "|" + /(^|\/)\.SAFETY_/.source;
const isVendored = (rel) => new RegExp(VENDORED).test(rel);

const files = walk(ROOT);
const reach = [], optOut = [], exposed = [], vendored = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (!REACHES_ENGINE.test(src)) continue;
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  if (isVendored(rel)) { vendored.push(rel); continue; }
  reach.push(f);
  if (OPTS_OUT.test(src)) { optOut.push(f); continue; }
  if (IS_ENTRYPOINT.test(src)) exposed.push(rel);
}

const canaryLive = optOut.length > 0 && exposed.length >= 0 && reach.length > optOut.length;
const out = {
  completion: canaryLive ? (exposed.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN") : "INCOMPLETE",
  reasons: canaryLive ? [] : ["canary: the audit must see both opting-out and non-opting-out files; it did not, so the classifier is suspect"],
  scanned: files.length,
  reach_the_engine: reach.length,
  already_opt_out: optOut.length,
  exposed_count: exposed.length,
  exposed,
  vendored_excluded: vendored.length,
  method_limit: "IS_ENTRYPOINT is a heuristic (top-level driver shapes). A file it misclassifies as a library is not proven safe; it is unexamined.",
};
fs.mkdirSync(path.join(HERE, "out"), { recursive: true });
fs.writeFileSync(path.join(HERE, "out", "spend_audit.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
