-- ============================================================
-- 035_inbox_followup.sql — Inbox follow-up status + settings
--
-- Adds a `followup` conversation status with per-account timing
-- and message configuration. Scheduled sends are tracked on the
-- conversation row and drained by GET /api/inbox/followup-cron.
-- ============================================================

-- Extend allowed conversation statuses.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'pending', 'closed', 'followup'));

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS followup_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS followup_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_followup_due
  ON conversations (followup_scheduled_at)
  WHERE status = 'followup' AND followup_sent_at IS NULL;

-- Per-account follow-up configuration.
CREATE TABLE IF NOT EXISTS inbox_followup_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  delay_hours INTEGER NOT NULL DEFAULT 4 CHECK (delay_hours > 0 AND delay_hours <= 168),
  message_text TEXT NOT NULL DEFAULT 'Hi, We are waiting for your response',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at ON inbox_followup_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inbox_followup_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inbox_followup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_followup_settings_select ON inbox_followup_settings;
CREATE POLICY inbox_followup_settings_select ON inbox_followup_settings
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS inbox_followup_settings_insert ON inbox_followup_settings;
CREATE POLICY inbox_followup_settings_insert ON inbox_followup_settings
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS inbox_followup_settings_update ON inbox_followup_settings;
CREATE POLICY inbox_followup_settings_update ON inbox_followup_settings
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
