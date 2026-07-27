# AGENTS.md — read [`CLAUDE.md`](CLAUDE.md)

**`CLAUDE.md` is the single source of truth for this repo.** This file exists only because
`AGENTS.md` is the filename some tools read by convention. It is a signpost, not a second copy.

## Why this is a pointer and not a copy

It used to be a copy. Measured 2026-07-27: untracked by git and never committed, 563 lines
against CLAUDE.md's 1040, **490 of CLAUDE.md's lines with no counterpart here** — including one
contiguous 440-line block (CLAUDE.md:576-1015) holding every learning from v2.4 through v3.2.
Staleness was not the worst of it: the fork carried a **deploy fact that was false**, stated as
confidently as the true ones, and an independent reviewer believed it. AGENTS.md:152-154 said:

> Runs locally against `DATABASE_URL` (Supabase session pooler, port 5432) AND at **startup**
> on Railway (`railway.json` start = `npm run migrate; npm start`, non-fatal so a DB hiccup
> degrades gracefully instead of crash-looping).

**A wrong document is worse than no document, because it is trusted.** Two documents are never
kept in sync by intent — one gets updated, the other keeps being read.

## The corrected deploy fact — stated here because it is the one the fork got wrong

Re-verified 2026-07-27 against `railway.json` (`"startCommand": "npm run migrate && npm start"`)
and `src/db/migrate.ts:133` (`process.exit(1)`). CLAUDE.md:152-158:

> ⚠️ **Corrected 2026-07-25:** this used to say the start command was `npm run migrate; npm start`,
> "non-fatal". It is **`npm run migrate && npm start`** (`railway.json`) and `migrate.ts` exits `1`
> on failure — so **a failed migration fails the deploy**, it does not degrade. The useful
> consequence: **a green `/healthz` on a known commit is proof that every migration applied**,
> since the app cannot start otherwise.

Everything else about deploys: CLAUDE.md:134-175 and [`DEPLOY.md`](DEPLOY.md).

## Operating rules to read before you touch anything

These are the ones that make a broken run look like a clean one; full context in CLAUDE.md.

- **Never `npx tsx -e`, `node -e` or `python -c`.** They emit no output and exit 0 in this
  environment's shell, so a silent one-liner reads exactly like a clean sweep. Use a script
  *file*. (CLAUDE.md:1006-1008, and :635 on the same failure class.)
- **Grep/ripgrep respects `.gitignore`, so `experiments/` is invisible to it.** An exhaustive
  sweep needs its own walker; pass gitignored paths to Read explicitly. (CLAUDE.md:1009-1011.)
- **Do not run a package manager mid-session.** One agent ran `npm install` and emptied
  `node_modules` while other work was in flight (CLAUDE.md:950). CLAUDE.md states this
  unconditionally — "tell agents given a repo not to run a package manager" — and grants no
  exemption, so this file must not invent one either.
- **Run `npm test` before and after touching `src/detection/`** or any matcher file
  (`src/server/{productTest,testEvidence,subject,claimLinter}.ts`). It carries the adversarial
  corpus, whose `EXPECTED_OPEN_GAPS` is asserted exactly. (CLAUDE.md:278, :969-1004.)
- **A real-store replay is a REGRESSION check, never an acceptance gate for a matcher change.**
  A 216-store replay reported 0 lost positives on guards two independent attackers measured at
  192 regressions. The gate is an adversarial pass by someone who did not write the guard.
  (CLAUDE.md:881-897.)
- **A measurement that did not complete is not a passing measurement.** Zero is what a broken
  instrument returns and what a healthy one returns; resolve to `VERIFIED_CLEAN` /
  `DEFECTS_FOUND` / `INCOMPLETE`, never a bare count. (CLAUDE.md:625-656.)
- **Sweep files you write for control bytes.** A `\b` through a shell quoting layer has landed
  in this repo as a literal 0x08 more than once. (CLAUDE.md:958-967.) The same quoting layer
  eats one backslash per level: writing a test through a heredoc turned `\\s` into `\s`, which
  a JS template literal then resolved to a plain `s`, and the regex silently stopped matching a
  file that plainly contained the text. Write files with an editor, not a heredoc.
- **`npm run test:db` needs the LOCAL Supabase stack, and hangs without it.** `.env` points at
  the Docker/Supabase-CLI stack on `127.0.0.1:54322`, not at cloud, so a DB-gated run with the
  stack down does not fail — it blocks until the harness times out, which looks like a slow
  suite rather than a missing dependency. Start Docker, then `npx supabase start`, then run it.

Backlog: [`TODO.md`](TODO.md). Phase status: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).
