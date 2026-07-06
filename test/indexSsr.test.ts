import { test } from "node:test";
import assert from "node:assert/strict";
import { renderIndexListSsr, renderIndexSlugSsr, rankView } from "../src/server/indexSsr.js";
import type { CategoryIndexRow } from "../src/db/supabase.js";

// The Index pages are the distribution engine, and AI crawlers / first-pass search indexers don't
// execute JS — so the leaderboard content MUST exist in the raw HTML the server sends. AND it must be
// HONEST: a #1 is crowned only when dominance-gated (alone at the top, 2×+ the runner-up, above an
// event floor); otherwise the page says "contested/tied", and ranks are tie-aware with visible counts,
// so the page never implies a precise order the run-to-run noise contradicts. These tests pin that.

const BASE = "https://lens.example.com";
const BRAND = "AisleLens";

// A genuinely DOMINANT category (real shape: EltaMD 14/45, next 4/45 → 3.5×). → gated crown.
const dominant: CategoryIndexRow = {
  slug: "mineral-sunscreen",
  label: "Mineral Sunscreen",
  run_id: "20260610-120000-aaaaaaaaaaaaaaaaaaaa",
  updated_at: "2026-06-25T12:00:00.000Z",
  entries: [
    { brand: "EltaMD", rank: 1, mention: 0.47, recommendation: 0.31 },
    { brand: "Blue Lizard", rank: 2, mention: 0.47, recommendation: 0.089 },
    { brand: "Supergoop", rank: 3, mention: 0.36, recommendation: 0.044 },
  ],
};

// A TIED category (real shape: robot vacuums — top 3 all 10/42; tail one event apart). → contested.
const tied: CategoryIndexRow = {
  slug: "robot-vacuums",
  label: "Robot Vacuums",
  run_id: "20260619-000000-bbbbbbbbbbbbbbbbbbbb",
  updated_at: "2026-06-19T15:38:49.832Z",
  entries: [
    { brand: "Roborock", rank: 1, mention: 0.738, recommendation: 0.238 },
    { brand: "Dreame", rank: 2, mention: 0.452, recommendation: 0.238 },
    { brand: "iRobot Roomba", rank: 3, mention: 0.381, recommendation: 0.238 },
    { brand: "Eufy", rank: 4, mention: 0.548, recommendation: 0.0952 },
    { brand: "Shark", rank: 5, mention: 0.452, recommendation: 0.0476 },
    { brand: "Ecovacs", rank: 6, mention: 0.5, recommendation: 0.0238 },
  ],
};

function extractJsonLd(tag: string): Record<string, unknown> {
  const m = tag.match(/^<script type="application\/ld\+json">(.*)<\/script>$/s);
  assert.ok(m, "jsonLd is a single <script type=application/ld+json> tag");
  return JSON.parse(m![1]!) as Record<string, unknown>;
}

test("rankView: tie-aware ranks + dominance gate (unit)", () => {
  const g = rankView(dominant.entries, 45);
  assert.equal(g.gated, true, "EltaMD 14 vs 4 (3.5×) → gated");
  assert.deepEqual(g.rows.map((r) => [r.rank, r.count]), [[1, 14], [2, 4], [3, 2]]);

  const c = rankView(tied.entries, 42);
  assert.equal(c.gated, false, "3-way tie at the top → never crowned");
  assert.equal(c.topTied.length, 3, "three brands share rank 1");
  assert.deepEqual(c.rows.map((r) => r.rank), [1, 1, 1, 4, 5, 6], "tie-aware competition ranking");
  assert.deepEqual(c.rows.map((r) => r.count), [10, 10, 10, 4, 2, 1], "raw counts surface closeness");
});

test("slug SSR (dominant): GATED crown badged + counts, tail under 'Also recommended', NO rank ladder", () => {
  const ssr = renderIndexSlugSsr(dominant, BASE, BRAND, 45);
  assert.ok(ssr);
  for (const e of dominant.entries) assert.ok(ssr!.bodyHtml.includes(e.brand), `${e.brand} in body`);
  // Gated crown copy + the crowned row badged/highlighted, with the raw count visible.
  assert.ok(ssr!.bodyHtml.includes("clear AI favorite"), "gated crown headline");
  assert.match(
    ssr!.bodyHtml,
    /<tr class="lead"><td class="brand"><span class="lead-badge">★ Leader<\/span> EltaMD<\/td><td>47%<\/td><td>31% <span class="rec-count">14\/45<\/span><\/td>/,
    "crown row: badge + count, no rank number",
  );
  // The tail is grouped under "Also recommended" — NOT a numeric 1..N ladder.
  assert.ok(!ssr!.bodyHtml.includes('class="rank"'), "no numeric rank ladder anywhere");
  assert.ok(ssr!.bodyHtml.includes("Also recommended"), "tail sits under an also-recommended divider");
  // Honest denominator + date + directional caveat + gate rule.
  assert.ok(ssr!.bodyHtml.includes("n=45"), "n= denominator cited");
  assert.ok(ssr!.bodyHtml.includes("Jun 25, 2026"), "scan date rendered (UTC-pinned)");
  assert.ok(ssr!.bodyHtml.includes("directional"), "directional caveat present");
  assert.ok(ssr!.bodyHtml.includes("2-to-1"), "gate rule disclosed in methodology");
  // Funnel links survive on every brand (incl. the tail — the loser-outreach hook).
  assert.ok(ssr!.bodyHtml.includes("/scan?brand=EltaMD&amp;category=Mineral%20Sunscreen"), "claim link prefilled");
  assert.ok(ssr!.bodyHtml.includes("/scan?brand=Supergoop&amp;category=Mineral%20Sunscreen"), "tail brand also claimable");
  assert.ok(ssr!.bodyHtml.includes(`/report/${dominant.run_id}`), "source-run link present");
  // The CITABLE meta description names the leader honestly (only because it's gated).
  assert.ok(ssr!.description.includes("EltaMD leads") && ssr!.description.includes("2×"), "description: gated leader");
  assert.equal(ssr!.canonical, `${BASE}/index/mineral-sunscreen`);
});

test("slug SSR (tied): NO crown, NO badge, NO rank ladder — counts + 'Also recommended' tell the story", () => {
  const ssr = renderIndexSlugSsr(tied, BASE, BRAND, 42);
  assert.ok(ssr);
  // Contested headline names the tied set — never "X leads".
  assert.ok(ssr!.bodyHtml.includes("No single favorite"), "contested headline");
  assert.ok(ssr!.bodyHtml.includes("Roborock, Dreame and iRobot Roomba are tied"), "names the tied top");
  assert.ok(!/\bleads\b/.test(ssr!.description), "description must NOT claim a leader");
  assert.ok(ssr!.description.includes("no single favorite"), "description: honest contested");
  // Every brand present, but with NO numeric rank ladder and NO crown.
  for (const e of tied.entries) assert.match(ssr!.bodyHtml, new RegExp(`<td class="brand">${e.brand}</td>`), `${e.brand} row`);
  assert.ok(!ssr!.bodyHtml.includes('class="rank"'), "no numeric rank ladder");
  assert.ok(!ssr!.bodyHtml.includes("lead-badge"), "no leader badge when contested");
  assert.ok(!ssr!.bodyHtml.includes('class="lead"'), "no crowned row when contested");
  assert.ok(ssr!.bodyHtml.includes("Also recommended"), "tail under an also-recommended divider");
  // Counts make the tail closeness visible (Shark 2 vs Ecovacs 1 — one event apart).
  assert.ok(ssr!.bodyHtml.includes("10/42") && ssr!.bodyHtml.includes("2/42") && ssr!.bodyHtml.includes("1/42"), "raw counts shown");
});

test("slug SSR: n unknown → no n=/counts fabricated, gate still honest", () => {
  const ssr = renderIndexSlugSsr(tied, BASE, BRAND, null);
  assert.ok(ssr);
  assert.ok(!/n=\d/.test(ssr!.bodyHtml), "no n=<number> denominator without a real one"); // (not the false 'n=' in colspan)
  assert.ok(!ssr!.bodyHtml.includes('class="rec-count"'), "no count chips without n");
  assert.ok(ssr!.bodyHtml.includes("No single favorite"), "tie still detected from rates alone");
  assert.ok(ssr!.bodyHtml.includes("directional"), "caveat still present");
});

test("slug SSR: JSON-LD positions are TIE-AWARE (co-leaders share position 1)", () => {
  const ssr = renderIndexSlugSsr(tied, BASE, BRAND, 42);
  const ld = extractJsonLd(ssr!.jsonLd);
  assert.equal(ld["@type"], "ItemList");
  assert.equal(ld.numberOfItems, 6);
  assert.equal(ld.dateModified, tied.updated_at);
  const items = ld.itemListElement as Array<{ position: number; name: string; item: { "@type": string; name: string } }>;
  assert.deepEqual(
    items.map((i) => [i.position, i.name]),
    [[1, "Roborock"], [1, "Dreame"], [1, "iRobot Roomba"], [4, "Eufy"], [5, "Shark"], [6, "Ecovacs"]],
    "structured data never asserts a strict order the tie contradicts",
  );
  assert.equal(items[0]!.item["@type"], "Brand");
});

test("slug SSR: brand names are HTML-escaped and cannot break out of the JSON-LD script", () => {
  const hostile: CategoryIndexRow = {
    slug: "test-cat",
    label: 'Pots & "Pans"',
    entries: [{ brand: '</script><b>Evil & Co', rank: 1, mention: 0.5, recommendation: 0.5 }],
  };
  const ssr = renderIndexSlugSsr(hostile, BASE, BRAND, null);
  assert.ok(ssr);
  assert.ok(!ssr!.bodyHtml.includes("</script><b>"), "brand HTML-escaped in body");
  assert.ok(ssr!.bodyHtml.includes("&lt;/script&gt;"), "escaped form present");
  assert.ok(!ssr!.jsonLd.slice("<script".length).includes("</script><"), "no early script terminator");
  const ld = extractJsonLd(ssr!.jsonLd);
  const items = ld.itemListElement as Array<{ name: string }>;
  assert.equal(items[0]!.name, '</script><b>Evil & Co');
});

test("slug SSR: empty entries → null (CSR fallback, never an empty shell)", () => {
  assert.equal(renderIndexSlugSsr({ slug: "x", label: "X", entries: [] }, BASE, BRAND, null), null);
});

test("list SSR: one card per category with top-3 brands, link, and ItemList of pages", () => {
  const rows: CategoryIndexRow[] = [
    dominant,
    {
      slug: "olive-oil",
      label: "Olive Oil",
      updated_at: "2026-06-20T00:00:00.000Z",
      entries: [
        { brand: "Graza", rank: 1, mention: 0.6, recommendation: 0.4 },
        { brand: "Brightland", rank: 2, mention: 0.5, recommendation: 0.2 },
        { brand: "California Olive Ranch", rank: 3, mention: 0.4, recommendation: 0.1 },
        { brand: "Fourth Brand", rank: 4, mention: 0.1, recommendation: 0.05 },
      ],
    },
  ];
  const ssr = renderIndexListSsr(rows, BASE, BRAND);
  assert.ok(ssr);
  assert.ok(ssr!.bodyHtml.includes('href="/index/mineral-sunscreen"'));
  assert.ok(ssr!.bodyHtml.includes('href="/index/olive-oil"'));
  assert.ok(ssr!.bodyHtml.includes("Graza") && ssr!.bodyHtml.includes("Brightland"));
  assert.ok(!ssr!.bodyHtml.includes("Fourth Brand"), "list cards show top 3 only");
  assert.ok(ssr!.bodyHtml.includes("3 brands ranked") && ssr!.bodyHtml.includes("4 brands ranked"));
  const ld = extractJsonLd(ssr!.jsonLd);
  assert.equal(ld["@type"], "ItemList");
  const items = ld.itemListElement as Array<{ item: { url: string } }>;
  assert.deepEqual(
    items.map((i) => i.item.url),
    [`${BASE}/index/mineral-sunscreen`, `${BASE}/index/olive-oil`],
  );
  assert.equal(ssr!.canonical, `${BASE}/index`);
});

test("list SSR: no published categories → null (CSR fallback)", () => {
  assert.equal(renderIndexListSsr([], BASE, BRAND), null);
});
