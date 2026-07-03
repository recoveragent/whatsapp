-- ============================================================
-- 034_wallet.sql — Brand wallets, per-message pricing, recharges
--
-- Super admin configures org payment gateway (Razorpay) and
-- per-brand Meta message rates (utility / marketing / auth).
-- Brands recharge with 18% GST; sends debit the wallet.
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$ BEGIN
  CREATE TYPE message_pricing_category_enum AS ENUM (
    'utility', 'marketing', 'authentication'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_transaction_type_enum AS ENUM ('credit', 'debit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_provider_enum AS ENUM ('razorpay');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_recharge_status_enum AS ENUM (
    'pending', 'paid', 'failed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- ORG PAYMENT GATEWAY (super admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_payment_config (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  provider payment_provider_enum NOT NULL DEFAULT 'razorpay',
  key_id TEXT NOT NULL DEFAULT '',
  key_secret_encrypted TEXT NOT NULL DEFAULT '',
  webhook_secret_encrypted TEXT,
  gst_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.18,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organization_payment_config ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON organization_payment_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_payment_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- BRAND WALLETS
-- ============================================================
CREATE TABLE IF NOT EXISTS account_wallets (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE account_wallets ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON account_wallets;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- PER-BRAND MESSAGE PRICING (super admin)
-- Amounts stored in paise per message.
-- ============================================================
CREATE TABLE IF NOT EXISTS account_message_pricing (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category message_pricing_category_enum NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, category)
);

ALTER TABLE account_message_pricing ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON account_message_pricing;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_message_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- WALLET TRANSACTIONS (immutable ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type wallet_transaction_type_enum NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  gst_paise BIGINT NOT NULL DEFAULT 0 CHECK (gst_paise >= 0),
  balance_after_paise BIGINT NOT NULL CHECK (balance_after_paise >= 0),
  category message_pricing_category_enum,
  reference_type TEXT NOT NULL,
  reference_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account_created
  ON wallet_transactions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account_type
  ON wallet_transactions (account_id, type, created_at DESC);

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RECHARGE ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_recharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  base_amount_paise BIGINT NOT NULL CHECK (base_amount_paise > 0),
  gst_amount_paise BIGINT NOT NULL CHECK (gst_amount_paise >= 0),
  total_amount_paise BIGINT NOT NULL CHECK (total_amount_paise > 0),
  status wallet_recharge_status_enum NOT NULL DEFAULT 'pending',
  provider payment_provider_enum NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT,
  provider_payment_id TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_recharges_provider_order
  ON wallet_recharges (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_recharges_provider_payment
  ON wallet_recharges (provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

ALTER TABLE wallet_recharges ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON wallet_recharges;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON wallet_recharges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTO-CREATE WALLET + DEFAULT PRICING ON NEW BRAND
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_account_wallet(p_account_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO account_wallets (account_id)
  VALUES (p_account_id)
  ON CONFLICT (account_id) DO NOTHING;

  INSERT INTO account_message_pricing (account_id, category, price_paise)
  VALUES
    (p_account_id, 'utility', 45),
    (p_account_id, 'marketing', 78),
    (p_account_id, 'authentication', 45)
  ON CONFLICT (account_id, category) DO NOTHING;
END;
$$;

ALTER FUNCTION ensure_account_wallet(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION ensure_account_wallet(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION trg_accounts_ensure_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM ensure_account_wallet(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_ensure_wallet ON accounts;
CREATE TRIGGER accounts_ensure_wallet
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION trg_accounts_ensure_wallet();

-- Backfill wallets for existing brands
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM accounts LOOP
    PERFORM ensure_account_wallet(r.id);
  END LOOP;
END $$;

-- ============================================================
-- CREDIT WALLET (idempotent via recharge status)
-- ============================================================
CREATE OR REPLACE FUNCTION credit_wallet_for_recharge(
  p_recharge_id UUID,
  p_payment_id TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recharge wallet_recharges%ROWTYPE;
  v_new_balance BIGINT;
  v_tx_id UUID;
BEGIN
  SELECT * INTO v_recharge
  FROM wallet_recharges
  WHERE id = p_recharge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recharge not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_recharge.status = 'paid' THEN
    RETURN json_build_object(
      'already_paid', true,
      'account_id', v_recharge.account_id,
      'recharge_id', v_recharge.id
    );
  END IF;

  UPDATE wallet_recharges
  SET
    status = 'paid',
    provider_payment_id = COALESCE(p_payment_id, provider_payment_id),
    paid_at = NOW(),
    updated_at = NOW()
  WHERE id = p_recharge_id;

  UPDATE account_wallets
  SET
    balance_paise = balance_paise + v_recharge.base_amount_paise,
    updated_at = NOW()
  WHERE account_id = v_recharge.account_id
  RETURNING balance_paise INTO v_new_balance;

  INSERT INTO wallet_transactions (
    account_id, type, amount_paise, gst_paise, balance_after_paise,
    reference_type, reference_id, description, created_by_user_id
  )
  VALUES (
    v_recharge.account_id,
    'credit',
    v_recharge.base_amount_paise,
    v_recharge.gst_amount_paise,
    v_new_balance,
    'recharge',
    p_recharge_id::TEXT,
    'Wallet recharge (incl. GST paid separately)',
    v_recharge.created_by_user_id
  )
  RETURNING id INTO v_tx_id;

  RETURN json_build_object(
    'already_paid', false,
    'account_id', v_recharge.account_id,
    'recharge_id', v_recharge.id,
    'transaction_id', v_tx_id,
    'balance_paise', v_new_balance
  );
END;
$$;

ALTER FUNCTION credit_wallet_for_recharge(UUID, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION credit_wallet_for_recharge(UUID, TEXT) TO service_role;

-- ============================================================
-- DEBIT WALLET FOR MESSAGE SEND
-- ============================================================
CREATE OR REPLACE FUNCTION debit_wallet_for_message(
  p_account_id UUID,
  p_category message_pricing_category_enum,
  p_reference_id TEXT,
  p_description TEXT DEFAULT ''
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price INTEGER;
  v_balance BIGINT;
  v_new_balance BIGINT;
  v_tx_id UUID;
BEGIN
  SELECT price_paise INTO v_price
  FROM account_message_pricing
  WHERE account_id = p_account_id AND category = p_category;

  IF v_price IS NULL THEN
    v_price := 0;
  END IF;

  IF v_price = 0 THEN
    SELECT balance_paise INTO v_balance
    FROM account_wallets
    WHERE account_id = p_account_id;
    RETURN json_build_object(
      'debited', false,
      'amount_paise', 0,
      'balance_paise', COALESCE(v_balance, 0)
    );
  END IF;

  SELECT balance_paise INTO v_balance
  FROM account_wallets
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM ensure_account_wallet(p_account_id);
    SELECT balance_paise INTO v_balance
    FROM account_wallets
    WHERE account_id = p_account_id
    FOR UPDATE;
  END IF;

  IF v_balance < v_price THEN
    RAISE EXCEPTION 'Insufficient wallet balance'
      USING ERRCODE = 'P0001',
            DETAIL = format('balance=%s required=%s', v_balance, v_price);
  END IF;

  v_new_balance := v_balance - v_price;

  UPDATE account_wallets
  SET balance_paise = v_new_balance, updated_at = NOW()
  WHERE account_id = p_account_id;

  INSERT INTO wallet_transactions (
    account_id, type, amount_paise, balance_after_paise,
    category, reference_type, reference_id, description
  )
  VALUES (
    p_account_id, 'debit', v_price, v_new_balance,
    p_category, 'message', p_reference_id,
    COALESCE(NULLIF(trim(p_description), ''), p_category::TEXT || ' message')
  )
  RETURNING id INTO v_tx_id;

  RETURN json_build_object(
    'debited', true,
    'amount_paise', v_price,
    'balance_paise', v_new_balance,
    'transaction_id', v_tx_id
  );
END;
$$;

ALTER FUNCTION debit_wallet_for_message(UUID, message_pricing_category_enum, TEXT, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION debit_wallet_for_message(UUID, message_pricing_category_enum, TEXT, TEXT) TO service_role;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Payment config: super admin read/write for their org
DROP POLICY IF EXISTS org_payment_config_select ON organization_payment_config;
CREATE POLICY org_payment_config_select ON organization_payment_config
  FOR SELECT TO authenticated
  USING (
    organization_id = current_organization_id()
    AND is_org_super_admin()
  );

DROP POLICY IF EXISTS org_payment_config_write ON organization_payment_config;
CREATE POLICY org_payment_config_write ON organization_payment_config
  FOR ALL TO authenticated
  USING (
    organization_id = current_organization_id()
    AND is_org_super_admin()
  )
  WITH CHECK (
    organization_id = current_organization_id()
    AND is_org_super_admin()
  );

-- Wallets: brand members read; writes via service role RPCs only
DROP POLICY IF EXISTS account_wallets_select ON account_wallets;
CREATE POLICY account_wallets_select ON account_wallets
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'viewer'));

-- Pricing: brand members read; super admin write
DROP POLICY IF EXISTS account_message_pricing_select ON account_message_pricing;
CREATE POLICY account_message_pricing_select ON account_message_pricing
  FOR SELECT TO authenticated
  USING (
    is_account_member(account_id, 'viewer')
    OR (
      is_org_super_admin()
      AND account_id IN (
        SELECT a.id FROM accounts a
        WHERE a.organization_id = current_organization_id()
      )
    )
  );

DROP POLICY IF EXISTS account_message_pricing_write ON account_message_pricing;
CREATE POLICY account_message_pricing_write ON account_message_pricing
  FOR ALL TO authenticated
  USING (
    is_org_super_admin()
    AND account_id IN (
      SELECT a.id FROM accounts a
      WHERE a.organization_id = current_organization_id()
    )
  )
  WITH CHECK (
    is_org_super_admin()
    AND account_id IN (
      SELECT a.id FROM accounts a
      WHERE a.organization_id = current_organization_id()
    )
  );

-- Transactions: brand members read
DROP POLICY IF EXISTS wallet_transactions_select ON wallet_transactions;
CREATE POLICY wallet_transactions_select ON wallet_transactions
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'viewer'));

-- Recharges: brand admins read their own
DROP POLICY IF EXISTS wallet_recharges_select ON wallet_recharges;
CREATE POLICY wallet_recharges_select ON wallet_recharges
  FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'admin'));
