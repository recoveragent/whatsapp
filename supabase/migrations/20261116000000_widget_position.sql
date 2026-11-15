ALTER TABLE public.website_widget_config
  ADD COLUMN IF NOT EXISTS desktop_position text NOT NULL DEFAULT 'right' CHECK (desktop_position IN ('left', 'right')),
  ADD COLUMN IF NOT EXISTS mobile_position text NOT NULL DEFAULT 'right' CHECK (mobile_position IN ('left', 'right'));
