-- ============================================================
-- 082_whatsapp_product_sends.sql — audit trail for product cards
-- sent from inbox or flows (Sell on WhatsApp).
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_product_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  shopify_variant_id BIGINT NOT NULL,
  product_title TEXT NOT NULL,
  checkout_url TEXT NOT NULL,
  sent_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  flow_run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_product_sends_conversation
  ON whatsapp_product_sends (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_product_sends_account
  ON whatsapp_product_sends (account_id, created_at DESC);

ALTER TABLE whatsapp_product_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_product_sends_select ON whatsapp_product_sends;
CREATE POLICY whatsapp_product_sends_select ON whatsapp_product_sends FOR SELECT
  USING (is_account_member(account_id));
