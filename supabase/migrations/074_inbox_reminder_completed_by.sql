-- ============================================================
-- 074_inbox_reminder_completed_by.sql — Who completed a reminder
-- ============================================================

ALTER TABLE inbox_reminders
  ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES profiles(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_reminders_completed
  ON inbox_reminders (account_id, conversation_id, status, completed_at DESC);
