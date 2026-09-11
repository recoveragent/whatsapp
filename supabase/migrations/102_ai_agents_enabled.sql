-- ============================================================
-- 102_ai_agents_enabled.sql — Super-admin gate for AI Agents
-- ============================================================
-- When false (default), brand users cannot access AI Agents UI,
-- inbox AI affordances, or /api/ai/* routes.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ai_agents_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN accounts.ai_agents_enabled IS
  'Super-admin gate: when false, brand users cannot access AI Agents UI or AI APIs.';
