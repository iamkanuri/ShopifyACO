// ===========================================================================
// v3.8 CP-1B — what the fetch corpus found, and what the two fixes closed.
//
//   node experiments/v3-8/fetch_compare.mjs
//
// ⚠️ A FLAG IS NOT A DEFECT, and on this corpus the distinction is load-bearing
// rather than pedantic. Two different things make a case flag:
//
//   WRONG NUMBER   — `minPriceUsd` differs from the honest price. This is a
//                    defect on any reading: the engine computed a figure that is
//                    not the product's price.
//   PROMISE        — the engine's STATUS differs from the answer the case author
//                    expected, with no wrong number. On the currency cluster the
//                    authors expected `pass` (report the price, in its own
//                    currency); v3.8 shipped a REFUSAL instead, deliberately, and
//                    the brief said in advance that what a price row should
//                    promise for a non-USD store is not settled here. Counting
//                    that as a defect would count a decision as a bug.
//
// Both are reported. Neither is folded into the other, and the headline metric —
// defects a real-store sample could not have found — is computed over the WRONG
// NUMBER class only, because that is the one nobody can argue with.
// ===========================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pre = JSON.parse(readFileSync(join(HERE, "out", "fetch_results_pre.json"), "utf8"));
const post = JSON.parse(readFileSync(join(HERE, "out", "fetch_results_post.json"), "utf8"));

if (!pre.canary?.live || !post.canary?.live) {
  console.error("REFUSING: a harness canary collapsed. Neither run can be believed.");
  process.exit(2);
}
if (pre.state === "incomplete" || post.state === "incomplete") {
  console.error("REFUSING: a harness run is INCOMPLETE.");
  process.exit(2);
}

const wrongNumber = (r) => r.flags.some((f) => f.startsWith("wrong_price") || f.startsWith("states_a_price_where_none"));
const forbidden = (r) => r.flags.some((f) => f.startsWith("rendered_forbidden_string") || f.startsWith("renders_dollar_sign"));
const promiseOnly = (r) => r.flags.length > 0 && !wrongNumber(r) && !forbidden(r);

const idx = (rs) => Object.fromEntries(rs.map((r) => [r.id, r]));
const P = idx(pre.results), Q = idx(post.results);

const classes = [...new Set(pre.results.map((r) => r.attack_class))].sort();
const rows = [];
for (const c of classes) {
  const cases = pre.results.filter((r) => r.attack_class === c);
  rows.push({
    cls: c,
    total: cases.length,
    preWrong: cases.filter((r) => wrongNumber(P[r.id])).length,
    postWrong: cases.filter((r) => wrongNumber(Q[r.id])).length,
    preForbidden: cases.filter((r) => forbidden(P[r.id])).length,
    postForbidden: cases.filter((r) => forbidden(Q[r.id])).length,
    postPromise: cases.filter((r) => promiseOnly(Q[r.id])).length,
  });
}

const preWrongAll = pre.results.filter((r) => wrongNumber(r));
const postWrongAll = post.results.filter((r) => wrongNumber(r));
const closed = preWrongAll.filter((r) => !wrongNumber(Q[r.id]));
const opened = postWrongAll.filter((r) => !wrongNumber(P[r.id]));
const residual = postWrongAll.filter((r) => wrongNumber(P[r.id]));

// THE HEADLINE. Defects the real-store sample could not have found, counted over
// the class nobody can argue with, and using the AUTHORS' OWN honesty flag.
const headlinePre = preWrongAll.filter((r) => r.unreachable_by_real_store_sample);
const headlinePost = postWrongAll.filter((r) => r.unreachable_by_real_store_sample);

const L = [];
L.push("v3.8 CP-1B — THE FETCH-LAYER CORPUS");
L.push(`  cases            : ${pre.results.length}`);
L.push(`  canary           : pre ${pre.canary.cheap}/${pre.canary.dear}  post ${post.canary.cheap}/${post.canary.dear}  LIVE both sides`);
L.push("");
L.push("PER CLASS — wrong NUMBER (a defect on any reading), before -> after the two fixes");
L.push(`  ${"class".padEnd(24)} ${"n".padStart(4)} ${"wrong".padStart(8)} ${"->".padStart(4)} ${"wrong".padStart(6)}   ${"forbidden-string".padStart(18)}   promise-only`);
for (const r of rows) {
  L.push(`  ${r.cls.padEnd(24)} ${String(r.total).padStart(4)} ${String(r.preWrong).padStart(8)} ${"->".padStart(4)} ${String(r.postWrong).padStart(6)}   ${String(r.preForbidden).padStart(8)} -> ${String(r.postForbidden).padStart(4)}      ${r.postPromise}`);
}
L.push(`  ${"TOTAL".padEnd(24)} ${String(pre.results.length).padStart(4)} ${String(preWrongAll.length).padStart(8)} ${"->".padStart(4)} ${String(postWrongAll.length).padStart(6)}`);
L.push("");
L.push(`  CLOSED by 3a+3b   : ${closed.length}`);
L.push(`  RESIDUAL          : ${residual.length}`);
L.push(`  NEWLY OPENED      : ${opened.length}   <-- must be 0, or a fix made something worse`);
if (opened.length) for (const r of opened) L.push(`      [${r.id}] ${r.attack_class}/${r.subclass}  ${r.flags.join(" | ")}`);
L.push("");
L.push("=== THE HEADLINE ===");
L.push(`  Wrong-number defects the SHIPPED engine had, that a real-store sample could NOT have found`);
L.push(`  (the case authors' own \`unreachable_by_real_store_sample\` flag, set before any result was seen):`);
L.push(`      ${headlinePre.length} of ${preWrongAll.length}`);
L.push(`  Still open after both fixes: ${headlinePost.length}`);
L.push("");
L.push("RESIDUAL WRONG-NUMBER DEFECTS, still open at HEAD:");
for (const r of residual) {
  L.push(`  [${r.id}] ${r.attack_class}/${r.subclass}${r.unreachable_by_real_store_sample ? "  *unreachable-by-sample*" : ""}`);
  L.push(`      rendered=${r.engine.minPriceUsd}  honest=${r.honest_answer.min_price_usd}  status=${r.engine.priceRowStatus}`);
  L.push(`      why: ${String(r.why).slice(0, 190)}`);
}
console.log(L.join("\n"));
