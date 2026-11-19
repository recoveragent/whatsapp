-- Instagram identities are scoped to a connected professional account, not
-- to a WhatsApp phone number. Credentials are accessible only server-side.
CREATE TABLE public.instagram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  instagram_id text NOT NULL UNIQUE,
  username text NOT NULL,
  client_business_id text NOT NULL,
  access_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, account_id)
);
CREATE INDEX instagram_connections_account_idx ON public.instagram_connections(account_id);
CREATE TABLE public.instagram_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  participant_id text NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_text text NOT NULL DEFAULT '',
  last_inbound_at timestamptz,
  FOREIGN KEY (connection_id, account_id) REFERENCES public.instagram_connections(id, account_id) ON DELETE CASCADE,
  UNIQUE (connection_id, participant_id),
  UNIQUE (id, account_id)
);
CREATE INDEX instagram_threads_inbox_idx ON public.instagram_threads(account_id, last_message_at DESC);
CREATE TABLE public.instagram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  meta_message_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (thread_id, account_id) REFERENCES public.instagram_threads(id, account_id) ON DELETE CASCADE,
  UNIQUE (thread_id, meta_message_id)
);
CREATE INDEX instagram_messages_thread_idx ON public.instagram_messages(thread_id, created_at);
ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_connections, public.instagram_threads, public.instagram_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.instagram_threads, public.instagram_messages TO authenticated;
GRANT ALL ON public.instagram_connections, public.instagram_threads, public.instagram_messages TO service_role;
CREATE POLICY instagram_threads_read ON public.instagram_threads FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY instagram_messages_read ON public.instagram_messages FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- Meta retries notifications. Insert and update the thread in one transaction,
-- advancing its preview only when the new event is newer.
CREATE FUNCTION public.instagram_record_message(
  p_connection uuid, p_participant text, p_meta_id text, p_direction text,
  p_content text, p_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_account uuid; v_thread uuid; v_inserted uuid;
BEGIN
  SELECT account_id INTO STRICT v_account FROM public.instagram_connections WHERE id = p_connection;
  INSERT INTO public.instagram_threads(account_id, connection_id, participant_id, last_message_at)
    VALUES (v_account, p_connection, p_participant, p_at)
    ON CONFLICT (connection_id, participant_id) DO UPDATE SET participant_id = EXCLUDED.participant_id
    RETURNING id INTO v_thread;
  INSERT INTO public.instagram_messages(account_id, thread_id, meta_message_id, direction, content, created_at)
    VALUES (v_account, v_thread, p_meta_id, p_direction, p_content, p_at)
    ON CONFLICT (thread_id, meta_message_id) DO NOTHING RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    UPDATE public.instagram_threads SET
      last_message_text = CASE WHEN p_at >= last_message_at THEN p_content ELSE last_message_text END,
      last_message_at = greatest(last_message_at, p_at),
      last_inbound_at = CASE WHEN p_direction = 'inbound' THEN greatest(coalesce(last_inbound_at, p_at), p_at) ELSE last_inbound_at END
      WHERE id = v_thread;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.instagram_record_message(uuid,text,text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_record_message(uuid,text,text,text,text,timestamptz) TO service_role;
