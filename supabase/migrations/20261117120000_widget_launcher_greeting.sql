ALTER TABLE public.website_widget_config
  ADD COLUMN launcher_greeting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN launcher_greeting_text text NOT NULL DEFAULT 'Hi! How can I help?' CHECK (char_length(launcher_greeting_text) BETWEEN 1 AND 120),
  ADD COLUMN launcher_greeting_delay integer NOT NULL DEFAULT 5 CHECK (launcher_greeting_delay BETWEEN 0 AND 300),
  ADD COLUMN launcher_indicator text NOT NULL DEFAULT 'dot' CHECK (launcher_indicator IN ('dot', 'number'));
