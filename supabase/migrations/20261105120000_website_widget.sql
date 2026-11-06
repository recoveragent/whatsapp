-- Website chat widget: per-brand settings for the embeddable AI chat.
-- `public_key` is embedded in the merchant's site, so it is not a secret;
-- `allowed_domains` and the reply limits are what protect the brand's AI key.
CREATE TABLE public.website_widget_config (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  public_key text NOT NULL UNIQUE
    DEFAULT 'wgt_' || replace(gen_random_uuid()::text, '-', ''),
  enabled boolean NOT NULL DEFAULT false,
  allowed_domains text[] NOT NULL DEFAULT '{}',
  title text NOT NULL DEFAULT 'Chat with us' CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  greeting text NOT NULL DEFAULT 'Hi! How can we help you today?'
    CHECK (char_length(btrim(greeting)) BETWEEN 1 AND 300),
  accent_color text NOT NULL DEFAULT '#128C7E' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  whatsapp_number text CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^[0-9]{8,15}$'),
  daily_reply_limit integer NOT NULL DEFAULT 500 CHECK (daily_reply_limit BETWEEN 1 AND 100000),
  replies_today integer NOT NULL DEFAULT 0,
  replies_day date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.website_widget_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.website_widget_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.website_widget_config TO authenticated;
GRANT ALL ON public.website_widget_config TO service_role;
CREATE POLICY website_widget_config_select ON public.website_widget_config FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY website_widget_config_insert ON public.website_widget_config FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY website_widget_config_update ON public.website_widget_config FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Atomically spend one of today's replies. The in-memory rate limiter is per
-- process and resets on deploy, so this is the durable ceiling on what a
-- public endpoint can spend on the brand's AI key.
CREATE FUNCTION public.claim_website_widget_reply(target_account uuid)
RETURNS boolean
LANGUAGE sql
SET search_path = public
AS $$
  WITH claimed AS (
    UPDATE public.website_widget_config
    SET replies_today = CASE WHEN replies_day = CURRENT_DATE THEN replies_today + 1 ELSE 1 END,
        replies_day = CURRENT_DATE
    WHERE account_id = target_account
      AND enabled
      AND (replies_day IS DISTINCT FROM CURRENT_DATE OR replies_today < daily_reply_limit)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

REVOKE ALL ON FUNCTION public.claim_website_widget_reply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_website_widget_reply(uuid) TO service_role;
