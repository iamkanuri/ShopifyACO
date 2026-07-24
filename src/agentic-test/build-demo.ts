import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { buildClaims, renderCase, type Claim } from "./case-render.js";

// ===========================================================================
// GATE 3 — demo package builder (Part A). Hydrates the case with the REAL
// competitor name (from the gitignored meta) and writes ONLY into the
// gitignored demo directory. The name-safety guard (test 44) refuses to write
// any real-name-bearing file anywhere else. No new capability; $0 spend.
// ===========================================================================

const DEMO_DIR = join(process.cwd(), "experiments", "agentic-stage4", "demo");
const META = join(process.cwd(), "experiments", "agentic-stage3", "probes", "competitors-meta.json");

/** Test-44 guard: a file whose content contains the real competitor name may
 *  ONLY be written inside the gitignored demo directory. */
export function assertDemoWriteSafe(filePath: string, content: string, realName: string, demoDir: string = DEMO_DIR): void {
  if (!realName) return;
  const inDemo = resolve(filePath).toLowerCase().startsWith(resolve(demoDir).toLowerCase() + sep);
  if (!inDemo && content.toLowerCase().includes(realName.toLowerCase())) {
    throw new Error(
      `DEMO NAME GUARD: refusing to write "${filePath}" — it contains the real competitor name outside the gitignored demo directory`,
    );
  }
}

function guardedWrite(filePath: string, content: string, realName: string): void {
  assertDemoWriteSafe(filePath, content, realName);
  writeFileSync(filePath, content, "utf8");
}

const DEMO_BANNER =
  "Built and verified end-to-end on our demonstration store. Approval and confirmation checkpoints are shown exactly as they work in production; in this verified run they were executed automatically.";

const DEMO_CSS = `
:root{--ink:#1a2330;--muted:#5b6673;--accent:#0f766e;--rule:#e5e9ee;--soft:#f6f8fa}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;color:var(--ink);
  margin:0;padding:0;background:#fff;line-height:1.6;-webkit-text-size-adjust:100%}
main{max-width:680px;margin:0 auto;padding:24px 20px 64px}
h1{font-size:1.5rem;line-height:1.25;margin:.4em 0 .5em;letter-spacing:-.01em}
h2{font-size:.95rem;text-transform:none;color:var(--accent);margin:2.1em 0 .45em;
  padding-top:1.1em;border-top:1px solid var(--rule)}
p,li{font-size:1rem;color:var(--ink)}
b{font-variant-numeric:tabular-nums}
ul{padding-left:1.2em}
blockquote{border-left:3px solid var(--accent);margin:.8em 0;padding:.4em 0 .4em .9em;
  color:var(--muted);font-style:italic;background:var(--soft);border-radius:0 6px 6px 0}
code{background:var(--soft);padding:.12em .4em;border-radius:4px;font-size:.9em}
.disclosure{background:#fffbe8;border:1px solid #f2e2a0;padding:.7rem .9rem;border-radius:8px;
  font-size:.88rem;color:#5c4d0d}
i{color:var(--muted)}
@media (max-width:480px){main{padding:16px 14px 48px}h1{font-size:1.28rem}}
@media print{
  body{background:#fff}
  main{max-width:100%;padding:0}
  h2{break-after:avoid;page-break-after:avoid}
  blockquote,ul,p{break-inside:avoid;page-break-inside:avoid}
  .disclosure{border:1px solid #ccc}
}
`;

export function buildDemo(): { files: string[]; pdf: "generated" | "manual-step-documented" } {
  if (!existsSync(META)) throw new Error("competitors-meta.json not found — the demo needs the gitignored meta locally");
  const meta = JSON.parse(readFileSync(META, "utf8")) as { mapping: Array<{ alias: string; name: string }> };
  const realName = meta.mapping[0]!.name;
  const claims = buildClaims();
  mkdirSync(DEMO_DIR, { recursive: true });

  // ---- demo-index.html ------------------------------------------------------
  let body = renderCase(claims, realName);
  body = body.replace(
    /<p class="disclosure">[^<]*<\/p>/,
    `<p class="disclosure">${DEMO_BANNER}</p>`,
  );
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>AisleLens — one complete verified case</title><style>${DEMO_CSS}</style></head>` +
    `<body><main>${body}</main></body></html>`;
  const htmlPath = join(DEMO_DIR, "demo-index.html");
  guardedWrite(htmlPath, html, realName);

  // ---- demo-notes.md --------------------------------------------------------
  const claimLines = (Object.entries(claims) as Array<[string, Claim]>)
    .map(([k, c]) => `| \`${k}\` | ${c.value.length > 60 ? c.value.slice(0, 57) + "…" : c.value} | ${c.source} |`)
    .join("\n");
  const notes = `# Demo presenter notes — every number, traceable

Banner on the page (read it aloud if asked): "${DEMO_BANNER}"

Competitor shown: **${realName}** (committed artifacts + reports say "observed
competitor A"; the name is hydrated only in this gitignored demo build).

## Where every number comes from

| Claim | Value | Artifact |
|---|---|---|
${claimLines}

## The three questions you'll get, answered in one glance

- **"Where does the ${claims.competitorMentions!.value} come from?"** — ${claims.competitorMentions!.source}. It is the number of AI answers (of ${claims.probeCount!.value} live shopping questions asked across ${claims.channelCount!.value} assistants) that named ${realName}, counted by a deterministic extractor anyone can re-run on the persisted battery file.
- **"What does 'verified' mean?"** — ${claims.journeyCount!.value} complete simulated shopping journeys on 2 AI models failed ${claims.faultedFailures!.value} while the store lacked the aluminum-free statement, and passed ${claims.fixedPasses!.value} after the one-sentence fix — same tests, same models, versions pinned (before-after-diff.json).
- **"Did the live assistants change?"** — No, and the page says so plainly: ${claims.livePre!.value} before, ${claims.livePost!.value} after. The demo store is password-protected and invisible to external AI; the live recheck proves the MECHANISM. Movement requires an indexed store — that is the design-partner conversation.

## Handling the conversation (Part B discipline)

Say nothing while they read states 1–5. Note where they stop or scroll back.
Do not pitch, do not explain away confusion. If asked something not in this
sheet: "good question — the full artifact trail is committed; I'll pull it up."

## PDF

If demo-case.pdf is missing here, print demo-index.html from any browser
(Ctrl+P → Save as PDF — print CSS is already in the page).
`;
  const notesPath = join(DEMO_DIR, "demo-notes.md");
  guardedWrite(notesPath, notes, realName);

  // ---- demo-case.pdf via system Edge headless (no repo dependency) ----------
  let pdf: "generated" | "manual-step-documented" = "manual-step-documented";
  const edgePaths = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const edge = edgePaths.find((p) => existsSync(p));
  if (edge) {
    try {
      const pdfPath = join(DEMO_DIR, "demo-case.pdf");
      execFileSync(edge, [
        "--headless=new",
        "--disable-gpu",
        `--print-to-pdf=${pdfPath}`,
        "--no-pdf-header-footer",
        `file:///${htmlPath.replace(/\\/g, "/")}`,
      ], { timeout: 60_000 });
      if (existsSync(pdfPath)) pdf = "generated";
    } catch {
      /* fall back to the documented manual step */
    }
  }

  console.log(`[demo] built demo-index.html + demo-notes.md${pdf === "generated" ? " + demo-case.pdf" : " (PDF: manual print step documented in notes)"} → experiments/agentic-stage4/demo/`);
  return { files: ["demo-index.html", "demo-notes.md", ...(pdf === "generated" ? ["demo-case.pdf"] : [])], pdf };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("agentic-test/build-demo.ts");
if (isMain) {
  try {
    buildDemo();
  } catch (err) {
    console.error(`[demo] FAILED: ${(err as Error).message}`);
    process.exit(1);
  }
}
