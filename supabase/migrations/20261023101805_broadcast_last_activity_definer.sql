-- ============================================================
-- contacts_by_last_message_activity: account check once, not per row.
--
-- As SECURITY INVOKER the RLS on messages / conversations /
-- broadcast_recipients re-ran is_account_member() for every message
-- row the lateral touched — ~5 s per 1 000-row page on a 6.7k-contact
-- account, and the wizard pages through the whole result.
--
-- Those policies (and contacts_select) all reduce to "caller is a
-- member of the row's account". So the function now runs as
-- SECURITY DEFINER and applies that check once, on the contact's
-- account; every message / broadcast row it reads belongs to one of
-- those contacts. The result is the same set the caller could
-- compute under RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.contacts_by_last_message_activity(
  p_activities TEXT[],
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (contact_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH member_accounts AS (
    SELECT a.id FROM accounts a WHERE is_account_member(a.id)
  ),
  last_touch AS (
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
            AND cv.account_id = c.account_id
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
    WHERE c.account_id IN (SELECT id FROM member_accounts)
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
