ALTER TABLE public.website_widget_config
  ADD COLUMN avatar_url text CHECK (avatar_url IS NULL OR (length(avatar_url) <= 2048 AND avatar_url ~ '^https://')),
  ADD COLUMN show_whatsapp_link boolean NOT NULL DEFAULT true,
  ADD COLUMN suggested_questions text[] NOT NULL DEFAULT ARRAY['Help me find something', 'I have a question']::text[]
    CHECK (cardinality(suggested_questions) <= 5);
