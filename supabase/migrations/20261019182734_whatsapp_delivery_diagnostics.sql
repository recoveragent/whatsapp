-- No dependency on a messages row: a status callback can arrive before it exists.
CREATE TABLE public.message_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL,
  message_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('api_accepted','sent','delivered','read','failed')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (account_id, phone_number_id, message_id, event_type, occurred_at)
);
CREATE INDEX message_delivery_events_message ON public.message_delivery_events(message_id, occurred_at);
ALTER TABLE public.message_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_delivery_events FROM anon, authenticated;
GRANT SELECT ON public.message_delivery_events TO authenticated;
GRANT ALL ON public.message_delivery_events TO service_role;
CREATE POLICY "Members read brand delivery events" ON public.message_delivery_events
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
