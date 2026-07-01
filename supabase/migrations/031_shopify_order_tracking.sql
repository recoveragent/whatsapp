-- ============================================================
-- 031_shopify_order_tracking.sql — tracking + admin link fields
-- ============================================================

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT;
