import { EXPORT_FORMATS, OPENAI_FIELDS, type ExportFormat } from "./spec.js";
import type { FeedRecord, FeedValue } from "./map.js";

// Pure serializers for the generated feed (Phase 9). Exports CSV/TSV/JSON (all
// officially accepted upload formats) and JSONL (a convenience, line-delimited
// variant — `EXPORT_FORMATS.jsonl.official === false`; submit the JSON array to
// OpenAI). Generating/exporting a file is NOT submitting it.

/** Stable column order: spec field order first, then any extra keys, alphabetized. */
export function columnsFor(records: FeedRecord[]): string[] {
  const present = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (r[k] !== undefined) present.add(k);
  const ordered = OPENAI_FIELDS.map((f) => f.name).filter((n) => present.has(n));
  const extras = [...present].filter((k) => !ordered.includes(k)).sort();
  return [...ordered, ...extras];
}

/** Serialize a single value to a flat cell string (for CSV/TSV). */
function cell(v: FeedValue | undefined): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(",");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** TSV has no standard quoting; neutralize tabs/newlines so columns stay aligned. */
function tsvEscape(s: string): string {
  return s.replace(/[\t\r\n]+/g, " ");
}

export function toCSV(records: FeedRecord[]): string {
  const cols = columnsFor(records);
  const lines = [cols.map(csvEscape).join(",")];
  for (const r of records) lines.push(cols.map((c) => csvEscape(cell(r[c]))).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function toTSV(records: FeedRecord[]): string {
  const cols = columnsFor(records);
  const lines = [cols.map(tsvEscape).join("\t")];
  for (const r of records) lines.push(cols.map((c) => tsvEscape(cell(r[c]))).join("\t"));
  return lines.join("\n") + "\n";
}

/** Drop undefined keys so the JSON is clean (a field is "absent", not null). */
function clean(r: FeedRecord): Record<string, FeedValue> {
  const out: Record<string, FeedValue> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined) out[k] = v;
  return out;
}

export const toJSON = (records: FeedRecord[]): string => JSON.stringify(records.map(clean), null, 2) + "\n";
export const toJSONL = (records: FeedRecord[]): string => records.map((r) => JSON.stringify(clean(r))).join("\n") + (records.length ? "\n" : "");

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "feed";

export interface ExportResult {
  contentType: string;
  filename: string;
  body: string;
  official: boolean;
}

export function exportFeed(records: FeedRecord[], format: ExportFormat, opts: { feedName?: string; version?: number } = {}): ExportResult {
  const meta = EXPORT_FORMATS[format];
  const body =
    format === "csv" ? toCSV(records)
    : format === "tsv" ? toTSV(records)
    : format === "jsonl" ? toJSONL(records)
    : toJSON(records);
  const name = slug(opts.feedName ?? "feed");
  const ver = opts.version != null ? `-v${opts.version}` : "";
  return { contentType: meta.contentType, filename: `${name}${ver}.${meta.ext}`, body, official: meta.official };
}
