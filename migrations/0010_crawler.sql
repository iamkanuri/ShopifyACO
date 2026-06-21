-- 0010_crawler — bounded-crawl artifacts + evidence-backed findings (Phase 5).
-- The crawler explains WHY competitors win: it fetches the merchant's own pages and
-- the competitor pages the AI engines actually cited, extracts structured signals,
-- and diagnoses the gap. ALL crawled content is untrusted input (SSRF + prompt-
-- injection are the primary threat model). Additive + idempotent. shop_domain is
-- nullable so the URL-only free scan reuses the same machinery.

create table if not exists crawl_pages (
  id              bigint generated always as identity primary key,
  shop_domain     text,                                 -- null for URL-only free scans
  run_id          bigint,                               -- benchmark_runs.id this crawl supports (nullable)
  role            text not null default 'competitor',   -- merchant | competitor
  brand           text,                                 -- which brand this page belongs to
  url             text not null,                        -- requested URL
  final_url       text,                                 -- after validated redirects
  origin          text,                                 -- scheme://host of final_url
  http_status     int,
  content_type    text,
  ok              boolean not null default false,
  error           text,                                 -- fetch/SSRF/robots reason when !ok
  bytes           int not null default 0,
  truncated       boolean not null default false,       -- body hit the byte cap
  -- extraction (all derived from sanitized, untrusted input) -----------------
  title           text,
  canonical_url   text,
  robots_index    boolean,                              -- null unknown; false = noindex
  extracted       jsonb not null default '{}'::jsonb,   -- ExtractedPage: product/offer/identifiers/specs/shipping/returns/reviews/headings/faqs
  injection_flag  boolean not null default false,       -- text contained prompt-injection cues
  injection_terms jsonb not null default '[]'::jsonb,
  text_excerpt    text,                                 -- sanitized, truncated plain text
  fetched_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists crawl_pages_shop_idx on crawl_pages (shop_domain, fetched_at desc);
create index if not exists crawl_pages_run_idx on crawl_pages (run_id);
-- One stored page per (run, url): re-crawling a run converges instead of duplicating.
-- coalesce keeps run-less (ad-hoc) crawls from colliding on a single NULL bucket key.
create unique index if not exists crawl_pages_run_url_uidx on crawl_pages (coalesce(run_id, 0), url);

create table if not exists findings (
  id                       bigint generated always as identity primary key,
  shop_domain              text,
  run_id                   bigint,
  benchmark_id             bigint,
  kind                     text not null default 'evidence_backed', -- evidence_backed | general_hygiene
  -- the lost shopper moment (the evidence) --------------------------------
  intent                   text,
  prompt_text              text,
  engine                   text,
  merchant_brand           text,
  winning_competitor       text,
  ai_answer_snippet        text,                                    -- what the assistant said (untrusted, sanitized)
  citations                jsonb not null default '[]'::jsonb,      -- source URLs the assistant cited
  -- the diagnosis ---------------------------------------------------------
  merchant_gap             jsonb not null default '[]'::jsonb,      -- structured: what the merchant page lacks
  competitor_advantage     jsonb not null default '[]'::jsonb,      -- structured: what the competitor page has
  confidence_level         text not null default 'directional',     -- strong | moderate | directional
  basis_n                  int not null default 0,                  -- lost responses backing this finding
  limits                   text,                                    -- honest caveats (small sample, run-to-run variance)
  recommended_intervention text,
  expected_mechanism       text,                                    -- WHY it may help — a mechanism, never a guaranteed outcome
  status                   text not null default 'open',            -- open | dismissed | actioned
  created_at               timestamptz not null default now()
);
create index if not exists findings_shop_idx on findings (shop_domain, created_at desc);
create index if not exists findings_run_idx on findings (run_id);

grant select, insert, update, delete on table crawl_pages, findings to service_role;
