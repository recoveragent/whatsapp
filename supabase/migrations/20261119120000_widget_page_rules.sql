-- Which pages of the merchant's site show the chat widget. Shape and limits
-- are validated by the API (src/lib/website-widget/page-rules.ts).
ALTER TABLE public.website_widget_config
  ADD COLUMN page_rules jsonb NOT NULL
    DEFAULT '{"show":"all","include":[],"exclude":[]}'::jsonb
    CHECK (jsonb_typeof(page_rules) = 'object' AND pg_column_size(page_rules) <= 32768);
