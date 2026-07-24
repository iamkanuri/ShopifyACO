import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunContext } from "./stage5-run.js";
import { slug } from "./stage5-run.js";
import { categoryByKey } from "./categories/registry.js";
import { oneLineFinding, lintProse } from "./stage5-case.js";
import {
  loadTokenMap, tokenForSlug, saveTokenMap, linkMessage, linkMessageBody, bodyWordCount,
  writeHostedBundle, type HostedEntry, type LinkMessageInput,
} from "./hosted-case.js";

// ===========================================================================
// STAGE 6.4 — assemble the SEND PACK (the thing the human actually sends). For
// every rendered case across BOTH categories: a stable unguessable token, its
// hosted URL, a ≤120-word link-based message (Part B, real numbers + one-line
// finding), the store's public contact URL, severity, and the finding. Plus the
// portable hosted bundle (out/hosted/) and a send-log-template.csv. Every one-
// line finding and message body is prose-linted (no overselling past the case
// linter's honesty). Nothing is sent here.
// ===========================================================================

const STAGE6_OUT = join(process.cwd(), "experiments", "stage6", "out");
const SEND_PACK = join(STAGE6_OUT, "send-pack");
const HOSTED = join(STAGE6_OUT, "hosted");
const TOKENS = join(STAGE6_OUT, "tokens.json");

const HOSTED_BASE_URL = (process.env.HOSTED_BASE_URL ?? "https://lens.thirdocular.com").replace(/\/$/, "");
const AISLELENS_URL = process.env.AISLELENS_URL ?? "https://lens.thirdocular.com";
/** Cap gaps named in the message so multi-gap coffee stays ≤120 words. */
const MESSAGE_GAP_CAP = 2;

export interface PackItem {
  category: string;
  storeName: string;
  slug: string;
  origin: string;
  severity: number;
  token: string;
  hostedUrl: string;
  contactUrl: string;
  oneLineFinding: string;
  genuineGaps: string[];
  storeAppearances: number;
  competitorName: string;
  competitorMentions: number;
  batteryTotal: number;
  messageBodyWords: number;
}

const norm = (u: string): string => (u ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();

const csvCell = (s: string | number): string => {
  const v = String(s);
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function buildSendPack(categoryKeys: string[] = ["deodorant", "coffee"]): { items: PackItem[]; hostedWritten: number } {
  // Rebuild from scratch so a dropped prospect (e.g. a store that lost its only
  // valid name) leaves NO stale dir. tokens.json lives OUTSIDE these dirs, so
  // already-assigned tokens stay stable across rebuilds.
  rmSync(SEND_PACK, { recursive: true, force: true });
  rmSync(HOSTED, { recursive: true, force: true });
  mkdirSync(SEND_PACK, { recursive: true });
  const tokenMap = loadTokenMap(TOKENS);
  const items: PackItem[] = [];
  const hostedEntries: HostedEntry[] = [];

  for (const key of categoryKeys) {
    const desc = categoryByKey(key);
    const ctxPath = join(desc.outDir, "run-context.json");
    if (!existsSync(ctxPath)) {
      console.log(`[send-pack] no run-context for ${key} — skip`);
      continue;
    }
    const rc = JSON.parse(readFileSync(ctxPath, "utf8")) as RunContext;
    const sorted = [...rc.diagnostics].sort((a, b) => b.severity - a.severity);
    const winnerOrigin = norm(rc.competitor.origin);
    const seenOrigins = new Set<string>();
    for (const d of sorted) {
      // Never send the category LEADER its own "you have gaps" case, and never
      // send the same store twice (brand extraction can surface one domain under
      // two name variants — a brand name and a slight paraphrase of it).
      if (norm(d.origin) === winnerOrigin) continue;
      if (seenOrigins.has(norm(d.origin))) continue;
      seenOrigins.add(norm(d.origin));
      const s = slug(d.origin);
      const caseHtml = join(desc.outDir, "cases", s, "index.html");
      if (!existsSync(caseHtml)) continue; // only rendered (linter-passing) cases ship

      const gaps = d.findings.filter((f) => f.genuineEvidenceGap).map((f) => f.attribute);
      if (gaps.length === 0) continue;
      const finding = oneLineFinding(gaps, MESSAGE_GAP_CAP);
      const token = tokenForSlug(tokenMap, `${key}:${s}`);
      const hostedUrl = `${HOSTED_BASE_URL}/c/${token}/`;
      const msgIn: LinkMessageInput = {
        storeName: d.brand,
        competitorName: rc.competitor.brand,
        storeAppearances: String(d.battery.brandMentions),
        competitorMentions: String(rc.competitor.mentions),
        batteryTotal: String(rc.batteryTotal),
        categoryLabel: desc.label,
        oneLineFinding: finding,
        caseUrl: hostedUrl,
      };
      // Honesty gate on the SENT copy (finding + full body) — never oversell.
      const proseLint = lintProse(`${finding}\n${linkMessageBody(msgIn)}`);
      if (!proseLint.ok) {
        console.log(`[send-pack] message BLOCKED for ${d.brand}: ${proseLint.violations.map((v) => v.pattern).join(", ")}`);
        continue;
      }
      const words = bodyWordCount(msgIn);
      if (words > 120) console.log(`[send-pack] WARN ${d.brand} message body ${words} words (>120)`);

      const dir = join(SEND_PACK, `${key}-${s}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "message.txt"), linkMessage(msgIn), "utf8");
      const item: PackItem = {
        category: key, storeName: d.brand, slug: s, origin: d.origin, severity: d.severity, token, hostedUrl,
        contactUrl: `${d.origin.replace(/\/$/, "")}/pages/contact`, oneLineFinding: finding, genuineGaps: gaps,
        storeAppearances: d.battery.brandMentions, competitorName: rc.competitor.brand, competitorMentions: rc.competitor.mentions,
        batteryTotal: rc.batteryTotal, messageBodyWords: words,
      };
      writeFileSync(join(dir, "meta.json"), JSON.stringify(item, null, 2), "utf8");
      hostedEntries.push({ token, caseHtmlPath: caseHtml });
      items.push(item);
    }
  }

  const { written } = writeHostedBundle(hostedEntries, HOSTED, { installUrl: AISLELENS_URL, hostedBaseUrl: HOSTED_BASE_URL });
  saveTokenMap(TOKENS, tokenMap);

  // send-log-template.csv (prospect, category, channel used, date sent, opened?, replied?, reply summary).
  const header = ["prospect", "category", "hosted_url", "severity", "channel_used", "date_sent", "opened", "replied", "reply_summary"];
  const rows = items.map((i) => [i.storeName, i.category, i.hostedUrl, i.severity, "", "", "", "", ""].map(csvCell).join(","));
  writeFileSync(join(SEND_PACK, "send-log-template.csv"), [header.join(","), ...rows].join("\n") + "\n", "utf8");

  writeFileSync(
    join(SEND_PACK, "index.json"),
    JSON.stringify({ generatedFrom: categoryKeys, hostedBaseUrl: HOSTED_BASE_URL, installUrl: AISLELENS_URL, count: items.length, items }, null, 2),
    "utf8",
  );
  console.log(`[send-pack] ${items.length} prospects across ${categoryKeys.filter((k) => existsSync(join(categoryByKey(k).outDir, "run-context.json"))).length} categories; hosted bundle ${written} pages → ${SEND_PACK}`);
  return { items, hostedWritten: written };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/send-pack.ts");
if (isMain) {
  const keys = process.argv.slice(2).filter(Boolean);
  buildSendPack(keys.length ? keys : ["deodorant", "coffee"]);
}
