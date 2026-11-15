-- Optional visitor-provided number for a WhatsApp follow-up.
ALTER TABLE public.website_chat_sessions
  ADD COLUMN phone text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{0,2}[0-9]{10}$');
