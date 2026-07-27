import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ===========================================================================
// THE DEPLOY FACT THAT HAS NOW BEEN WRONG TWICE, AND HAND-CORRECTED TWICE.
//
// The claim: Railway's start command is `npm run migrate; npm start`, "non-fatal, so a
// DB hiccup degrades gracefully instead of crash-looping."
//
// It is FALSE. `railway.json` uses `&&`, and `src/db/migrate.ts` exits 1 on failure, so
// a failed migration FAILS THE DEPLOY — it does not degrade. CLAUDE.md corrected this on
// 2026-07-25. Then v3.3 found the false form still live in three more places: DEPLOY.md
// twice (a third variant at :843 put migrate at BUILD time), the AGENTS.md fork that had
// briefed an independent reviewer off it, and `src/start.ts`'s own header comment.
//
// The useful consequence of the TRUE fact is load-bearing and worth protecting: because
// the app cannot start unless every migration applied, a green `/healthz` on a known
// commit is proof that they did. That is the one-step, credential-free way to verify a
// migration in production, and it is only true while the start command short-circuits.
//
// So this stops being prose. Every hand-correction of a fact nobody can check gets
// re-broken; a five-line test that reads the file cannot. It asserts the CONFIGURATION,
// not a sentence about it, and it fails on any document or comment still carrying the
// old form.
// ===========================================================================

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

test("[deploy] the start command CHAINS — a failed migration fails the deploy", () => {
  const railway = JSON.parse(read("railway.json")) as {
    build?: { buildCommand?: string };
    deploy?: { startCommand?: string; healthcheckPath?: string };
  };
  const start = railway.deploy?.startCommand ?? "";
  assert.match(start, /npm run migrate\s*&&\s*npm start/,
    `railway.json's startCommand is ${JSON.stringify(start)}. If this genuinely changed, every document that explains WHY a green /healthz proves the migrations applied is now wrong and has to change with it.`);
  assert.doesNotMatch(start, /;/,
    "a `;` between migrate and start would make a failed migration NON-fatal — the app would boot on an unmigrated database and serve traffic against it");

  // Migrations must NOT run at build time: the build has no database, and DEPLOY.md's
  // own history records that placement as "too early / unreliable".
  assert.doesNotMatch(railway.build?.buildCommand ?? "", /migrate/,
    "the build command runs migrations — the build container has no database connection");

  // The healthcheck is what turns "the app started" into "the migrations applied".
  assert.equal(railway.deploy?.healthcheckPath, "/healthz");
});

test("[deploy] migrate.ts EXITS NON-ZERO on failure, which is what makes the chain fatal", () => {
  const src = read("src/db/migrate.ts");
  assert.match(src, /process\.exit\(1\)/,
    "migrate.ts no longer exits 1 — `&&` would then let a failed migration through to npm start");
});

test("[deploy] NO source file or document still states the FALSE non-fatal form", () => {
  // ⚠️ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT ALL FOUR SURVIVING INSTANCES.
  // CLAUDE.md and DEPLOY.md legitimately QUOTE the false form in order to correct it, so
  // a bare substring sweep would fire on the correction itself. What is forbidden is
  // stating it — the wrong form NOT immediately accompanied by a marker that it is being
  // corrected.
  const FILES = [
    "railway.json", "src/start.ts", "src/health.ts", "src/db/migrate.ts",
    "DEPLOY.md", "CLAUDE.md", "AGENTS.md", "README.md",
  ].filter((f) => fs.existsSync(path.join(root, f)));
  assert.ok(FILES.length >= 6, `only ${FILES.length} files found — the sweep is not covering the repo`);

  const WRONG = /npm run migrate\s*;\s*(\/?\s*)?npm start|npm run build\s*&&\s*npm run migrate/g;
  // Words that mark the surrounding text as a correction rather than an assertion.
  const CORRECTING = /corrected|used to say|was false|it is `?&&`?|NOT|never|wrong|false|⚠️|instead of/i;

  const offenders: string[] = [];
  for (const f of FILES) {
    const text = read(f);
    for (const m of text.matchAll(WRONG)) {
      const at = m.index ?? 0;
      const around = text.slice(Math.max(0, at - 400), at + 400);
      if (CORRECTING.test(around)) continue;   // quoted in order to correct it
      const line = text.slice(0, at).split("\n").length;
      offenders.push(`${f}:${line} states the false form: ${JSON.stringify(m[0])}`);
    }
  }
  assert.deepEqual(offenders, [], `the corrected deploy fact is still asserted somewhere:\n${offenders.join("\n")}`);

  // TWO-SIDED LIVENESS. A sweep that can never fire is worth nothing, and this one is
  // built out of a regex plus a context filter — either of which could silently stop
  // matching. Feed it the exact sentence it exists to catch, with no correcting marker.
  const canary = "The Railway start command is `npm run migrate; npm start`, so a database hiccup degrades gracefully.";
  assert.match(canary, WRONG, "the detector does not match the sentence it was written for");
  assert.doesNotMatch(canary, CORRECTING, "the context filter would have excused the very sentence this test targets");
});
