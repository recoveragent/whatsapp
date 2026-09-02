-- ============================================================
-- 072_shopify_order_shipment_status.sql — carrier scan status
-- from Shopify fulfillments (in_transit, delivered, …).
-- ============================================================

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS shipment_status TEXT;
