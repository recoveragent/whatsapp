-- ============================================================
-- 060_resend_brand_admin_invite.sql
--
-- Super admins can issue a fresh invite for a brand that still
-- has no owner (e.g. after deleting the auth user and starting
-- over with the same email). Revokes outstanding invites first.
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resend_brand_admin_invite(
  p_account_id UUID,
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
  v_email TEXT;
  v_inv_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT is_org_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_org_id := current_organization_id();
  v_email := NULLIF(lower(trim(p_admin_email)), '');

  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'Valid admin email is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = p_account_id
      AND organization_id = v_org_id
      AND owner_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Brand not found or already has an admin assigned'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM account_invitations
  WHERE account_id = p_account_id
    AND accepted_at IS NULL;

  INSERT INTO account_invitations (
    account_id, token_hash, role, created_by_user_id,
    invited_email, expires_at
  )
  VALUES (
    p_account_id, p_token_hash, 'admin', auth.uid(),
    v_email, p_expires_at
  )
  RETURNING id INTO v_inv_id;

  RETURN json_build_object(
    'account_id', p_account_id,
    'invitation_id', v_inv_id
  );
END;
$$;

ALTER FUNCTION public.resend_brand_admin_invite(UUID, TEXT, TEXT, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resend_brand_admin_invite(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resend_brand_admin_invite(UUID, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
