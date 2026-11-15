ALTER TABLE public.website_widget_config
  ADD COLUMN desktop_position text NOT NULL DEFAULT 'right' CHECK (desktop_position IN ('left', 'right')),
  ADD COLUMN mobile_position text NOT NULL DEFAULT 'right' CHECK (mobile_position IN ('left', 'right'));
