-- ============================================================
-- 048_google_sheets.sql — Google Sheets OAuth per brand (account)
--
-- Stores OAuth tokens for reading spreadsheets. New rows are polled
-- by GET /api/google-sheets/cron and dispatched to flows with
-- trigger_type = google_sheet_row. Idempotent — safe to re-run.
-- ============================================================

-- ---- flows.trigger_type: allow google_sheet_row --------------------
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
    'time_based',
    'google_sheet_row'
  ));

-- ============================================================
-- GOOGLE_SHEETS_CONFIG — one Google account per brand
-- ============================================================
CREATE TABLE IF NOT EXISTS google_sheets_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ,
  google_email TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_config_account_id
  ON google_sheets_config (account_id);

ALTER TABLE google_sheets_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_sheets_config_select ON google_sheets_config;
DROP POLICY IF EXISTS google_sheets_config_insert ON google_sheets_config;
DROP POLICY IF EXISTS google_sheets_config_update ON google_sheets_config;
DROP POLICY IF EXISTS google_sheets_config_delete ON google_sheets_config;
CREATE POLICY google_sheets_config_select ON google_sheets_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY google_sheets_config_insert ON google_sheets_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY google_sheets_config_update ON google_sheets_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY google_sheets_config_delete ON google_sheets_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON google_sheets_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON google_sheets_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- GOOGLE_SHEETS_OAUTH_STATES — short-lived OAuth CSRF tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS google_sheets_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_oauth_states_expires
  ON google_sheets_oauth_states (expires_at);

ALTER TABLE google_sheets_oauth_states ENABLE ROW LEVEL SECURITY;
-- Service-role only.
