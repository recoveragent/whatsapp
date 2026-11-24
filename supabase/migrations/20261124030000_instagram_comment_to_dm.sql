-- Comment-to-DM: rules choose which comments get one private reply, and
-- instagram_comment_replies records each attempt. A rule is on while
-- active_since is set, and only applies to comments made after that time.
CREATE TABLE public.instagram_comment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  media_id text,
  keywords text[] NOT NULL DEFAULT '{}',
  reply_text text NOT NULL CHECK (octet_length(reply_text) BETWEEN 1 AND 1000),
  active_since timestamptz,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, account_id) REFERENCES public.instagram_connections(id, account_id) ON DELETE CASCADE
);
CREATE INDEX instagram_comment_rules_connection_idx ON public.instagram_comment_rules(connection_id) WHERE active_since IS NOT NULL;
CREATE INDEX instagram_comment_rules_account_idx ON public.instagram_comment_rules(account_id);

-- The row is inserted before sending. UNIQUE (connection_id, comment_id) means a
-- comment is answered at most once; the second constraint means a person gets at
-- most one DM per post, however often they comment.
CREATE TABLE public.instagram_comment_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  rule_id uuid REFERENCES public.instagram_comment_rules(id) ON DELETE SET NULL,
  comment_id text NOT NULL,
  media_id text NOT NULL,
  commenter_key text NOT NULL,
  commenter_username text,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, account_id) REFERENCES public.instagram_connections(id, account_id) ON DELETE CASCADE,
  UNIQUE (connection_id, comment_id),
  UNIQUE (connection_id, media_id, commenter_key)
);
CREATE INDEX instagram_comment_replies_recent_idx ON public.instagram_comment_replies(account_id, created_at DESC);

ALTER TABLE public.instagram_comment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_comment_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_comment_rules, public.instagram_comment_replies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.instagram_comment_rules, public.instagram_comment_replies TO authenticated;
GRANT ALL ON public.instagram_comment_rules, public.instagram_comment_replies TO service_role;
CREATE POLICY instagram_comment_rules_read ON public.instagram_comment_rules FOR SELECT TO authenticated USING (public.is_account_member(account_id));
CREATE POLICY instagram_comment_replies_read ON public.instagram_comment_replies FOR SELECT TO authenticated USING (public.is_account_member(account_id));
