// ===========================================================================
// PUBLISHING A STANDARD (v3.2 CP7).
//
// A published standard whose numbers are retyped into a web page is worse than an
// unpublished one: the page and the artifact drift, and the citation that resolves
// to the page says something the JSON does not. So EVERY published number in here
// is read from the artifact — `standard.json` for structure, `fitness.json` for
// measured error bounds — and `standards.test.ts` asserts the published content
// hash equals the artifact's.
//
// WHY THIS IS SERVER-RENDERED. The whole point of publishing is that a machine can
// read it. lens.thirdocular.com returns meta tags and an empty <div id="root"> to a
// non-JavaScript fetch, so the site whose headline is "AI buyers treat your store
// like an API" was unreadable by AI buyers. These pages render their full text into
// the document, ahead of the SPA catch-all; React mounts over it and takes the page
// for interaction, exactly as the Index SSR already does.
//
// WHAT IS DELIBERATELY PUBLISHED THAT NOBODY ELSE PUBLISHES:
//   • the INSUFFICIENT evidence for every entry — what does NOT count, and why;
//   • the BLOCKED, ADVISORY and NOT-DISCRIMINATING tiers, each naming why it is not
//     executable. Sixteen questions saying "here is exactly what would be required"
//     is a stronger artifact than ten presented as complete;
//   • what a pass does NOT license;
//   • the measured error bound, per sample, with its method and n — AND the fact
//     that the two samples are not audited to the same depth, which matters more
//     than the gap between them. Every comparative sentence is DERIVED from the
//     numbers; the hand-written one went false the moment they moved.
//
// `independently_applied: false` is stated on the front page. We wrote the standard
// and we run it; no third party has applied it. Saying so is cheap and not saying so
// would be the first false claim on a site about claim discipline.
// ===========================================================================
import fs from "node:fs";
import path from "node:path";
import { standardHash, hashMatches } from "../../standards/hash.js";

// ---- the artifacts ---------------------------------------------------------

export interface StandardEntry {
  id: string;
  question: string;
  assertion?: { subject?: string; operator?: string; expected?: unknown };
  tier: "executable" | "not_discriminating" | "blocked" | "advisory" | string;
  /** An OBJECT ({applies_when, signal}) in the artifact, not a string. Rendering it
   *  directly produced "[object Object]" — the SECOND field in this file to do so
   *  after `posture`, which is why `renderScalarish` exists rather than a third
   *  bespoke branch, and why a test now forbids the string anywhere on any page. */
  applicability?: { applies_when?: string; signal?: string } | string;
  accepted_evidence?: Array<{ surface?: string; form?: string; example?: string }>;
  insufficient_evidence?: Array<{ form?: string; why_not?: string }>;
  conflict_rules?: Array<{ when?: string; resolution?: string; precedence?: string[] }>;
  public_inspectable?: unknown;
  predicted_discrimination?: {
    predicted_fail_rate_band?: string;
    in_target_band?: boolean;
    reasoning?: string;
    measured?: boolean;
    measured_fail_rate_pct?: number;
    measured_n?: number;
    measured_verdict?: string;
  };
  consumer_note?: string;
  pass_means?: { establishes?: string; does_not_establish?: string } | string;
  known_gaps?: Array<{ corpus_case?: string; effect?: string; note?: string }> | string[];
  // ⚠️ THE ARTIFACT'S KEY IS `citations`. An earlier version of this file read
  // `grounding.sources`, which does not exist — so every grounding block rendered
  // EMPTY, on the entry pages and on the whole grounding page, and the tests passed
  // because they only asserted that the id and the insufficient-evidence forms were
  // present. A renderer reading a field that is not there produces nothing and looks
  // exactly like a section that legitimately has nothing. `sources` is kept as a
  // tolerated alias so a future schema rename does not silently blank the page again.
  grounding?: {
    citations?: Array<{ source?: string; url?: string; kind?: string; establishes?: string }>;
    sources?: Array<{ source?: string; url?: string; kind?: string; establishes?: string }>;
    demand_basis?: string[];
    refutation?: unknown;
  };
  merchant_remediation?: string;
  not_executable_because?: string;
  blocked_reason?: string;
  [k: string]: unknown;
}

export interface StandardDoc {
  standard_id: string;
  version: string;
  title: string;
  status?: string;
  /** An OBJECT in the artifact, not a string — it rendered as "[object Object]". */
  posture?: { independently_applied?: boolean; statement?: string } | string;
  grammar_version?: string;
  applicability_envelope?: unknown;
  out_of_scope?: unknown;
  engine_contract?: unknown;
  standard_hash?: string;
  entries: StandardEntry[];
  [k: string]: unknown;
}

export interface FitnessSample {
  name: string; label: string; description?: string;
  stores: number; pass_rows_audited: number; confirmed_false_positives: number;
  point_estimate_pct: number; bound_95_naive_pct?: number; bound_95_cluster_icc02_pct: number;
  rows_per_store?: number; deff_icc02?: number; method: string; source?: string;
  /** Only PART of this sample has been re-checked, so its rate is a lower bound. A
   *  floor and a complete audit must never be compared as peers. */
  is_floor?: boolean;
  supersedes?: string;
}
export interface EntryDiscrimination {
  id: string; asked: number; fail_pct: number; predicted_band?: string; verdict?: string; note?: string;
}
export interface FitnessDoc {
  measured_at: string; engine_version?: string;
  samples: FitnessSample[];
  pending?: Record<string, string>;
  /** Measured fail rate per entry. OVERRIDES the document's predicted band — the
   *  bands are hypotheses written before the standard had ever run, and rewriting
   *  them inside standard.json would change its hash and break every citation. */
  entry_discrimination?: { n_products?: number; bands_held?: number; entries?: EntryDiscrimination[] };
}

export interface PublishedStandard {
  slug: string;            // "coffee"
  publicVersion: string;   // "1.0"
  dir: string;             // on-disk directory
  doc: StandardDoc;
  fitness: FitnessDoc | null;
  hash: string;
  hashOk: boolean;
  rawJson: string;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

/** Every standard that is PUBLISHED. A draft under `standards/` is not published by
 *  existing — it is published by appearing here, so `accessory/v0.1-draft` cannot
 *  leak onto the site because someone added a directory. */
const PUBLISHED: ReadonlyArray<{ slug: string; publicVersion: string; dir: string }> = [
  { slug: "coffee", publicVersion: "1.0", dir: "standards/coffee/v1.0" },
];

let cache: PublishedStandard[] | null = null;

export function loadPublishedStandards(): PublishedStandard[] {
  if (cache) return cache;
  const out: PublishedStandard[] = [];
  for (const p of PUBLISHED) {
    try {
      const raw = fs.readFileSync(path.join(repoRoot, p.dir, "standard.json"), "utf8");
      const doc = JSON.parse(raw) as StandardDoc;
      let fitness: FitnessDoc | null = null;
      try {
        fitness = JSON.parse(fs.readFileSync(path.join(repoRoot, p.dir, "fitness.json"), "utf8")) as FitnessDoc;
      } catch { fitness = null; }   // absent ⇒ the page says "not measured", never invents
      const check = hashMatches(doc as unknown);
      out.push({
        ...p, doc, fitness, rawJson: raw,
        hash: check.computed, hashOk: check.ok,
      });
    } catch { /* a standard that will not load is simply not published */ }
  }
  cache = out;
  return out;
}

/** Test seam — the module caches on first read, and a test that writes a fixture
 *  needs to invalidate it. */
export function __resetStandardsCache(): void { cache = null; }

export const findStandard = (slug: string, version: string): PublishedStandard | null =>
  loadPublishedStandards().find((s) => s.slug === slug && s.publicVersion === version) ?? null;

// ---- html helpers ----------------------------------------------------------

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const p = (s: unknown) => `<p>${esc(s)}</p>`;
const li = (s: unknown) => `<li>${esc(s)}</li>`;

const TIER_LABEL: Record<string, string> = {
  executable: "Executable",
  not_discriminating: "Not discriminating",
  blocked: "Blocked",
  advisory: "Advisory",
};
const TIER_WHY: Record<string, string> = {
  executable: "This question is asked as a test and produces a result for a real page.",
  not_discriminating: "This question is executable, but nearly every page answers it the same way — so the answer carries almost no information, and it is published rather than run.",
  blocked: "This question matters to a buyer and CANNOT be answered from a public product page today. What would be required is stated in full.",
  advisory: "This question is worth asking but is not reducible to a check a page can settle. It is published as guidance, not as a test.",
};

/**
 * Render a field that MIGHT be a string and might be a small object of strings.
 *
 * ⚠️ TWO FIELDS IN THIS ARTIFACT ARE OBJECTS THAT READ LIKE STRINGS — `posture` and
 * `applicability` — and both rendered as the literal text "[object Object]" on a
 * published page. Template interpolation converts silently, so nothing failed; the
 * page simply published a JavaScript diagnostic to a reader. A third such field is
 * a matter of time, so this handles the shape rather than the two known names, and
 * `standardsSite.test.ts` forbids "[object Object]" on EVERY page.
 */
function renderScalarish(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return p(v);
  if (Array.isArray(v)) return `<ul>${v.map((x) => li(typeof x === "string" ? x : JSON.stringify(x))).join("")}</ul>`;
  if (typeof v === "object") {
    const rows = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => typeof val === "string" && val.trim())
      .map(([k, val]) => `<div><dt>${esc(k.replace(/_/g, " "))}</dt><dd>${esc(val)}</dd></div>`);
    return rows.length ? `<dl class="std-kv">${rows.join("")}</dl>` : "";
  }
  return p(String(v));
}

/**
 * The comparison between samples, DERIVED from them.
 *
 * Two things it must never say when they are not true: that the bounds differ by an
 * order of magnitude, and that the samples were audited to the same depth. `is_floor`
 * on a sample means only part of it has been re-checked, and comparing a complete
 * audit against a floor as if they were peers is a bigger error than either number.
 */
function renderComparison(samples: FitnessSample[]): string {
  if (samples.length < 2) return "";
  const complete = samples.filter((s) => !s.is_floor);
  const floors = samples.filter((s) => s.is_floor);
  const hi = [...samples].sort((a, b) => b.bound_95_cluster_icc02_pct - a.bound_95_cluster_icc02_pct)[0]!;
  const lo = [...samples].sort((a, b) => a.bound_95_cluster_icc02_pct - b.bound_95_cluster_icc02_pct)[0]!;
  const ratio = lo.bound_95_cluster_icc02_pct > 0 ? hi.bound_95_cluster_icc02_pct / lo.bound_95_cluster_icc02_pct : 0;
  const size = ratio >= 8 ? "by an order of magnitude" : ratio >= 2 ? `by more than ${Math.floor(ratio)}×` : `by about ${ratio.toFixed(1)}×`;

  const out = [p(`The ${esc(hi.label)} bound is higher than the ${esc(lo.label)} bound ${size}. A general sample estimates the error rate on copy that looks like the average of every category at once, which is copy no individual merchant writes — so the number that matters to a merchant is the one measured on their own category.`)];

  if (floors.length && complete.length) {
    out.push(`<p class="std-limit"><strong>These two are not audited to the same depth, and the difference matters more than the gap between them.</strong> ${
      esc(complete.map((s) => s.label).join(" and "))} had every passing row read individually. ${
      esc(floors.map((s) => s.label).join(" and "))} is a FLOOR: one defect class was checked mechanically and found ${
      floors.reduce((n, s) => n + s.confirmed_false_positives, 0)} errors that a full read of the rendered rows had already missed. Its true rate is at least what is shown and probably higher, so the two columns are not a like-for-like comparison and the gap between them is not a measurement.</p>`);
  }
  return out.join("");
}

/** The scalar rendering of an assertion's `expected`, which is a boolean or a string
 *  on a direct assertion and an object on a DERIVED one. */
function expectedText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return Array.isArray(v) ? v.join(", ") : "(derived — see below)";
  return String(v);
}

/** The grounding citations for an entry. See the note on `StandardEntry.grounding`. */
export function groundingOf(e: StandardEntry): Array<{ source?: string; url?: string; kind?: string; establishes?: string }> {
  return e.grounding?.citations ?? e.grounding?.sources ?? [];
}

/**
 * The document's own posture, VERBATIM.
 *
 * ⚠️ THIS IS THE MOST IMPORTANT PARAGRAPH ON THE SITE AND IT IS NOT OURS TO SOFTEN.
 * The coffee standard's `status` is `draft`, and its posture statement says in as
 * many words that it "has never been applied to a real store by anyone" and is "a
 * rubric with a versioned changelog, not a standard". Publishing it under a heading
 * that calls it a finished standard would make the site's first claim about itself a
 * false one — on a site whose subject is claim discipline. So the artifact's own
 * words are rendered, unedited, above everything else.
 */
function postureHtml(doc: StandardDoc): string {
  const po = doc.posture;
  const statement = typeof po === "string" ? po : po?.statement;
  const status = doc.status ?? "unstated";
  return `<aside class="std-posture" role="note">
  <p class="std-status"><strong>Status: ${esc(status)}.</strong></p>
  ${statement ? p(statement) : ""}
</aside>`;
}

/** The artifact's title is a full descriptive sentence ("… — buyer questions,
 *  assertions and evidence rules for roasted coffee product pages"), which makes an
 *  unusable <title> and a worse breadcrumb. The short name is the part before the
 *  em dash; the full title is still published on the page itself. */
export function shortName(doc: StandardDoc): string {
  return String(doc.title ?? "").split("—")[0]!.trim() || String(doc.standard_id ?? "standard");
}

function tierCounts(doc: StandardDoc): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const e of doc.entries) m.set(e.tier, (m.get(e.tier) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

// ---- the rendered fragments ------------------------------------------------

export interface SitePage {
  title: string;
  description: string;
  canonical: string;
  jsonLd: string;
  bodyHtml: string;
}

function frontMatter(s: PublishedStandard): string {
  const counts = tierCounts(s.doc);
  const total = s.doc.entries.length;
  const rows = counts.map(([t, n]) =>
    `<tr><th scope="row">${esc(TIER_LABEL[t] ?? t)}</th><td>${n}</td><td>${esc(TIER_WHY[t] ?? "")}</td></tr>`).join("");
  return `<section class="std-front" aria-label="Standard front matter">
  <dl class="std-meta">
    <div><dt>Standard</dt><dd>${esc(s.doc.standard_id)}</dd></div>
    <div><dt>Version</dt><dd>${esc(s.doc.version)}</dd></div>
    <div><dt>Status</dt><dd>${esc(s.doc.status ?? "published")}</dd></div>
    <div><dt>Content hash</dt><dd><code>${esc(s.hash)}</code></dd></div>
    <div><dt>Entries</dt><dd>${total}</dd></div>
    <div><dt>Independently applied</dt><dd>No</dd></div>
  </dl>
  <p class="std-note"><strong>Independently applied: no.</strong> We wrote this standard and we run it; no third party has applied it to a store. That is a limit on what a pass here is worth, and it is stated because a site about claim discipline cannot make its first unchecked claim about itself.</p>
  <table class="std-tiers"><caption>Entries by tier</caption>
    <thead><tr><th scope="col">Tier</th><th scope="col">Count</th><th scope="col">What the tier means</th></tr></thead>
    <tbody>${rows}</tbody></table>
</section>`;
}

/** The measured error bounds — the single most checkable thing on the site, and the
 *  one no competitor can copy without first measuring themselves. */
export function renderFitness(s: PublishedStandard): string {
  const f = s.fitness;
  if (!f || !f.samples?.length) {
    return `<section class="std-fitness"><h2>Measured error</h2>${p("This standard has not yet been fitness-measured on a published sample. No bound is stated, because an unmeasured bound would be a guess presented as a number.")}</section>`;
  }
  const rows = f.samples.map((x) => `<tr>
    <th scope="row">${esc(x.label)}</th>
    <td>${x.stores}</td><td>${x.pass_rows_audited}</td><td>${x.confirmed_false_positives}</td>
    <td>${x.point_estimate_pct.toFixed(2)}%</td><td><strong>${x.bound_95_cluster_icc02_pct.toFixed(2)}%</strong></td>
  </tr>`).join("");
  const methods = f.samples.map((x) =>
    `<div class="std-method"><h3>${esc(x.label)} — method</h3>${p(x.method)}${x.source ? p(`Record: ${x.source}`) : ""}</div>`).join("");
  const pending = f.pending && Object.keys(f.pending).length
    ? `<div class="std-pending">${Object.entries(f.pending).map(([k, v]) => p(`${k}: ${v}`)).join("")}</div>`
    : "";
  // ⚠️ THIS PARAGRAPH USED TO BE HAND-WRITTEN, AND IT WENT FALSE THE MOMENT THE
  // NUMBERS MOVED. It asserted the two bounds "differ by an order of magnitude" and
  // were produced "under the same audit discipline". After the v3.2 audit neither was
  // true: the ratio is under 2×, and one sample is a complete row-by-row audit while
  // the other is a floor from ONE mechanically-checked defect class. A sentence of
  // interpretation sitting next to generated numbers is the same "site disagrees with
  // its own JSON" defect one level up, so the comparison is now derived too.
  const shape = renderComparison(f.samples);
  return `<section class="std-fitness" id="measured-error">
  <h2>Measured error</h2>
  ${p("Every row this standard passed was audited individually against its full evidence. The bound is a 95% upper bound, cluster-adjusted at ICC 0.2 because pass rows are not independent — rows from one store share that store's copy conventions, and the bare rule of three would overstate the precision.")}
  <table class="std-bounds"><caption>False-positive rate by sample</caption>
    <thead><tr><th scope="col">Sample</th><th scope="col">Stores</th><th scope="col">Pass rows audited</th><th scope="col">Confirmed false positives</th><th scope="col">Point estimate</th><th scope="col">95% upper bound</th></tr></thead>
    <tbody>${rows}</tbody></table>
  ${shape}${methods}${pending}
  <p class="std-note">Measured ${esc(f.measured_at)}${f.engine_version ? ` against engine ${esc(f.engine_version)}` : ""}.</p>
</section>`;
}

function entryHref(s: PublishedStandard, id: string): string {
  return `/standards/${s.slug}/${s.publicVersion}/${encodeURIComponent(id)}`;
}

export function renderEntry(s: PublishedStandard, e: StandardEntry, base: string): SitePage {
  const measured = s.fitness?.entry_discrimination?.entries?.find((x) => x.id === e.id) ?? null;
  const canonical = `${base}${entryHref(s, e.id)}`;
  const a = e.assertion;
  const pd = e.predicted_discrimination;

  const accepted = (e.accepted_evidence ?? []).map((x) =>
    `<li><strong>${esc(x.surface ?? "any product surface")}</strong> — ${esc(x.form ?? "")}${x.example ? ` <span class="std-eg">e.g. ${esc(x.example)}</span>` : ""}</li>`).join("");
  // Given deliberate visual weight: nobody else publishes what does NOT count.
  const insufficient = (e.insufficient_evidence ?? []).map((x) =>
    `<li><strong>${esc(x.form ?? "")}</strong><br /><span class="std-why">${esc(x.why_not ?? "")}</span></li>`).join("");
  const conflicts = (e.conflict_rules ?? []).map((x) =>
    `<li><strong>When</strong> ${esc(x.when ?? "")} — <strong>then</strong> ${esc(x.resolution ?? "")}${x.precedence?.length ? ` <span class="std-eg">precedence: ${esc(x.precedence.join(" > "))}</span>` : ""}</li>`).join("");
  const grounding = groundingOf(e).map((x) =>
    `<li>${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.source ?? x.url)}</a>` : `<strong>${esc(x.source ?? "")}</strong>`}${x.kind ? ` <span class="std-eg">(${esc(x.kind)})</span>` : ""}${x.establishes ? `<br /><span class="std-why">${esc(x.establishes)}</span>` : ""}</li>`).join("");
  const gaps = Array.isArray(e.known_gaps)
    ? (e.known_gaps as Array<Record<string, unknown> | string>).map((g) =>
      typeof g === "string" ? li(g)
        : `<li>${esc((g as { corpus_case?: string }).corpus_case ?? "")}${(g as { effect?: string }).effect ? ` — <strong>${esc((g as { effect?: string }).effect)}</strong>` : ""}${(g as { note?: string }).note ? `<br /><span class="std-why">${esc((g as { note?: string }).note)}</span>` : ""}</li>`).join("")
    : "";

  const passMeans = typeof e.pass_means === "string"
    ? p(e.pass_means)
    : `${e.pass_means?.establishes ? `<p><strong>A pass establishes:</strong> ${esc(e.pass_means.establishes)}</p>` : ""}${e.pass_means?.does_not_establish ? `<p class="std-limit"><strong>A pass does NOT establish:</strong> ${esc(e.pass_means.does_not_establish)}</p>` : ""}`;

  // MEASURED beats predicted, and both are shown: a reader should be able to see how
  // far the hypothesis was off, which is most of what this standard has learned.
  const discrimination = (pd || measured)
    ? `<section><h2>Discrimination</h2>
       ${measured
        ? `<p><strong>Measured fail rate:</strong> ${measured.fail_pct.toFixed(1)}% <span class="std-eg">(n=${measured.asked} products asked)</span></p>`
          + (measured.predicted_band ? `<p class="std-note">Predicted before this standard had ever run: ${esc(measured.predicted_band)}${measured.verdict === "held" ? " — held." : measured.verdict === "above_band" ? " — the real rate is higher, so the entry discriminates less than predicted." : " — the real rate is lower, so more stores pass than predicted."}</p>` : "")
          + (measured.note ? p(measured.note) : "")
        : `<p><strong>Predicted fail rate:</strong> ${esc(pd?.predicted_fail_rate_band ?? "not stated")} <span class="std-eg">(predicted, not yet measured)</span></p>`}
       ${pd?.reasoning ? p(pd.reasoning) : ""}</section>`
    : "";

  const bodyHtml = `<article class="std-entry">
  <nav class="std-crumb"><a href="/standards">Standards</a> / <a href="/standards/${esc(s.slug)}/${esc(s.publicVersion)}">${esc(shortName(s.doc))}</a></nav>
  <p class="std-tier std-tier-${esc(e.tier)}">${esc(TIER_LABEL[e.tier] ?? e.tier)}</p>
  <h1>${esc(e.question)}</h1>
  <p class="std-id"><code>${esc(e.id)}</code></p>
  ${p(TIER_WHY[e.tier] ?? "")}
  ${a ? `<section><h2>Assertion</h2><p><code>${esc(a.subject ?? "")} ${esc(a.operator ?? "")} ${esc(expectedText(a.expected))}</code></p>${
    // A DERIVED assertion's `expected` is itself an object — its inputs and the rule
    // that combines them. That is the most interesting part of the entry and it was
    // rendering as "[object Object]": the THIRD field in this artifact to do so.
    a.expected && typeof a.expected === "object" ? renderScalarish(a.expected) : ""
  }</section>` : ""}
  ${e.applicability ? `<section><h2>Applicability</h2>${renderScalarish(e.applicability)}</section>` : ""}
  ${accepted ? `<section><h2>Accepted evidence</h2><ul class="std-accept">${accepted}</ul></section>` : ""}
  ${insufficient ? `<section class="std-insufficient"><h2>Explicitly insufficient evidence</h2><p class="std-note">What does <em>not</em> count, and why. Published because the omission is where a check quietly becomes a claim.</p><ul>${insufficient}</ul></section>` : ""}
  ${conflicts ? `<section><h2>Conflict rules</h2><ul>${conflicts}</ul></section>` : ""}
  ${passMeans ? `<section><h2>What a pass licenses</h2>${passMeans}</section>` : ""}
  ${discrimination}
  ${gaps ? `<section><h2>Known gaps</h2><ul>${gaps}</ul></section>` : ""}
  ${e.consumer_note ? `<section><h2>For a shopper</h2>${p(e.consumer_note)}</section>` : ""}
  ${e.merchant_remediation ? `<section><h2>For a merchant</h2>${p(e.merchant_remediation)}</section>` : ""}
  ${grounding ? `<section><h2>Grounding</h2><ul class="std-grounding">${grounding}</ul></section>` : ""}
</article>`;

  return {
    title: `${e.question} — ${e.id}`,
    description: `${e.id}: ${e.question} Tier: ${TIER_LABEL[e.tier] ?? e.tier}. Accepted evidence, explicitly insufficient evidence, and what a pass does and does not license.`,
    canonical,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "TechArticle",
      identifier: e.id, headline: e.question, url: canonical, isPartOf: { "@type": "CreativeWork", name: s.doc.title, version: s.doc.version },
    })}</script>`,
    bodyHtml,
  };
}

export function renderStandard(s: PublishedStandard, base: string): SitePage {
  const canonical = `${base}/standards/${s.slug}/${s.publicVersion}`;
  const byTier = new Map<string, StandardEntry[]>();
  for (const e of s.doc.entries) {
    if (!byTier.has(e.tier)) byTier.set(e.tier, []);
    byTier.get(e.tier)!.push(e);
  }
  const order = ["executable", "not_discriminating", "advisory", "blocked"];
  const sections = order.filter((t) => byTier.has(t)).map((t) => {
    const items = byTier.get(t)!.map((e) =>
      `<li><a href="${esc(entryHref(s, e.id))}"><code>${esc(e.id)}</code> — ${esc(e.question)}</a></li>`).join("");
    return `<section class="std-tier-group"><h2>${esc(TIER_LABEL[t] ?? t)} <span class="std-eg">(${byTier.get(t)!.length})</span></h2>${p(TIER_WHY[t] ?? "")}<ul>${items}</ul></section>`;
  }).join("");

  return {
    title: `${shortName(s.doc)} — ${s.doc.standard_id} v${s.doc.version}`,
    description: `${s.doc.title}. ${s.doc.entries.length} entries: the questions a competent buyer asks in this category, with accepted evidence, explicitly insufficient evidence, and what a pass does and does not license.`,
    canonical,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "Dataset",
      name: s.doc.title, identifier: s.doc.standard_id, version: s.doc.version, url: canonical,
      distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${canonical}/standard.json` }],
    })}</script>`,
    bodyHtml: `<div class="std-doc">
  <nav class="std-crumb"><a href="/standards">Standards</a></nav>
  <h1>${esc(s.doc.title)}</h1>
  ${postureHtml(s.doc)}
  ${frontMatter(s)}
  ${renderFitness(s)}
  <p class="std-note"><a href="${esc(canonical)}/standard.json">The full standard as JSON</a> · <a href="${esc(canonical)}/grounding">Every source this standard is grounded in</a> · <a href="/methodology">How these are built and measured</a></p>
  ${sections}
</div>`,
  };
}

export function renderStandardsIndex(list: PublishedStandard[], base: string): SitePage {
  const items = list.map((s) => {
    const c = tierCounts(s.doc).map(([t, n]) => `${n} ${TIER_LABEL[t] ?? t}`).join(" · ");
    return `<li><h2><a href="/standards/${esc(s.slug)}/${esc(s.publicVersion)}">${esc(shortName(s.doc))}</a></h2>
      <p><code>${esc(s.doc.standard_id)}</code> v${esc(s.doc.version)} — ${s.doc.entries.length} entries (${esc(c)})</p></li>`;
  }).join("");
  return {
    title: "Buying standards",
    description: "Versioned buying standards — the questions a competent buyer asks in a category, written as executable tests, with the evidence that counts, the evidence that does not, and the measured error bound.",
    canonical: `${base}/standards`,
    jsonLd: `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org", "@type": "CollectionPage", name: "Buying standards", url: `${base}/standards`,
    })}</script>`,
    bodyHtml: `<div class="std-doc">
  <h1>Buying standards</h1>
  ${p("A buying standard is the set of questions a competent buyer asks in a category, written down, versioned, and executable against a real product page.")}
  ${p("We publish what we cannot test, and why. Every standard states its blocked and advisory entries in full — the questions that matter and that a public product page cannot settle today — alongside the ones that run.")}
  <ul class="std-list">${items || "<li>No standards are published yet.</li>"}</ul>
</div>`,
  };
}

export function renderGrounding(s: PublishedStandard, base: string): SitePage {
  const canonical = `${base}/standards/${s.slug}/${s.publicVersion}/grounding`;
  const rows: string[] = [];
  for (const e of s.doc.entries) {
    const srcs = groundingOf(e);
    if (!srcs.length) continue;
    rows.push(`<section><h2><a href="${esc(entryHref(s, e.id))}"><code>${esc(e.id)}</code></a> — ${esc(e.question)}</h2><ul>${
      srcs.map((x) => `<li>${x.url ? `<a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.source ?? x.url)}</a>` : esc(x.source ?? "")}${x.kind ? ` <span class="std-eg">(${esc(x.kind)})</span>` : ""}${x.establishes ? `<br /><span class="std-why">${esc(x.establishes)}</span>` : ""}</li>`).join("")
    }</ul></section>`);
  }
  return {
    title: `Grounding — ${shortName(s.doc)}`,
    description: `Every external source this standard is grounded in: regulations, certification bodies, and published guidance, with what each establishes.`,
    canonical,
    jsonLd: "",
    bodyHtml: `<div class="std-doc">
  <nav class="std-crumb"><a href="/standards">Standards</a> / <a href="/standards/${esc(s.slug)}/${esc(s.publicVersion)}">${esc(shortName(s.doc))}</a></nav>
  <h1>Grounding</h1>
  ${p("Each entry's requirement is grounded in something outside our own opinion. This page lists every source, and what each one establishes.")}
  ${rows.join("") || p("No grounding sources are recorded.")}
</div>`,
  };
}

// ---- routing ---------------------------------------------------------------

const ENTRY_RE = /^\/standards\/([a-z0-9-]+)\/([0-9.]+)\/([A-Za-z0-9._-]+)\/?$/;
const STD_RE = /^\/standards\/([a-z0-9-]+)\/([0-9.]+)\/?$/;

/** The rendered page for a `/standards*` path, or null when the path is not one. */
export function standardsPageFor(pathname: string, base: string): SitePage | null {
  const list = loadPublishedStandards();
  if (pathname === "/standards" || pathname === "/standards/") return renderStandardsIndex(list, base);

  const std = STD_RE.exec(pathname);
  if (std) {
    const s = findStandard(std[1]!, std[2]!);
    return s ? renderStandard(s, base) : null;
  }
  const ent = ENTRY_RE.exec(pathname);
  if (ent) {
    const s = findStandard(ent[1]!, ent[2]!);
    if (!s) return null;
    const tail = ent[3]!;
    if (tail === "grounding") return renderGrounding(s, base);
    if (tail === "standard.json") return null;   // served as JSON, not HTML
    const e = s.doc.entries.find((x) => x.id === tail);
    return e ? renderEntry(s, e, base) : null;
  }
  return null;
}

/** The raw artifact for `/standards/:slug/:version/standard.json`, or null. */
export function standardJsonFor(pathname: string): { json: string; hash: string } | null {
  const m = ENTRY_RE.exec(pathname);
  if (!m || m[3] !== "standard.json") return null;
  const s = findStandard(m[1]!, m[2]!);
  return s ? { json: s.rawJson, hash: s.hash } : null;
}

// ---- the standalone document shell ----------------------------------------
//
// ⚠️ THESE PAGES ARE NOT SPA ROUTES, AND THE FIRST VERSION SHIPPED THEM AS IF THEY
// WERE. Injecting the rendered body into the SPA's `<div id="root">` — the mechanism
// the Index SSR uses — produced the exact inverse of the goal: a crawler saw the full
// standard and a HUMAN saw "Page not found", because `/standards` matches no route in
// App.tsx and React wipes #root the moment it mounts. The document even kept the
// standard's <title> while its body said 404, so the page contradicted itself.
//
// A standard is a DOCUMENT. It does not need the app, so it does not load the app:
// this is a complete HTML file that links the built stylesheet and nothing else. No
// bundle, no hydration, nothing to wipe it, and it stays readable with JavaScript off
// by construction rather than by luck.
const NAV = [
  ["/", "Home"],
  ["/standards", "Standards"],
  ["/methodology", "Methodology"],
] as const;

export function renderStandaloneDocument(
  page: SitePage,
  opts: { cssHref: string | null; brand: string; base: string },
): string {
  const nav = NAV.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}" />
<link rel="canonical" href="${esc(page.canonical)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="${esc(opts.brand)}" />
<meta property="og:title" content="${esc(page.title)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:url" content="${esc(page.canonical)}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(page.title)}" />
<meta name="twitter:description" content="${esc(page.description)}" />
${opts.cssHref ? `<link rel="stylesheet" href="${esc(opts.cssHref)}" />` : ""}
${page.jsonLd}
</head>
<body>
<div class="std-page">
<nav class="std-crumb">${nav}</nav>
${page.bodyHtml}
<footer class="std-note" style="margin-top:56px;border-top:1px solid var(--border);padding-top:18px">
${esc(opts.brand)} · <a href="${esc(opts.base)}/standards">All standards</a> · <a href="${esc(opts.base)}/llms.txt">llms.txt</a>
</footer>
</div>
</body>
</html>
`;
}

/** Paths a sitemap should carry — every published standard, every entry. */
export function standardsSitemapPaths(): string[] {
  const out = ["/standards"];
  for (const s of loadPublishedStandards()) {
    const b = `/standards/${s.slug}/${s.publicVersion}`;
    out.push(b, `${b}/standard.json`, `${b}/grounding`);
    for (const e of s.doc.entries) out.push(`${b}/${encodeURIComponent(e.id)}`);
  }
  return out;
}

/** `/llms.txt` — a plain-text map for a machine reader that arrives without a crawler. */
export function llmsTxt(base: string): string {
  const lines = [
    `# ${base}`,
    ``,
    `> Versioned buying standards: the questions a competent buyer asks in a category,`,
    `> written as executable tests and run against a store's real product pages.`,
    `> Each requirement reports pass, not proven, or requires store access, with the`,
    `> evidence that decided it. We publish what we cannot test, and why.`,
    ``,
    `## Standards`,
  ];
  for (const s of loadPublishedStandards()) {
    const b = `${base}/standards/${s.slug}/${s.publicVersion}`;
    const counts = tierCounts(s.doc).map(([t, n]) => `${n} ${t}`).join(", ");
    lines.push(`- [${s.doc.title}](${b}): ${s.doc.entries.length} entries (${counts}). Content hash ${s.hash}.`);
    lines.push(`  - [JSON](${b}/standard.json) — the artifact a citation resolves against.`);
    lines.push(`  - [Grounding](${b}/grounding) — every external source, and what it establishes.`);
    const f = s.fitness?.samples ?? [];
    for (const x of f) {
      lines.push(`  - Measured false-positive rate, ${x.label}: ${x.point_estimate_pct.toFixed(2)}% point estimate, ${x.bound_95_cluster_icc02_pct.toFixed(2)}% 95% upper bound (n=${x.pass_rows_audited} pass rows across ${x.stores} stores, cluster-adjusted).`);
    }
  }
  lines.push(``, `## Method`, `- [Methodology](${base}/methodology)`);
  return lines.join("\n") + "\n";
}

export { standardHash };
