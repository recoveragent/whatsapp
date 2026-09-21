ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID REFERENCES whatsapp_config(id) ON DELETE CASCADE;

UPDATE message_templates mt
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE mt.account_id = wc.account_id
  AND mt.whatsapp_config_id IS NULL
  AND wc.id = (
    SELECT id FROM whatsapp_config WHERE account_id = mt.account_id ORDER BY created_at ASC LIMIT 1
  );

DROP INDEX IF EXISTS message_templates_user_name_language_key;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_config_name_language_key
  ON message_templates (account_id, whatsapp_config_id, name, language);
CREATE INDEX IF NOT EXISTS idx_message_templates_whatsapp_config
  ON message_templates (whatsapp_config_id);
