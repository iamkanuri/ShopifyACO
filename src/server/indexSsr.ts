// Server-side render of the public AI Visibility Index pages (/index, /index/:slug).
//
// WHY: the viewer is a CSR-only React SPA — the raw HTML body is an empty #root. AI
// crawlers (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot) and Google's first-pass
// indexer do NOT execute JavaScript, so the leaderboards were invisible to search and
// citation-ineligible — while the whole distribution strategy is that these pages get
// cited for "which brands do AI assistants recommend for X". This module renders the
// leaderboard content (brand names, ranks, rates, n=, date, methodology) as static
// HTML + ItemList JSON-LD that the server injects into the served index.html. The
// snapshot sits INSIDE <div id="root">: React 18's createRoot().render() clears the
// container on mount, so the live app replaces it seamlessly (no hydration needed);
// without JS, the content simply stays.
//
// Contract: `title`/`description`/`canonical` are RAW text (the caller escapes at
// injection); `jsonLd`/`bodyHtml` are finished, escaped HTML fragments. Every failure
// path returns null → the caller serves the plain SPA (CSR fallback, never a 500).

import { listCategoryIndexes, getCategoryIndex, type CategoryIndexRow, type IndexEntry } from "../db/supabase.js";
import { getResults } from "./runStore.js";
import { ENV } from "./env.js";

export interface IndexSsr {
  /** Page <title> (raw text — caller escapes). Also used for og:title/twitter:title. */
  title: string;
  /** Meta description (raw text — caller escapes). */
  description: string;
  /** Canonical URL for the page (raw — caller escapes). */
  canonical: string;
  /** Ready-to-insert <script type="application/ld+json"> tag (safe HTML). */
  jsonLd: string;
  /** Static page snapshot to place inside #root (safe HTML). */
  bodyHtml: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (x: number) => `${Math.round(x * 100)}%`;
// UTC-pinned so output doesn't depend on server timezone (tests + Railway agree).
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
// `</script>`-breakout-safe JSON-LD serialization.
const jsonLdTag = (obj: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const andList = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// ---- honest ranking view (KEEP IN SYNC with viewer/src/pages/IndexLeaderboardPage.tsx) ------
// The tail of an AI-recommendation leaderboard reshuffles run-to-run: positions a single recommendation
// apart are noise, not a real order (see the Olipop rerun). Publishing a precise 1..N ranking — or
// crowning a "leader" that's actually tied — overclaims precision the data can't support, and these are
// our most-exposed public pages. So we (1) rank TIE-AWARE (equal recommendation counts share a rank),
// (2) crown a single leader ONLY when it's dominance-gated (alone at the top, recommended 2×+ the
// runner-up, above an event floor), else say "contested/no single favorite", and (3) surface the raw
// recommendation COUNT so a reader sees how close positions are. Everything stays date-stamped.
export interface RankRow { brand: string; mention: number; recommendation: number; count: number | null; rank: number }
export interface RankView { rows: RankRow[]; top: RankRow | null; runnerUp: RankRow | null; topTied: RankRow[]; gated: boolean }
const EPS = 1e-9;
export function rankView(entries: IndexEntry[], n: number | null): RankView {
  const sorted = [...entries].sort((a, b) => b.recommendation - a.recommendation);
  const rows: RankRow[] = sorted.map((e) => ({
    brand: e.brand,
    mention: e.mention,
    recommendation: e.recommendation,
    count: n ? Math.round(e.recommendation * n) : null,
    rank: 1 + sorted.filter((o) => o.recommendation > e.recommendation + EPS).length,
  }));
  const top = rows[0] ?? null;
  const runnerUp = rows.find((r) => r.rank > 1) ?? null; // first STRICTLY-lower brand (not a co-leader)
  const topTied = rows.filter((r) => r.rank === 1);
  // ≥2× the runner-up is n-independent (rate ratio). Event floor: ≥8 events when n is known, else a
  // rate proxy so a sparse scan can't crown a 2-recommendation "leader". Ties at the top never crown.
  const ratioOk = runnerUp ? top!.recommendation >= 2 * runnerUp.recommendation : !!top && top.recommendation > 0;
  const floorOk = n ? (top?.count ?? 0) >= 8 : (top?.recommendation ?? 0) >= 0.18;
  const gated = !!top && topTied.length === 1 && ratioOk && floorOk;
  return { rows, top, runnerUp, topTied, gated };
}

// ---- OG share-card model (same dominance gate as the page) ------------------
// The card content the /og/index/:slug.png renderer draws. Derived through the SAME
// rankView() as the SSR page above, so the image can never crown a brand the page
// doesn't crown — an OG image travels further than the page; it must not out-claim it.

export interface IndexOgModel {
  label: string;
  slug: string;
  gated: boolean;
  /** Plain-text, honesty-gated headline (crown / tied / narrow-lead). */
  headline: string;
  rows: Array<{ rank: number; brand: string; count: number | null; recommendation: number }>;
  n: number | null;
  updatedAt: string | null;
  brandsRanked: number;
}

export function indexOgModel(row: CategoryIndexRow, n: number | null): IndexOgModel | null {
  if (!row.entries?.length) return null;
  const { rows, top, runnerUp, topTied, gated } = rankView(row.entries, n);
  if (!top) return null;
  const recShort = (r: RankRow) => (r.count != null && n ? `${r.count} of ${n}` : pct(r.recommendation));

  let headline: string;
  if (gated) {
    headline = `${top.brand} — the clear AI favorite: recommended in ${recShort(top)} answers, over 2× any other brand`;
  } else if (topTied.length > 1) {
    headline = `No single favorite — ${andList(topTied.map((r) => r.brand))} tied at the top (${recShort(top)} each)`;
  } else {
    headline = `${top.brand} leads (${recShort(top)})${runnerUp ? `, ${runnerUp.brand} close behind (${recShort(runnerUp)})` : ""} — no runaway leader`;
  }

  return {
    label: row.label,
    slug: row.slug,
    gated,
    headline,
    rows: rows.map((r) => ({ rank: r.rank, brand: r.brand, count: r.count, recommendation: r.recommendation })),
    n,
    updatedAt: row.updated_at ?? null,
    brandsRanked: rows.length,
  };
}

/** Load the OG model for a slug (DB + n resolution), or null (unknown slug / DB down). */
export async function loadIndexOgModel(slug: string): Promise<IndexOgModel | null> {
  try {
    const row = await getCategoryIndex(slug);
    if (!row?.entries?.length) return null;
    return indexOgModel(row, await answersN(row));
  } catch {
    return null;
  }
}

// ---- pure renderers (exported for tests) -----------------------------------

export function renderIndexListSsr(rows: CategoryIndexRow[], base: string, brandName: string): IndexSsr | null {
  if (rows.length === 0) return null;
  const title = `AI Visibility Index: Which Brands AI Assistants Recommend — ${brandName}`;
  const description =
    "Category leaderboards of the brands ChatGPT, Gemini & Perplexity actually recommend when shoppers ask what to buy — measured by scan, ranked by recommendation rate.";
  const canonical = `${base}/index`;

  const cards = rows
    .map((r) => {
      const top = r.entries.slice(0, 3);
      const meta = `${r.entries.length} brands ranked${r.updated_at ? ` · scanned ${fmtDate(r.updated_at)}` : ""} · AI recommends most:`;
      const items = top
        .map(
          (e) =>
            `<li><span class="icb-name">${esc(e.brand)}</span> <span class="icb-pct">${pct(e.recommendation)}</span></li>`,
        )
        .join("");
      return (
        `<a href="/index/${esc(r.slug)}" class="index-card card">` +
        `<div class="index-card-label">${esc(r.label)}</div>` +
        `<div class="index-card-meta">${esc(meta)}</div>` +
        `<ol class="index-card-top">${items}</ol>` +
        `<div class="index-card-go">View full leaderboard →</div>` +
        `</a>`
      );
    })
    .join("\n");

  const bodyHtml =
    `<div class="app"><div class="indexpage">` +
    `<div class="index-head"><h1>The AI Visibility Index</h1>` +
    `<p class="index-sub">See which brands AI assistants recommend when shoppers ask what to buy. We tested <b>ChatGPT, Gemini &amp; Perplexity</b> across popular shopping categories — each ranking comes from a single scan, so results are directional. Pick a category for the full leaderboard.</p></div>` +
    `<div class="index-grid">${cards}</div>` +
    `<p class="index-foot muted">${esc(brandName)} · <a href="/scan">Run a free scan for your own brand</a></p>` +
    `</div></div>`;

  const jsonLd = jsonLdTag({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `AI Visibility Index — ${brandName}`,
    description,
    url: canonical,
    numberOfItems: rows.length,
    itemListElement: rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: { "@type": "WebPage", name: `AI Visibility Index: ${r.label}`, url: `${base}/index/${r.slug}` },
    })),
  });

  return { title, description, canonical, jsonLd, bodyHtml };
}

export function renderIndexSlugSsr(row: CategoryIndexRow, base: string, brandName: string, n: number | null): IndexSsr | null {
  if (!row.entries?.length) return null;
  const cat = row.label.toLowerCase();
  const { rows, top, runnerUp, topTied, gated } = rankView(row.entries, n);
  if (!top) return null;
  // "10 of 42 answers (24%)" when the count is known, else "24% of answers" (no redundant re-quote).
  const recPhrase = (r: RankRow) => (r.count != null ? `${r.count} of ${n} answers (${pct(r.recommendation)})` : `${pct(r.recommendation)} of answers`);
  const recShort = (r: RankRow) => (r.count != null ? `${r.count} of ${n}` : pct(r.recommendation));
  const dateNote = row.updated_at ? ` Scanned ${fmtDate(row.updated_at)}.` : "";

  // Severity-selected headline → drives the <h1> insight AND the meta description (the CITABLE string):
  // gated crown / tied-at-top / narrow-lead. Never claim a single leader the data can't support.
  let insight: string;
  let descLead: string;
  if (gated) {
    insight = `<b>${esc(top.brand)}</b> is the clear AI favorite in ${esc(cat)} — recommended in ${recPhrase(top)}, more than 2× any other brand.`;
    descLead = `${top.brand} leads — recommended in ${pct(top.recommendation)} of AI answers, more than 2× any rival`;
  } else if (topTied.length > 1) {
    const names = topTied.map((r) => r.brand);
    insight = `<b>No single favorite.</b> ${esc(andList(names))} are tied at the top of ${esc(cat)} — each recommended in ${recPhrase(top)} in this scan. Positions below shift between scans.`;
    descLead = `no single favorite — ${andList(names)} are tied at the top (${pct(top.recommendation)} each)`;
  } else {
    insight = `<b>${esc(top.brand)}</b> is the most-recommended ${esc(cat)} brand (${recShort(top)})${runnerUp ? `, but ${esc(runnerUp.brand)} (${recShort(runnerUp)}) is close behind — no runaway leader` : ""}.`;
    descLead = `${top.brand} is most-recommended${runnerUp ? `, but ${runnerUp.brand} is close behind — no runaway leader` : ""}`;
  }

  const title = `AI Visibility Index: ${row.label} — ${brandName}`;
  const description =
    `Which ${cat} brands do AI assistants recommend? ${descLead}, across ChatGPT, Gemini & Perplexity.${dateNote} ${rows.length} brands ranked.`;
  const canonical = `${base}/index/${row.slug}`;

  // NO numeric 1..N ladder: the tail reshuffles run-to-run (positions a few recommendations apart flip
  // between scans), so a precise rank overclaims. Instead: only a GATED leader is badged/highlighted;
  // everyone else sits under an "Also recommended" divider, sorted by frequency with the raw COUNT shown
  // so closeness is self-evident. `leadCount` = the top group above the divider (the crown, or the
  // co-leaders in a contested tie).
  const leadCount = gated ? 1 : Math.max(1, topTied.length);
  const dividerNote = "Also recommended — ordered by how often AI named each brand; positions a few recommendations apart can flip between scans.";
  const rowsHtml = rows
    .map((r, i) => {
      // Prefill the scan form with this brand + category + the OTHER top leaderboard brands as
      // competitors (the form requires ≥1), so a merchant clicking their row can run in one click.
      const comps = rows.filter((x) => x.brand !== r.brand).slice(0, 4).map((x) => x.brand);
      const claim =
        `/scan?brand=${encodeURIComponent(r.brand)}&category=${encodeURIComponent(row.label)}` +
        (comps.length ? `&competitors=${encodeURIComponent(comps.join(","))}` : "");
      const recCell = r.count != null ? `${pct(r.recommendation)} <span class="rec-count">${r.count}/${n}</span>` : pct(r.recommendation);
      const isCrown = gated && i === 0;
      const badge = isCrown ? `<span class="lead-badge">★ Leader</span> ` : "";
      const divider =
        i === leadCount && leadCount < rows.length
          ? `<tr class="tail-divider"><td colspan="4">${dividerNote}</td></tr>`
          : "";
      return (
        divider +
        `<tr${isCrown ? ' class="lead"' : ""}>` +
        `<td class="brand">${badge}${esc(r.brand)}</td>` +
        `<td>${pct(r.mention)}</td>` +
        `<td>${recCell}</td>` +
        `<td><a href="${esc(claim)}" class="linkbtn">See your own scan →</a></td></tr>`
      );
    })
    .join("");

  const nNote = n ? ` Each brand was measured across the same n=${n} AI answers.` : "";
  const methodology =
    `Methodology: one multi-brand scan asked ChatGPT (OpenAI), Gemini (Google) and Perplexity the same real shopper prompts for ${cat}.` +
    ` “Recommended” = the assistant explicitly recommends the brand; “Mentioned” = the brand appears in the answer.${nNote}${dateNote}` +
    ` Rates are directional: brands within a few recommendations are effectively tied and their order can shift between scans, so we name a single leader only when it outscores the field more than 2-to-1.`;

  const bodyHtml =
    `<div class="app"><div class="indexpage">` +
    `<div class="index-head"><a href="/index" class="back-link">← All categories</a>` +
    `<h1>AI Visibility Index: ${esc(row.label)}</h1>` +
    `<p class="index-sub">How often <b>ChatGPT, Gemini &amp; Perplexity</b> recommend each ${esc(cat)} brand when shoppers ask what to buy. Ranked by recommendation rate; positions within a few recommendations are effectively tied.</p>` +
    `<div class="index-insight card">${insight}${row.updated_at ? ` <span class="muted">Scanned ${fmtDate(row.updated_at)}.</span>` : ""}</div></div>` +
    `<div class="card cardpad"><table class="index-table">` +
    `<thead><tr><th>Brand</th><th>Mentioned</th><th>Recommended</th><th></th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table></div>` +
    `<p class="index-foot muted">${esc(methodology)}</p>` +
    `<p class="index-foot muted">${esc(brandName)} · <a href="/scan">Is your brand missing? Run a free scan</a>` +
    `${row.run_id ? ` · <a href="/report/${esc(row.run_id)}">See the scan behind this index →</a>` : ""}</p>` +
    `</div></div>`;

  const jsonLd = jsonLdTag({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `AI Visibility Index: ${row.label}`,
    description,
    url: canonical,
    ...(row.updated_at ? { dateModified: row.updated_at } : {}),
    numberOfItems: rows.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    // Tie-aware positions: co-leaders share a position, so the structured data never asserts a strict
    // order the recommendation counts don't support (three brands tied at the top all get position 1).
    itemListElement: rows.map((r) => ({
      "@type": "ListItem",
      position: r.rank,
      name: r.brand,
      item: { "@type": "Brand", name: r.brand },
    })),
  });

  return { title, description, canonical, jsonLd, bodyHtml };
}

// ---- data loading + cache ---------------------------------------------------

/** The leaderboard rate denominator (grounded answers in the run). Newer index builds
 *  persist it on the entries (`n`); older rows fall back to the run's results.json on
 *  the volume. null when neither is available — the page simply omits the n= note. */
async function answersN(row: CategoryIndexRow): Promise<number | null> {
  const stored = row.entries.find((e): e is IndexEntry & { n: number } => typeof e.n === "number" && e.n > 0);
  if (stored) return stored.n;
  if (!row.run_id) return null;
  try {
    const results = (await getResults(row.run_id)) as
      | { analysis?: { leaderboard?: Array<{ mention?: { total?: number } }> } }
      | null;
    const total = results?.analysis?.leaderboard?.[0]?.mention?.total;
    return typeof total === "number" && total > 0 ? total : null;
  } catch {
    return null;
  }
}

// Small TTL cache: this sits on the HTML serving path, and crawlers re-fetch these
// pages — don't hit Supabase (and the results.json volume read for n) per request.
// Misses (unpublished slugs) are cached too so junk crawls can't hammer the DB.
const SSR_TTL_MS = 5 * 60_000;
const ssrCache = new Map<string, { at: number; val: IndexSsr | null }>();

const SLUG_RE = /^\/index\/([a-z0-9-]+)\/?$/;

/** SSR fragments for an Index page path, or null (not an SSR-able path / no data / DB down). */
export async function indexSsrFor(path: string, base: string): Promise<IndexSsr | null> {
  const isList = path === "/index" || path === "/index/";
  const slug = isList ? null : SLUG_RE.exec(path)?.[1];
  if (!isList && !slug) return null;

  const key = `${base}|${isList ? "/index" : `/index/${slug}`}`;
  const hit = ssrCache.get(key);
  if (hit && Date.now() - hit.at < SSR_TTL_MS) return hit.val;

  let val: IndexSsr | null = null;
  try {
    if (isList) {
      val = renderIndexListSsr(await listCategoryIndexes(), base, ENV.publicBrandName);
    } else {
      const row = await getCategoryIndex(slug!);
      if (row?.entries?.length) val = renderIndexSlugSsr(row, base, ENV.publicBrandName, await answersN(row));
    }
  } catch {
    val = null; // DB down / bad row → plain SPA
  }

  if (ssrCache.size > 300) ssrCache.clear(); // unbounded slug space (crawler junk) — cheap cap
  ssrCache.set(key, { at: Date.now(), val });
  return val;
}
