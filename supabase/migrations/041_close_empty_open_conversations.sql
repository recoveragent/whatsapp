-- ============================================================
-- 041_close_empty_open_conversations.sql
--
-- One-time cleanup: Shopify webhooks used to create conversations as
-- `open` even when no WhatsApp message was sent. Those empty rows
-- cluttered the Open inbox. Close any open conversation that still
-- has zero messages. New Shopify outbound creates as `closed` going
-- forward (see ensureConversation).
-- ============================================================

UPDATE conversations c
SET
  status = 'closed',
  updated_at = NOW()
WHERE c.status = 'open'
  AND NOT EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.conversation_id = c.id
  );
