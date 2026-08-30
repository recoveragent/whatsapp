-- ============================================================
-- 067_shopify_order_product_shipping.sql — inbox order card fields
-- ============================================================

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS product_title TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT;
