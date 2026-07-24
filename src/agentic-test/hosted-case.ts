import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// ===========================================================================
// STAGE 6.3 — hosted-case bundle (the funnel seam). A pasted wall of text gets
// deleted; a link that renders the merchant's own store name gets opened. Each
// case is served at an UNGUESSABLE token path (/c/<12-char base32>), noindex/
// nofollow, no store name in the URL, no index page, no cross-links. Tracking =
// one unique token per send → page views per token from the host's existing
// analytics (opens). No pixels, no fingerprinting, no PII.
// ===========================================================================

/** base32 (Crockford-ish, lowercase) alphabet — no vowels-only ambiguity issues
 *  for our purposes; 12 chars ≈ 60 bits of entropy → unguessable. */
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export const TOKEN_RE = /^[a-z2-7]{12}$/;

/** A fresh unguessable 12-char token. */
export function newCaseToken(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += B32[bytes[i]! % 32];
  return out;
}

export interface TokenMap {
  /** origin slug → token (stable across re-renders so a SENT link never changes). */
  bySlug: Record<string, string>;
}

/** Load (or start) the persistent slug→token map. Tokens are assigned ONCE and
 *  reused so a link that has already been sent keeps resolving. */
export function loadTokenMap(file: string): TokenMap {
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as TokenMap;
    } catch {
      /* fall through to empty */
    }
  }
  return { bySlug: {} };
}

export function tokenForSlug(map: TokenMap, slug: string): string {
  if (!map.bySlug[slug]) map.bySlug[slug] = newCaseToken();
  return map.bySlug[slug]!;
}

export function saveTokenMap(file: string, map: TokenMap): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(map, null, 2), "utf8");
}

// ---- the restrained CTA (appended to every hosted case; the case IS the pitch) --

/** The ONE CTA. Deliberately restrained + honest: it describes what AisleLens
 *  does (fix / verify against live models / monitor — all shipped) and promises
 *  no ranking or revenue. Contains no store-specific claim and no number, so it
 *  never affects the per-case claim linter. */
export function installCtaHtml(installUrl: string): string {
  return (
    `\n<div class="cta" style="margin-top:2rem;padding-top:1rem;border-top:2px solid #0f766e;font-size:.95rem;color:#334">` +
    `This diagnostic used only your public store data. Fixing it, verifying the fix against live AI models, and monitoring it is what AisleLens does — ` +
    `<a href="${escapeAttr(installUrl)}" style="color:#0f766e;font-weight:600">install AisleLens →</a>.</div>`
  );
}

/** Plain-text CTA sentence for the message/footer. */
export function installCtaText(installUrl: string): string {
  return `Fixing it, verifying the fix against live AI models, and monitoring it is what AisleLens does: ${installUrl}`;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Append the install CTA to a rendered case's HTML (before </body>). */
export function appendCtaToHtml(html: string, installUrl: string): string {
  const cta = installCtaHtml(installUrl);
  return html.includes("</body>") ? html.replace("</body>", `${cta}</body>`) : html + cta;
}

// ---- link-based outreach message (Part B template, ≤120 words) --------------

export interface LinkMessageInput {
  storeName: string;
  competitorName: string;
  storeAppearances: string; // K
  competitorMentions: string; // N
  batteryTotal: string; // e.g. 90
  categoryLabel: string; // "natural deodorant" / "coffee"
  oneLineFinding: string; // evidence-availability finding, no product-truth
  caseUrl: string;
}

/** Subject/opening line from Part B: "[Store] appeared in K of B AI shopping
 *  answers. [Competitor] appeared in N." */
export function linkMessageSubject(m: LinkMessageInput): string {
  return `${m.storeName} appeared in ${m.storeAppearances} of ${m.batteryTotal} AI shopping answers. ${m.competitorName} appeared in ${m.competitorMentions}.`;
}

/** The ≤120-word body (Part B). Personalized, honest, ends with the correction
 *  invitation ("if I got something wrong, I'd like to know"). */
export function linkMessageBody(m: LinkMessageInput): string {
  return [
    `Hi — I run AisleLens, a tool that tests how AI assistants (ChatGPT, Gemini, Perplexity) answer shopping questions.`,
    `I ran ${m.batteryTotal} real buyer questions in ${m.categoryLabel} this week. Your store came up ${m.storeAppearances} times; ${m.competitorName} came up ${m.competitorMentions}.`,
    `The reason is specific and fixable: ${m.oneLineFinding}`,
    `Full diagnostic of your store, built only from your public data: ${m.caseUrl}`,
    `If it's useful, it tells you exactly what to add. If I got something wrong, I'd genuinely like to know that too.`,
  ].join("\n\n");
}

export function linkMessage(m: LinkMessageInput): string {
  return `Subject: ${linkMessageSubject(m)}\n\n${linkMessageBody(m)}`;
}

/** Word count of the BODY (subject excluded) — the ≤120-word target. */
export function bodyWordCount(m: LinkMessageInput): number {
  return linkMessageBody(m).trim().split(/\s+/).filter(Boolean).length;
}

// ---- portable static bundle (out/hosted/) -----------------------------------

export interface HostedEntry {
  token: string;
  /** Absolute path to the rendered case index.html (CTA appended at write). */
  caseHtmlPath: string;
}

/** Write a portable static bundle: c/<token>/index.html per case + noindex
 *  belt-and-suspenders (_headers for Netlify/Cloudflare + robots.txt) + a
 *  README with exact deploy instructions. NO index page, NO cross-links. */
export function writeHostedBundle(
  entries: HostedEntry[],
  hostedDir: string,
  opts: { installUrl: string; hostedBaseUrl: string },
): { written: number } {
  mkdirSync(join(hostedDir, "c"), { recursive: true });
  let written = 0;
  for (const e of entries) {
    if (!TOKEN_RE.test(e.token) || !existsSync(e.caseHtmlPath)) continue;
    const dir = join(hostedDir, "c", e.token);
    mkdirSync(dir, { recursive: true });
    const html = appendCtaToHtml(readFileSync(e.caseHtmlPath, "utf8"), opts.installUrl);
    writeFileSync(join(dir, "index.html"), html, "utf8");
    written++;
  }
  // noindex for the whole bundle (defense in depth; the meta tag is already in each page).
  writeFileSync(join(hostedDir, "robots.txt"), "User-agent: *\nDisallow: /\n", "utf8");
  writeFileSync(join(hostedDir, "_headers"), "/c/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: private, no-store\n", "utf8");
  writeFileSync(join(hostedDir, "README.md"), hostedReadme(opts.hostedBaseUrl, written), "utf8");
  return { written };
}

function hostedReadme(hostedBaseUrl: string, count: number): string {
  return `# Hosted diagnostic cases (${count}) — UNLISTED, NOINDEX

Each case lives at \`/c/<token>/\` (12-char unguessable token, no store name in the
URL). Pages are \`noindex, nofollow\`; there is no index page and no cross-links.
Tracking = page views per token from your host's analytics (= opens). No pixels,
no PII.

## Deploy — pick ONE

### A. Static host (fastest — Netlify / Cloudflare Pages)
Drag this folder into Netlify (or \`wrangler pages deploy .\`). \`_headers\` already
sets \`X-Robots-Tag: noindex, nofollow\`. Your links become:
\`\`\`
${hostedBaseUrl.replace(/\/$/, "")}/c/<token>/
\`\`\`

### B. From the AisleLens app (this repo → Railway)
This repo already serves the case route. On the web service set:
\`\`\`
AGENTIC_INSTRUMENT_TEST_ENABLED=true
HOSTED_CASES_DIR=/data/hosted          # copy this folder there (Railway volume)
AISLELENS_URL=https://lens.thirdocular.com
\`\`\`
Then \`GET /c/<token>\` serves the case with a \`noindex, nofollow\` header. It is
gated by the flag and registered before the SPA catch-all. **Do not enable in
production until you intend the links to be live.**

Links in \`../send-pack/*/message.txt\` already point at your chosen base URL.
`;
}
