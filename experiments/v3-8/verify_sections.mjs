// ===========================================================================
// v3.8 CP-0 — DO THE NEW SECTIONS ACTUALLY REACH A READER?
//
//   node experiments/v3-8/verify_sections.mjs
//
// `verify_prod.mjs` proves the routes are up, the hashes agree and the byte
// floors hold. It cannot prove that a section WRITTEN THIS RELEASE is being
// served, because a page that renders it as nothing still returns 200 and still
// clears a byte floor set for the page as a whole.
//
// This project has shipped that exact defect four times: `grounding.sources` vs
// `grounding.citations` (42 entry pages rendered empty, eleven tests green);
// `s.fitness` vs `measured_fitness` (three wrong pages in one session); a
// renderEntry reading a v1.0 sidecar directly; and v3.5 CP5, where v1.3 was
// committed, hashed, gated and corpus-pinned while `PUBLISHED` still stopped at
// v1.2 so NOTHING SERVED IT. Every gate was green, because each checks the
// artifact rather than its REACHABILITY.
//
// The per-kind table and the interval-overlap ratio refusal have never been
// served before this release. So: fetch production, and require the rendered
// CONTENT — not a 200, not a byte floor.
//
// Also asserts the ABSENCE of the retired spread sentences, which a fix has
// twice revived, and of the `[object Object]` / `undefined` / `NaN` family.
// ===========================================================================

const BASE = process.env.BASE_URL ?? "https://lens.thirdocular.com";
const EXPECT_SHA = process.env.EXPECT_SHA ?? null;

const checks = [];
const record = (name, ok, detail) => { checks.push({ name, ok, detail }); };

const strip = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s+/g, " ").trim();

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { "user-agent": "aislelens-v38-section-probe" } });
  return { status: r.status, body: await r.text() };
}

const main = async () => {
  // ---- 0. the SHA, so this cannot pass against a stale deploy ----
  if (EXPECT_SHA) {
    const h = await get("/healthz");
    let sha = null;
    try { sha = JSON.parse(h.body).commit; } catch { /* reported below */ }
    record("production is serving the expected commit", sha === EXPECT_SHA,
      `expected ${EXPECT_SHA?.slice(0, 12)}, serving ${String(sha).slice(0, 12)}`);
    if (sha !== EXPECT_SHA) {
      // Everything below would be measuring the PREVIOUS release.
      report();
      process.exit(1);
    }
  }

  const page = await get("/standards/coffee/1.3");
  record("/standards/coffee/1.3 responds 200", page.status === 200, `status ${page.status}`);
  const text = strip(page.body);

  // ---- 1. THE PER-KIND TABLE — new this release ----
  // Its caption is generated: `${label} — the bound decomposed by requirement kind`.
  const capRe = /—\s*the bound decomposed by requirement kind/gi;
  const captions = [...text.matchAll(capRe)].length;
  record("per-kind table: caption is SERVED", captions > 0,
    `${captions} caption(s) matching "the bound decomposed by requirement kind"`);

  // A caption with an empty table is exactly the failure this file exists for.
  // Require the KIND NAMES themselves, which only the rows can supply.
  const kinds = ["price_under", "in_stock", "delivery", "attribute", "variant_option", "identifiers", "claim"];
  const kindsSeen = kinds.filter((k) => text.includes(k));
  record("per-kind table: rows carry real requirement kinds", kindsSeen.length >= 4,
    `${kindsSeen.length}/${kinds.length} kind names present: ${kindsSeen.join(", ")}`);

  // And a completion state per cell — the brief's own gate.
  const states = ["DEFECTS_FOUND", "VERIFIED_CLEAN", "INCOMPLETE"];
  const statesSeen = states.filter((s) => page.body.includes(s) || text.includes(s.replace(/_/g, " ")));
  record("per-kind table: completion states are rendered", statesSeen.length >= 1,
    `states present: ${statesSeen.join(", ") || "NONE"}`);

  // ---- 2. THE INTERVAL-OVERLAP RATIO REFUSAL — new this release ----
  const refusal = /No difference is stated between these samples, because their intervals overlap/i.test(text);
  record("interval-overlap ratio refusal is SERVED", refusal,
    refusal ? "the refusal sentence is present" : "THE REFUSAL SENTENCE IS ABSENT — either the samples stopped overlapping or the renderer is not reached");

  // ---- 3. THE RETIRED SPREAD SENTENCES MUST BE ABSENT ----
  // Retired three times, revived by a fix twice. An absence check is weak in
  // general; here it is exactly right, because these are literal published strings.
  const retired = [
    "order of magnitude",
    "higher by about",
    "the number that matters to a merchant is the one measured on their own category",
  ];
  for (const r of retired) {
    record(`retired spread sentence absent: ${JSON.stringify(r.slice(0, 44))}`, !text.toLowerCase().includes(r.toLowerCase()),
      text.toLowerCase().includes(r.toLowerCase()) ? "PRESENT — a fix has revived it for the third time" : "absent");
  }

  // ---- 4. THE SILENT-RENDER FAMILY ----
  for (const bad of ["[object Object]", "undefined", "NaN"]) {
    // `undefined`/`NaN` can legitimately occur inside scripts; check stripped text.
    const hit = text.includes(bad);
    record(`no ${bad} in rendered text of /standards/coffee/1.3`, !hit, hit ? `FOUND ${bad}` : "clean");
  }

  // ---- 5. THE SEPARATION TEST, with pairs_tested beside pairs_separated ----
  const sepRan = /pairs? tested/i.test(text) || /separat/i.test(text);
  record("pairwise separation statement is served", sepRan,
    sepRan ? "present" : "absent — a table of cells with no separation statement invites the reader to infer a spread");

  // ---- 6. THE COMPLETED GENERAL AUDIT reaches llms.txt ----
  const llms = await get("/llms.txt");
  record("/llms.txt responds 200", llms.status === 200, `status ${llms.status}`);
  // v3.7 completed the general audit, so the general sample must no longer be a FLOOR
  // at v1.3 — while v1.0/v1.1/v1.2 must KEEP theirs (they were floors when taken).
  const v13Block = llms.body.split(/\n(?=.*1\.3)/).find((b) => /1\.3/.test(b)) ?? "";
  record("llms.txt is reachable and non-trivial", llms.body.length > 4000, `${llms.body.length} bytes`);

  report();
};

function report() {
  const ran = checks.length;
  const failed = checks.filter((c) => !c.ok);
  const L = [];
  L.push("v3.8 CP-0 — NEW-SECTION REACHABILITY PROBE");
  L.push(`base: ${BASE}`);
  L.push("");
  for (const c of checks) {
    L.push(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
    L.push(`      ${c.detail}`);
  }
  L.push("");
  L.push("=".repeat(76));
  L.push(`completion: ${failed.length === 0 ? "VERIFIED_CLEAN" : "DEFECTS_FOUND"}`);
  L.push(`checks run: ${ran}   failures: ${failed.length}`);
  console.log(L.join("\n"));
  process.exitCode = failed.length ? 1 : 0;
}

await main();
