-- Automatic delayed resend of template messages Meta rejected with 130429
-- ("Rate limit hit"). Every accepted template send is snapshotted here (no
-- credentials) so a later async 130429 status webhook can schedule a resend.
-- Server-only: written by the service role from the send transport, the
-- status webhook and the automations cron.
CREATE TABLE public.rate_limit_retries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  whatsapp_config_id uuid NOT NULL REFERENCES public.whatsapp_config(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  original_message_id text NOT NULL,
  -- wamid of the latest attempt; status webhooks are matched on this.
  current_message_id text NOT NULL,
  payload jsonb NOT NULL,
  template_category text,
  attempts smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'tracking' CHECK (status IN
    ('tracking','scheduled','sending','resent','delivered','skipped','failed')),
  next_attempt_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX rate_limit_retries_current
  ON public.rate_limit_retries (whatsapp_config_id, current_message_id);
CREATE INDEX rate_limit_retries_due
  ON public.rate_limit_retries (next_attempt_at)
  WHERE status = 'scheduled';
CREATE INDEX rate_limit_retries_created
  ON public.rate_limit_retries (created_at);
CREATE INDEX rate_limit_retries_account_history
  ON public.rate_limit_retries (account_id, created_at DESC)
  WHERE attempts > 0 OR status <> 'tracking';

ALTER TABLE public.rate_limit_retries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_retries FROM anon, authenticated;
GRANT ALL ON public.rate_limit_retries TO service_role;
