# v4.2 HANDOFF — restart-sufficient

**Branch:** `feat/v4-2-sendable` off `main` @ `46e5c5e`. Full record: `REPORT.md` beside this.

## STATE: all four checkpoints complete, plus two unbriefed production fixes.

| | state |
|---|---|
| CP-0 discovery | done — 5 questions answered by execution |
| CP-1 permanent result URL | done — `/result/:token`, migration `0031`, 26/26 e2e |
| CP-2 print path | done — proved by rendering, 20 + 88 items gained, 0 lost |
| CP-3 one-pager | done — 2 reference PDFs, 23/23 artifact checks |
| CP-4 outreach | done — `outreach_final.md` generated, 3 flags |
| P-A retired spread sentence live on v1.0/v1.1 | fixed |
| P-B peer line joined 0 of 10 rows | fixed |

## Gates

- `npm run typecheck` — green.
- `npm test` — **1071 · 995 pass · 0 fail · 76 skipped** (base 1053/977/76).
- `RUN_DB_TESTS=1 npm run test:db` with the local Supabase stack — **1071 · 1056 pass · 0 fail ·
  15 skipped**. ~10 minutes.
- Migration `0031` applied locally and verified.
- **Production probes NOT yet run** — nothing is deployed. See below.

## To finish from a cold start

```bash
git checkout feat/v4-2-sendable
# local DB: Docker Desktop + `npx supabase start`, then:
npm run migrate
npm run typecheck && npm test
```

To regenerate the reference artifacts (needs the local DB and a running server on 8787):

```bash
npx tsx experiments/v4-2/seed_reference.ts                 # coffee / standard layer -> token
SEED_HOST=barebonesliving.com npx tsx experiments/v4-2/seed_general.ts   # general layer -> token
node experiments/v4-2/print_probe.mjs "http://127.0.0.1:8787/result/<COFFEE>/one-pager" --pdf experiments/v4-2/onepager_coffee_klatchcoffee.pdf
node experiments/v4-2/print_probe.mjs "http://127.0.0.1:8787/result/<GENERAL>/one-pager" --pdf experiments/v4-2/onepager_general_barebonesliving.pdf
node experiments/v4-2/verify_pdfs.mjs <COFFEE> <GENERAL>
npx tsx experiments/v4-2/instantiate_outreach.ts <COFFEE> <GENERAL>
```

Tokens used for the committed artifacts (LOCAL DB only — they do not exist in production):
coffee `t_a7060bfdd703961be238`, general `t_cd29c6b169d53519c10f`.

## Deploy

Railway deploys from `main`; `railway.json` runs `npm run migrate && npm start`, and
`migrate.ts` exits 1 on failure, so **a failed migration fails the deploy**. Migration `0031`
is additive and idempotent and applied cleanly locally.

After pushing, run both production probes:

```bash
node experiments/v3-7/verify_prod.mjs
```

Then confirm the two new things by hand, because no existing probe knows about them:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://lens.thirdocular.com/result/t_00000000000000000000   # expect 404
curl -s https://lens.thirdocular.com/standards/coffee/1.0 | grep -c "No comparison is drawn"          # expect 1
curl -s https://lens.thirdocular.com/standards/coffee/1.1 | grep -c "No comparison is drawn"          # expect 1
```

⚠️ **`HOSTED_CASES_DIR` on Railway is now inert** — nothing reads it. Delete it when convenient.

## Instruments built here, reusable

- `cdp.mjs` — zero-dependency Chrome DevTools Protocol client (Node 22 global `WebSocket` +
  system Chromium). Print-media emulation and `Page.printToPDF` read back as a **stream**.
- `pdftext.mjs` — PDF text extraction, per-page font resolution, canaried two-sided before any
  result from it is believed. Containment is whitespace-**insensitive**; a PDF has no word
  boundaries.
- `print_probe.mjs` / `print_diff.mjs` — the two-sided print proof. `--css <file>` swaps the
  stylesheet in place so a BEFORE/AFTER is over the SAME served HTML.
- `rule_scan.mjs` — scores candidate CSS rules against the real engine.

⚠️ **Write these with the Write tool, never a bash heredoc.** A heredoc ate one backslash from
`/\\s+/g` and sent `/s+/g` to the page, which replaced every literal `s` and made a throwaway
check report 124 phantom failures.

To re-run the CP-2 A/B you need the PRE-FIX stylesheet. It is not committed (it is a copy of a
tracked file); regenerate it from the base commit, **not** from `HEAD`, which now contains the
fix:

```bash
git show 46e5c5e:viewer/src/theme.css > experiments/v4-2/theme_BEFORE.css
```

## Open, filed not fixed (see REPORT.md "FILED, NOT FIXED")

1. `pt-stdfoot` on `/test` hand-types "100 real coffee products across 77 storefronts" —
   currently correct, but hand-typed on a surface that lints none of its own copy.
2. The general engine asks off-category claims ("Paraben-free" of a watch strap). Matcher edit.
3. `fitness.json`'s `cross_sample_comparison.general_interval_95` still holds v3.7 values while
   `samples[general].interval_95` holds v3.8's. Not published today; a trap for any new reader.
4. `/llms.txt` carries four version blocks, three superseded. Never pattern-match a figure out.
5. The SPA-Link guard's regex misses `<Link className="…" to="/x">` (prop before `to`).
6. `src/server/publicSsr.ts` is covered by no test at all.
