-- ============================================================
-- 027_organizations.sql — Recover Agent company + brands
--
-- Single organization ("Recover Agent") with super admins who
-- provision brands (accounts) and invite brand admins. Super
-- admins switch into a brand via organization_admin_context and
-- act with admin-level access through an extended
-- is_account_member().
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_role_enum') THEN
    CREATE TYPE organization_role_enum AS ENUM ('super_admin');
  END IF;
END $$;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO organizations (name, slug)
VALUES ('Recover Agent', 'recover-agent')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- ORGANIZATION MEMBERS (super admins)
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role organization_role_enum NOT NULL DEFAULT 'super_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id),
  UNIQUE (user_id)
);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SUPER-ADMIN BRAND CONTEXT (which brand they are acting in)
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_admin_context (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  acting_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organization_admin_context ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BRANDS (accounts) BELONG TO THE ORGANIZATION
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;

UPDATE accounts
SET organization_id = (SELECT id FROM organizations WHERE slug = 'recover-agent' LIMIT 1)
WHERE organization_id IS NULL;

ALTER TABLE accounts ALTER COLUMN organization_id SET NOT NULL;

-- Brands may exist without an assigned owner until the brand admin
-- accepts their invite. Drop the one-account-per-owner constraint
-- that blocked a super admin from creating multiple brands.
DROP INDEX IF EXISTS idx_accounts_one_per_owner;
ALTER TABLE accounts ALTER COLUMN owner_user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_per_owner
  ON accounts(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- Optional label for who the invite was issued to.
ALTER TABLE account_invitations
  ADD COLUMN IF NOT EXISTS invited_email TEXT;

-- Super admins have no home brand on their profile.
ALTER TABLE profiles ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN account_role DROP NOT NULL;

-- ============================================================
-- HELPERS
-- ============================================================
CREATE OR REPLACE FUNCTION is_org_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.user_id = auth.uid()
      AND om.role = 'super_admin'
  );
$$;

ALTER FUNCTION is_org_super_admin() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_org_super_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT om.organization_id
  FROM organization_members om
  WHERE om.user_id = auth.uid()
  LIMIT 1;
$$;

ALTER FUNCTION current_organization_id() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION current_organization_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION get_super_admin_acting_account_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oac.acting_account_id
  FROM organization_admin_context oac
  WHERE oac.user_id = auth.uid()
    AND is_org_super_admin();
$$;

ALTER FUNCTION get_super_admin_acting_account_id() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION get_super_admin_acting_account_id() TO authenticated, service_role;

-- Extend membership: brand members OR super admin acting in a brand.
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND p.account_role IS NOT NULL
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  )
  OR (
    is_org_super_admin()
    AND EXISTS (
      SELECT 1
      FROM organization_admin_context oac
      JOIN accounts a ON a.id = oac.acting_account_id
      JOIN organization_members om
        ON om.organization_id = a.organization_id
       AND om.user_id = auth.uid()
      WHERE oac.user_id = auth.uid()
        AND oac.acting_account_id = target_account_id
        AND a.organization_id = om.organization_id
    )
    AND CASE min_role
          WHEN 'owner'  THEN 4
          WHEN 'admin'  THEN 3
          WHEN 'agent'  THEN 2
          WHEN 'viewer' THEN 1
        END <= 3
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- RLS — organizations + members + admin context
-- ============================================================
DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
    )
    OR is_org_super_admin()
  );

DROP POLICY IF EXISTS organization_members_select ON organization_members;
CREATE POLICY organization_members_select ON organization_members FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS organization_admin_context_select ON organization_admin_context;
DROP POLICY IF EXISTS organization_admin_context_modify ON organization_admin_context;
CREATE POLICY organization_admin_context_select ON organization_admin_context FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY organization_admin_context_modify ON organization_admin_context FOR ALL
  USING (user_id = auth.uid() AND is_org_super_admin())
  WITH CHECK (user_id = auth.uid() AND is_org_super_admin());

-- ============================================================
-- RLS — accounts (brands)
-- ============================================================
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_insert ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;

CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (
    is_account_member(id)
    OR (
      is_org_super_admin()
      AND organization_id = current_organization_id()
    )
  );

CREATE POLICY accounts_insert ON accounts FOR INSERT
  WITH CHECK (
    is_org_super_admin()
    AND organization_id = current_organization_id()
  );

CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (
    is_account_member(id, 'admin')
    OR (
      is_org_super_admin()
      AND organization_id = current_organization_id()
    )
  )
  WITH CHECK (
    is_account_member(id, 'admin')
    OR (
      is_org_super_admin()
      AND organization_id = current_organization_id()
    )
  );

-- ============================================================
-- RPC — set acting brand for super admin
-- ============================================================
CREATE OR REPLACE FUNCTION set_super_admin_acting_brand(p_account_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT is_org_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_org_id := current_organization_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization membership' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.id = p_account_id
      AND a.organization_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'Brand not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO organization_admin_context (user_id, acting_account_id, updated_at)
  VALUES (auth.uid(), p_account_id, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET acting_account_id = EXCLUDED.acting_account_id,
        updated_at = NOW();

  RETURN p_account_id;
END;
$$;

ALTER FUNCTION set_super_admin_acting_brand(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION set_super_admin_acting_brand(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_super_admin_acting_brand(UUID) TO authenticated;

-- ============================================================
-- RPC — create brand + owner invite (super admin only)
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

ALTER FUNCTION create_brand_with_admin_invite(TEXT, TEXT, TEXT, TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION create_brand_with_admin_invite(TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_brand_with_admin_invite(TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- RPC — claim super admin (one-time bootstrap via env email)
-- ============================================================
CREATE OR REPLACE FUNCTION claim_super_admin(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_email TEXT;
  v_old_account_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM organization_members) THEN
    RAISE EXCEPTION 'Super admin already assigned' USING ERRCODE = '23505';
  END IF;

  v_email := lower(trim(p_email));
  IF v_email IS NULL OR v_email <> lower(trim((SELECT email FROM auth.users WHERE id = v_user_id))) THEN
    RAISE EXCEPTION 'Email does not match' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_org_id FROM organizations WHERE slug = 'recover-agent' LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = '22023';
  END IF;

  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'super_admin');

  SELECT account_id INTO v_old_account_id
  FROM profiles WHERE user_id = v_user_id;

  UPDATE profiles
  SET account_id = NULL, account_role = NULL
  WHERE user_id = v_user_id;

  IF v_old_account_id IS NOT NULL THEN
    DELETE FROM accounts
    WHERE id = v_old_account_id
      AND owner_user_id = v_user_id
      AND NOT EXISTS (SELECT 1 FROM contacts WHERE account_id = v_old_account_id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM conversations WHERE account_id = v_old_account_id LIMIT 1);
  END IF;

  RETURN v_org_id;
END;
$$;

ALTER FUNCTION claim_super_admin(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION claim_super_admin(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_super_admin(TEXT) TO authenticated;

-- ============================================================
-- redeem_invitation — assign brand owner on owner-role redeem
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
    -- Invite-only signup path: profile may exist without account_id
    -- until first redeem. Skip orphan-account cleanup.
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

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  IF v_inv.role = 'owner' THEN
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

-- ============================================================
-- SIGNUP — profile only; no auto-created personal brand
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
