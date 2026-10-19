-- Separate credentials allow both gateways to remain connected for in-flight links.
CREATE TABLE public.account_cashfree_connections (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  client_secret_encrypted text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('production', 'sandbox')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_cashfree_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_cashfree_connections FROM anon, authenticated;
GRANT ALL ON public.account_cashfree_connections TO service_role;
-- Cashfree references are merchant scoped, so link IDs must be unique within a
-- brand and gateway, not globally. Existing requests retain their saved config.
ALTER TABLE public.flow_payment_requests DROP CONSTRAINT flow_payment_requests_provider_link_id_key;
CREATE UNIQUE INDEX flow_payment_requests_provider_link
  ON public.flow_payment_requests(account_id, (COALESCE(config->>'provider', 'razorpay')), provider_link_id);
