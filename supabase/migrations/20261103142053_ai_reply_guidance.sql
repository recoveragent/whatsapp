-- Team corrections on AI replies ("next time a customer says X, respond like Y").
-- Active rows are fed into the AI system prompt for every reply.
CREATE TABLE public.ai_reply_guidance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  customer_message text NOT NULL DEFAULT '' CHECK (char_length(customer_message) <= 2000),
  ai_reply text NOT NULL DEFAULT '' CHECK (char_length(ai_reply) <= 4000),
  instruction text NOT NULL CHECK (char_length(btrim(instruction)) BETWEEN 1 AND 1000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_reply_guidance_account ON public.ai_reply_guidance(account_id, created_at DESC);

ALTER TABLE public.ai_reply_guidance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_reply_guidance FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_reply_guidance TO authenticated;
GRANT ALL ON public.ai_reply_guidance TO service_role;
CREATE POLICY ai_reply_guidance_select ON public.ai_reply_guidance FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY ai_reply_guidance_insert ON public.ai_reply_guidance FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_reply_guidance_update ON public.ai_reply_guidance FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_reply_guidance_delete ON public.ai_reply_guidance FOR DELETE TO authenticated
  USING (public.is_account_member(account_id, 'admin'));
