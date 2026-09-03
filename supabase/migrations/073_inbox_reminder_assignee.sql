-- ============================================================
-- 073_inbox_reminder_assignee.sql — Who should follow up
--
-- Reminders stay visible to every account member (unchanged RLS).
-- assignee_id records whom the team should follow up with.
-- ============================================================

ALTER TABLE inbox_reminders
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES profiles(user_id) ON DELETE CASCADE;

UPDATE inbox_reminders
SET assignee_id = created_by
WHERE assignee_id IS NULL;

ALTER TABLE inbox_reminders
  ALTER COLUMN assignee_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_reminders_assignee
  ON inbox_reminders (account_id, assignee_id, status, due_at);
