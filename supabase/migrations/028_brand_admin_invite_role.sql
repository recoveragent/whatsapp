-- ============================================================
-- 028_brand_admin_invite_role.sql
--
-- account_invitations forbids role = 'owner' (migration 017).
-- create_brand_with_admin_invite (027) incorrectly used 'owner'.
-- Brand admins are invited as 'admin'; on redeem into a brand with
-- no owner yet, they are promoted to owner.
-- ============================================================

CREATE OR REPLACE FUNCTION create_brand_with_admin_invite(
  p_brand_name TEXT,
  p_admin_email TEXT,
  p_token_hash TEXT,
  p_expires_at TIMESTAMPTZ
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

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Brand name is required' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Valid admin email is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, organization_id, owner_user_id)
  VALUES (v_name, v_org_id, NULL)
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

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
  v_assigned_role account_role_enum;
  v_brand_has_owner BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  LEFT JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL AND NOT is_org_super_admin() THEN
    NULL;
  ELSIF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id IS NOT NULL AND v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_id IS NOT NULL AND v_old_account_owner IS NOT NULL
     AND v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM contacts WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
      UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
      LIMIT 1
    ) INTO v_has_data;

    IF v_has_data THEN
      RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT owner_user_id IS NOT NULL INTO v_brand_has_owner
  FROM accounts WHERE id = v_inv.account_id;

  -- First admin of a new brand becomes owner.
  v_assigned_role := CASE
    WHEN NOT v_brand_has_owner AND v_inv.role = 'admin' THEN 'owner'::account_role_enum
    ELSE v_inv.role
  END;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_assigned_role
  WHERE user_id = v_caller_id;

  IF v_assigned_role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_caller_id
    WHERE id = v_inv.account_id;
  END IF;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  IF v_old_account_id IS NOT NULL THEN
    DELETE FROM accounts WHERE id = v_old_account_id;
  END IF;

  RETURN v_inv.account_id;
END;
$$;
