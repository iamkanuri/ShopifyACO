-- 0005_category_index — public "AI Visibility Index" leaderboards per category.
-- One curated index per category, built by admin from a single multi-brand scan.

create table if not exists category_index (
  slug        text primary key,             -- e.g. "non-toxic-cookware"
  label       text not null,                -- e.g. "Non-toxic cookware"
  run_id      text,                          -- the scan this leaderboard came from
  entries     jsonb not null default '[]',   -- [{brand, rank, mention, recommendation}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

grant select, insert, update, delete on table category_index to service_role;
