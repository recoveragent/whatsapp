-- ============================================================
-- 20261126120000_admin_template_defaults.sql
-- Super admins mark gallery templates (built-in or custom) as
-- "default". Every brand in the organization then sees those
-- templates in its Template library, waiting for review, and can
-- approve or edit them before they are submitted to Meta.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_template_defaults (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, slug),
  CONSTRAINT admin_template_defaults_slug_check
    CHECK (slug ~ '^[a-z0-9_]{1,128}$')
);

ALTER TABLE admin_template_defaults ENABLE ROW LEVEL SECURITY;

-- Brand users never read this table directly: the brand-side library
-- API resolves defaults with the service-role client.
DROP POLICY IF EXISTS admin_template_defaults_select ON admin_template_defaults;
CREATE POLICY admin_template_defaults_select
  ON admin_template_defaults FOR SELECT
  USING (is_org_super_admin());

DROP POLICY IF EXISTS admin_template_defaults_insert ON admin_template_defaults;
CREATE POLICY admin_template_defaults_insert
  ON admin_template_defaults FOR INSERT
  WITH CHECK (is_org_super_admin());

DROP POLICY IF EXISTS admin_template_defaults_delete ON admin_template_defaults;
CREATE POLICY admin_template_defaults_delete
  ON admin_template_defaults FOR DELETE
  USING (is_org_super_admin());
