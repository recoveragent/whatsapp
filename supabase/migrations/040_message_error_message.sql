-- ============================================================
-- 040_message_error_message.sql
--
-- Persist Meta's delivery-failure reason on messages so the inbox
-- can show why a send was marked Failed (code / title / details
-- from the WhatsApp status webhook `errors` array).
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_message TEXT;
