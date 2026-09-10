-- ============================================================
-- 079_admin_template_custom_presets.sql
-- Org-scoped custom templates saved to the admin gallery.
-- ============================================================

ALTER TABLE admin_template_preset_overrides
  ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE admin_template_preset_overrides
  DROP CONSTRAINT IF EXISTS admin_template_preset_overrides_custom_title_check;

ALTER TABLE admin_template_preset_overrides
  ADD CONSTRAINT admin_template_preset_overrides_custom_title_check
  CHECK (NOT is_custom OR (title IS NOT NULL AND length(trim(title)) > 0));
