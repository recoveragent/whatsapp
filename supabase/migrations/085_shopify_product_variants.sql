-- ============================================================
-- 085_shopify_product_variants.sql
-- Store one catalog row per Shopify variant (not just default).
-- ============================================================

ALTER TABLE shopify_products
  DROP CONSTRAINT IF EXISTS shopify_products_account_id_shopify_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_products_account_variant_unique
  ON shopify_products (account_id, shopify_variant_id);

CREATE INDEX IF NOT EXISTS idx_shopify_products_account_product
  ON shopify_products (account_id, shopify_product_id);
