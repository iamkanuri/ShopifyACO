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
  stores: number; products_evaluated?: number;
  pass_rows_audited: number; confirmed_false_positives: number; borderline_counted_as_passes?: number;
  point_estimate_pct: number; bound_95_naive_pct?: number; bound_95_cluster_icc02_pct: number;
  rows_per_store?: number; deff_icc02?: number; method: string; source?: string;
  /** Grammar 1.1: the classes behind the confirmed errors, each with its count and an
   *  example, and whether ANY mechanism in the engine addresses it. `false` is the
   *  interesting value and the reason this is published at all. */
  defect_classes?: Array<{ klass: string; count: number; example: string; addressed_by_a_guard?: boolean } | string>;
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

/**
 * The fitness a document carries INSIDE itself (grammar 1.1), rather than beside it.
 *
 * The sidecar rule is not "measurements live outside the document" — it is that a
 * measurement taken AFTER a version is published must not change that version's bytes,
 * because a citation resolves through its hash. v1.0's measurement came after v1.0
 * shipped, so it is a sidecar; v1.1's came before v1.1 existed, so it is in the
 * document. `fitnessOf` below normalises the two into one shape so the renderer never
 * has to know which kind it is looking at.
 */
export interface EmbeddedFitness {
  measured_at: string; engine_version?: string;
  bands_held?: number; bands_total?: number;
  samples: Array<FitnessSample & { defect_classes?: Array<{ klass: string; count: number; example: string; addressed_by_a_guard?: boolean }> }>;
}

/** The measurement to publish for a standard: its sidecar if it has one, otherwise its
 *  own `measured_fitness`. Never invents one — an absent measurement stays absent. */
export function fitnessOf(s: PublishedStandard): FitnessDoc | null {
  if (s.fitness?.samples?.length) return s.fitness;
  const inDoc = (s.doc as { measured_fitness?: EmbeddedFitness }).measured_fitness;
  if (!inDoc?.samples?.length) return null;
  return {
    measured_at: inDoc.measured_at,
    engine_version: inDoc.engine_version,
    samples: inDoc.samples,
    // Per-entry rates live on the entries themselves in grammar 1.1, so there is no
    // separate block to normalise — `measuredOf` reads them directly.
  };
}

/** The measured discrimination for one entry, from wherever this version keeps it. */
export function measuredOf(s: PublishedStandard, e: StandardEntry): EntryDiscrimination | null {
  const inEntry = (e as { measured_discrimination?: { fail_rate_pct: number; asked: number; verdict: string; note?: string; carries_information?: boolean } }).measured_discrimination;
  if (inEntry) {
    return {
      id: e.id, asked: inEntry.asked, fail_pct: inEntry.fail_rate_pct,
      predicted_band: e.predicted_discrimination?.predicted_fail_rate_band,
      verdict: inEntry.verdict, note: inEntry.note,
    };
  }
  return s.fitness?.entry_discrimination?.entries?.find((x) => x.id === e.id) ?? null;
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
  /** The version that replaces this one, when there is one. Set HERE, in the registry —
   *  never inside the artifact, whose bytes are what a citation resolves through. */
  supersededBy?: string;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

/** Every standard that is PUBLISHED. A draft under `standards/` is not published by
 *  existing — it is published by appearing here, so `accessory/v0.1-draft` cannot
 *  leak onto the site because someone added a directory. */
const PUBLISHED: ReadonlyArray<{ slug: string; publicVersion: string; dir: string; supersededBy?: string }> = [
  // ORDER MATTERS: the LAST entry for a slug is the current one. v1.0 keeps serving,
  // byte-for-byte, forever — that is what a content hash promises — and gains only a
  // supersession notice, added by this RENDERER and never by editing the document.
  { slug: "coffee", publicVersion: "1.0", dir: "standards/coffee/v1.0", supersededBy: "1.1" },
  { slug: "coffee", publicVersion: "1.1", dir: "standards/coffee/v1.1" },
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
  <p class="std-status"><strong>Status: ${esc(status.replace(/_/g, " "))}</strong></p>
  ${statement ? p(statement) : ""}
</aside>`;
}

/**
 * The supersession notice, added AT RENDER TIME and never by editing the document.
 *
 * v1.0 keeps serving its original bytes forever — that is what a content hash promises,
 * and every citation already made against it resolves through those bytes. But a reader
 * who lands on it should not have to discover from the version list that a newer one
 * exists, so the notice lives here, in the registry-driven renderer, where it changes
 * nothing that is hashed.
 */
function supersessionHtml(s: PublishedStandard): string {
  if (!s.supersededBy) return "";
  const href = `/standards/${s.slug}/${s.supersededBy}`;
  return `<aside class="std-superseded" role="note">
  <p><strong>Superseded by v${esc(s.supersededBy)}.</strong> This version is served exactly as it was published, byte for byte, because a citation made against it resolves through its content hash. Nothing here has been edited — including the parts it gets wrong about itself, which is what v${esc(s.supersededBy)} corrects. <a href="${esc(href)}">Read v${esc(s.supersededBy)} →</a></p>
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
  const total = s.doc.entries.length;
  return `<section class="std-front" aria-label="Standard front matter">
  <dl class="std-meta">
    <div><dt>Standard</dt><dd>${esc(s.doc.standard_id)}</dd></div>
    <div><dt>Version</dt><dd>${esc(s.doc.version)}</dd></div>
    <div><dt>Status</dt><dd>${esc((s.doc.status ?? "published").replace(/_/g, " "))}</dd></div>
    <div><dt>Content hash</dt><dd><code>${esc(s.hash)}</code></dd></div>
    <div><dt>Entries</dt><dd>${total}</dd></div>
    <div><dt>Independently applied</dt><dd>No</dd></div>
  </dl>
  <p class="std-note"><strong>Independently applied: no.</strong> We wrote this standard and we run it; no third party has applied it to a store. That is a limit on what a pass here is worth, and it is stated because a site about claim discipline cannot make its first unchecked claim about itself.</p>
</section>`;
}

/**
 * THE TABLE OF CONTENTS — the thing whose absence made this document unusable.
 *
 * Before v3.3 a reader met a giant H1, four sentences of self-negation and a metadata
 * card, and then 42 entries with no way to navigate them. The document was legible in
 * the literal sense and unusable in every other. This is a jump table with the tier
 * split visible immediately, above the entries, and it doubles as the split itself —
 * one structure rather than a summary table AND a list that can disagree.
 *
 * No JavaScript: same-page fragment links, which work with the bundle absent and are
 * what a citation like `#ALS-COFFEE-1.1-CERT-002` needs anyway.
 */
function tableOfContents(s: PublishedStandard): string {
  const counts = tierCounts(s.doc);
  const total = s.doc.entries.length;
  const order = ["executable", "not_discriminating", "advisory", "blocked"];
  const ordered = order.filter((t) => counts.some(([k]) => k === t))
    .map((t) => [t, counts.find(([k]) => k === t)![1]] as [string, number]);

  const cards = ordered.map(([t, n]) => `<li class="std-toc-tier std-tier-${esc(t)}">
    <a href="#tier-${esc(t)}"><strong>${n}</strong> <span>${esc(TIER_LABEL[t] ?? t)}</span></a>
    <p>${esc(TIER_WHY[t] ?? "")}</p>
  </li>`).join("");

  const groups = ordered.map(([t]) => {
    const items = s.doc.entries.filter((e) => e.tier === t).map((e) =>
      `<li><a href="#${esc(e.id)}"><code>${esc(e.id.replace(/^ALS-[A-Z]+-[0-9.]+-/, ""))}</code> ${esc(e.question)}</a></li>`).join("");
    return `<div class="std-toc-group"><h3><a href="#tier-${esc(t)}">${esc(TIER_LABEL[t] ?? t)}</a></h3><ol>${items}</ol></div>`;
  }).join("");

  return `<nav class="std-toc" aria-label="Contents">
  <h2 id="contents">What is in here — ${total} entries</h2>
  <ul class="std-toc-tiers">${cards}</ul>
  <p class="std-note">${esc(`${ordered.find(([t]) => t === "executable")?.[1] ?? 0} of ${total} run against a public product page today. The rest are published with the reason each one does not, because the second number is the one you need in order to know what a passing result did not cover.`)}</p>
  <details class="std-toc-all"><summary>Every entry, by tier</summary>${groups}</details>
</nav>`;
}

/** The measured error bounds — the single most checkable thing on the site, and the
 *  one no competitor can copy without first measuring themselves. */
/**
 * MEASURED VERSUS PREDICTED, as a table rather than as prose.
 *
 * Three numbers this document must not run together, because they answer three
 * different questions and the brief that asked for this page ran two of them together:
 *
 *   bands held        — how often the PREDICTION was right (1 of 10)
 *   above band        — how many discriminate LESS than predicted (8 of 10)
 *   carries information — how many MEASURED rates sit inside the grammar's own 15-85%
 *                       target band (4 of 10)
 *
 * "Above its predicted band" and "carries no information" are not the same claim.
 * FORMAT-001 measured 73.7% against a predicted 30-60% — above its band, and still
 * squarely inside the band where an answer discriminates. Every figure below is derived
 * from the artifact; none is typed.
 */
function discriminationTable(s: PublishedStandard): string {
  const rows = s.doc.entries
    .map((e) => ({ e, m: measuredOf(s, e) }))
    .filter((x): x is { e: StandardEntry; m: EntryDiscrimination } => x.m !== null);
  if (!rows.length) return "";

  const inBand = (pct: number) => pct >= 15 && pct <= 85;
  const held = rows.filter((x) => x.m.verdict === "held").length;
  const above = rows.filter((x) => x.m.verdict === "above_band").length;
  const carries = rows.filter((x) => inBand(x.m.fail_pct));

  const body = rows.map(({ e, m }) => `<tr>
    <th scope="row"><a href="#${esc(e.id)}"><code>${esc(e.id.replace(/^ALS-[A-Z]+-[0-9.]+-/, ""))}</code></a></th>
    <td>${m.fail_pct.toFixed(1)}%</td>
    <td>${esc(m.predicted_band ?? "—")}</td>
    <td>${esc((m.verdict ?? "").replace(/_/g, " "))}</td>
    <td>${m.asked}</td>
    <td>${inBand(m.fail_pct) ? "yes" : "no"}</td>
  </tr>`).join("");

  return `<section class="std-discrimination" id="discrimination">
  <h2>Measured against predicted, entry by entry</h2>
  ${p("The bands were written before this standard had ever run. They are kept exactly as authored and shown beside what actually happened, because a document that shows its own hypothesis failing is making a stronger case that its numbers are measured than one whose predictions all came true.")}
  <table class="std-bounds"><caption>Fail rate per entry, over the products each entry was asked</caption>
    <thead><tr>
      <th scope="col">Entry</th><th scope="col">Measured</th><th scope="col">Predicted</th>
      <th scope="col">Verdict</th><th scope="col">Asked</th><th scope="col">Discriminates</th>
    </tr></thead>
    <tbody>${body}</tbody></table>
  <p><strong>${held} of ${rows.length}</strong> predictions held. <strong>${above} of ${rows.length}</strong> came in above their band, which means those entries discriminate <em>less</em> than predicted, not more.</p>
  <p class="std-limit"><strong>Discrimination and conformance are different questions, and only one of them is about whether an entry belongs here.</strong> ${
    esc(`${carries.length} of ${rows.length} entries have a measured fail rate inside the 15-85% band where an answer carries information: ${carries.map((x) => `${x.e.id.replace(/^ALS-[A-Z]+-[0-9.]+-/, "")} at ${x.m.fail_pct.toFixed(1)}%`).join(", ")}.`)
  } The others are failed by almost every store, so they separate nobody from anybody — and they are still legitimate requirements, because whether the page states the thing is still what a buyer needs settled. Nothing is deleted for discriminating poorly.</p>
</section>`;
}

/**
 * The defect classes behind a sample's confirmed errors.
 *
 * ⚠️ TWO SHAPES, AND ASSUMING ONE OF THEM REPRODUCED THE `grounding.sources` DEFECT
 * VERBATIM. v1.0's sidecar stores these as prose STRINGS with the count written into
 * the sentence; grammar 1.1 stores them as objects with `klass`, `count`, `example` and
 * `addressed_by_a_guard`. A renderer written for the object shape read `c.klass` off a
 * string, got `undefined`, and published four table rows reading "undefined" on the
 * v1.0 page — the same failure this file's header already documents for `grounding`,
 * introduced again, one version later, by the same reflex. The blanket
 * "no page renders undefined" assertion is what caught it; nothing else would have.
 *
 * `addressed_by_a_guard: false` is the interesting value in the object shape and the
 * reason the list is published at all: it says out loud that the engine has no
 * mechanism for that class, instead of leaving a reader to assume every known error has
 * been fixed.
 */
function defectClasses(x: FitnessSample): string {
  const cs = x.defect_classes ?? [];
  if (!cs.length) return "";
  const caption = `What the ${esc(x.label.toLowerCase())}'s ${x.confirmed_false_positives} wrong passes actually were`;
  // The prose shape (v1.0's sidecar): a list, because there are no fields to tabulate.
  if (cs.every((c) => typeof c === "string")) {
    return `<div class="std-classes"><h4>${caption}</h4><ul>${(cs as unknown as string[]).map(li).join("")}</ul></div>`;
  }
  type Klass = { klass: string; count: number; example: string; addressed_by_a_guard?: boolean };
  const rows = cs.filter((c): c is Klass => Boolean(c) && typeof c === "object").map((c) => `<tr>
    <th scope="row">${esc(c.klass)}</th><td>${c.count}</td>
    <td><q>${esc(c.example)}</q></td>
    <td>${c.addressed_by_a_guard === false ? "<strong>no</strong>" : c.addressed_by_a_guard === true ? "yes" : "—"}</td>
  </tr>`).join("");
  if (!rows) return "";
  return `<table class="std-bounds"><caption>${caption}</caption>
    <thead><tr><th scope="col">Class</th><th scope="col">n</th><th scope="col">Example</th><th scope="col">Addressed by a guard</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/**
 * THE IDENTIFIER WORKED EXAMPLE — the one defect class a rendered-evidence audit
 * cannot see, shown as three real rows from three real stores.
 *
 * Why it belongs on the BOUND page and nowhere else. The identifiers row renders no
 * quote: it says "Your structured data publishes MPN" and shows the merchant nothing to
 * be suspicious of, so the row looks identical whether the value is a GS1 barcode or a
 * number the store minted about itself. A general sample of 507 rows was read
 * individually and reported ZERO false positives; one mechanical check of this single
 * class found eighteen in the same sample, and correcting them moved a bound this
 * project had published for weeks from 0.83% to 7.80%. That is not a story about a term
 * list — it is a story about what an audit method can and cannot see, which is exactly
 * what a page publishing its own error rate owes a reader.
 *
 * Every value below is read from `fixtures/identifiers/worked-example.json`, extracted
 * from the captured bytes of the three stores. Nothing here is typed.
 */
interface IdentifierRow {
  host: string; url: string; capturedAt: string; value: string;
  fields: string[]; verdict: string; why: string; excerpt: string; byteOffset: number;
  alsoAppearsAs?: string[];
}
interface IdentifierExample {
  requirement: string; why_it_matters: string; source: string;
  honest: IdentifierRow; storeLocal: IdentifierRow[];
}
let identCache: IdentifierExample | null | undefined;
function identifierExample(): IdentifierExample | null {
  if (identCache !== undefined) return identCache;
  try {
    identCache = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "fixtures/identifiers/worked-example.json"), "utf8"),
    ) as IdentifierExample;
  } catch { identCache = null; }   // absent ⇒ the section is absent, never invented
  return identCache;
}

function identifierRowHtml(r: IdentifierRow, honest: boolean): string {
  return `<div class="std-ident-row ${honest ? "std-ident-ok" : "std-ident-bad"}">
  <h4>${esc(r.host)} — <code>${esc(r.value)}</code></h4>
  <p><strong>${esc(honest ? "Honest pass" : "False pass")}:</strong> ${esc(r.why)}</p>
  <pre class="std-ident-bytes"><code>${esc(r.excerpt)}</code></pre>
  <p class="std-note">From the page captured on ${esc(r.capturedAt.slice(0, 10))}, at byte ${r.byteOffset}. Published in: ${
    r.fields.map((f) => `<code>${esc(f)}</code>`).join(", ")}.</p>
</div>`;
}

function identifierSection(): string {
  const ex = identifierExample();
  if (!ex) return "";
  return `<section class="std-ident" id="identifier-example">
  <h2>Worked example: the row that shows you nothing</h2>
  ${p(`“${ex.requirement}” is the one requirement in this standard whose result renders NO QUOTE. It reports that your structured data publishes an identifier; it cannot show you the identifier, so the row reads the same whether the value is a real barcode or a number the store made up about itself.`)}
  ${p(ex.why_it_matters)}
  ${p("Three real stores, all three passing that row, from the captured bytes of their own pages. One of them deserved to.")}
  ${identifierRowHtml(ex.honest, true)}
  ${ex.storeLocal.map((r) => identifierRowHtml(r, false)).join("")}
  <p class="std-limit"><strong>This is why the general figure moved.</strong> An audit that reads rendered evidence — however many rows it reads — is structurally unable to see this class, because there is no rendered evidence to read. The two false passes above sat inside a sample of 507 rows that had been read individually and reported zero errors. One mechanical check against the captured bytes found eighteen.</p>
  <p class="std-note">Record: ${esc(ex.source)}</p>
</section>`;
}

export function renderFitness(s: PublishedStandard): string {
  const f = fitnessOf(s);
  if (!f || !f.samples?.length) {
    return `<section class="std-fitness"><h2>Measured error</h2>${p("This standard has not yet been fitness-measured on a published sample. No bound is stated, because an unmeasured bound would be a guess presented as a number.")}</section>`;
  }
  const rows = f.samples.map((x) => `<tr>
    <th scope="row">${esc(x.label)}</th>
    <td>${x.stores}</td><td>${x.pass_rows_audited}</td><td>${x.confirmed_false_positives}</td>
    <td>${x.point_estimate_pct.toFixed(2)}%</td><td><strong>${x.bound_95_cluster_icc02_pct.toFixed(2)}%</strong></td>
  </tr>`).join("");
  const methods = f.samples.map((x) =>
    `<div class="std-method"><h3>${esc(x.label)} — method</h3>${p(x.method)}${defectClasses(x)}${x.source ? p(`Record: ${x.source}`) : ""}</div>`,
  ).join("");
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
    const items = byTier.get(t)!.map((e) => {
      const m = measuredOf(s, e);
      // ⚠️ PER-ENTRY ANCHORS. A citation is written as "your product pages fail
      // CERT-002", and a reader following it needs to land ON that line, not at the top
      // of a 42-entry page. `id` here is what makes `#ALS-COFFEE-1.1-CERT-002` work.
      const blocked = t === "blocked" && Array.isArray(e.blocked_by) && (e.blocked_by as string[]).length
        ? `<span class="std-eg">blocked by ${esc((e.blocked_by as string[]).join(", "))}${e.blocked_reason ? ` — ${esc(String(e.blocked_reason))}` : ""}</span>`
        : "";
      const rate = m ? `<span class="std-eg">${m.fail_pct.toFixed(1)}% of ${m.asked} products asked did not state it</span>` : "";
      return `<li id="${esc(e.id)}">
        <a href="${esc(entryHref(s, e.id))}"><code>${esc(e.id)}</code> — ${esc(e.question)}</a>
        ${rate}${blocked}
      </li>`;
    }).join("");
    return `<section class="std-tier-group" id="tier-${esc(t)}">
      <h2>${esc(TIER_LABEL[t] ?? t)} <span class="std-eg">(${byTier.get(t)!.length})</span></h2>
      ${p(TIER_WHY[t] ?? "")}
      <ul class="std-entry-list">${items}</ul>
      <p class="std-note"><a href="#contents">Back to contents ↑</a></p>
    </section>`;
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
    // ⚠️ THE H1 IS THE SHORT NAME, AND THE ARTIFACT'S FULL TITLE IS A SUBTITLE.
    // The artifact's `title` is a whole descriptive sentence — "… — buyer questions,
    // assertions and evidence rules for roasted coffee product pages" — which at 30px
    // wrapped to four tight lines and made the top of the page a wall. `shortName`
    // already existed for exactly this reason and was not being used here. The full
    // title is still published, immediately below, so nothing is hidden.
    bodyHtml: `<div class="std-doc">
  <nav class="std-crumb"><a href="/standards">Standards</a></nav>
  <h1>${esc(shortName(s.doc))}</h1>
  <p class="std-subtitle">${esc(s.doc.title)}</p>
  ${supersessionHtml(s)}
  ${postureHtml(s.doc)}
  ${frontMatter(s)}
  <p class="std-note"><a href="${esc(canonical)}/standard.json">The full standard as JSON</a> · <a href="${esc(canonical)}/grounding">Every source this standard is grounded in</a> · <a href="/demo">A real result on a real store</a> · <a href="/methodology">How these are built and measured</a></p>
  ${tableOfContents(s)}
  ${renderFitness(s)}
  ${identifierSection()}
  ${discriminationTable(s)}
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
    const e = s.doc.entries.find((x) => x.id === tail)
      // A PRIOR VERSION'S ID, ASKED OF THIS ONE. The id carries the version, so
      // reissuing renames every entry — and someone holding a v1.0 citation who trims
      // the URL to the current version would otherwise get a 404 for a question that
      // is still right there. `supersedes` is the chain, and this is where it pays.
      ?? s.doc.entries.find((x) => (x as { supersedes?: string }).supersedes === tail);
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
  ["/demo", "Example test"],
  ["/methodology", "Methodology"],
] as const;

/**
 * ⚠️ THE FONTS ARE LOADED BY THE HTML, NOT BY THE STYLESHEET, AND THIS DOCUMENT WAS
 * COPYING ONLY THE STYLESHEET.
 *
 * `viewer/index.html` loads Inter and Space Grotesk with a `<link>`; there is no
 * `@import` or `@font-face` anywhere in `viewer/src/theme.css`. `renderStandaloneDocument`
 * copied the stylesheet href and nothing else — so every published standard page has
 * been rendering `--font-display` all the way down to `-apple-system`/Segoe UI. The
 * pages looked plausible, which is why nobody noticed: a missing webfont degrades to a
 * system font rather than to an error, and the typography was being tuned against a
 * face that was never on the page.
 *
 * Byte-identical to viewer/index.html:13-18. `test/standardsSite.test.ts` asserts the
 * pair, because two copies of a font URL is exactly the shape that drifts.
 */
export const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />`;

export function renderStandaloneDocument(
  page: SitePage,
  opts: { cssHref: string | null; brand: string; base: string; ogImage?: string | null },
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
${opts.ogImage ? `<meta property="og:image" content="${esc(opts.ogImage)}" />` : ""}
<meta name="twitter:card" content="${opts.ogImage ? "summary_large_image" : "summary"}" />
<meta name="twitter:title" content="${esc(page.title)}" />
<meta name="twitter:description" content="${esc(page.description)}" />
${opts.ogImage ? `<meta name="twitter:image" content="${esc(opts.ogImage)}" />` : ""}
${FONT_LINKS}
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
    // `proven`, not `pass` — the product's own result vocabulary, and the exact word
    // the two sites had drifted apart on. See PRODUCT_DESCRIPTION in viewer/src/copy.ts.
    `> written as executable tests and run against a store's real product pages.`,
    `> Each requirement reports proven, not proven, or requires store access, with the`,
    `> evidence that decided it. We publish what we cannot test, and why.`,
    ``,
    `## Standards`,
  ];
  for (const s of loadPublishedStandards()) {
    const b = `${base}/standards/${s.slug}/${s.publicVersion}`;
    const counts = tierCounts(s.doc).map(([t, n]) => `${n} ${t}`).join(", ");
    lines.push(`- [${s.doc.title}](${b}): ${s.doc.entries.length} entries (${counts}). Content hash ${s.hash}.`);
    // A machine reader has to be told which version is current, or it cites the first
    // one it finds. This is the same fact the HTML page states in a notice.
    if (s.supersededBy) {
      lines.push(`  - SUPERSEDED by v${s.supersededBy} (${base}/standards/${s.slug}/${s.supersededBy}). Served unchanged so existing citations resolve; do not cite it for new work.`);
    }
    lines.push(`  - [JSON](${b}/standard.json) — the artifact a citation resolves against.`);
    lines.push(`  - [Grounding](${b}/grounding) — every external source, and what it establishes.`);
    // ⚠️ `fitnessOf`, NOT `s.fitness`. The THIRD place in this session where reading
    // one of the two fitness shapes silently produced the wrong answer — and the worst
    // of the three, because the failure was inverted: llms.txt advertised the SUPERSEDED
    // version as measured and the CURRENT one as having no published error rate at all,
    // to exactly the machine readers this file exists for.
    for (const x of fitnessOf(s)?.samples ?? []) {
      lines.push(`  - Measured false-positive rate, ${x.label}: ${x.point_estimate_pct.toFixed(2)}% point estimate, ${x.bound_95_cluster_icc02_pct.toFixed(2)}% 95% upper bound (n=${x.pass_rows_audited} pass rows across ${x.stores} stores, cluster-adjusted)${x.is_floor ? " — a FLOOR: only one defect class was re-checked, so the true rate is at least this" : ""}.`);
    }
  }
  lines.push(``, `## A worked result`, `- [An Example test on a real store](${base}/demo) — a published standard executed against a real coffee product page, every requirement with the evidence sentence and the surface it was read from.`);
  lines.push(``, `## Method`, `- [Methodology](${base}/methodology)`);
  return lines.join("\n") + "\n";
}

export { standardHash };
