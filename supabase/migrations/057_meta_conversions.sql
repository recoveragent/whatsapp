-- Meta Conversions API for Business Messaging (CTWA lead quality feedback).
-- Sends LeadSubmitted / QualifiedLead events back to Meta when CRM signals fire.

CREATE TABLE IF NOT EXISTS meta_conversions_config (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  dataset_id TEXT,
  test_event_code TEXT,
  partner_agent TEXT NOT NULL DEFAULT 'recoveragent',
  send_on_replied BOOLEAN NOT NULL DEFAULT true,
  send_on_qualified BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE meta_conversions_config IS
  'Per-brand Meta CAPI settings for WhatsApp business messaging conversions.';

ALTER TABLE meta_conversions_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_conversions_config_select ON meta_conversions_config;
DROP POLICY IF EXISTS meta_conversions_config_write ON meta_conversions_config;
CREATE POLICY meta_conversions_config_select ON meta_conversions_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY meta_conversions_config_write ON meta_conversions_config FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON meta_conversions_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_conversions_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Idempotency log — one row per (account, trigger_key).
CREATE TABLE IF NOT EXISTS meta_conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  skip_reason TEXT,
  meta_event_id TEXT,
  error_message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_meta_conversion_events_contact
  ON meta_conversion_events (contact_id, created_at DESC);

ALTER TABLE meta_conversion_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_conversion_events_select ON meta_conversion_events;
CREATE POLICY meta_conversion_events_select ON meta_conversion_events FOR SELECT
  USING (is_account_member(account_id));
