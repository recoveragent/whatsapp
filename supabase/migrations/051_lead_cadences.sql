-- ============================================================
-- 051_lead_cadences.sql — Sales cadences for silent ad leads
--
-- Meta Instant Forms land in Google Sheets. Each sheet is a campaign
-- lead source that enrolls new rows into a timed cadence (WhatsApp
-- templates + call tasks). Agents work a shared claim-to-call queue.
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- CADENCES — playbooks (new Instant Form vs reactivation, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS cadences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom'
    CHECK (kind IN ('new_lead', 'reactivation', 'custom')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  call_hours_start TIME NOT NULL DEFAULT '10:00',
  call_hours_end TIME NOT NULL DEFAULT '19:00',
  -- 0=Sun … 6=Sat. Default Mon–Sat.
  call_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  expire_after_days INTEGER NOT NULL DEFAULT 30
    CHECK (expire_after_days BETWEEN 1 AND 365),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cadences_account
  ON cadences (account_id);

ALTER TABLE cadences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cadences_select ON cadences;
DROP POLICY IF EXISTS cadences_insert ON cadences;
DROP POLICY IF EXISTS cadences_update ON cadences;
DROP POLICY IF EXISTS cadences_delete ON cadences;
CREATE POLICY cadences_select ON cadences FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY cadences_insert ON cadences FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY cadences_update ON cadences FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY cadences_delete ON cadences FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON cadences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cadences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CADENCE_STEPS — delay from enrollment start
-- ============================================================
CREATE TABLE IF NOT EXISTS cadence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cadence_id UUID NOT NULL REFERENCES cadences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  delay_minutes INTEGER NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  channel TEXT NOT NULL
    CHECK (channel IN ('wa_template', 'call_task', 'voice_note_task')),
  template_name TEXT,
  script_en TEXT,
  script_hi TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cadence_id, position)
);

CREATE INDEX IF NOT EXISTS idx_cadence_steps_cadence
  ON cadence_steps (cadence_id, position);

ALTER TABLE cadence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cadence_steps_select ON cadence_steps;
DROP POLICY IF EXISTS cadence_steps_write ON cadence_steps;
CREATE POLICY cadence_steps_select ON cadence_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cadences c
      WHERE c.id = cadence_steps.cadence_id
        AND is_account_member(c.account_id)
    )
  );
CREATE POLICY cadence_steps_write ON cadence_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM cadences c
      WHERE c.id = cadence_steps.cadence_id
        AND is_account_member(c.account_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cadences c
      WHERE c.id = cadence_steps.cadence_id
        AND is_account_member(c.account_id, 'admin')
    )
  );

-- ============================================================
-- LEAD_SOURCES — one Google Sheet tab per campaign
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cadence_id UUID REFERENCES cadences(id) ON DELETE SET NULL,
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_url TEXT,
  sheet_name TEXT NOT NULL,
  phone_column TEXT NOT NULL DEFAULT 'phone',
  name_column TEXT,
  email_column TEXT,
  language_column TEXT,
  default_language TEXT NOT NULL DEFAULT 'en'
    CHECK (default_language IN ('en', 'hi')),
  last_processed_row INTEGER,
  sync_existing BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_sources_account
  ON lead_sources (account_id, active);

ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_sources_select ON lead_sources;
DROP POLICY IF EXISTS lead_sources_insert ON lead_sources;
DROP POLICY IF EXISTS lead_sources_update ON lead_sources;
DROP POLICY IF EXISTS lead_sources_delete ON lead_sources;
CREATE POLICY lead_sources_select ON lead_sources FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY lead_sources_insert ON lead_sources FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY lead_sources_update ON lead_sources FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY lead_sources_delete ON lead_sources FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON lead_sources;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONTACTS — lead lifecycle fields
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'new';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lead_status_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_lead_status_check
  CHECK (lead_status IN (
    'new',
    'in_cadence',
    'replied',
    'meeting_booked',
    'onboarded',
    'expired',
    'lost'
  ));

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_language TEXT
    CHECK (lead_language IS NULL OR lead_language IN ('en', 'hi'));

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_touch_at TIMESTAMPTZ;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS next_action_type TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_lead_status
  ON contacts (account_id, lead_status);

CREATE INDEX IF NOT EXISTS idx_contacts_lead_source
  ON contacts (lead_source_id)
  WHERE lead_source_id IS NOT NULL;

-- ============================================================
-- CADENCE_ENROLLMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS cadence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  cadence_id UUID NOT NULL REFERENCES cadences(id) ON DELETE CASCADE,
  lead_source_id UUID REFERENCES lead_sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'exited')),
  current_step_position INTEGER NOT NULL DEFAULT 1,
  next_run_at TIMESTAMPTZ,
  claimed_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  exit_reason TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_due
  ON cadence_enrollments (status, next_run_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cadence_enrollments_account
  ON cadence_enrollments (account_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_cadence_enrollment
  ON cadence_enrollments (contact_id)
  WHERE status = 'active';

ALTER TABLE cadence_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cadence_enrollments_select ON cadence_enrollments;
DROP POLICY IF EXISTS cadence_enrollments_insert ON cadence_enrollments;
DROP POLICY IF EXISTS cadence_enrollments_update ON cadence_enrollments;
CREATE POLICY cadence_enrollments_select ON cadence_enrollments FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY cadence_enrollments_insert ON cadence_enrollments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY cadence_enrollments_update ON cadence_enrollments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON cadence_enrollments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cadence_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CRM_TASKS — shared call / voice-note queue
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES cadence_enrollments(id) ON DELETE SET NULL,
  cadence_step_id UUID REFERENCES cadence_steps(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('call', 'voice_note')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'completed', 'cancelled')),
  due_at TIMESTAMPTZ NOT NULL,
  claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_until TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  outcome TEXT
    CHECK (outcome IS NULL OR outcome IN (
      'no_answer',
      'busy',
      'later',
      'booked',
      'not_interested',
      'wrong_number',
      'connected'
    )),
  outcome_note TEXT,
  script TEXT,
  campaign_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_queue
  ON crm_tasks (account_id, status, due_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tasks_open_step
  ON crm_tasks (enrollment_id, cadence_step_id)
  WHERE status IN ('pending', 'claimed')
    AND enrollment_id IS NOT NULL
    AND cadence_step_id IS NOT NULL;

ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_tasks_select ON crm_tasks;
DROP POLICY IF EXISTS crm_tasks_insert ON crm_tasks;
DROP POLICY IF EXISTS crm_tasks_update ON crm_tasks;
CREATE POLICY crm_tasks_select ON crm_tasks FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY crm_tasks_insert ON crm_tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY crm_tasks_update ON crm_tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON crm_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'crm_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE crm_tasks;
  END IF;
END $$;
