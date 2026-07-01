-- ============================================================
-- 032_brand_category.sql — Ecommerce vs lead gen per brand
-- ============================================================

DO $$ BEGIN
  CREATE TYPE brand_category_enum AS ENUM ('lead_gen', 'ecommerce');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS brand_category brand_category_enum NOT NULL DEFAULT 'lead_gen';

CREATE OR REPLACE FUNCTION create_brand_with_admin_invite(
  p_brand_name TEXT,
  p_admin_email TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_brand_category brand_category_enum DEFAULT 'lead_gen'
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

  INSERT INTO accounts (name, organization_id, owner_user_id, brand_category)
  VALUES (v_name, v_org_id, NULL, v_category)
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

ALTER FUNCTION create_brand_with_admin_invite(TEXT, TEXT, TEXT, TIMESTAMPTZ, brand_category_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION create_brand_with_admin_invite(TEXT, TEXT, TEXT, TIMESTAMPTZ, brand_category_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_brand_with_admin_invite(TEXT, TEXT, TEXT, TIMESTAMPTZ, brand_category_enum) TO authenticated;
