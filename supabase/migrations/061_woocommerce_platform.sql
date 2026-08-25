-- ============================================================
-- 061_woocommerce_platform.sql — One ecommerce platform per brand
-- (Shopify OR WooCommerce) + WooCommerce connection tables.
-- Idempotent — safe to re-run.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE ecommerce_platform_enum AS ENUM ('shopify', 'woocommerce');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ecommerce_platform ecommerce_platform_enum;

-- Existing ecommerce brands default to Shopify.
UPDATE accounts
SET ecommerce_platform = 'shopify'
WHERE brand_category = 'ecommerce'
  AND ecommerce_platform IS NULL;

-- ============================================================
-- WOOCOMMERCE_CONFIG — one store per account
-- ============================================================
CREATE TABLE IF NOT EXISTS woocommerce_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_url TEXT NOT NULL,
  consumer_key TEXT NOT NULL,
  consumer_secret TEXT NOT NULL,
  webhook_secret TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_woocommerce_config_store_url
  ON woocommerce_config (store_url);

CREATE INDEX IF NOT EXISTS idx_woocommerce_config_account_id
  ON woocommerce_config (account_id);

ALTER TABLE woocommerce_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woocommerce_config_select ON woocommerce_config;
DROP POLICY IF EXISTS woocommerce_config_insert ON woocommerce_config;
DROP POLICY IF EXISTS woocommerce_config_update ON woocommerce_config;
DROP POLICY IF EXISTS woocommerce_config_delete ON woocommerce_config;
CREATE POLICY woocommerce_config_select ON woocommerce_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY woocommerce_config_insert ON woocommerce_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY woocommerce_config_update ON woocommerce_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY woocommerce_config_delete ON woocommerce_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- WOOCOMMERCE_ORDERS — order cache for inbox sidebar
-- ============================================================
CREATE TABLE IF NOT EXISTS woocommerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_phone TEXT,
  woocommerce_order_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  total_price TEXT,
  currency TEXT,
  payment_status TEXT,
  payment_gateway TEXT,
  fulfillment_status TEXT,
  order_status_url TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  ordered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, woocommerce_order_id)
);

CREATE INDEX IF NOT EXISTS idx_woocommerce_orders_contact
  ON woocommerce_orders (account_id, contact_id, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_woocommerce_orders_phone
  ON woocommerce_orders (account_id, customer_phone);

ALTER TABLE woocommerce_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS woocommerce_orders_select ON woocommerce_orders;
CREATE POLICY woocommerce_orders_select ON woocommerce_orders FOR SELECT
  USING (is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON woocommerce_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON woocommerce_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON woocommerce_orders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON woocommerce_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Brand creation RPC — accept ecommerce platform for ecommerce brands
-- ============================================================
CREATE OR REPLACE FUNCTION create_brand_with_admin_invite(
  p_brand_name TEXT,
  p_admin_email TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_brand_category brand_category_enum DEFAULT 'lead_gen',
  p_ecommerce_platform ecommerce_platform_enum DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_account_id UUID;
  v_inv_id UUID;
  v_name TEXT;
  v_email TEXT;
  v_category brand_category_enum;
  v_platform ecommerce_platform_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT is_org_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_org_id := current_organization_id();
  v_name := NULLIF(trim(p_brand_name), '');
  v_email := NULLIF(lower(trim(p_admin_email)), '');
  v_category := COALESCE(p_brand_category, 'lead_gen');

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Brand name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Valid admin email is required' USING ERRCODE = '22023';
  END IF;

  IF v_category = 'ecommerce' THEN
    v_platform := COALESCE(p_ecommerce_platform, 'shopify');
  ELSE
    v_platform := NULL;
  END IF;

  INSERT INTO accounts (name, organization_id, owner_user_id, brand_category, ecommerce_platform)
  VALUES (v_name, v_org_id, NULL, v_category, v_platform)
  RETURNING id INTO v_account_id;

  INSERT INTO account_invitations (
    account_id, token_hash, role, created_by_user_id,
    invited_email, expires_at
  )
  VALUES (
    v_account_id, p_token_hash, 'admin', auth.uid(),
    v_email, p_expires_at
  )
  RETURNING id INTO v_inv_id;

  RETURN json_build_object(
    'account_id', v_account_id,
    'invitation_id', v_inv_id
  );
END;
$$;

ALTER FUNCTION create_brand_with_admin_invite(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, brand_category_enum, ecommerce_platform_enum
) OWNER TO postgres;
REVOKE ALL ON FUNCTION create_brand_with_admin_invite(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, brand_category_enum, ecommerce_platform_enum
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_brand_with_admin_invite(
  TEXT, TEXT, TEXT, TIMESTAMPTZ, brand_category_enum, ecommerce_platform_enum
) TO authenticated;
