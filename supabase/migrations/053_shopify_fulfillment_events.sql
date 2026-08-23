-- ============================================================
-- 053_shopify_fulfillment_events.sql — audit Shopify fulfillment
-- webhook shipment_status values for flow trigger configuration.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_fulfillment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shopify_order_id TEXT,
  order_number TEXT,
  shopify_fulfillment_id TEXT NOT NULL,
  webhook_topic TEXT NOT NULL
    CHECK (webhook_topic IN ('fulfillments/create', 'fulfillments/update')),
  /** Normalized shipment_status; NULL when Shopify omits the field. */
  shipment_status TEXT,
  raw_shipment_status TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_fulfillment_events_account_received
  ON shopify_fulfillment_events (account_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopify_fulfillment_events_account_status
  ON shopify_fulfillment_events (account_id, shipment_status, received_at DESC);

ALTER TABLE shopify_fulfillment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_fulfillment_events_select ON shopify_fulfillment_events;
CREATE POLICY shopify_fulfillment_events_select ON shopify_fulfillment_events FOR SELECT
  USING (is_account_member(account_id));
