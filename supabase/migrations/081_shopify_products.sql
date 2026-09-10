-- ============================================================
-- 081_shopify_products.sql — Cached Shopify catalog for Sell on WhatsApp
--
-- Shopify is the source of truth; wacrm mirrors active products
-- for inbox search and flow product sends (checkout via cart link).
-- ============================================================

ALTER TABLE shopify_config
  ADD COLUMN IF NOT EXISTS sell_on_whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS products_last_synced_at TIMESTAMPTZ;

-- ============================================================
-- SHOPIFY_PRODUCTS — one row per product (default variant)
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shopify_product_id BIGINT NOT NULL,
  shopify_variant_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  variant_title TEXT,
  handle TEXT,
  price TEXT NOT NULL,
  compare_at_price TEXT,
  currency TEXT,
  image_url TEXT,
  inventory_quantity INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'draft')),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_products_account_title
  ON shopify_products (account_id, title);

CREATE INDEX IF NOT EXISTS idx_shopify_products_account_variant
  ON shopify_products (account_id, shopify_variant_id);

CREATE INDEX IF NOT EXISTS idx_shopify_products_account_status
  ON shopify_products (account_id, status)
  WHERE status = 'active';

ALTER TABLE shopify_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_products_select ON shopify_products;
DROP POLICY IF EXISTS shopify_products_insert ON shopify_products;
DROP POLICY IF EXISTS shopify_products_update ON shopify_products;
DROP POLICY IF EXISTS shopify_products_delete ON shopify_products;
CREATE POLICY shopify_products_select ON shopify_products FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY shopify_products_insert ON shopify_products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY shopify_products_update ON shopify_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY shopify_products_delete ON shopify_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON shopify_products;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SHOPIFY_PRODUCT_SYNC_RUNS — audit trail for catalog sync
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_product_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'success', 'failed')),
  products_upserted INTEGER NOT NULL DEFAULT 0,
  products_archived INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shopify_product_sync_runs_account
  ON shopify_product_sync_runs (account_id, started_at DESC);

ALTER TABLE shopify_product_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_product_sync_runs_select ON shopify_product_sync_runs;
CREATE POLICY shopify_product_sync_runs_select ON shopify_product_sync_runs FOR SELECT
  USING (is_account_member(account_id));
