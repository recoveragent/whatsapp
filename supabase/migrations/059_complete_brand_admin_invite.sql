-- ============================================================
-- 059_complete_brand_admin_invite.sql
--
-- Super admins can finalize a brand admin invite when the
-- invitee already signed up (via Supabase invite email) but
-- never clicked "Accept invitation" on /join/<token>.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_brand_admin_invite(
  p_account_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_user_id UUID;
  v_existing_account_id UUID;
  v_assigned_role account_role_enum;
  v_brand_has_owner BOOLEAN;
  v_org_id UUID;
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
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending invitation for this brand' USING ERRCODE = '22023';
  END IF;

  IF v_inv.invited_email IS NULL OR trim(v_inv.invited_email) = '' THEN
    RAISE EXCEPTION 'Invitation has no invited email' USING ERRCODE = '22023';
  END IF;

  SELECT p.user_id, p.account_id
  INTO v_user_id, v_existing_account_id
  FROM profiles p
  WHERE lower(trim(p.email)) = lower(trim(v_inv.invited_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user has signed up with the invited email yet'
      USING ERRCODE = '22023';
  END IF;

  IF v_existing_account_id IS NOT NULL AND v_existing_account_id = p_account_id THEN
    RAISE EXCEPTION 'User is already a member of this brand'
      USING ERRCODE = '23505';
  END IF;

  IF v_existing_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'User is already linked to another workspace'
      USING ERRCODE = '23505';
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

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_user_id
  WHERE id = v_inv.id;

  RETURN p_account_id;
END;
$$;

ALTER FUNCTION public.complete_brand_admin_invite(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_brand_admin_invite(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_brand_admin_invite(UUID) TO authenticated;
