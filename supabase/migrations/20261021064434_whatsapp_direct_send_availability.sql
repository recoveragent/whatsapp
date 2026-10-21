-- Meta controls access. Existing and new accounts remain unconfirmed by default.
ALTER TABLE public.whatsapp_config
  ADD COLUMN direct_send_status text NOT NULL DEFAULT 'unknown'
    CHECK (direct_send_status IN ('unknown', 'enabled', 'unavailable'));

-- A replacement number / WABA must never inherit another account's access.
CREATE FUNCTION public.reset_direct_send_on_connection_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.phone_number_id IS DISTINCT FROM OLD.phone_number_id
     OR NEW.waba_id IS DISTINCT FROM OLD.waba_id
     OR NEW.status = 'disconnected' THEN
    NEW.direct_send_status := 'unknown';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reset_direct_send_on_connection_change
  BEFORE UPDATE ON public.whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.reset_direct_send_on_connection_change();
