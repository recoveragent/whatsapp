-- ============================================================
-- 054_shopify_flow_fulfillment_log.sql — one flow run per order +
-- shipment status (dedupe fulfillment webhook retries/updates).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_flow_fulfillment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  order_key TEXT NOT NULL,
  shipment_status_key TEXT NOT NULL,
  flow_run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, flow_id, order_key, shipment_status_key)
);

CREATE INDEX IF NOT EXISTS idx_shopify_flow_fulfillment_log_account
  ON shopify_flow_fulfillment_log (account_id, created_at DESC);

ALTER TABLE shopify_flow_fulfillment_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_flow_fulfillment_log_select ON shopify_flow_fulfillment_log;
CREATE POLICY shopify_flow_fulfillment_log_select ON shopify_flow_fulfillment_log FOR SELECT
  USING (is_account_member(account_id));
