-- ============================================================
-- 069_multi_active_flow_runs
--
-- Allow multiple concurrent flow runs per contact. Replaces the
-- single-active-run unique index with per-event idempotency so
-- duplicate webhooks do not double-start the same external flow.
-- ============================================================

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS external_idempotency_key TEXT;

-- Drop the one-active-run-per-contact constraint.
DROP INDEX IF EXISTS idx_one_active_run_per_contact;

-- Fast lookup for inbound routing across concurrent runs.
CREATE INDEX IF NOT EXISTS idx_flow_runs_active_contact
  ON flow_runs (account_id, contact_id, last_advanced_at DESC)
  WHERE status IN ('active', 'waiting');

-- Prevent duplicate external starts (same flow + same order/event).
CREATE UNIQUE INDEX IF NOT EXISTS idx_flow_runs_external_idempotency
  ON flow_runs (account_id, flow_id, external_idempotency_key)
  WHERE external_idempotency_key IS NOT NULL
    AND status IN ('active', 'waiting');
