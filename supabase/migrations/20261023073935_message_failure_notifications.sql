-- Covers immediate send failures and asynchronous WhatsApp delivery webhooks.
-- Existing notification RLS, realtime publication and read_at privileges apply.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'message_failed'));
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS source_message_id uuid
  REFERENCES public.messages(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_failed_message_recipient
  ON public.notifications(user_id, source_message_id) WHERE type = 'message_failed';

CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.notify_message_failure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  conv record;
  brand_id uuid;
  recipient uuid;
  reason text;
  guidance text;
BEGIN
  IF NEW.status <> 'failed' OR NEW.sender_type = 'customer' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('failed', 'delivered', 'read') THEN RETURN NEW; END IF;
  SELECT c.account_id, c.contact_id, c.assigned_agent_id,
    COALESCE(NULLIF(ct.name, ''), 'Contact') AS contact_name
    INTO conv FROM public.conversations c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    WHERE c.id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT COALESCE(a.parent_brand_id, a.id) INTO brand_id
    FROM public.accounts a WHERE a.id = conv.account_id;
  reason := COALESCE(NULLIF(NEW.error_message, ''), 'No error details were returned.');
  guidance := CASE WHEN reason LIKE '%131042%'
    THEN ' Check WhatsApp billing in Meta Business Manager, including country, currency and payment method.'
    ELSE ' Open the chat to review the failed message before retrying.' END;
  -- Parent-brand admins handle channel billing; assigned agents handle their chats.
  -- Membership filtering prevents alerts to a former assignee or another tenant.
  FOR recipient IN SELECT DISTINCT p.user_id FROM public.profiles p
    WHERE p.account_id = brand_id AND (
      p.account_role IN ('owner', 'admin') OR
      (p.user_id = conv.assigned_agent_id AND p.account_role = 'agent')
    )
  LOOP
    INSERT INTO public.notifications(account_id, user_id, type, conversation_id,
      contact_id, source_message_id, title, body)
    VALUES (conv.account_id, recipient, 'message_failed', NEW.conversation_id,
      conv.contact_id, NEW.id, 'WhatsApp message failed',
      conv.contact_name || ': ' || reason || guidance)
    ON CONFLICT (user_id, source_message_id) WHERE type = 'message_failed' DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_message_failure() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_message_failure ON public.messages;
CREATE TRIGGER on_message_failure AFTER INSERT OR UPDATE OF status ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.notify_message_failure();
