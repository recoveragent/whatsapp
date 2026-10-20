-- WhatsApp Forms designed in-app. `definition` is the editor's source of
-- truth; Meta only holds the generated Flow JSON. Published Flows are
-- immutable on Meta, so each re-publish creates a new Flow and the old IDs
-- are kept in `previous_flow_ids` (nodes that picked them keep working).
CREATE TABLE public.whatsapp_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  category text NOT NULL DEFAULT 'LEAD_GENERATION',
  definition jsonb NOT NULL,
  waba_id text,
  meta_flow_id text,
  meta_status text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  previous_flow_ids text[] NOT NULL DEFAULT '{}',
  has_unpublished_changes boolean NOT NULL DEFAULT true,
  last_error text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_forms_account ON public.whatsapp_forms(account_id, updated_at DESC);

ALTER TABLE public.whatsapp_forms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_forms FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_forms TO authenticated;
GRANT ALL ON public.whatsapp_forms TO service_role;
-- Writes go through the API (role check + Meta calls) with the service role.
CREATE POLICY "Members read brand forms" ON public.whatsapp_forms
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));
