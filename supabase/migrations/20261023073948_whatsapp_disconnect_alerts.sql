-- Records when Meta removes this app's access to a WhatsApp number
-- (account_update webhook: app uninstalled, partner removed, coexistence
-- offboarded) and alerts brand admins. Credentials are kept so the brand
-- can reconnect the same number through Embedded Signup.
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_disconnected_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_disconnect_reason text;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'message_failed', 'whatsapp_disconnected'));
