-- COD → prepaid: a paid collection marks its Shopify order paid. The sync is
-- tracked on the collection so it survives webhook failures and stopped runs.
ALTER TABLE public.flow_payment_requests
  ADD COLUMN shopify_order_id text,
  ADD COLUMN shopify_sync_status text CHECK (shopify_sync_status IN ('pending','synced','failed')),
  ADD COLUMN shopify_sync_attempts integer NOT NULL DEFAULT 0 CHECK (shopify_sync_attempts >= 0),
  ADD COLUMN shopify_sync_next_at timestamptz,
  ADD COLUMN shopify_sync_error text,
  ADD COLUMN shopify_synced_at timestamptz,
  ADD CONSTRAINT flow_payment_requests_shopify_sync_order CHECK (
    (shopify_sync_status IS NULL) = (shopify_order_id IS NULL)
  );

CREATE INDEX flow_payment_requests_shopify_sync_due
  ON public.flow_payment_requests(shopify_sync_next_at)
  WHERE status = 'paid' AND shopify_sync_status = 'pending';
