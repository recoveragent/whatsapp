-- Track when the customer last messaged so the 24-hour service window
-- can be computed exactly (last_customer_message_at + 24h).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;

UPDATE conversations c
SET last_customer_message_at = sub.last_at
FROM (
  SELECT conversation_id, MAX(created_at) AS last_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) sub
WHERE c.id = sub.conversation_id
  AND c.last_customer_message_at IS NULL;
