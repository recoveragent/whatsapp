-- Structured payload for inbound messages that carry more than plain
-- text (e.g. WhatsApp Address Message nfm_reply values). Optional JSONB
-- so existing rows stay NULL and inserts that omit it behave the same.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS content_payload JSONB;
