# v4.4 HANDOFF — restart-sufficient

## Where things are

Branch **`feat/v4-4-semantic`**, off `main` at `16e90c3`. Not merged, not deployed.

State: **typecheck clean · viewer build clean · 1091 tests / 1015 pass / 0 fail / 76 skipped**
(DB-gated). Both production probes were `VERIFIED_CLEAN` on `16e90c3` before any work.

## The five things to know before touching anything

1. **Four permanent production results carry a tier-granted pass; three are false.** Tokens
   `t_15802547df13b8daf273`, `t_91db6f4c309fcf6734c9`, `t_0db9852c7e19461c49f8` (**standard
   layer, Coffee v1.3**) and `t_5996b5618d2d5f9988eb` (adjudicated: stands). They are
   remediated by a **render-time notice**, never a byte edit — results are append-only, and
   the remediation IS the disclosure. `src/server/resultNotices.ts`.

2. **Detection is derived; attribution is curated. Do not collapse them.** Detection reads
   `semantic.granted > 0` off the stored blob at both shapes, so a result minted later by a
   path that still runs the tier is still disclosed. Attribution is a hand-checked map,
   because the blob records only a **count**. A row with no curated entry reports as
   *unnamed* — never guessed.

3. **The attribution map joins on the assertion label BYTE-FOR-BYTE.** One trailing space
   renders no notice, and no notice looks exactly like a result that needs none.
   `test/resultNotices.test.ts` mutation-proves this (a one-character drift fails 2 of 9).
   Its anti-vacuity anchor reads `test/fixtures/v4-4-affected-rows.json` and **fails if the
   file is absent** — it must stay committed; `experiments/` is gitignored.

4. **The tier is pinned off on both public routes, and `ENGINE_VERSION` is v2.5.0.** This is
   a durability decision (P-28 #4), NOT a verdict on precision. The engine-version tripwire
   hashes matcher files and **no matcher logic moved** — the bump is correct anyway, and the
   lesson is in the test file: a quiet tripwire is not "no bump needed".

5. **The pilot found real recall, and that is why the tier is not dead.** 3 grants in 16 rows
   asked; **2 are genuine statements** no term list matches (a named farmer group and
   district; a named single farm). Killing it without measuring that would repeat the
   `origin` mistake in reverse.

## THE ONE THING WAITING ON A USER GO

The full-corpus measurement. The pilot stopped where §3 said to stop.

```bash
PILOT_N=338 MEASURE_OUT=full.jsonl npx tsx experiments/v4-4/tier_measure.ts
```

Projected spend **$0.50** (measured $0.00147/store for runs B+C, × 338). Needs `OPENAI_API_KEY`
in `.env`. Both canaries must stay green; a grant rate of zero is a broken instrument until
proven otherwise.

Then §4 decides between outcome 2 (grants with high precision) and outcome 3 (poor
precision), and the outcome-2 branch must also compute the re-measured bound from run B's
adjudications plus the existing tier-off ones.

## Re-running everything

```bash
npm run typecheck
npm --prefix viewer run build
npm test
```

```bash
node experiments/v4-4/prod_semantic_audit.mjs        # §1.1 + §2, needs .env.prod.bak
npx tsx experiments/v4-4/attribute_grants.ts         # which row each grant moved
npx tsx experiments/v4-4/adjudicate_stored.ts        # full untruncated evidence per grant
node experiments/v4-4/harness_default.mjs            # decided vs inert harnesses
node experiments/v4-4/determinism_claims.mjs         # §1.5 claims inventory
npx tsx experiments/v4-4/tier_measure.ts             # the 20-store pilot (spends ~$0.03)
npx tsx experiments/v4-4/render_check.ts             # what a reader sees on each affected page
```

`prod_semantic_audit.mjs` writes `affected_rows.json`; the committed test fixture is the
trimmed copy at `test/fixtures/v4-4-affected-rows.json`.

## Deploying

Merge to `main`, push; Railway runs `npm run migrate && npm start`. **No migration in this
release.** Post-deploy, both probes:

```bash
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-7/verify_prod.mjs
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-8/verify_sections.mjs
```

Neither was re-pinned. Then confirm each of the four tokens serves its notice:
`curl -s https://lens.thirdocular.com/result/t_0db9852c7e19461c49f8 | grep -c bt-correction`.

⚠️ **Deploy ShopifyACO before ThirdOcular**, as always. `PRODUCT_DESCRIPTION`,
`PRODUCT_CAPABILITIES` and `PRODUCT_KIND` are unchanged, so that gate is not at risk.

## Open, in priority order

1. **The full-corpus run + the §4 decision.** Above. Everything else is downstream of it.
2. **`semanticTier.ts` claims "temperature 0" and sets none.** `defaultComplete`'s body has
   `model`, `messages`, `response_format`, `max_completion_tokens` — no `temperature`. Left
   alone deliberately so the measurement runs as-prod-configured. It is the first thing to
   change if outcome 2 sends the tier back anywhere, and the variance must then be
   **re-verified at ≈0**, not assumed.
3. **`funnel_events` is blind to the standard route.** It emits `standard_test_requested` and
   no completion event, so `semantic_invoked` was 0 there while a standard result carried a
   grant. Telemetry covering one of two public routes reads as "barely runs".
4. **Raw HTML leaks into evidence sentences and into a published quote.**
   `t_5996b5618d2d5f9988eb` publishes `…keto-friendly magic!</p>`; the `product_faq` surface
   carries `<p>`, `<br/>` fragments. Independent of the tier; visible on a permanent page.
5. **27 inert harnesses** (`harness_default.mjs`). Four are live and could spend on a machine
   with a key: `experiments/v4-2/seed_general.ts`, `seed_reference.ts`,
   `experiments/v4-3/probe_demo.ts`, `probe_peers.ts`. Cheap fix: one explicit default-off
   line per entrypoint.
6. **§5, dropped and carried whole** — the card shown twice. On mobile the hero result card
   stacks above the later full-section card (same store, counts, CTA) and reads as a bug. Fix
   by differentiation: hero truncates ≤~700px to the summary plus 2–3 rows with an explicit
   **"showing 3 of 10 rows"** label (the label keeps the section's "nothing selected for
   effect" claim exactly true); hero loses its internal CTA (the page hero's button serves);
   the section card gains one line naming its job — the complete result, with the evidence
   sentence behind every row. Verify at 320/375/768/1024 with `experiments/v4-3/responsive.mjs`
   and `shots.mjs`; **do not re-derive those instruments.**

## §7 — PARKED, EXPLICITLY (unchanged; still waiting on the §4 outcome)

Outcomes 2/3 may move the published numbers, so regenerating now mints them twice:

- thirdocular.com parent retheme to the light token system.
- Regeneration of every pre-v4.3 exhibit — one-pagers, `outreach_final`, OG images. The demo
  verdict change 6/4 → 5/5 already staled them, and any bound movement would stale them again.
- The end-to-end runway walk.
