-- ============================================================
-- 050_flow_reply_timeout.sql
--
-- Extend flow_pending_executions so suspending nodes can schedule
-- a "no reply in X" branch without flipping the run to `waiting`
-- (unlike the time-based wait node).
-- ============================================================

ALTER TABLE flow_pending_executions
  ADD COLUMN IF NOT EXISTS execution_kind TEXT NOT NULL DEFAULT 'wait'
    CHECK (execution_kind IN ('wait', 'reply_timeout'));

ALTER TABLE flow_pending_executions
  ADD COLUMN IF NOT EXISTS source_node_key TEXT;
