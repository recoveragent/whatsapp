-- Multiple WhatsApp numbers per brand, with every inbox thread pinned to
-- the number that received/created it.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS reference_name TEXT;

UPDATE whatsapp_config
SET reference_name = COALESCE(NULLIF(reference_name, ''), 'Primary')
WHERE reference_name IS NULL OR reference_name = '';

ALTER TABLE whatsapp_config ALTER COLUMN reference_name SET NOT NULL;
ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_reference_name_not_blank
  CHECK (length(btrim(reference_name)) > 0);

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_account_reference_name
  ON whatsapp_config (account_id, lower(reference_name));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES whatsapp_config(id) ON DELETE SET NULL;

-- Existing brands had exactly one config, so the backfill is unambiguous.
UPDATE conversations c
SET whatsapp_config_id = wc.id
FROM whatsapp_config wc
WHERE wc.account_id = c.account_id
  AND c.whatsapp_config_id IS NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_whatsapp
  ON conversations (account_id, contact_id, whatsapp_config_id)
  WHERE whatsapp_config_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON conversations (whatsapp_config_id);
