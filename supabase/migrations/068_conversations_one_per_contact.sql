-- ============================================================
-- 068_conversations_one_per_contact.sql
--
-- One conversation per (account_id, contact_id). Duplicate rows
-- (Shopify webhook races, inbound find-or-create with .single())
-- split the inbox thread from flow runs so close_conversation
-- closed the wrong shell.
--
-- 1. Merge duplicate conversations into a canonical winner.
-- 2. Delete empty loser rows.
-- 3. Enforce uniqueness going forward.
-- ============================================================

-- Pick the canonical row per contact: most messages, then latest
-- activity, then oldest created_at (stable tie-break).
CREATE TEMP TABLE conv_merge_map ON COMMIT DROP AS
WITH msg_counts AS (
  SELECT conversation_id, COUNT(*)::int AS msg_count
  FROM messages
  GROUP BY conversation_id
),
ranked AS (
  SELECT
    c.id,
    c.account_id,
    c.contact_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.account_id, c.contact_id
      ORDER BY
        COALESCE(mc.msg_count, 0) DESC,
        c.last_message_at DESC NULLS LAST,
        c.created_at ASC
    ) AS rn
  FROM conversations c
  LEFT JOIN msg_counts mc ON mc.conversation_id = c.id
),
winners AS (
  SELECT account_id, contact_id, id AS winner_id
  FROM ranked
  WHERE rn = 1
)
SELECT r.id AS loser_id, w.winner_id
FROM ranked r
JOIN winners w
  ON w.account_id = r.account_id
 AND w.contact_id = r.contact_id
WHERE r.rn > 1;

-- Repoint dependent rows before deleting losers.
UPDATE messages m
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE m.conversation_id = map.loser_id;

UPDATE message_reactions mr
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE mr.conversation_id = map.loser_id;

UPDATE conversation_private_notes n
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE n.conversation_id = map.loser_id;

UPDATE inbox_reminders r
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE r.conversation_id = map.loser_id;

UPDATE flow_runs fr
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE fr.conversation_id = map.loser_id;

UPDATE flow_pending_executions fpe
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE fpe.conversation_id = map.loser_id;

UPDATE crm_tasks ct
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE ct.conversation_id = map.loser_id;

UPDATE deals d
SET conversation_id = map.winner_id
FROM conv_merge_map map
WHERE d.conversation_id = map.loser_id;

DELETE FROM conversations c
USING conv_merge_map map
WHERE c.id = map.loser_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON conversations (account_id, contact_id);
