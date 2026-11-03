-- Only the server may write recovery state or settings. Authenticated APIs
-- authorize the active brand before using their service-role client.
CREATE TABLE public.smart_retry_settings (
  whatsapp_config_id uuid PRIMARY KEY REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  company_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.smart_retry_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  whatsapp_config_id uuid NOT NULL REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  original_message_id text,
  prompt_message_id text,
  retry_message_id text,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'tracking' CHECK (status IN
    ('tracking','prompting','awaiting_acceptance','retrying','resent','delivered','failed','suppressed','expired','cancelled')),
  error_message text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX smart_retry_original ON public.smart_retry_messages(whatsapp_config_id, original_message_id);
CREATE INDEX smart_retry_replay ON public.smart_retry_messages(whatsapp_config_id, retry_message_id);
CREATE INDEX smart_retry_prompt ON public.smart_retry_messages(whatsapp_config_id, prompt_message_id);
CREATE INDEX smart_retry_account_history ON public.smart_retry_messages(account_id, created_at DESC);
CREATE TABLE public.smart_retry_cooldowns (
  whatsapp_config_id uuid NOT NULL REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  prompted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(whatsapp_config_id, recipient)
);
ALTER TABLE public.smart_retry_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_retry_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_retry_cooldowns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smart_retry_settings, public.smart_retry_messages, public.smart_retry_cooldowns FROM anon, authenticated;
GRANT ALL ON public.smart_retry_settings, public.smart_retry_messages, public.smart_retry_cooldowns TO service_role;

CREATE FUNCTION public.claim_smart_retry_prompt(p_config_id uuid, p_recipient text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH claimed AS (
    INSERT INTO public.smart_retry_cooldowns(whatsapp_config_id, recipient)
    VALUES(p_config_id, p_recipient)
    ON CONFLICT (whatsapp_config_id, recipient) DO UPDATE SET prompted_at = now()
      WHERE public.smart_retry_cooldowns.prompted_at <= now() - interval '24 hours'
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION public.claim_smart_retry_prompt(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_smart_retry_prompt(uuid, text) TO service_role;
