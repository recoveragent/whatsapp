-- ============================================================
-- 083_shopify_product_link_recovery.sql
-- Remind customers who received a product checkout link but did not order.
-- ============================================================

ALTER TABLE shopify_config
  ADD COLUMN IF NOT EXISTS product_link_recovery_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS product_link_recovery_delay_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (product_link_recovery_delay_minutes >= 5 AND product_link_recovery_delay_minutes <= 10080);

CREATE TABLE IF NOT EXISTS shopify_pending_product_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_send_id UUID NOT NULL REFERENCES whatsapp_product_sends(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  shopify_variant_id BIGINT NOT NULL,
  product_title TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'sent', 'cancelled', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, product_send_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_pending_product_links_due
  ON shopify_pending_product_links (run_at)
  WHERE status = 'pending';

ALTER TABLE shopify_pending_product_links ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON shopify_pending_product_links;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_pending_product_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
