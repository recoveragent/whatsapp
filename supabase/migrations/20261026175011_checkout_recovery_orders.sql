-- Order creation from saved abandoned checkouts. Server-only writes and secrets.
ALTER TABLE public.flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK (node_type IN (
  'start','send_buttons','send_list','send_message','send_media','send_product',
  'send_template','collect_input','send_address','send_flow','condition','switch',
  'set_tag','handoff','wait','send_webhook','http_fetch','update_contact_field',
  'assign_conversation','create_deal','close_conversation','end','collect_payment',
  'ai_agent','recover_checkout'
));

CREATE TABLE public.shopify_checkout_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  checkout_id text NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('preparing','quoted','completing','placed')),
  draft_order_id text,
  shopify_order_id text,
  order_name text,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 100),
  summary text NOT NULL DEFAULT '',
  quote_fingerprint text NOT NULL DEFAULT '',
  quoted_at timestamptz,
  reserved_until timestamptz,
  confirmed_at timestamptz,
  confirmed_flow_run_id uuid REFERENCES public.flow_runs(id) ON DELETE SET NULL,
  payment_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, checkout_id)
);
ALTER TABLE public.shopify_checkout_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shopify_checkout_recoveries FROM anon, authenticated;
GRANT ALL ON public.shopify_checkout_recoveries TO service_role;
GRANT SELECT ON public.shopify_checkout_recoveries TO authenticated;
CREATE POLICY "Members read checkout recovery orders" ON public.shopify_checkout_recoveries
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

ALTER TABLE public.flow_payment_requests
  ADD COLUMN checkout_recovery_id uuid REFERENCES public.shopify_checkout_recoveries(id),
  ADD COLUMN checkout_branch_released_at timestamptz,
  DROP CONSTRAINT flow_payment_requests_shopify_sync_order,
  ADD CONSTRAINT flow_payment_requests_shopify_sync_order CHECK (
    (shopify_sync_status IS NULL) = (shopify_order_id IS NULL AND checkout_recovery_id IS NULL)
  );
CREATE UNIQUE INDEX flow_payment_checkout_recovery_unique ON public.flow_payment_requests(checkout_recovery_id)
  WHERE checkout_recovery_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.resolve_flow_payment(p_request_id uuid, p_outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  payment public.flow_payment_requests%ROWTYPE;
  run public.flow_runs%ROWTYPE;
  target text;
  new_vars jsonb;
BEGIN
  IF p_outcome NOT IN ('paid', 'expired', 'failed') THEN RAISE EXCEPTION 'Invalid payment outcome'; END IF;
  SELECT * INTO payment FROM public.flow_payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR payment.status <> 'pending' THEN RETURN false; END IF;
  SELECT * INTO run FROM public.flow_runs WHERE id = payment.flow_run_id AND account_id = payment.account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF run.status = 'active' THEN RETURN false; END IF;
  UPDATE public.flow_payment_requests SET status = p_outcome, resolved_at = now(), reminder_claimed_at = NULL WHERE id = payment.id;
  -- A paid checkout cannot send an order confirmation until Shopify has the order.
  IF p_outcome = 'paid' AND payment.checkout_recovery_id IS NOT NULL THEN RETURN false; END IF;
  IF run.status <> 'waiting' OR run.current_node_key IS DISTINCT FROM payment.node_key THEN RETURN false; END IF;
  target := payment.config ->> (p_outcome || '_next');
  IF target IS NULL OR target = '' THEN RAISE EXCEPTION 'Missing payment branch'; END IF;
  new_vars := run.vars || jsonb_build_object('payment_collection_status', p_outcome, 'payment_reference', payment.id::text);
  UPDATE public.flow_runs SET vars = new_vars WHERE id = run.id;
  INSERT INTO public.flow_pending_executions(flow_run_id, flow_id, account_id, user_id, contact_id, conversation_id, next_node_key, vars, run_at, execution_kind, source_node_key)
    VALUES(run.id, run.flow_id, run.account_id, run.user_id, run.contact_id, run.conversation_id, target, new_vars, now(), 'wait', payment.node_key);
  RETURN true;
END;
$$;

CREATE FUNCTION public.resume_checkout_payment(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  payment public.flow_payment_requests%ROWTYPE;
  run public.flow_runs%ROWTYPE;
  recovery public.shopify_checkout_recoveries%ROWTYPE;
  target text;
  new_vars jsonb;
BEGIN
  SELECT * INTO payment FROM public.flow_payment_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR payment.status <> 'paid' OR payment.checkout_recovery_id IS NULL
    OR payment.checkout_branch_released_at IS NOT NULL OR payment.shopify_sync_status IS NULL OR payment.shopify_sync_status NOT IN ('synced','failed') THEN RETURN false; END IF;
  SELECT * INTO run FROM public.flow_runs WHERE id=payment.flow_run_id AND account_id=payment.account_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO recovery FROM public.shopify_checkout_recoveries WHERE id=payment.checkout_recovery_id AND account_id=payment.account_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF payment.shopify_sync_status='synced' AND (recovery.status <> 'placed' OR recovery.shopify_order_id IS NULL) THEN RETURN false; END IF;
  UPDATE public.flow_payment_requests SET checkout_branch_released_at=now() WHERE id=payment.id;
  IF run.status <> 'waiting' OR run.current_node_key IS DISTINCT FROM payment.node_key THEN RETURN false; END IF;
  target := payment.config ->> (CASE WHEN payment.shopify_sync_status='synced' THEN 'paid_next' ELSE 'failed_next' END);
  IF target IS NULL OR target='' THEN RAISE EXCEPTION 'Missing payment branch'; END IF;
  new_vars := run.vars || jsonb_build_object('payment_collection_status','paid','payment_reference',payment.id::text,
    'shopify_order_id',recovery.shopify_order_id,'order_number',recovery.order_name,
    'checkout_recovery_error',payment.shopify_sync_error);
  UPDATE public.flow_runs SET vars=new_vars WHERE id=run.id;
  INSERT INTO public.flow_pending_executions(flow_run_id,flow_id,account_id,user_id,contact_id,conversation_id,next_node_key,vars,run_at,execution_kind,source_node_key)
    VALUES(run.id,run.flow_id,run.account_id,run.user_id,run.contact_id,run.conversation_id,target,new_vars,now(),'wait',payment.node_key);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.resume_checkout_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_checkout_payment(uuid) TO service_role;
