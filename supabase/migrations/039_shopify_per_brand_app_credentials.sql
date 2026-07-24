-- ============================================================
-- 039_shopify_per_brand_app_credentials.sql
--
-- Brands connect with their own Shopify custom app (Client ID +
-- Secret) instead of a single Recover Agent shared Partner app.
-- ============================================================

ALTER TABLE shopify_config
  ADD COLUMN IF NOT EXISTS api_key TEXT,
  ADD COLUMN IF NOT EXISTS api_secret TEXT;

ALTER TABLE shopify_oauth_states
  ADD COLUMN IF NOT EXISTS api_key TEXT,
  ADD COLUMN IF NOT EXISTS api_secret TEXT;

COMMENT ON COLUMN shopify_config.api_key IS
  'Shopify custom app Client ID for this brand (plaintext).';
COMMENT ON COLUMN shopify_config.api_secret IS
  'Shopify custom app Client Secret, encrypted with ENCRYPTION_KEY.';
COMMENT ON COLUMN shopify_oauth_states.api_key IS
  'Pending OAuth Client ID (plaintext).';
COMMENT ON COLUMN shopify_oauth_states.api_secret IS
  'Pending OAuth Client Secret, encrypted.';
