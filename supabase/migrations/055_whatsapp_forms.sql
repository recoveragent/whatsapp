-- WhatsApp Flow form support: send_flow node + CTWA referral on contacts.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS referral JSONB;

COMMENT ON COLUMN contacts.referral IS
  'CTWA / ad attribution from the first inbound WhatsApp message (source_id, headline, ctwa_clid, etc.).';

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'send_template',
    'collect_input',
    'send_address',
    'send_flow',
    'condition',
    'switch',
    'set_tag',
    'handoff',
    'wait',
    'send_webhook',
    'http_fetch',
    'update_contact_field',
    'assign_conversation',
    'create_deal',
    'close_conversation',
    'end'
  ));
