-- 0018_expiring_tokens — adopt Shopify EXPIRING offline access tokens. Shopify no longer
-- accepts non-expiring offline tokens on the Admin API; expiring tokens (requested with
-- `expiring=1`) last ~1h and come with a ROTATING refresh token (~90d). We store the refresh
-- token (encrypted at rest, same AES-256-GCM as the access token) plus both expiries so
-- getAccessToken can refresh a stale token before use — including for background jobs, which
-- have no App Bridge session token to re-exchange. Additive + idempotent. Legacy rows keep
-- NULL refresh/expiry and are replaced by an expiring token on the next embedded load.

alter table shop_credentials add column if not exists refresh_token_enc        text;
alter table shop_credentials add column if not exists access_token_expires_at  timestamptz;
alter table shop_credentials add column if not exists refresh_token_expires_at timestamptz;
