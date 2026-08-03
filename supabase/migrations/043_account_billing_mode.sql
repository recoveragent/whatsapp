-- ============================================================
-- 043_account_billing_mode.sql — Wallet vs Meta-direct billing
-- ============================================================
-- Super admins choose whether a brand is billed via our prepaid
-- wallet or pays Meta directly (no wallet balance checks / debits).

DO $$ BEGIN
  CREATE TYPE account_billing_mode_enum AS ENUM ('wallet', 'meta_direct');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS billing_mode account_billing_mode_enum NOT NULL DEFAULT 'wallet';

COMMENT ON COLUMN accounts.billing_mode IS
  'wallet = prepaid CRM wallet debit; meta_direct = client pays Meta, skip wallet gates';
