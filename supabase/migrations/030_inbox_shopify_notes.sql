-- ============================================================
-- 030_inbox_shopify_notes.sql — Shopify order cache + agent-only
-- conversation private notes. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_phone TEXT,
  shopify_order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  total_price TEXT,
  currency TEXT,
  payment_status TEXT,
  payment_gateway TEXT,
  fulfillment_status TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  ordered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_orders_contact
  ON shopify_orders (account_id, contact_id, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopify_orders_phone
  ON shopify_orders (account_id, customer_phone);

ALTER TABLE shopify_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_orders_select ON shopify_orders;
CREATE POLICY shopify_orders_select ON shopify_orders FOR SELECT
  USING (is_account_member(account_id));

CREATE TABLE IF NOT EXISTS conversation_private_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_private_notes_conv
  ON conversation_private_notes (conversation_id, created_at DESC);

ALTER TABLE conversation_private_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conversation_private_notes_select ON conversation_private_notes;
DROP POLICY IF EXISTS conversation_private_notes_insert ON conversation_private_notes;
CREATE POLICY conversation_private_notes_select ON conversation_private_notes FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY conversation_private_notes_insert ON conversation_private_notes FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON shopify_orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
