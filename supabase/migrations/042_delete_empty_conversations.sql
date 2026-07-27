-- ============================================================
-- 042_delete_empty_conversations.sql
--
-- Empty conversations (zero WhatsApp messages, zero private notes)
-- should not appear in Open or Closed. Shopify webhooks used to
-- create shells before a send landed; remove those leftovers.
-- Contacts and Shopify order rows are kept.
-- ============================================================

DELETE FROM conversations c
WHERE NOT EXISTS (
    SELECT 1
    FROM messages m
    WHERE m.conversation_id = c.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM conversation_private_notes n
    WHERE n.conversation_id = c.id
  );
