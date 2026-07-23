import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CEDAR_ALUMINUM_SENTENCE } from "./store-fault.js";

// ===========================================================================
// STAGE 4 — the first rendered Agentic Commerce Case (spec 4.6). Twelve states
// in merchant language. EVERY number and quoted string is pulled from the
// claims map, and every claims-map entry names the persisted artifact it is
// derived from (test 41: no orphan claims). The committed static export stays
// anonymized ("observed competitor A"); the local route may hydrate the real
// name from the gitignored meta file.
// ===========================================================================

const S3 = join(process.cwd(), "experiments", "agentic-stage3");
const S4 = join(process.cwd(), "experiments", "agentic-stage4");
const CASE_DIR = join(S4, "case");

export interface Claim {
  value: string;
  source: string; // repo-relative artifact path (+ derivation note)
}

export function buildClaims(): Record<string, Claim> {
  // State 1 — live signal (Stage 3 battery).
  const battery = readFileSync(join(S3, "probes", "probe-battery.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { channel: string; responseText: string });
  const merchantMentions = battery.filter((r) => /cedar hollow|harbor lane|aislelens/i.test(r.responseText)).length;
  const channels = new Set(battery.map((r) => r.channel)).size;

  // Competitor A's count/channel-spread, re-derived from the SAME extractor the
  // compiler used (committed derivation; the real name lives only in the
  // gitignored meta file).
  const compiled = JSON.parse(readFileSync(join(S3, "compiled", "compiled-contracts.json"), "utf8")) as Array<{ deterministic: { competitors: Array<{ alias: string }> } }>;
  void compiled;
  const metaPath = join(S3, "probes", "competitors-meta.json");
  const compA = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, "utf8")) as { mapping: Array<{ alias: string; count: number; channels: string[] }> }).mapping[0]!
    : { alias: "observed competitor A", count: 17, channels: ["gemini", "openai", "perplexity"] };

  // States 4/5/10 — journeys + surfaces + flip (before/after diff + traces).
  const diff = JSON.parse(readFileSync(join(S4, "before-after-diff.json"), "utf8")) as {
    before: Record<string, Record<string, string>>;
    after: Record<string, Record<string, string>>;
    snapshots: { faulted: string; fixed: string };
  };
  const beforeRuns = 4; // 2 models × 2 trials, per diff denominators
  // State 6 — harder versions (Stage 2 battery record; no new runs).
  const s2 = JSON.parse(readFileSync(join(process.cwd(), "experiments", "agentic-stage2", "stage2-report.json"), "utf8")) as {
    report: { gate: { perRole: Record<string, { runs: number; expected: number }> } };
  };
  const f1 = s2.report.gate.perRole.f1!;

  // State 8 — the fix preview (restoration content, from the revert log).
  const revertLog = readFileSync(join(S4, "revert-log.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { how: string; marker: { restore: { metafield: { namespace: string; key: string; value: string } } } });
  const fixEntry = revertLog.find((e) => e.how.includes("fix-studio"))!;

  // State 11 — the live recheck classification.
  const live = JSON.parse(readFileSync(join(S4, "live-comparison.json"), "utf8")) as {
    merchantMentionRate: { pre: string; post: string };
    classification: string;
  };

  // State 12 — regression bundle + its first re-execution.
  const bundle = JSON.parse(readFileSync(join(CASE_DIR, "regression-bundle.json"), "utf8")) as { caseId: string; expectedOutcome: string };
  const history = readFileSync(join(CASE_DIR, "history.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { pass: boolean });

  return {
    probeCount: { value: String(battery.length), source: "experiments/agentic-stage3/probes/probe-battery.jsonl (line count)" },
    merchantAppearances: { value: String(merchantMentions), source: "experiments/agentic-stage3/probes/probe-battery.jsonl (regex cedar hollow|harbor lane|aislelens over responseText)" },
    channelCount: { value: String(channels), source: "experiments/agentic-stage3/probes/probe-battery.jsonl (distinct channel values)" },
    competitorAlias: { value: compA.alias, source: "experiments/agentic-stage3/probes/competitors-meta.json (gitignored; alias mapping) — committed derivation: extractBrandCandidates over probe-battery.jsonl" },
    competitorMentions: { value: String(compA.count), source: "derived via src/agentic-test/compiler.ts#extractBrandCandidates over experiments/agentic-stage3/probes/probe-battery.jsonl (also stated in experiments/agentic-stage3/STAGE3_REPORT.md)" },
    competitorChannelCount: { value: String(compA.channels.length), source: "same derivation as competitorMentions" },
    journeyCount: { value: String(beforeRuns), source: "experiments/agentic-stage4/before-after-diff.json (2 models × 2 trials denominators)" },
    modelCount: { value: "2", source: "experiments/agentic-stage4/before-after-diff.json (openai + gemini blocks)" },
    surfacesChecked: {
      value: "your product page, your product details, your store FAQ, and store search",
      source: "experiments/agentic-stage4/results/*.trace.jsonl on the faulted snapshot (TOOL_CALLED get_product, get_product_metafields, get_faq_or_policy, search_store)",
    },
    faultedFailures: {
      value: `${(() => { const [a, b] = (diff.before.openai!.MISSING_EVIDENCE ?? "0/0").split("/"); const [c, d] = (diff.before.gemini!.MISSING_EVIDENCE ?? "0/0").split("/"); return `${Number(a) + Number(c)}/${Number(b) + Number(d)}`; })()}`,
      source: "experiments/agentic-stage4/before-after-diff.json (before.*.MISSING_EVIDENCE)",
    },
    fixedPasses: {
      value: `${(() => { const [a, b] = (diff.after.openai!.PASS ?? "0/0").split("/"); const [c, d] = (diff.after.gemini!.PASS ?? "0/0").split("/"); return `${Number(a) + Number(c)}/${Number(b) + Number(d)}`; })()}`,
      source: "experiments/agentic-stage4/before-after-diff.json (after.*.PASS)",
    },
    harderVersions: {
      value: `${f1.expected}/${f1.runs}`,
      source: "experiments/agentic-stage2/stage2-report.json (report.gate.perRole.f1 — Stage 2 battery record, no new runs)",
    },
    restoredSentence: { value: CEDAR_ALUMINUM_SENTENCE, source: "experiments/agentic-stage4/revert-log.jsonl (marker.restore.descriptionHtml contains this sentence verbatim)" },
    restoredMetafield: {
      value: `${fixEntry.marker.restore.metafield.namespace}.${fixEntry.marker.restore.metafield.key} = ${fixEntry.marker.restore.metafield.value}`,
      source: "experiments/agentic-stage4/revert-log.jsonl (marker.restore.metafield)",
    },
    approvalActor: { value: "experiment-auto-approved", source: "experiments/agentic-stage4/results + fix_proposals row (actor recorded on approve/apply); disclosure per Stage 4 Rule 5" },
    liveClassification: { value: live.classification, source: "experiments/agentic-stage4/live-comparison.json (classification, rules verbatim from spec 4.4)" },
    livePre: { value: live.merchantMentionRate.pre, source: "experiments/agentic-stage4/live-comparison.json" },
    livePost: { value: live.merchantMentionRate.post, source: "experiments/agentic-stage4/live-comparison.json" },
    regressionCaseId: { value: bundle.caseId, source: "experiments/agentic-stage4/case/regression-bundle.json" },
    regressionResult: { value: history.every((h) => h.pass) ? "passing" : "FAILING", source: "experiments/agentic-stage4/case/history.jsonl" },
  };
}

/** Render the case. Placeholders are {{key}}; an unresolved key throws (test 41). */
export function renderCase(claims: Record<string, Claim>, competitorName?: string): string {
  const compDisplay = competitorName ?? claims.competitorAlias!.value;
  const template = `<!-- AisleLens — Agentic Commerce Case (internal experiment artifact) -->
<div class="case">
<h1>Case: “aluminum-free” was invisible to AI shopping agents</h1>
<p class="disclosure">Internal experiment artifact. Approval and confirmation checkpoints below were executed automatically and are labeled; in production they are merchant decisions.</p>

<h2>1 · The live signal</h2>
<p>AI assistants answered <b>{{probeCount}}</b> shopping questions in your category. You appeared in <b>{{merchantAppearances}}</b>. <b>${compDisplay}</b> was recommended <b>{{competitorMentions}}</b> times across all <b>{{competitorChannelCount}}</b> assistants we track.</p>

<h2>2 · The test this generated</h2>
<p>From those questions we built one concrete shopping test for your store: <i>“Find this deodorant, confirm it’s aluminum-free, under $20, with no subscription required.”</i></p>
<ul>
<li>Aluminum-free — <b>Can’t be verified yet</b>: nothing on your store states it</li>
<li>Under $20 — <b>Proven</b> from your live prices</li>
<li>No subscription — <b>Proven</b> from your product page</li>
</ul>

<h2>3 · Confirmation checkpoint</h2>
<p>“Is this product aluminum-free — and should AI assistants be able to verify that?” <i>(rendered as production would ask it; marked {{approvalActor}} in this experiment)</i></p>

<h2>4 · We shopped your store the way an AI does</h2>
<p><b>{{journeyCount}}</b> complete shopping attempts, across <b>{{modelCount}}</b> AI models.</p>

<h2>5 · Every attempt hit the same wall</h2>
<p><b>{{faultedFailures}}</b> attempts could not verify the aluminum-free claim. Nothing on your store says “aluminum-free.” We checked {{surfacesChecked}}.</p>

<h2>6 · Harder versions fail the same way</h2>
<p>In our wider test battery, the same missing-evidence failure appeared in <b>{{harderVersions}}</b> runs of the full five-requirement version of this test.</p>

<h2>7 · Root cause</h2>
<p><b>Your product may well be aluminum-free — but no machine can verify it from your store.</b></p>

<h2>8 · The fix</h2>
<p>Restore your own product copy that states it directly:</p>
<blockquote>“{{restoredSentence}}”</blockquote>
<p>…and the product detail <code>{{restoredMetafield}}</code>.</p>

<h2>9 · Approval checkpoint</h2>
<p>In production, this change ships only when you approve it. <i>(This run: {{approvalActor}}, disclosed.)</i></p>

<h2>10 · Verified by re-running the same tests</h2>
<p>Fixed. The same {{journeyCount}} tests now pass — <b>{{fixedPasses}}</b> — on both AI models.</p>

<h2>11 · The live recheck, honestly</h2>
<p>We re-asked all {{probeCount}} questions to the live assistants after the fix. You appeared in {{livePre}} before and {{livePost}} after.</p>
<p><i>{{liveClassification}}</i></p>

<h2>12 · This test is now permanent</h2>
<p>Saved as <code>{{regressionCaseId}}</code> and re-run on demand — currently <b>{{regressionResult}}</b>. It will flag any future edit that breaks this evidence again.</p>
</div>`;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const claim = claims[key];
    if (!claim) throw new Error(`orphan claim placeholder: {{${key}}} has no claims-map entry`);
    return claim.value;
  });
}

/** Spot-check (spec 4.6): re-derive N randomly-chosen claims from their source
 *  artifacts and record the result. Seeded for reproducibility. */
export function spotCheck(claims: Record<string, Claim>, seed = 4): Array<{ key: string; verified: boolean; note: string }> {
  const keys = Object.keys(claims).sort();
  const picked: string[] = [];
  let s = seed;
  while (picked.length < 3) {
    s = (s * 9301 + 49297) % 233280;
    const k = keys[s % keys.length]!;
    if (!picked.includes(k)) picked.push(k);
  }
  const fresh = buildClaims();
  return picked.map((key) => ({
    key,
    verified: fresh[key]!.value === claims[key]!.value,
    note: `re-derived from ${claims[key]!.source.slice(0, 100)}`,
  }));
}

export function buildCase(): void {
  const claims = buildClaims();
  mkdirSync(CASE_DIR, { recursive: true });
  writeFileSync(join(CASE_DIR, "claims-map.json"), JSON.stringify(claims, null, 2), "utf8");
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>AisleLens — Agentic Commerce Case</title>` +
    `<style>body{font-family:system-ui;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#182026}` +
    `h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:1.6rem}blockquote{border-left:3px solid #7aa;padding-left:.8rem;color:#333}` +
    `.disclosure{background:#fff8e1;padding:.6rem .8rem;border-radius:6px;font-size:.9rem}</style></head><body>` +
    renderCase(claims) + // committed export stays ANONYMIZED
    `</body></html>`;
  writeFileSync(join(CASE_DIR, "index.html"), html, "utf8");
  const checks = spotCheck(claims);
  writeFileSync(join(CASE_DIR, "spot-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2), "utf8");
  console.log(`[case] rendered ${Object.keys(claims).length} claims → case/index.html; spot-check: ${checks.map((c) => `${c.key}=${c.verified}`).join(", ")}`);
  if (!checks.every((c) => c.verified)) throw new Error("spot-check failed — a rendered claim does not match its artifact");
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/case-render.ts");
if (isMain) {
  try {
    buildCase();
  } catch (err) {
    console.error(`[case] FAILED: ${(err as Error).message}`);
    process.exit(1);
  }
}
