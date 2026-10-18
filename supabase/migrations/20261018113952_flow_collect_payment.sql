-- Customer collections use each brand's gateway, independently of wallet billing.
ALTER TABLE public.flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK (node_type IN (
  'start','send_buttons','send_list','send_message','send_media','send_product',
  'send_template','collect_input','send_address','send_flow','condition','switch',
  'set_tag','handoff','wait','send_webhook','http_fetch','update_contact_field',
  'assign_conversation','create_deal','close_conversation','end','collect_payment'
));

CREATE TABLE public.account_payment_connections (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  key_secret_encrypted text NOT NULL,
  webhook_secret_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_payment_connections ENABLE ROW LEVEL SECURITY;
-- Secrets are available only through authorized server endpoints. No client policies.
REVOKE ALL ON public.account_payment_connections FROM anon, authenticated;
GRANT ALL ON public.account_payment_connections TO service_role;

CREATE TABLE public.flow_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  flow_run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  node_key text NOT NULL,
  provider_link_id text UNIQUE,
  payment_url text,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 100),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating','pending','paid','expired','failed')),
  config jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  reminder_at timestamptz NOT NULL,
  reminders_sent integer NOT NULL DEFAULT 0 CHECK (reminders_sent >= 0),
  reminder_claimed_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (flow_run_id, node_key)
);
CREATE INDEX flow_payment_requests_due ON public.flow_payment_requests(next_check_at) WHERE status = 'pending';
CREATE INDEX flow_payment_requests_account ON public.flow_payment_requests(account_id);
ALTER TABLE public.flow_payment_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_payment_requests FROM anon, authenticated;
GRANT SELECT ON public.flow_payment_requests TO authenticated;
GRANT ALL ON public.flow_payment_requests TO service_role;
CREATE POLICY "Members read brand collections" ON public.flow_payment_requests
  FOR SELECT TO authenticated USING (public.is_account_member(account_id));

-- Resolving and enqueueing must be one transaction. Duplicate callbacks cannot
-- queue two receipts. SECURITY INVOKER + service_role-only EXECUTE keeps this private.
CREATE FUNCTION public.resolve_flow_payment(p_request_id uuid, p_outcome text)
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
  -- An early callback during the initial send is retried by the reconciliation cron.
  IF run.status = 'active' THEN RETURN false; END IF;
  UPDATE public.flow_payment_requests SET status = p_outcome, resolved_at = now(), reminder_claimed_at = NULL WHERE id = payment.id;
  -- Never revive a run stopped by an agent, exit condition or another flow.
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
REVOKE ALL ON FUNCTION public.resolve_flow_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_flow_payment(uuid, text) TO service_role;
