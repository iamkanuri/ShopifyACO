-- 0016_pixel_activation — store the app-owned Web Pixel id per shop (Phase 10) so
-- activation (webPixelCreate → webPixelUpdate) is idempotent: we create once, store the
-- returned id, and update thereafter. Additive + idempotent.

alter table shops add column if not exists web_pixel_id text;
