-- Temporary diagnostics for Instagram webhook delivery. Stores request
-- outcome and payload shape only — no message text, no signatures.
-- Drop once Instagram messaging is confirmed working.
CREATE TABLE public.instagram_webhook_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  status int NOT NULL,
  reason text NOT NULL,
  secret_match text,
  instagram_secret_set boolean,
  object text,
  entry_ids text[],
  item_keys text[],
  events int
);
ALTER TABLE public.instagram_webhook_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_webhook_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.instagram_webhook_log TO service_role;
