-- A merchant who signs up on the Recover Agent dashboard gets a WhatsApp CRM
-- workspace the first time they open it, instead of a login with no workspace.
-- Existing brands, invitations and super admins are unaffected.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS dashboard_company_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_dashboard_company_id_key
  ON accounts (dashboard_company_id)
  WHERE dashboard_company_id IS NOT NULL;

COMMENT ON COLUMN accounts.dashboard_company_id IS
  'The Recover Agent dashboard company this workspace was created for at self-serve signup. NULL for brands created by invitation.';

-- Server only. The caller has already verified the one-time dashboard ticket.
-- Ends in the same state as complete_brand_admin_invite for a brand with no
-- owner: accounts.owner_user_id set and the profile linked as owner. Safe to
-- call repeatedly; never moves someone who already has a workspace.
CREATE OR REPLACE FUNCTION provision_dashboard_signup_workspace(
  p_user_id uuid,
  p_company_id uuid,
  p_name text,
  p_ecommerce_platform text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
  v_account_id uuid;
  v_owner uuid;
  v_org_id uuid;
  v_org_count integer;
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
BEGIN
  IF p_user_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'User and company are required' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Brand name is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_ecommerce_platform, '') NOT IN ('shopify', 'woocommerce') THEN
    RAISE EXCEPTION 'Unknown ecommerce platform' USING ERRCODE = '22023';
  END IF;

  -- Two tabs opening at once must not create two workspaces.
  PERFORM pg_advisory_xact_lock(hashtext('dashboard-signup:' || p_company_id::text));

  INSERT INTO profiles (user_id, full_name, email)
  SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', ''), COALESCE(u.email, '')
  FROM auth.users u
  WHERE u.id = p_user_id
  ON CONFLICT (user_id) DO NOTHING;

  SELECT p.account_id, lower(trim(p.email))
  INTO v_account_id, v_email
  FROM profiles p
  WHERE p.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = '22023';
  END IF;

  IF v_account_id IS NOT NULL THEN
    RETURN json_build_object('account_id', v_account_id, 'created', false);
  END IF;

  -- Platform staff pick a brand to act in; they never get their own workspace.
  IF EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id = p_user_id) THEN
    RETURN json_build_object('skipped', 'organization_member');
  END IF;

  SELECT a.id, a.owner_user_id
  INTO v_account_id, v_owner
  FROM accounts a
  WHERE a.dashboard_company_id = p_company_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_owner IS NOT NULL AND v_owner <> p_user_id THEN
      RAISE EXCEPTION 'This company''s workspace belongs to another user' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- The team may already have invited this person to a brand they set up by
    -- hand. Let them accept it rather than creating a second workspace.
    IF EXISTS (
      SELECT 1 FROM account_invitations i
      WHERE lower(trim(i.invited_email)) = v_email
        AND i.accepted_at IS NULL
        AND i.expires_at > now()
    ) THEN
      RETURN json_build_object('skipped', 'pending_invitation');
    END IF;

    SELECT count(*), min(o.id::text)::uuid INTO v_org_count, v_org_id FROM organizations o;
    IF v_org_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one organization, found %', v_org_count USING ERRCODE = 'P0001';
    END IF;

    -- The accounts trigger seeds the wallet and message pricing.
    INSERT INTO accounts (name, organization_id, owner_user_id, brand_category, ecommerce_platform, dashboard_company_id)
    VALUES (
      v_name, v_org_id, p_user_id, 'ecommerce',
      p_ecommerce_platform::ecommerce_platform_enum, p_company_id
    )
    RETURNING id INTO v_account_id;

    UPDATE profiles SET account_id = v_account_id, account_role = 'owner' WHERE user_id = p_user_id;
    RETURN json_build_object('account_id', v_account_id, 'created', true);
  END IF;

  UPDATE accounts SET owner_user_id = p_user_id WHERE id = v_account_id AND owner_user_id IS NULL;
  UPDATE profiles SET account_id = v_account_id, account_role = 'owner' WHERE user_id = p_user_id;
  RETURN json_build_object('account_id', v_account_id, 'created', false);
END;
$$;

REVOKE ALL ON FUNCTION provision_dashboard_signup_workspace(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION provision_dashboard_signup_workspace(uuid, uuid, text, text) TO service_role;
