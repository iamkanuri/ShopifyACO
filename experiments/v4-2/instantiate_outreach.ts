// CP-4 — fill every `{DERIVED:…}` in OUTREACH_PACK.md from artifacts.
//
// THE RULE FROM THE PACK ITSELF: "no number in a sent message may be hand-typed." So this
// is a generator, not a document. Every figure below is read from
// `standards/coffee/v1.3/fitness.json`, from the published standard, or from a STORED
// result row through the same `selectMaterial` the one-pager uses — so the three findings
// in the email are byte-for-byte the three on the attached PDF. Two documents that pick
// their own "top three" would eventually disagree in front of a prospect.
//
// AND THE OTHER RULE: "Where a placeholder's honest value differs from what the pack's
// prose implies, flag it and keep the number; never bend a figure to fit copy." Those
// flags are collected in FLAGS and printed in the output, not silently resolved.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getStoredResult } from "../../src/db/buyerTests.js";
import { resolveStored } from "../../src/server/resultPage.js";
import { selectMaterial } from "../../src/server/onePager.js";
import { peerSentence } from "../../viewer/src/peerSentence.js";
import { currentOf, fitnessOf } from "../../src/server/standardsSite.js";

const BASE = process.env.OUTREACH_BASE ?? "https://lens.thirdocular.com";
const [COFFEE_TOKEN, GENERAL_TOKEN] = process.argv.slice(2);
if (!COFFEE_TOKEN || !GENERAL_TOKEN) {
  console.error("usage: instantiate_outreach.ts <coffeeToken> <generalToken>");
  process.exit(2);
}
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repoRoot = path.resolve(here, "..", "..");

const FLAGS: string[] = [];

// ---- the published measurement ---------------------------------------------
const published = currentOf("coffee");
if (!published) throw new Error("INCOMPLETE: coffee is not published");
const f = fitnessOf(published);
if (!f) throw new Error("INCOMPLETE: no fitness record for the current coffee standard");
const coffee = f.samples.find((s) => s.name === "coffee");
const general = f.samples.find((s) => s.name === "general");
if (!coffee) throw new Error("INCOMPLETE: no coffee sample");

// ⚠️ CLAUDE.md IS STALE BY A RELEASE and would be the obvious place to copy from. It
// records the v3.7 general figures (7.53% over 488 rows, Wilson 2.35–5.75). The artifact
// carries the v3.8 re-measurement after the tier-aware cents fix and the non-USD refusal.
// Reading the file rather than the notes is the whole discipline.
if (general) {
  const displaced = (general as Record<string, unknown>).supersedes_measurement as
    | { bound_95_cluster_icc02_pct?: number; pass_rows_audited?: number } | undefined;
  if (displaced?.bound_95_cluster_icc02_pct && displaced.bound_95_cluster_icc02_pct !== general.bound_95_cluster_icc02_pct) {
    FLAGS.push(
      `The general-sample bound in CLAUDE.md (${displaced.bound_95_cluster_icc02_pct}% over ` +
      `${displaced.pass_rows_audited} rows) is SUPERSEDED. The artifact publishes ` +
      `${general.bound_95_cluster_icc02_pct}% over ${general.pass_rows_audited} rows. Used the artifact.`,
    );
  }
}

// ⚠️ NO SPREAD. Both intervals present and overlapping ⇒ any comparative sentence between
// them is arithmetic, not a measurement. The pack has no such placeholder; this exists so
// a future edit cannot add one without tripping it.
const ivs = [coffee.interval_95, general?.interval_95].filter(Boolean) as Array<{ lower_pct: number; upper_pct: number }>;
const overlap = ivs.length === 2 && !(ivs[0]!.lower_pct > ivs[1]!.upper_pct || ivs[1]!.lower_pct > ivs[0]!.upper_pct);

// ---- the two reference runs -------------------------------------------------
async function load(token: string) {
  const row = await getStoredResult(token);
  if (!row) throw new Error(`INCOMPLETE: no stored result for ${token}`);
  const r = resolveStored(row);
  if (!r) throw new Error(`INCOMPLETE: stored blob for ${token} does not resolve`);
  return { row, r, material: selectMaterial(r, 3) };
}
const A = await load(COFFEE_TOKEN);   // Track A — coffee / standard layer
const B = await load(GENERAL_TOKEN);  // Track B — general layer

if (!A.material.length || !B.material.length) throw new Error("INCOMPLETE: a reference run produced no findings");

// ---- the Track A peer line, and the sentence it contradicts ------------------
//
// The pack's prose: "For context: {DERIVED: X} of 100 {CATEGORY} stores we measured state
// this on-page — so this is a peer gap, not a nitpick."
//
// TWO separate problems, both flagged rather than smoothed:
//  1. "of 100" is false for five of the ten measured entries (asked of 99 or 76), and the
//     delivery entry could be DECIDED on only 74 of the 100 it was asked.
//  2. On this store the sentence's ARGUMENT inverts: every one of its unmet rows is a
//     requirement most comparable stores also fail, so the honest number says "this is a
//     category-wide gap", not "you are behind your peers".
const peerLines = A.material.map((m) => {
  if (!m.peer) return { label: m.a.label, line: null as string | null, statedByPeers: null as number | null };
  const stated = m.peer.adjudicated - m.peer.failed;
  return {
    label: m.a.label,
    line: peerSentence(m.peer, false),
    statedByPeers: stated,
    adjudicated: m.peer.adjudicated,
    asked: m.peer.asked,
    undecided: m.peer.undecided,
  };
});
const nonHundred = peerLines.filter((p) => p.adjudicated !== undefined && p.adjudicated !== 100);
if (nonHundred.length) {
  FLAGS.push(
    `"of 100" IS FALSE for ${nonHundred.length} of the ${peerLines.length} findings on the Track A ` +
    `artifact: ${nonHundred.map((p) => `${p.label} (${p.adjudicated} adjudicated of ${p.asked} asked)`).join("; ")}. ` +
    `Every peer sentence below is generated by peerSentence(), which names its own denominator.`,
  );
}
const weak = peerLines.filter((p) => p.statedByPeers !== null && p.adjudicated && p.statedByPeers / p.adjudicated < 0.5);
if (weak.length === peerLines.length) {
  FLAGS.push(
    `THE PACK'S TRACK A ARGUMENT DOES NOT HOLD ON THIS STORE, and the number is kept rather than the copy. ` +
    `The pack reads "X of 100 stores state this on-page — so this is a peer gap, not a nitpick", which needs a ` +
    `HIGH X. On ${A.row.store_host} every unmet requirement is one MOST comparable stores also fail ` +
    `(${weak.map((p) => `${p.statedByPeers}/${p.adjudicated}`).join(", ")} state it). The honest framing is the ` +
    `opposite and is arguably stronger: this is a category-wide gap, which is an argument for the STANDARD ` +
    `rather than a criticism of one merchant. The line below says that instead.`,
  );
}

const fmt = (n: number) => n.toFixed(2).replace(/\.00$/, "");
const findingLine = (m: (typeof A.material)[number], withPeer: boolean): string => {
  const bits = [`**${m.a.label}** — ${m.a.detail}`];
  if (m.a.evidenceQuote) bits.push(`Evidence: “${m.a.evidenceQuote}”`);
  if (withPeer && m.peer) bits.push(peerSentence(m.peer, false));
  return bits.join(" ");
};

const out = `# OUTREACH PACK — INSTANTIATED (v4.2 CP-4)

**Generated by** \`experiments/v4-2/instantiate_outreach.ts\`, not written. Every figure is read
from \`standards/coffee/v1.3/fitness.json\`, the published standard, or a stored result row —
and the three findings in each message come from the same \`selectMaterial()\` that renders the
attached one-pager, so the email and the PDF cannot disagree about which findings are the
material ones.

**Do not hand-edit the numbers.** Re-run the generator.

---

## FLAGS — where the honest value differs from what the pack's prose implies

${FLAGS.length ? FLAGS.map((x, i) => `${i + 1}. ${x}`).join("\n\n") : "_None._"}

${overlap ? `**No spread may be stated between the two samples.** Their 95% intervals overlap (coffee ${
  fmt(coffee.interval_95!.lower_pct)}–${fmt(coffee.interval_95!.upper_pct)}%, general ${
  fmt(general!.interval_95!.lower_pct)}–${fmt(general!.interval_95!.upper_pct)}%), so no sentence may claim a
category sample and a general sample differ. That claim has been retired four times and revived
by a fix twice.` : ""}

---

## THE DERIVED VALUES

| placeholder | value | source |
|---|---|---|
| \`{DERIVED: current bound}\` | **${fmt(coffee.bound_95_cluster_icc02_pct)}% (95% upper, cluster-adjusted ICC 0.2); ${fmt(coffee.point_estimate_pct)}% point estimate** | \`fitness.json\` → samples[coffee] |
| audited rows behind it | ${coffee.pass_rows_audited} passing rows, each read individually, across ${coffee.stores} storefronts (${coffee.products_evaluated ?? coffee.stores} products) | same |
| confirmed wrong | ${coffee.confirmed_false_positives} | same |
${general ? `| general-sample bound (do NOT compare) | ${fmt(general.bound_95_cluster_icc02_pct)}% over ${general.pass_rows_audited} rows | \`fitness.json\` → samples[general] |\n` : ""}| \`{DERIVED: methodology URL}\` | ${BASE}/methodology | live route |
| current standard | ${published.doc.standard_id} v${published.doc.version}, content hash \`${published.hash}\` | \`standard.json\` |
| standard URL | ${BASE}/standards/coffee/${published.publicVersion} | live route |

---

## TRACK A — the standard story (coffee / food-bev clients)

**Reference store:** ${A.row.store_host} · **Contract:** ${A.r.standard?.id} v${A.r.standard?.version}
**Result:** ${A.r.test.evidencedCount + A.r.test.noBlockingCount} stated · ${A.r.test.notProvenCount} not stated${
  A.r.test.requiresAccessCount ? ` · ${A.r.test.requiresAccessCount} not decidable publicly` : ""} of ${A.r.test.total}

> **Subject:** ${A.row.store_host} — ${A.material.length} things an AI can't get from their product pages
>
> Hi {NAME} — I build conformance tests for AI commerce (solo founder, engineer at heart).
> I ran ${A.row.store_host} — saw them in your portfolio — against a published buying standard
> for coffee.
>
> ${A.material.length} findings, each checkable on their live page in ~30 seconds:
${A.material.map((m) => `> - ${findingLine(m, true)}`).join("\n")}
>
> The part that's unusual: we publish our own error rate (${fmt(coffee.bound_95_cluster_icc02_pct)}% 95% upper
> bound, measured over ${coffee.pass_rows_audited} passing rows read back one at a time; method public),
> version every standard, and every verdict carries the exact sentence it rests on — built so it
> can survive a client pushing back on it.
>
> I'm doing 5 conversations with agencies who write audit deliverables before deciding what to
> build next. 20 minutes: I'll run any client you pick live, and I want one answer from you —
> what would this need to output to go into a deliverable you'd sign?
>
> Full result for ${A.row.store_host}: ${BASE}/result/${COFFEE_TOKEN}
> How it works under the hood, if anyone technical wants to kick it: ${BASE}/methodology

**Attachment:** \`onepager_coffee_klatchcoffee.pdf\`

**The peer line, per finding, with its true denominator:**

${peerLines.map((p) => `- ${p.label} — ${p.line ?? "_no published peer measurement for this entry_"}`).join("\n")}

---

## TRACK B — the findings story (any Shopify client)

**Reference store:** ${B.row.store_host} · **Contract:** generated buyer task — no published standard covers this product
**Result:** ${B.r.test.evidencedCount + B.r.test.noBlockingCount} stated · ${B.r.test.notProvenCount} not stated of ${B.r.test.total}

> **Subject:** ${B.row.store_host} — ${B.material.length} things an AI can't get from their product pages
>
> Hi {NAME} — I build conformance tests for AI commerce (solo founder, engineer at heart).
> I ran ${B.row.store_host} — saw them in your portfolio — against a set of machine-buyer
> conformance checks.
>
> ${B.material.length} findings, each checkable on their live page in ~30 seconds:
${B.material.map((m) => `> - ${findingLine(m, false)}`).join("\n")}
>
> The part that's unusual: we publish our own error rate, version every standard, and every
> verdict carries the exact sentence it rests on — built so it can survive a client pushing
> back on it.
>
> I'm doing 5 conversations with agencies who write audit deliverables before deciding what to
> build next. 20 minutes: I'll run any client you pick live, and I want one answer from you —
> what would this need to output to go into a deliverable you'd sign?
>
> Full result for ${B.row.store_host}: ${BASE}/result/${GENERAL_TOKEN}
> How it works under the hood, if anyone technical wants to kick it: ${BASE}/methodology

**Attachment:** \`onepager_general_barebonesliving.pdf\`

⚠️ **NO peer line and NO error rate appears in Track B, by construction.** The measured bound is
measured while executing a standard on its own category; quoting it beside a general-engine
result would attribute a measurement to a different thing than the one that produced the finding.
The pack's own rule — "Never imply an executable standard exists outside coffee" — is enforced by
the renderer, not by the sender's memory: a general-layer one-pager states no percentage at all.

---

## WHAT IS NOT DERIVED, AND MUST NOT BE SENT UNTIL IT IS

- \`{NAME}\`, the agency, and the portfolio client are the human's job (§2 of the pack).
- Both reference stores are OUR choices, not an agency's client. When a real prospect is picked,
  re-run the test on THEIR named client and regenerate — the URLs above are exhibits.
`;

const outPath = path.join(repoRoot, "experiments/v4-2/outreach_final.md");
fs.writeFileSync(outPath, out);

// A generated document that quietly failed to interpolate is the `${…}` defect this repo
// already guards on the public site. Same check, same reason.
// Scoped to PROSE. The derived-values table names each placeholder in its label column on
// purpose — that is the audit trail from the pack to the value — so a whole-document scan
// flags its own index. Table rows start with `|`; everything else must be filled.
const leftovers = out.split("\n")
  .filter((l) => !l.trimStart().startsWith("|"))
  .flatMap((l) => [...l.matchAll(/\{DERIVED[^}]*\}/g)].map((m) => m[0]));
const undef = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(out);
console.log(JSON.stringify({
  completion: leftovers.length || undef ? "DEFECTS_FOUND" : "VERIFIED_CLEAN",
  wrote: path.relative(repoRoot, outPath),
  unfilled_placeholders: leftovers,
  bad_interpolation: undef ? undef[0] : null,
  flags: FLAGS.length,
  coffee_bound_pct: coffee.bound_95_cluster_icc02_pct,
  general_bound_pct: general?.bound_95_cluster_icc02_pct ?? null,
  intervals_overlap: overlap,
  trackA_findings: A.material.length,
  trackB_findings: B.material.length,
}, null, 2));
if (leftovers.length || undef) process.exit(1);
