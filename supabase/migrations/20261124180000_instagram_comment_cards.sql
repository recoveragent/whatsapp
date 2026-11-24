-- Product cards for comment-to-DM. Existing rules keep sending plain text.
-- 'products' sends cards as the first DM. 'tap' sends one card with a button;
-- the products, and an optional reminder, follow the customer's tap.
ALTER TABLE public.instagram_comment_rules
  ADD COLUMN delivery text NOT NULL DEFAULT 'text' CHECK (delivery IN ('text', 'products', 'tap')),
  ADD COLUMN product_ids bigint[] NOT NULL DEFAULT '{}' CHECK (cardinality(product_ids) <= 10),
  ADD COLUMN tap_title text NOT NULL DEFAULT '',
  ADD COLUMN tap_subtitle text NOT NULL DEFAULT '',
  ADD COLUMN tap_button text NOT NULL DEFAULT '',
  ADD COLUMN reminder_text text CHECK (reminder_text IS NULL OR octet_length(reminder_text) BETWEEN 1 AND 1000),
  ADD COLUMN reminder_minutes int NOT NULL DEFAULT 600 CHECK (reminder_minutes BETWEEN 10 AND 1380);

-- What was sent is copied from the rule, so later edits never change a
-- conversation already under way.
ALTER TABLE public.instagram_comment_replies
  ADD COLUMN delivery text NOT NULL DEFAULT 'text' CHECK (delivery IN ('text', 'products', 'tap')),
  ADD COLUMN recipient_id text,
  ADD COLUMN product_ids bigint[] NOT NULL DEFAULT '{}',
  ADD COLUMN fallback_text text,
  ADD COLUMN tap_label text,
  ADD COLUMN tapped_at timestamptz,
  ADD COLUMN tap_message_id uuid UNIQUE REFERENCES public.instagram_messages(id) ON DELETE SET NULL,
  ADD COLUMN products_status text CHECK (products_status IN ('sending', 'sent', 'failed', 'unknown')),
  ADD COLUMN products_error text,
  ADD COLUMN products_sent_at timestamptz,
  ADD COLUMN reminder_text text,
  ADD COLUMN reminder_minutes int,
  ADD COLUMN reminder_status text CHECK (reminder_status IN ('sending', 'sent', 'failed', 'unknown', 'skipped')),
  ADD COLUMN reminder_error text;
CREATE INDEX instagram_comment_replies_flow_idx ON public.instagram_comment_replies(delivery, created_at DESC) WHERE delivery = 'tap' AND status = 'sent';

CREATE TABLE public.instagram_comment_links (
  token text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  reply_id uuid NOT NULL REFERENCES public.instagram_comment_replies(id) ON DELETE CASCADE,
  url text NOT NULL,
  clicks int NOT NULL DEFAULT 0,
  last_clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX instagram_comment_links_reply_idx ON public.instagram_comment_links(reply_id);
ALTER TABLE public.instagram_comment_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_comment_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.instagram_comment_links TO service_role;

CREATE FUNCTION public.instagram_comment_click(p_token text, p_count boolean) RETURNS text
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.instagram_comment_links SET
    clicks = clicks + CASE WHEN p_count THEN 1 ELSE 0 END,
    last_clicked_at = CASE WHEN p_count THEN now() ELSE last_clicked_at END
  WHERE token = p_token RETURNING url;
$$;

CREATE FUNCTION public.instagram_comment_stats(p_account uuid)
RETURNS TABLE (rule_id uuid, sent bigint, tapped bigint, clicked bigint, reminded bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT r.rule_id,
    count(*) FILTER (WHERE r.status = 'sent'),
    count(r.tapped_at),
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.instagram_comment_links l WHERE l.reply_id = r.id AND l.clicks > 0)),
    count(*) FILTER (WHERE r.reminder_status = 'sent')
  FROM public.instagram_comment_replies r
  WHERE r.account_id = p_account AND r.rule_id IS NOT NULL
  GROUP BY r.rule_id;
$$;
REVOKE ALL ON FUNCTION public.instagram_comment_click(text, boolean), public.instagram_comment_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.instagram_comment_click(text, boolean), public.instagram_comment_stats(uuid) TO service_role;
