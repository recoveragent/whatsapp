-- ============================================================
-- 066_shopify_order_lifecycle_status.sql — open / cancelled / archived
-- ============================================================

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS order_status TEXT;
