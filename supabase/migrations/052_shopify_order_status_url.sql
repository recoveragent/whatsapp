-- ============================================================
-- 052_shopify_order_status_url.sql — customer order status page
--
-- Courier tracking URLs change domain per carrier. Shopify's
-- order_status_url stays on the store domain, so WhatsApp URL
-- buttons can use a single static prefix + dynamic suffix.
-- ============================================================

ALTER TABLE shopify_orders
  ADD COLUMN IF NOT EXISTS order_status_url TEXT;
