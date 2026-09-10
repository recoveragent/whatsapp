-- Magic Message: free-form text delivered as an image inside a utility
-- template when the WhatsApp 24-hour session window is closed.

CREATE TABLE IF NOT EXISTS inbox_magic_message_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  template_name TEXT NOT NULL DEFAULT 'magic_message',
  template_language TEXT NOT NULL DEFAULT 'en_US',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON inbox_magic_message_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inbox_magic_message_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inbox_magic_message_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_magic_message_settings_select ON inbox_magic_message_settings;
CREATE POLICY inbox_magic_message_settings_select ON inbox_magic_message_settings
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS inbox_magic_message_settings_insert ON inbox_magic_message_settings;
CREATE POLICY inbox_magic_message_settings_insert ON inbox_magic_message_settings
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS inbox_magic_message_settings_update ON inbox_magic_message_settings;
CREATE POLICY inbox_magic_message_settings_update ON inbox_magic_message_settings
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
