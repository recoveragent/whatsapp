-- ============================================================
-- 063_super_admin_invitations_rls.sql
--
-- Super admins could not read account_invitations via RLS
-- (policy required account membership), so the brands admin UI
-- never saw pending/expired invites. Allow org super admins to
-- read invites for brands in their organization.
--
-- Also extends complete_brand_admin_invite with optional email
-- when the invite row is missing or has no invited_email.
-- ============================================================

DROP POLICY IF EXISTS account_invitations_select ON account_invitations;

CREATE POLICY account_invitations_select ON account_invitations FOR SELECT
  USING (
    is_account_member(account_id, 'admin')
    OR (
      is_org_super_admin()
      AND EXISTS (
        SELECT 1
        FROM accounts a
        WHERE a.id = account_invitations.account_id
          AND a.organization_id = current_organization_id()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.complete_brand_admin_invite(
  p_account_id UUID,
  p_admin_email TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_user_id UUID;
  v_existing_account_id UUID;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
  v_assigned_role account_role_enum;
  v_brand_has_owner BOOLEAN;
  v_org_id UUID;
  v_target_email TEXT;
  v_has_invite_row BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT is_org_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_org_id := current_organization_id();

  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = p_account_id
      AND organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Brand not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE account_id = p_account_id
    AND accepted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_has_invite_row := TRUE;
    IF v_inv.invited_email IS NOT NULL AND trim(v_inv.invited_email) <> '' THEN
      v_target_email := lower(trim(v_inv.invited_email));
    ELSIF p_admin_email IS NOT NULL AND trim(p_admin_email) <> '' THEN
      v_target_email := lower(trim(p_admin_email));
    ELSE
      RAISE EXCEPTION 'Invitation has no invited email; pass adminEmail'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_admin_email IS NULL OR trim(p_admin_email) = '' THEN
      RAISE EXCEPTION 'No pending invitation for this brand; pass adminEmail'
        USING ERRCODE = '22023';
    END IF;
    v_target_email := lower(trim(p_admin_email));
    v_inv.account_id := p_account_id;
    v_inv.role := 'admin';
  END IF;

  SELECT p.user_id, p.account_id
  INTO v_user_id, v_existing_account_id
  FROM profiles p
  WHERE lower(trim(p.email)) = v_target_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    SELECT u.id
    INTO v_user_id
    FROM auth.users u
    WHERE lower(trim(u.email)) = v_target_email
    LIMIT 1;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user has signed up with the invited email yet'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
  SELECT
    u.id,
    COALESCE(u.raw_user_meta_data->>'full_name', ''),
    COALESCE(u.email, ''),
    NULL,
    NULL
  FROM auth.users u
  WHERE u.id = v_user_id
  ON CONFLICT (user_id) DO NOTHING;

  SELECT p.account_id
  INTO v_existing_account_id
  FROM profiles p
  WHERE p.user_id = v_user_id;

  IF v_existing_account_id IS NOT NULL AND v_existing_account_id = p_account_id THEN
    RAISE EXCEPTION 'User is already a member of this brand'
      USING ERRCODE = '23505';
  END IF;

  IF v_existing_account_id IS NOT NULL THEN
    SELECT a.owner_user_id
    INTO v_old_account_owner
    FROM accounts a
    WHERE a.id = v_existing_account_id;

    IF v_old_account_owner IS NOT NULL AND v_old_account_owner <> v_user_id THEN
      RAISE EXCEPTION 'User is already in a shared account; use a different email for this brand'
        USING ERRCODE = '23505';
    END IF;

    v_old_account_id := v_existing_account_id;
  END IF;

  SELECT owner_user_id IS NOT NULL INTO v_brand_has_owner
  FROM accounts
  WHERE id = p_account_id;

  v_assigned_role := CASE
    WHEN NOT v_brand_has_owner AND v_inv.role = 'admin' THEN 'owner'::account_role_enum
    ELSE v_inv.role
  END;

  UPDATE profiles
  SET account_id = p_account_id,
      account_role = v_assigned_role
  WHERE user_id = v_user_id;

  IF v_assigned_role = 'owner' THEN
    UPDATE accounts
    SET owner_user_id = v_user_id
    WHERE id = p_account_id;
  END IF;

  IF v_has_invite_row THEN
    UPDATE account_invitations
    SET accepted_at = NOW(),
        accepted_by_user_id = v_user_id
    WHERE id = v_inv.id;
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

    IF NOT v_has_data THEN
      DELETE FROM accounts WHERE id = v_old_account_id;
    END IF;
  END IF;

  RETURN p_account_id;
END;
$$;

ALTER FUNCTION public.complete_brand_admin_invite(UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_brand_admin_invite(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_brand_admin_invite(UUID, TEXT) TO authenticated;
