# v4.3 HANDOFF — restart-sufficient

## Where things are

Branch **`feat/v4-3-landing`**, off `main` at `3a4c5cf`. Commits:

- `f48a897` CP-1 — light retheme, agency-first copy, the derived hero artifact, the
  semantic-tier pin
- `70eb86a` CP-2 — mobile pass, three instrument repairs, `test/landingV43.test.ts`
- `1edf7ba` housekeeping — untrack a pre-existing design note (locally excluded)

State at handoff: **typecheck clean, viewer build clean, 1082 tests / 1006 pass / 0 fail**,
`experiments/v4-3/responsive.mjs` `VERIFIED_CLEAN` at 4 widths,
`experiments/v4-3/mutate_palette.mjs` 10/10 guards biting.

## The five things you need to know before touching anything

1. **The landing page's figures are DERIVED and must stay derived.** `src/server/heroArtifact.ts`
   builds them from `runDemo()`; `viewer/src/heroArtifact.ts` is the shared type plus a
   DOM reader. The viewer bundle imports nothing from `src/`, so the payload travels as a
   JSON `<script>` the server injects *and* as rendered HTML in the JS-off snapshot. Both
   come from one derivation. If the artifact is missing, **every artifact-backed section
   renders nothing** — never a placeholder. `test/landingV43.test.ts` asserts all of this.

2. **`runDemo` pins the semantic tier off, and that is load-bearing.**
   `semantic: { disabled: true }` in its deps. Without it `/demo` and the landing hero make
   a live sampled model call per boot: two boots gave 5 proven and 6 proven on the same
   capture, and the sixth pass was a single-origin claim read out of a sentence stating no
   origin. The tier is **still live on `/test`** — see `ENGINE_GAPS` **P-28**, which has the
   measurement and what it needs before anyone changes it.

3. **The palette test is the gate and it has been re-proved, not just re-pointed.**
   Reserved hexes moved (crimson `#BF3A4F`, sand `#826738`). The block-identity assertion
   now says *the one theme override declares every colour token the base does*, with the
   colour/invariant split computed from the value rather than a hand-kept list. Re-run
   `node experiments/v4-3/mutate_palette.mjs` after any change to it — 10/10 must bite and
   the restore must verify byte-identical.

4. **Light is unconditional.** `:root` IS the light theme; there is exactly one
   `[data-theme="dark"]` block; there is no `prefers-color-scheme` anywhere.
   `viewer/src/theme.ts#defaultTheme()` returns `"light"` and the two must agree — the
   palette test refuses a second override block for this reason.

5. **`html, body { overflow-x: clip }` is doing real work.** The full-bleed band uses
   `100vw`, which counts the scrollbar. Removing either half of that selector puts an 8px
   sideways scroll back on every viewport. It was scored twice against two baselines:
   `body` alone and `html` alone each measure INERT depending on which is already present.
   `experiments/v4-3/bleed_ab.mjs` re-runs the scoring.

## Re-running everything

```bash
npm run typecheck
npm --prefix viewer run build
npm test
```

Then, with the dev server up (`preview_start` on the `aislelens` config, port 8787 — and
**restart it after every viewer build**, it caches `index.html` at boot):

```bash
node experiments/v4-3/tokens.mjs          # the contrast table, VERIFIED_CLEAN
node experiments/v4-3/mutate_palette.mjs  # 10/10 guards bite, restore byte-identical
node experiments/v4-3/responsive.mjs      # 320/375/768/1280, VERIFIED_CLEAN
node experiments/v4-3/scrollbar.mjs       # no width scrolls sideways
node experiments/v4-3/shots.mjs           # screenshots into experiments/v4-3/shots/
npx tsx experiments/v4-3/probe_hero.ts    # 10/10 peer lines join; payload round-trips
```

Everything renders through the **system Chromium over CDP** (`experiments/v4-2/cdp.mjs`),
because the Browser pane cannot composite in this environment. DOM readback and
`javascript_tool` against the pane DO work.

## Deploying

Same as every release: merge to `main`, push, Railway builds and runs
`npm run migrate && npm start`. **No migration in this release** — nothing under
`migrations/` changed.

Post-deploy, both probes:

```bash
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-7/verify_prod.mjs
EXPECT_SHA=$(git rev-parse HEAD) node experiments/v3-8/verify_sections.mjs
```

Neither was re-pinned; both should be `VERIFIED_CLEAN`. `verify_prod`'s last check — that
the landing page links only the CURRENT standard version — is the one this release could
plausibly have broken, and it passes locally.

⚠️ **Deploy ShopifyACO before ThirdOcular**, as always. The parent site's build gate fetches
`/api/brand.json`; `PRODUCT_DESCRIPTION`, `PRODUCT_CAPABILITIES` and `PRODUCT_KIND` are
**unchanged** in this release, so that gate is not at risk — but thirdocular.com now
mismatches on palette and positioning, which is filed and not fixed (§1a scoped it out).

## Open, in priority order

1. **`ENGINE_GAPS` P-28** — the semantic tier on `/test`. The serious one.
2. **Dead CSS** from the retired landing (~150 lines). Measured unreferenced in TSX;
   needs a sweep that also covers server-emitted class names and does not respect
   `.gitignore`.
3. **thirdocular.com** palette + positioning mismatch.
4. **`/og/default.png` renders the wordmark twice** — pre-existing, non-landing.
5. **The theme toggle wraps to its own line** in the header below ~560px. Functional and
   non-overflowing; tidier would be better.
