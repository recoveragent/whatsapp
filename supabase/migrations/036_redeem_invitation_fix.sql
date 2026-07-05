-- ============================================================
-- 036_redeem_invitation_fix.sql
--
-- Fixes "Caller has no profile" on brand invite accept when:
--   - invite-only users have a profile row but account_id IS NULL
--     (027+ signup) and production still had an older redeem, OR
--   - auth user exists but profiles row was never created, OR
--   - super admin tries to accept a brand invite (misleading error).
-- Idempotent — safe to run multiple times.
-- ============================================================

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
  v_profile_exists BOOLEAN;
  v_rows_updated INTEGER;
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

  -- Super admins manage brands from /admin — they must not redeem
  -- brand-admin invites while logged in as ops.
  IF is_org_super_admin() THEN
    RAISE EXCEPTION
      'Sign out of your super admin account, then open this invite link again with the invited email (or use Open as admin under Brands).'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = v_caller_id
  ) INTO v_profile_exists;

  IF NOT v_profile_exists THEN
    INSERT INTO profiles (user_id, full_name, email, account_id, account_role)
    SELECT
      u.id,
      COALESCE(u.raw_user_meta_data->>'full_name', ''),
      COALESCE(u.email, ''),
      NULL,
      NULL
    FROM auth.users u
    WHERE u.id = v_caller_id;
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  LEFT JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not load your profile. Try signing out and back in.'
      USING ERRCODE = '42501';
  END IF;

  -- Invite-only signup: profile exists, account_id NULL until redeem.

  IF v_old_account_id IS NOT NULL AND v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_id IS NOT NULL AND v_old_account_owner IS NOT NULL
     AND v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '42501';
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

  v_assigned_role := CASE
    WHEN NOT v_brand_has_owner AND v_inv.role = 'admin' THEN 'owner'::account_role_enum
    ELSE v_inv.role
  END;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_assigned_role
  WHERE user_id = v_caller_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'Could not update your profile. Try signing out and back in.'
      USING ERRCODE = '42501';
  END IF;

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

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
