-- ============================================================
-- 078_admin_template_preset_overrides.sql
-- Super-admin saved edits to predefined WhatsApp template presets.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_template_preset_overrides (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT,
  description TEXT,
  payload JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, slug),
  CONSTRAINT admin_template_preset_overrides_slug_check
    CHECK (slug ~ '^[a-z0-9_]{1,128}$')
);

ALTER TABLE admin_template_preset_overrides ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON admin_template_preset_overrides;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admin_template_preset_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_admin_template_preset_overrides_org
  ON admin_template_preset_overrides (organization_id);

DROP POLICY IF EXISTS admin_template_preset_overrides_select
  ON admin_template_preset_overrides;
CREATE POLICY admin_template_preset_overrides_select
  ON admin_template_preset_overrides FOR SELECT
  USING (is_org_super_admin());

DROP POLICY IF EXISTS admin_template_preset_overrides_insert
  ON admin_template_preset_overrides;
CREATE POLICY admin_template_preset_overrides_insert
  ON admin_template_preset_overrides FOR INSERT
  WITH CHECK (is_org_super_admin());

DROP POLICY IF EXISTS admin_template_preset_overrides_update
  ON admin_template_preset_overrides;
CREATE POLICY admin_template_preset_overrides_update
  ON admin_template_preset_overrides FOR UPDATE
  USING (is_org_super_admin())
  WITH CHECK (is_org_super_admin());

DROP POLICY IF EXISTS admin_template_preset_overrides_delete
  ON admin_template_preset_overrides;
CREATE POLICY admin_template_preset_overrides_delete
  ON admin_template_preset_overrides FOR DELETE
  USING (is_org_super_admin());
