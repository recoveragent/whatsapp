-- Extend Meta CAPI: Instant Form CRM dataset + negative lead signals.

ALTER TABLE meta_conversions_config
  ADD COLUMN IF NOT EXISTS crm_dataset_id TEXT,
  ADD COLUMN IF NOT EXISTS send_on_not_interested BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_on_wrong_number BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS send_on_instant_form_lead BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN meta_conversions_config.crm_dataset_id IS
  'Meta CRM dataset (pixel) ID for Instant Form Conversion Leads events (action_source=system_generated).';

COMMENT ON COLUMN contacts.referral IS
  'Meta ad attribution: CTWA (ctwa_clid) and/or Instant Form (meta_lead_id, ad_id, form_id) from sheet or webhook.';
