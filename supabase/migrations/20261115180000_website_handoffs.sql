-- Short-lived, service-only website chat references. No public data access.
CREATE TABLE public.website_handoffs (
  token text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{32}$'),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  transcript text NOT NULL CHECK (length(transcript) <= 30000),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.website_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_handoffs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.website_handoffs TO service_role;

-- Consume once and attach the context and human-only pause atomically.
CREATE FUNCTION public.consume_website_handoff(p_token text, p_account_id uuid, p_conversation_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE handoff_text text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = p_conversation_id AND account_id = p_account_id) THEN
    RETURN false;
  END IF;
  DELETE FROM website_handoffs WHERE token = p_token AND account_id = p_account_id AND expires_at > now()
    RETURNING transcript INTO handoff_text;
  IF handoff_text IS NULL THEN RETURN false; END IF;
  INSERT INTO conversation_private_notes (conversation_id, account_id, user_id, note_text)
    VALUES (p_conversation_id, p_account_id, p_user_id, 'Website chat handoff:' || E'\n\n' || handoff_text);
  UPDATE conversations SET ai_autoreply_disabled = true, ai_handoff_summary = NULL, status = 'open', updated_at = now()
    WHERE id = p_conversation_id AND account_id = p_account_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.consume_website_handoff(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_website_handoff(text, uuid, uuid, uuid) TO service_role;
