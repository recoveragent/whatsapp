-- ============================================================
-- 029_shopify.sql — Shopify integration per brand (account)
--
-- Stores OAuth credentials, campaign configs (order confirmation,
-- fulfillment updates, abandoned checkout), and pending abandoned-
-- checkout sends. Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- SHOPIFY_CONFIG — one store per account
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain TEXT NOT NULL,
  access_token TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_config_shop_domain
  ON shopify_config (shop_domain);

CREATE INDEX IF NOT EXISTS idx_shopify_config_account_id
  ON shopify_config (account_id);

ALTER TABLE shopify_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_config_select ON shopify_config;
DROP POLICY IF EXISTS shopify_config_insert ON shopify_config;
DROP POLICY IF EXISTS shopify_config_update ON shopify_config;
DROP POLICY IF EXISTS shopify_config_delete ON shopify_config;
CREATE POLICY shopify_config_select ON shopify_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY shopify_config_insert ON shopify_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY shopify_config_update ON shopify_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY shopify_config_delete ON shopify_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON shopify_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SHOPIFY_CAMPAIGNS — WhatsApp template mapping per event type
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_type TEXT NOT NULL
    CHECK (campaign_type IN (
      'order_confirmation',
      'fulfillment_update',
      'abandoned_checkout'
    )),
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  template_name TEXT,
  template_language TEXT NOT NULL DEFAULT 'en_US',
  /** Maps template variable index ("1", "2", …) → Shopify field key */
  variable_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Minutes to wait before sending abandoned-checkout messages */
  delay_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (delay_minutes >= 5 AND delay_minutes <= 10080),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, campaign_type)
);

CREATE INDEX IF NOT EXISTS idx_shopify_campaigns_account
  ON shopify_campaigns (account_id);

ALTER TABLE shopify_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_campaigns_select ON shopify_campaigns;
DROP POLICY IF EXISTS shopify_campaigns_insert ON shopify_campaigns;
DROP POLICY IF EXISTS shopify_campaigns_update ON shopify_campaigns;
DROP POLICY IF EXISTS shopify_campaigns_delete ON shopify_campaigns;
CREATE POLICY shopify_campaigns_select ON shopify_campaigns FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY shopify_campaigns_insert ON shopify_campaigns FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY shopify_campaigns_update ON shopify_campaigns FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY shopify_campaigns_delete ON shopify_campaigns FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON shopify_campaigns;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shopify_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SHOPIFY_PENDING_CHECKOUTS — delayed abandoned-checkout queue
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_pending_checkouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  checkout_id TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'sent', 'cancelled', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, checkout_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_pending_checkouts_due
  ON shopify_pending_checkouts (run_at)
  WHERE status = 'pending';

ALTER TABLE shopify_pending_checkouts ENABLE ROW LEVEL SECURITY;
-- Service-role only — no client policies.

-- ============================================================
-- SHOPIFY_MESSAGE_LOG — dedupe + audit for campaign sends
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  whatsapp_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, campaign_type, resource_key)
);

CREATE INDEX IF NOT EXISTS idx_shopify_message_log_account
  ON shopify_message_log (account_id, created_at DESC);

ALTER TABLE shopify_message_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shopify_message_log_select ON shopify_message_log;
CREATE POLICY shopify_message_log_select ON shopify_message_log FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- SHOPIFY_OAUTH_STATES — short-lived OAuth CSRF tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT NOT NULL UNIQUE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_domain TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_oauth_states_expires
  ON shopify_oauth_states (expires_at);

ALTER TABLE shopify_oauth_states ENABLE ROW LEVEL SECURITY;
-- Service-role only.
