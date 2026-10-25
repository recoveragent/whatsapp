-- ============================================================
-- Broadcast audience filter: last message activity.
--
-- Lets a broadcast target contacts by what happened to the LAST
-- message exchanged with them: read, delivered, sent (not yet
-- delivered), failed, replied (the customer spoke last), or none
-- (never messaged).
--
-- A contact's last message is the newest of
--   - their inbox thread messages (any conversation / number), and
--   - their broadcast_recipients rows — broadcast sends are tracked
--     there, not in `messages`.
-- Pending (not yet sent) broadcast rows are ignored.
--
-- p_since narrows read/delivered/sent/failed/replied to a last
-- message sent on or after that time; 'none' ignores it.
--
-- SECURITY INVOKER: runs as the caller, so the account RLS on
-- contacts / conversations / messages / broadcast_recipients
-- (migration 017) scopes the result. Callers page the result with
-- .range() — ORDER BY contact_id keeps pages stable.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact
  ON public.broadcast_recipients (contact_id);

CREATE OR REPLACE FUNCTION public.contacts_by_last_message_activity(
  p_activities TEXT[],
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (contact_id UUID)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH last_touch AS (
    SELECT c.id AS contact_id, lt.activity, lt.at
    FROM contacts c
    LEFT JOIN LATERAL (
      SELECT t.activity, t.at
      FROM (
        (
          SELECT
            CASE
              WHEN m.sender_type = 'customer' THEN 'replied'
              WHEN m.status = 'sending' THEN 'sent'
              ELSE m.status
            END AS activity,
            m.created_at AS at
          FROM conversations cv
          JOIN messages m ON m.conversation_id = cv.id
          WHERE cv.contact_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        )
        UNION ALL
        (
          SELECT br.status AS activity,
                 COALESCE(br.sent_at, br.created_at) AS at
          FROM broadcast_recipients br
          WHERE br.contact_id = c.id
            AND br.status <> 'pending'
          ORDER BY COALESCE(br.sent_at, br.created_at) DESC
          LIMIT 1
        )
      ) t
      ORDER BY t.at DESC NULLS LAST
      LIMIT 1
    ) lt ON true
  )
  SELECT last_touch.contact_id
  FROM last_touch
  WHERE COALESCE(activity, 'none') = ANY(p_activities)
    AND (activity IS NULL OR p_since IS NULL OR at >= p_since)
  ORDER BY last_touch.contact_id;
$$;

ALTER FUNCTION public.contacts_by_last_message_activity(TEXT[], TIMESTAMPTZ) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.contacts_by_last_message_activity(TEXT[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contacts_by_last_message_activity(TEXT[], TIMESTAMPTZ) TO authenticated;
