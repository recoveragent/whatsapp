-- ============================================================
-- 033_flows_automation_parity.sql
--
-- Extends flows with automation-parity triggers and node types,
-- plus a pending-executions queue for wait nodes.
-- ============================================================

-- ---- flows.trigger_type ------------------------------------------------
ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_trigger_type_check;

ALTER TABLE flows
  ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN (
    'keyword',
    'first_inbound_message',
    'manual',
    'new_message_received',
    'webhook_received',
    'shopify_order_placed',
    'shopify_order_updated',
    'shopify_order_fulfilled',
    'shopify_order_cancelled',
    'shopify_order_partially_fulfilled',
    'tag_added',
    'conversation_assigned',
    'time_based'
  ));

-- ---- flow_nodes.node_type ----------------------------------------------
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

-- ---- flow_runs.status: add 'waiting' for time-based wait nodes --------
ALTER TABLE flow_runs
  DROP CONSTRAINT IF EXISTS flow_runs_status_check;

ALTER TABLE flow_runs
  ADD CONSTRAINT flow_runs_status_check
  CHECK (status IN (
    'active',
    'waiting',
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed'
  ));

-- ---- flow_pending_executions (wait node queue) -------------------------
CREATE TABLE IF NOT EXISTS flow_pending_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  next_node_key TEXT NOT NULL,
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_pending_run_at
  ON flow_pending_executions(run_at)
  WHERE status = 'pending';

ALTER TABLE flow_pending_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own flow pending" ON flow_pending_executions;
CREATE POLICY "Users see own flow pending" ON flow_pending_executions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_pending_executions.flow_id
      AND is_account_member(f.account_id)
  ));
