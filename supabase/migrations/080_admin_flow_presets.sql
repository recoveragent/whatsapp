-- ============================================================
-- 080_admin_flow_presets.sql
-- Org-scoped flow presets for super-admin multi-brand deploy.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_flow_presets (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_flow_id UUID,
  source_brand_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  source_brand_name TEXT,
  payload JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, slug),
  CONSTRAINT admin_flow_presets_slug_check
    CHECK (slug ~ '^[a-z0-9_]{1,128}$'),
  CONSTRAINT admin_flow_presets_title_check
    CHECK (length(trim(title)) > 0)
);

ALTER TABLE admin_flow_presets ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON admin_flow_presets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admin_flow_presets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_admin_flow_presets_org
  ON admin_flow_presets (organization_id);

DROP POLICY IF EXISTS admin_flow_presets_select ON admin_flow_presets;
CREATE POLICY admin_flow_presets_select
  ON admin_flow_presets FOR SELECT
  USING (is_org_super_admin());

DROP POLICY IF EXISTS admin_flow_presets_insert ON admin_flow_presets;
CREATE POLICY admin_flow_presets_insert
  ON admin_flow_presets FOR INSERT
  WITH CHECK (is_org_super_admin());

DROP POLICY IF EXISTS admin_flow_presets_update ON admin_flow_presets;
CREATE POLICY admin_flow_presets_update
  ON admin_flow_presets FOR UPDATE
  USING (is_org_super_admin())
  WITH CHECK (is_org_super_admin());

DROP POLICY IF EXISTS admin_flow_presets_delete ON admin_flow_presets;
CREATE POLICY admin_flow_presets_delete
  ON admin_flow_presets FOR DELETE
  USING (is_org_super_admin());
