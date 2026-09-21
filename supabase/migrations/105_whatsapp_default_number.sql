ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE whatsapp_config wc
SET is_default = TRUE
WHERE wc.id = (
  SELECT id FROM whatsapp_config x
  WHERE x.account_id = wc.account_id
  ORDER BY x.created_at ASC, x.id ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM whatsapp_config existing
  WHERE existing.account_id = wc.account_id AND existing.is_default
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_default
  ON whatsapp_config (account_id) WHERE is_default;
