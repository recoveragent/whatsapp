-- Website visitors are anonymous and do not become WhatsApp contacts.
CREATE TABLE public.website_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, session_hash),
  UNIQUE (id, account_id)
);
CREATE INDEX website_chat_sessions_inbox ON public.website_chat_sessions(account_id, last_message_at DESC);
CREATE TABLE public.website_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  account_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4500),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, account_id) REFERENCES public.website_chat_sessions(id, account_id) ON DELETE CASCADE
);
CREATE INDEX website_chat_messages_session ON public.website_chat_messages(session_id, created_at);
ALTER TABLE public.website_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_chat_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_chat_sessions, public.website_chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.website_chat_sessions, public.website_chat_messages TO authenticated;
GRANT ALL ON public.website_chat_sessions, public.website_chat_messages TO service_role;
CREATE POLICY website_chat_sessions_read ON public.website_chat_sessions FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY website_chat_messages_read ON public.website_chat_messages FOR SELECT TO authenticated USING (public.is_account_member(account_id));
