-- Saved WhatsApp Flow forms for manual inbox sends (analogous to message_templates).

CREATE TABLE IF NOT EXISTS whatsapp_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  flow_cta TEXT NOT NULL DEFAULT 'Open form',
  body_text TEXT NOT NULL,
  header_text TEXT,
  footer_text TEXT,
  flow_screen TEXT,
  flow_message_version TEXT NOT NULL DEFAULT '3',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_flows_name_nonempty CHECK (char_length(trim(name)) > 0),
  CONSTRAINT whatsapp_flows_flow_id_nonempty CHECK (char_length(trim(flow_id)) > 0),
  CONSTRAINT whatsapp_flows_body_nonempty CHECK (char_length(trim(body_text)) > 0),
  CONSTRAINT whatsapp_flows_cta_nonempty CHECK (char_length(trim(flow_cta)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_flows_account_name_key
  ON whatsapp_flows (account_id, name);

CREATE INDEX IF NOT EXISTS idx_whatsapp_flows_account
  ON whatsapp_flows (account_id);

ALTER TABLE whatsapp_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_flows_select ON whatsapp_flows;
CREATE POLICY whatsapp_flows_select ON whatsapp_flows
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_flows_insert ON whatsapp_flows;
CREATE POLICY whatsapp_flows_insert ON whatsapp_flows
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_flows_update ON whatsapp_flows;
CREATE POLICY whatsapp_flows_update ON whatsapp_flows
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_flows_delete ON whatsapp_flows;
CREATE POLICY whatsapp_flows_delete ON whatsapp_flows
  FOR DELETE USING (is_account_member(account_id, 'admin'));
