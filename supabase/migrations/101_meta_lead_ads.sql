-- Direct Meta Instant Form ingestion.

CREATE TABLE IF NOT EXISTS meta_lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  page_id TEXT NOT NULL,
  form_id TEXT,
  access_token TEXT NOT NULL,
  cadence_id UUID REFERENCES cadences(id) ON DELETE SET NULL,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  default_language TEXT NOT NULL DEFAULT 'en'
    CHECK (default_language IN ('en', 'hi')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_lead_sources_page_form
  ON meta_lead_sources (account_id, page_id, COALESCE(form_id, ''));
CREATE INDEX IF NOT EXISTS idx_meta_lead_sources_lookup
  ON meta_lead_sources (page_id, active);

ALTER TABLE meta_lead_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_lead_sources_select ON meta_lead_sources FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY meta_lead_sources_insert ON meta_lead_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY meta_lead_sources_update ON meta_lead_sources FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY meta_lead_sources_delete ON meta_lead_sources FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON meta_lead_sources;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_lead_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS meta_lead_deliveries (
  leadgen_id TEXT PRIMARY KEY,
  source_id UUID REFERENCES meta_lead_sources(id) ON DELETE SET NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  form_id TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'failed')),
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  error TEXT,
  webhook_payload JSONB,
  lead_payload JSONB,
  attempts INTEGER NOT NULL DEFAULT 1,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_lead_deliveries_account
  ON meta_lead_deliveries (account_id, created_at DESC);

ALTER TABLE meta_lead_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY meta_lead_deliveries_select ON meta_lead_deliveries FOR SELECT
  USING (account_id IS NOT NULL AND is_account_member(account_id));

DROP TRIGGER IF EXISTS set_updated_at ON meta_lead_deliveries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_lead_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN meta_lead_sources.access_token IS
  'Page/system-user access token encrypted with ENCRYPTION_KEY.';
COMMENT ON COLUMN meta_lead_sources.form_id IS
  'Specific Instant Form ID, or NULL as the fallback for every form on the Page.';
