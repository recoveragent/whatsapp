-- ============================================================
-- 044_account_whatsapp_connect_mode.sql
-- ============================================================
-- Embedded Signup cannot select the Meta business portfolio that
-- owns our developer app / "Recover Agent WA". For that own-portfolio
-- brand, ops connects with WABA ID + Phone Number ID + permanent
-- System User token instead.

DO $$ BEGIN
  CREATE TYPE whatsapp_connect_mode_enum AS ENUM (
    'embedded_signup',
    'system_user_token'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS whatsapp_connect_mode whatsapp_connect_mode_enum
    NOT NULL DEFAULT 'embedded_signup';

COMMENT ON COLUMN accounts.whatsapp_connect_mode IS
  'embedded_signup = Meta FB.login for customer brands; system_user_token = ops paste WABA/phone/token for own Meta portfolio';
