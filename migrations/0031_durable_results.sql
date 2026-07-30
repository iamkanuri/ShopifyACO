-- ===========================================================================
-- v4.2 — A RESULT YOU CAN SEND. `public_tests` becomes durable and addressable.
--
-- THE PROBLEM THIS FIXES. An agency runs a test on a prospect's store and has nothing
-- to send them: `/test?url=…` re-runs the engine on every load, and while general-layer
-- results were written to this table, no public route ever read one back. A standard
-- entry has a permanent URL; a merchant's own verdict did not.
--
-- ⚠️ TWO LIFETIMES WERE SHARING ONE COLUMN, AND THAT IS THE ROOT OF THE "PERMANENT" LIE.
-- `expires_at` was written from PUBLIC_TEST_TTL_MS = 7 days and every read filtered on
-- it. But that window exists for the CLAIM flow — carrying a result through OAuth so the
-- first authenticated screen is the merchant's own test — not for readability. A
-- permanent URL over a row that stops being readable after seven days is a false
-- statement with a delay. So the two are separated rather than the TTL widened:
--   • `expires_at` keeps its exact meaning and every claim query keeps filtering on it.
--   • Reading a result for RENDERING no longer consults it (`getStoredResult`).
-- No column changes meaning, no claim behaviour moves, and nothing is deleted — this
-- table has never had a purge job and still does not.
--
-- Additive + idempotent, in the house style.
-- ===========================================================================

-- 1. PROVENANCE THE STORED BLOB CANNOT SUPPLY.
--    Measured, not assumed: the object handed to `storePublicTest` on a FRESH run carries
--    no timestamp at all — `testedAt`/`cached` are stamped only onto the copy inside the
--    in-memory result cache, so they are present on a cache-hit path and absent otherwise.
--    A permanent URL that cannot say when it ran is not citable, and "sometimes dated"
--    is worse than never, so the time is recorded here where it cannot be path-dependent.
alter table public_tests add column if not exists ran_at timestamptz;
alter table public_tests add column if not exists engine_version text;

-- 2. WHICH CONTRACT RAN. A general-layer result carries generated requirements; a
--    standard-layer result executes a published, content-hashed document. Both are
--    stored so the page can cite the exact thing that produced the verdict, and so a
--    citation still resolves after the standard is superseded.
alter table public_tests add column if not exists kind text not null default 'general';
alter table public_tests add column if not exists standard_slug text;
alter table public_tests add column if not exists standard_version text;
alter table public_tests add column if not exists standard_hash text;
alter table public_tests add column if not exists contract_version text;

-- 3. SHARING IS AN ACT, NOT A BYPRODUCT (CP-1 decision 1).
--    URL-addressability makes every visitor's test a potential permanent public page
--    about somebody else's store. The token is 80 bits and the page is noindex/nofollow
--    and absent from the sitemap whatever this column says; what `shared_at` gates is the
--    social card. An unshared result does not unfurl in Slack or on a timeline — the
--    thing that actually makes a link travel — until a human presses the button.
alter table public_tests add column if not exists shared_at timestamptz;

-- 4. RESULTS ARE APPEND-ONLY, AND A RE-RUN IS A NEW ROW (CP-1 decision 2).
--    Same rule as the fitness sidecars and as a standard reissue: a stored verdict is
--    never mutated. Re-running mints a new token; the two are LINKED, never reconciled.
--    `superseded_by` on the older row is the only field a later run may write, and it is
--    a pointer, not a verdict — exactly the supersession notice a byte-frozen standard
--    gets from its renderer rather than from an edit.
alter table public_tests add column if not exists rerun_of text;
alter table public_tests add column if not exists superseded_by text;

create index if not exists public_tests_rerun_idx on public_tests (rerun_of);

-- 5. Backfill provenance for rows written before this migration. `created_at` is the
--    honest approximation of `ran_at` for them — the row was inserted immediately after
--    the run returned — and it is applied ONLY where ran_at is null, so a re-run of this
--    migration cannot overwrite a real value.
update public_tests set ran_at = created_at where ran_at is null;
