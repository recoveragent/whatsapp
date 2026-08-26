-- ============================================================
-- 065_woocommerce_customer_sync.sql — WooCommerce customer sync,
-- purchase stats, and audience segment support.
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS woocommerce_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_woo_customer
  ON contacts (account_id, woocommerce_customer_id)
  WHERE woocommerce_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_woo_customer_lookup
  ON contacts (account_id, woocommerce_customer_id);

-- ============================================================
-- WOOCOMMERCE_CUSTOMER_STATS — aggregated purchase metrics per contact
-- ============================================================
CREATE TABLE IF NOT EXISTS woocommerce_customer_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  woocommerce_customer_id TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  total_spend NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency TEXT,
  last_order_at TIMESTAMPTZ,
  first_order_at TIMESTAMPTZ,
  latest_payment_status TEXT,
  preferred_payment_gateway TEXT,
  billing_country TEXT,
  billing_state TEXT,
  billing_city TEXT,
  is_paying_customer BOOLEAN NOT NULL DEFAULT false,
  customer_since TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id),
  UNIQUE (account_id, woocommerce_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_woo_customer_stats_account
  ON woocommerce_customer_stats (account_id);

CREATE INDEX IF NOT EXISTS idx_woo_customer_stats_orders
  ON woocommerce_customer_stats (account_id, order_count);

CREATE INDEX IF NOT EXISTS idx_woo_customer_stats_last_order
  ON woocommerce_customer_stats (account_id, last_order_at DESC);

ALTER TABLE woocommerce_customer_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woocommerce_customer_stats_select ON woocommerce_customer_stats;
CREATE POLICY woocommerce_customer_stats_select ON woocommerce_customer_stats FOR SELECT
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON woocommerce_customer_stats;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON woocommerce_customer_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Bulk sync progress on woocommerce_config
-- ============================================================
ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_status TEXT NOT NULL DEFAULT 'idle';

ALTER TABLE woocommerce_config
  DROP CONSTRAINT IF EXISTS woocommerce_config_customer_sync_status_check;

ALTER TABLE woocommerce_config
  ADD CONSTRAINT woocommerce_config_customer_sync_status_check
  CHECK (customer_sync_status IN ('idle', 'running', 'completed', 'failed'));

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_page INTEGER NOT NULL DEFAULT 1;

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_total INTEGER;

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_processed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_skipped_no_phone INTEGER NOT NULL DEFAULT 0;

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_started_at TIMESTAMPTZ;

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_completed_at TIMESTAMPTZ;

ALTER TABLE woocommerce_config
  ADD COLUMN IF NOT EXISTS customer_sync_error TEXT;
