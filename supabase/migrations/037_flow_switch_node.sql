-- Add multi-branch switch node type for ordered condition routing.

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
