-- Crawl-mode provenance on findings (App Store 2.1.4 honesty): a finding produced by a
-- mock/fixture crawl must be distinguishable — in the DB and in the UI — from one observed
-- on the merchant's real pages. Legacy rows stay NULL (= unknown provenance).
alter table findings add column if not exists crawl_mode text;
