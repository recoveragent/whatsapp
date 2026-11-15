ALTER TABLE public.website_widget_config
  ADD COLUMN IF NOT EXISTS desktop_side_offset integer NOT NULL DEFAULT 20 CHECK (desktop_side_offset BETWEEN 0 AND 200),
  ADD COLUMN IF NOT EXISTS desktop_bottom_offset integer NOT NULL DEFAULT 20 CHECK (desktop_bottom_offset BETWEEN 0 AND 200),
  ADD COLUMN IF NOT EXISTS mobile_side_offset integer NOT NULL DEFAULT 16 CHECK (mobile_side_offset BETWEEN 0 AND 200),
  ADD COLUMN IF NOT EXISTS mobile_bottom_offset integer NOT NULL DEFAULT 16 CHECK (mobile_bottom_offset BETWEEN 0 AND 200);
