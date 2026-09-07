-- Track how many times a contact re-entered as a lead (same phone, new sheet row).

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lead_duplicate_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lead_duplicate_count_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_lead_duplicate_count_check
  CHECK (lead_duplicate_count >= 0);

CREATE OR REPLACE FUNCTION public.increment_contact_lead_duplicate_count(
  p_contact_id UUID,
  p_account_id UUID
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE contacts
  SET lead_duplicate_count = lead_duplicate_count + 1,
      updated_at = NOW()
  WHERE id = p_contact_id
    AND account_id = p_account_id;
$$;

ALTER FUNCTION public.increment_contact_lead_duplicate_count(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.increment_contact_lead_duplicate_count(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_contact_lead_duplicate_count(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_contact_lead_duplicate_count(UUID, UUID) TO service_role;
