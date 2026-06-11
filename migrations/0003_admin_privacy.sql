-- 0003_admin_privacy — fields for the admin cockpit + privacy-preserving IP hashing.

alter table runs  add column if not exists error       text;
alter table runs  add column if not exists mode        text;      -- mini | standard | deep
alter table runs  add column if not exists ip_hash     text;      -- sha256(ip+salt), replaces raw ip
alter table leads add column if not exists source_page text;
alter table leads add column if not exists ip_hash     text;

create index if not exists runs_status_created_idx on runs (status, created_at);
