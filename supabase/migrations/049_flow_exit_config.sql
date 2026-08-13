-- ============================================================
-- 049_flow_exit_config.sql
--
-- Flow-level "end this run when…" conditions. Sibling to
-- trigger_config / fallback_policy — evaluated on CRM events and
-- before starting another flow so a drip can stop when the contact
-- is tagged, moved in the pipeline, assigned, or enters a different
-- flow.
-- ============================================================

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS exit_config JSONB NOT NULL DEFAULT '{"conditions":[]}'::jsonb;
