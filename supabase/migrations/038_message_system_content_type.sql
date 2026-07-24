-- ============================================================
-- 038_message_system_content_type.sql
--
-- Allows inbox timeline microcopy for conversation status changes
-- (opened / closed / follow-up) as messages.content_type = 'system'.
-- ============================================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'template',
    'interactive',
    'button',
    'system'
  ));
