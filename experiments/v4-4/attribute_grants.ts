// v4.4 §2 — WHICH ROW DID THE TIER ACTUALLY GRANT?
//
// The stored blob records `semantic.granted: 1` but not WHICH assertion moved, and
// the obvious shortcut is wrong: the tier's detail string ("Stated in your X.") is
// ALSO produced by the lexical path, so a prose/pattern read matches two rows per
// result and cannot tell them apart. This repo's own rule — never classify "did my
// change cause this" by reading prose, A/B it — applies to attribution too.
//
// TWO INDEPENDENT LEGS, and they must agree:
//   LEG 1 (kind filter, exact):  `applySemanticTier` promotes ONLY a requirement whose
//     `kind === "claim"`. Generate the buyer task for the captured product and read the
//     kinds. This is a property of the code path, independent of any run.
//   LEG 2 (replay A/B, empirical):  replay the captured bytes through the real
//     `runProductTest` with the tier OFF and diff statuses against the stored result.
//     A row that is `not_proven` offline and `pass_evidenced` in the stored blob is a
//     grant candidate.
//
// ⚠️ TWO-SIDED CANARY. Leg 1 is worthless unless the kind filter is shown to
// DISCRIMINATE on this data: if every pass row were a claim, "the claim rows are the
// grants" would be vacuous. So the probe asserts that among the stored pass rows there
// is at least one claim AND at least one non-claim. Leg 2 is worthless unless the
// replay is shown to have produced rows at all. Either failing ⇒ INCOMPLETE.
//
// ⚠️ Leg 2 carries a stated caveat: the capture and the live run are different days,
// so page drift can move a row for reasons unrelated to the tier. That is why leg 1
// exists and why agreement — not leg 2 alone — is the finding.
import fs from "node:fs";
import path from "node:path";

process.env.PRODUCT_TEST_SEMANTIC = "0"; // leg 2 must be tier-OFF

const { runProductTest, buildBuyerTask, fetchPublicProduct } = await import("../../src/server/productTest.js");
const { runStandardTest } = await import("../../src/server/publicStandard.js");
// `loadStandard` is module-private, and exporting it to satisfy a probe would edit
// `src/` for a measurement. The two modules it composes are both public, so the probe
// composes them itself — same artifact, same compiler, no production surface moved.
const { currentOf } = await import("../../src/server/standardsSite.js");
const { compileStandard } = await import("../../standards/compile.js");
const compiledOf = (slug: string) => {
  const pub = currentOf(slug);
  if (!pub) throw new Error(`no published standard for '${slug}'`);
  return compileStandard(JSON.parse(pub.rawJson)).requirements;
};
const { __resetCaches } = await import("../../src/server/productTestCache.js");

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = path.resolve(here, "..", "..");

const AFFECTED = JSON.parse(fs.readFileSync(path.join(here, "affected_rows.json"), "utf8"));

// Snapshot for each affected store. Both are already in the committed corpora.
const SNAPS: Record<string, string> = {
  "magicspoon.com": path.join(repo, "experiments/v2-9/snaps/magicspoon.com.json"),
  "www.klatchcoffee.com": path.join(repo, "experiments/v3-5/publish/snaps_coffee100/klatchcoffee.com.json"),
  "klatchcoffee.com": path.join(repo, "experiments/v3-5/publish/snaps_coffee100/klatchcoffee.com.json"),
};

interface Snap { host: string; url: string; responses: Record<string, { status: number; contentType: string | null; body: string; finalUrl?: string }> }

const reasons: string[] = [];
const findings: any[] = [];
let sawClaim = 0, sawNonClaim = 0, replayRows = 0;

for (const row of AFFECTED) {
  const snapPath = SNAPS[row.store_host];
  const stored = row.kind === "standard" ? (row.result.result ?? {}) : row.result;
  const storedPass = new Set<string>((stored.assertions ?? []).filter((a: any) => a.status === "pass_evidenced").map((a: any) => a.label));
  const storedByLabel = new Map<string, any>((stored.assertions ?? []).map((a: any) => [a.label, a]));

  console.log("\n" + "=".repeat(78));
  console.log(`${row.token}  (${row.kind})  ${row.store_host}`);
  console.log(`  stored semantic: ${JSON.stringify(row.semantic)}`);

  if (!snapPath || !fs.existsSync(snapPath)) {
    reasons.push(`${row.token}: no snapshot for ${row.store_host}`);
    console.log(`  NO SNAPSHOT — cannot attribute`);
    continue;
  }
  const snap: Snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const misses: string[] = [];
  const replay = async (url: string) => {
    const r = snap.responses[url];
    if (!r) { misses.push(url); throw new Error(`REPLAY MISS: ${url}`); }
    return r;
  };

  // ---- LEG 1: which of the STORED pass rows are claim-kind? ----------------
  // ⚠️ A STANDARD run does NOT use the generated buyer task — it runs the COMPILED
  // entries of the published standard, so their labels appear nowhere in
  // `buildBuyerTask`. Reading the generated task for a standard row returned "?????"
  // for every label and UNRESOLVED for the grant, which is the correct refusal and
  // the reason this branch exists rather than a widened lookup.
  __resetCaches();
  const fetched = await fetchPublicProduct(snap.url, { fetchUrl: replay, sleep: async () => {} });
  if (!fetched.product) { reasons.push(`${row.token}: capture did not yield a product`); continue; }
  const reqs = row.kind === "standard"
    ? compiledOf(row.standard_slug ?? "coffee")
    : buildBuyerTask(fetched.product).requirements;
  const kindOf = new Map<string, string>(reqs.map((r: any) => [r.label, r.kind]));
  const claimOf = new Map<string, string | undefined>(reqs.map((r: any) => [r.label, r.claim]));

  console.log(`  LEG 1 — kind of each STORED pass row (from the generated task):`);
  const leg1: string[] = [];
  for (const label of storedPass) {
    const k = kindOf.get(label);
    if (k === "claim") { sawClaim++; leg1.push(label); } else if (k) sawNonClaim++;
    console.log(`    ${k === "claim" ? "CLAIM " : (k ?? "?????").padEnd(6)} ${label}${k === "claim" ? `  (claim=${claimOf.get(label)})` : ""}`);
  }

  // ---- LEG 2: replay tier-OFF and diff -------------------------------------
  __resetCaches();
  const off: any = row.kind === "standard"
    ? ((await runStandardTest(snap.url, row.standard_slug ?? "coffee", { fetchUrl: replay, sleep: async () => {} })).result ?? {})
    : await runProductTest(snap.url, { fetchUrl: replay, force: true, sleep: async () => {} });
  replayRows += (off.assertions ?? []).length;
  const offByLabel = new Map<string, any>((off.assertions ?? []).map((a: any) => [a.label, a]));
  console.log(`  LEG 2 — replay tier-OFF: ${off.assertions?.length ?? 0} rows, misses ${misses.length}`);
  const leg2: string[] = [];
  for (const label of storedPass) {
    const o = offByLabel.get(label);
    if (!o) { console.log(`    (absent offline) ${label}`); continue; }
    if (o.status !== "pass_evidenced") {
      leg2.push(label);
      console.log(`    FLIP  ${label}: offline=${o.status}  stored=pass_evidenced`);
      console.log(`          offline detail: ${o.detail}`);
    }
  }

  const agree = leg1.filter((l) => leg2.includes(l));
  const leg1Only = leg1.filter((l) => !leg2.includes(l));
  const leg2Only = leg2.filter((l) => !leg1.includes(l));
  console.log(`  AGREEMENT: both legs ${JSON.stringify(agree)} | leg1-only ${JSON.stringify(leg1Only)} | leg2-only ${JSON.stringify(leg2Only)}`);

  // ⚠️ A LEG THAT DID NOT RUN MUST NOT READ AS A LEG THAT AGREED. If leg 2 produced no
  // rows (replay miss), `agree` is empty for a reason that has nothing to do with the
  // evidence, and silently falling back to leg 1 would report a two-leg attribution
  // that only ever had one leg. The basis is recorded per row instead.
  const granted = Number(row.semantic?.granted ?? 0);
  const leg2Ran = (off.assertions ?? []).length > 0;
  if (!leg2Ran) console.log(`  ⚠️ LEG 2 DID NOT RUN — 0 rows, ${misses.length} replay miss(es): ${JSON.stringify(misses)}`);
  let basis: string;
  let attributed: string[] | null;
  if (leg2Ran && agree.length === granted) { attributed = agree; basis = "both legs agree"; }
  else if (leg1.length === granted) {
    attributed = leg1;
    basis = leg2Ran
      ? "LEG 1 ONLY — leg 2 flipped different rows (page drift between capture and live run); leg 1 is exact because only a claim-kind row can receive a grant"
      : "LEG 1 ONLY — leg 2 did not run (replay miss); leg 1 is exact because only a claim-kind row can receive a grant";
  } else { attributed = null; basis = "UNRESOLVED"; }
  if (!attributed) reasons.push(`${row.token}: could not attribute ${granted} grant(s) — legs disagree`);
  console.log(`  ATTRIBUTED (${granted} grant): ${attributed ? JSON.stringify(attributed) : "UNRESOLVED"}`);
  console.log(`  BASIS: ${basis}`);

  for (const label of attributed ?? []) {
    const a = storedByLabel.get(label);
    findings.push({
      token: row.token, kind: row.kind, store: row.store_host, url: row.product_url,
      createdAt: row.created_at, standard: row.standard_slug ? `${row.standard_slug} ${row.standard_version}` : null,
      label, claimKey: claimOf.get(label) ?? null,
      detail: a?.detail, quote: a?.evidenceQuote, surface: a?.evidenceSurface,
      legs: { kindFilter: leg1, replayFlip: leg2, agreed: agree }, basis,
    });
  }
}

// ---- canaries --------------------------------------------------------------
console.log("\n" + "=".repeat(78));
console.log(`canary A — kind filter discriminates: claim rows ${sawClaim}, non-claim pass rows ${sawNonClaim}`);
console.log(`canary B — replay produced rows: ${replayRows}`);
if (sawClaim === 0) reasons.push("canary A: no claim row among stored passes — the filter cannot be the discriminator");
if (sawNonClaim === 0) reasons.push("canary A: EVERY stored pass row is a claim — the kind filter is vacuous here");
if (replayRows === 0) reasons.push("canary B: the tier-off replay produced no rows");

fs.writeFileSync(path.join(here, "attributed_grants.json"), JSON.stringify(findings, null, 2));
const completion = reasons.length ? "INCOMPLETE" : (findings.length ? "DEFECTS_FOUND" : "VERIFIED_CLEAN");
console.log(`\nattributed grants: ${findings.length}`);
console.log(`completion: ${completion}`);
for (const r of reasons) console.log(`  reason: ${r}`);
