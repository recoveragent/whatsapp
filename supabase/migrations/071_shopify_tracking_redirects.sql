-- ============================================================
-- 071_shopify_tracking_redirects.sql — short platform URLs that
-- redirect to per-carrier Shopify tracking links (WhatsApp URL
-- buttons only allow a fixed domain + {{1}} suffix).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_tracking_redirects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  target_url TEXT NOT NULL,
  shopify_order_id TEXT,
  shopify_fulfillment_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopify_tracking_redirects_token_unique UNIQUE (token)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_tracking_redirects_fulfillment
  ON shopify_tracking_redirects (account_id, shopify_fulfillment_id)
  WHERE shopify_fulfillment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_tracking_redirects_token
  ON shopify_tracking_redirects (token);

ALTER TABLE shopify_tracking_redirects ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON shopify_tracking_redirects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_tracking_redirects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
