-- ============================================================
-- 047_inbox_reminders.sql — In-app follow-up reminders
--
-- Agents schedule reminders from inbox chat (date/time + note).
-- Due items surface in the dashboard header notification bell.
-- Complete / snooze are in-app only (no WhatsApp to the team).
-- ============================================================

CREATE TABLE IF NOT EXISTS inbox_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_reminders_due
  ON inbox_reminders (account_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_inbox_reminders_conversation
  ON inbox_reminders (conversation_id, status);

DROP TRIGGER IF EXISTS set_updated_at ON inbox_reminders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON inbox_reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE inbox_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_reminders_select ON inbox_reminders;
CREATE POLICY inbox_reminders_select ON inbox_reminders
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS inbox_reminders_insert ON inbox_reminders;
CREATE POLICY inbox_reminders_insert ON inbox_reminders
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS inbox_reminders_update ON inbox_reminders;
CREATE POLICY inbox_reminders_update ON inbox_reminders
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS inbox_reminders_delete ON inbox_reminders;
CREATE POLICY inbox_reminders_delete ON inbox_reminders
  FOR DELETE USING (is_account_member(account_id, 'agent'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inbox_reminders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox_reminders;
  END IF;
END $$;
