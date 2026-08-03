// v4.5 A2 — THE MECHANICAL A/B, QUOTE-LEVEL.
//
// Diffs p19_base.jsonl against p19_fix.jsonl row by row. Three rules this repo paid for:
//
//   1. COMPARE THE QUOTE, NOT THE STATUS. v3.5 shipped two regressions that a status diff
//      could not see: `pass_evidenced` before and after, with a different rendered
//      sentence underneath. A pass count, a status comparison and a merchant reading a
//      green row are all blind to that.
//   2. JOIN ON (host, label). A join that finds nothing looks exactly like a change that
//      moved nothing, so the joined-row count is asserted, not assumed.
//   3. TWO-SIDED CANARY, COMPUTED FROM THE DATA. The diff must observe both rows that
//      changed and rows that did not. If everything changed, the fix is not scoped; if
//      nothing did, the two files may be the same run twice.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (f) => fs.readFileSync(path.join(here, "out", f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const base = read("p19_base.jsonl");
const fix = read("p19_fix.jsonl");

const byHost = (rows) => new Map(rows.map((r) => [r.key ?? r.host, r]));
const B = byHost(base), F = byHost(fix);

const changes = { status: [], quote: [], both: [], appeared: [], disappeared: [] };
let joinedRows = 0, unchangedRows = 0, hostsCompared = 0;

for (const [host, b] of B) {
  const f = F.get(host);
  if (!f) continue;
  hostsCompared++;
  const bRows = new Map((b.rows ?? []).map((r) => [r.label, r]));
  const fRows = new Map((f.rows ?? []).map((r) => [r.label, r]));
  for (const [label, br] of bRows) {
    const fr = fRows.get(label);
    if (!fr) { changes.disappeared.push({ host, label, was: { status: br.status, detail: br.detail } }); continue; }
    joinedRows++;
    const sDiff = br.status !== fr.status;
    const dDiff = (br.detail ?? null) !== (fr.detail ?? null);
    const rec = { host, corpus: b.corpus, label, before: { status: br.status, detail: br.detail }, after: { status: fr.status, detail: fr.detail } };
    if (sDiff && dDiff) changes.both.push(rec);
    else if (sDiff) changes.status.push(rec);
    else if (dDiff) changes.quote.push(rec);
    else unchangedRows++;
  }
  for (const [label, fr] of fRows) if (!bRows.has(label)) changes.appeared.push({ host, label, now: { status: fr.status, detail: fr.detail } });
}

// Which requirement kinds moved? A price fix that moves a non-price row is out of scope.
const kindOf = (label) => (/^Price under \$/i.test(label) ? "price_under" : "other");
const moved = [...changes.both, ...changes.status, ...changes.quote];
const byKind = moved.reduce((m, c) => ((m[kindOf(c.label)] = (m[kindOf(c.label)] ?? 0) + 1), m), {});
const otherKind = moved.filter((c) => kindOf(c.label) === "other");

// Rows that appeared/disappeared are label-keyed, so a CAP CHANGE shows up as a pair
// ("Price under $35" gone, "Price under $25" new) rather than as an edit. Pair them.
const capMoves = [];
for (const d of changes.disappeared) {
  if (kindOf(d.label) !== "price_under") continue;
  const a = changes.appeared.find((x) => x.host === d.host && kindOf(x.label) === "price_under");
  if (a) capMoves.push({ host: d.host, from: d.label, to: a.label, was: d.was, now: a.now });
}

// ⚠️ THE FIRST CANARY HERE WAS WRONG AND SAID SO, WHICH IS THE POINT. It counted only
// EDITED rows (same label, different status/detail) and reported `rows_changed: 0` over a
// change that demonstrably moves rows. The reason is structural: the price row's label
// EMBEDS its cap (`Price under $30`), and `niceCap` derives that cap from the very number
// this fix corrects — so a corrected price does not edit a row, it retires one label and
// creates another. A label-keyed diff sees a disappearance and an appearance, never an
// edit. Counting only edits would have reported "nothing changed" for a fix that changed
// 13 rows, which is the flattering-zero shape this repo tracks. The observable set is
// edits + cap-move pairs + dropped rows.
const observedChanges = moved.length + capMoves.length + (changes.disappeared.length - capMoves.length);
const canaryLive = observedChanges > 0 && unchangedRows > 0;
const out = {
  completion: !canaryLive ? "INCOMPLETE" : "DEFECTS_FOUND",
  reasons: canaryLive ? [] : ["A/B canary collapsed: the diff must see both changed and unchanged rows"],
  canary: { rows_edited: moved.length, cap_move_pairs: capMoves.length, rows_dropped: changes.disappeared.length - capMoves.length, rows_unchanged: unchangedRows, observed_changes: observedChanges, live: canaryLive },
  dropped_rows_by_kind: changes.disappeared.reduce((m, d) => ((m[kindOf(d.label)] = (m[kindOf(d.label)] ?? 0) + 1), m), {}),
  hosts_compared: hostsCompared,
  joined_rows: joinedRows,
  changed_by_kind: byKind,
  status_only: changes.status.length,
  quote_only: changes.quote.length,
  status_and_quote: changes.both.length,
  rows_appeared: changes.appeared.length,
  rows_disappeared: changes.disappeared.length,
  cap_moves: capMoves,
  OTHER_KIND_CHANGES: otherKind,
  detail: { both: changes.both, status: changes.status, quote: changes.quote, appeared: changes.appeared, disappeared: changes.disappeared },
};
fs.writeFileSync(path.join(here, "out", "p19_ab.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, detail: undefined }, null, 2));
