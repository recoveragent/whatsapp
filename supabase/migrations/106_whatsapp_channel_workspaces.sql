-- Apply after 105. Channel workspaces reuse account_id tenancy throughout CRM.
-- The original brand account hosts Primary; additional numbers get child
-- account tenants. Team membership stays on the original brand.
-- Transactional: a failed preflight or backfill rolls everything back.
BEGIN;

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS parent_brand_id uuid
  REFERENCES public.accounts(id) ON DELETE CASCADE;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS whatsapp_channel_name text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS channel_phone_number_id text;
CREATE INDEX IF NOT EXISTS idx_accounts_parent_brand ON public.accounts(parent_brand_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_channel_context (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  workspace_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, brand_account_id)
);
ALTER TABLE public.whatsapp_channel_context ENABLE ROW LEVEL SECURITY;

-- SSO can arrive before a first channel choice. Keep the one-time Shopify
-- credentials encrypted and service-role-only until the user chooses a tenant.
CREATE TABLE IF NOT EXISTS public.whatsapp_pending_shopify_imports (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  encrypted_connection text NOT NULL,
  webhook_callback_url text NOT NULL,
  PRIMARY KEY (user_id, brand_account_id)
);
ALTER TABLE public.whatsapp_pending_shopify_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_pending_shopify_imports FROM anon, authenticated;
GRANT ALL ON public.whatsapp_pending_shopify_imports TO service_role;

CREATE OR REPLACE FUNCTION public.channel_brand_id(target uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(parent_brand_id, id) FROM accounts WHERE id = target;
$$;

-- Preserve the existing member/acting-admin role checks, extending membership
-- to a child tenant through its parent brand. Activity RLS below additionally
-- requires that tenant to be the user's selected workspace.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid, min_role account_role_enum DEFAULT 'viewer'
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = channel_brand_id(target_account_id)
      AND CASE p.account_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
        >= CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
  ) OR (
    is_org_super_admin() AND EXISTS (
      SELECT 1 FROM organization_admin_context ctx
      JOIN accounts a ON a.id = ctx.acting_account_id
      JOIN organization_members om ON om.organization_id = a.organization_id AND om.user_id = auth.uid()
      WHERE ctx.user_id = auth.uid() AND ctx.acting_account_id = channel_brand_id(target_account_id)
    ) AND min_role <> 'owner'
  );
$$;

DROP POLICY IF EXISTS channel_context_own ON public.whatsapp_channel_context;
CREATE POLICY channel_context_own ON public.whatsapp_channel_context FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_account_member(brand_account_id)
    AND channel_brand_id(brand_account_id) = brand_account_id
    AND channel_brand_id(workspace_account_id) = brand_account_id
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = workspace_account_id AND a.whatsapp_channel_name IS NOT NULL));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_channel_context TO authenticated;

CREATE TABLE IF NOT EXISTS public.channel_isolation_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_id)
);
ALTER TABLE public.channel_isolation_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS channel_review_read ON public.channel_isolation_review;
CREATE POLICY channel_review_read ON public.channel_isolation_review FOR SELECT TO authenticated
  USING (is_account_member(account_id, 'admin'));
GRANT SELECT ON public.channel_isolation_review TO authenticated;

-- Clone brand metadata only. Contacts, rules, sources, credentials, pipelines
-- and all other activity are never copied into a newly added channel.
CREATE OR REPLACE FUNCTION public.create_channel_tenant(brand_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid := gen_random_uuid(); columns_sql text; source jsonb;
BEGIN
  SELECT to_jsonb(a) INTO source FROM accounts a WHERE a.id = brand_id AND a.parent_brand_id IS NULL;
  IF source IS NULL THEN RAISE EXCEPTION 'Brand not found'; END IF;
  source := source || jsonb_build_object('id', new_id, 'parent_brand_id', brand_id,
    'owner_user_id', NULL, 'whatsapp_channel_name', NULL, 'channel_phone_number_id', NULL,
    'created_at', now(), 'updated_at', now());
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO columns_sql
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'accounts'
      AND is_generated = 'NEVER' AND is_identity = 'NO';
  EXECUTE format('INSERT INTO accounts (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::accounts, $1)', columns_sql) USING source;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_channel_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- Two numbers under the same Meta WABA share Meta templates. Require distinct
-- WABAs for the requested full isolation, before moving any existing data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM whatsapp_config WHERE waba_id IS NOT NULL
    GROUP BY account_id, waba_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Channel isolation requires a separate Meta WABA per channel. Resolve shared WABAs before applying migration 106.';
  END IF;
END $$;

CREATE TEMP TABLE channel_contact_moves (
  old_contact_id uuid, new_contact_id uuid, workspace_account_id uuid,
  PRIMARY KEY (old_contact_id, workspace_account_id)
) ON COMMIT DROP;

DO $$
DECLARE channel record; person record; new_workspace uuid; new_contact uuid; item record;
BEGIN
  FOR channel IN
    SELECT c.*, row_number() OVER (PARTITION BY c.account_id ORDER BY c.is_default DESC, c.created_at, c.id) AS position
    FROM whatsapp_config c JOIN accounts a ON a.id = c.account_id
    WHERE a.parent_brand_id IS NULL
  LOOP
    IF channel.position = 1 THEN
      UPDATE accounts SET whatsapp_channel_name = channel.reference_name, channel_phone_number_id = channel.phone_number_id WHERE id = channel.account_id;
      CONTINUE;
    END IF;
    new_workspace := create_channel_tenant(channel.account_id);
    UPDATE accounts SET whatsapp_channel_name = channel.reference_name, channel_phone_number_id = channel.phone_number_id WHERE id = new_workspace;

    -- Separate customer records. Only basic identity fields move; shared
    -- notes/tags/custom values cannot be attributed safely and stay on Primary.
    FOR person IN SELECT DISTINCT c.* FROM contacts c JOIN conversations v ON v.contact_id = c.id
      WHERE v.whatsapp_config_id = channel.id AND v.account_id = channel.account_id
    LOOP
      new_contact := gen_random_uuid();
      INSERT INTO contacts(id, user_id, account_id, phone, name, email, company, avatar_url, created_at, updated_at)
        VALUES(new_contact, person.user_id, new_workspace, person.phone, person.name, person.email,
          person.company, person.avatar_url, person.created_at, person.updated_at);
      INSERT INTO channel_contact_moves VALUES(person.id, new_contact, new_workspace);
      INSERT INTO channel_isolation_review(account_id, source_table, source_id, reason)
        VALUES(channel.account_id, 'contacts', person.id,
          'Contact was used by multiple-channel activity. Channel conversations were separated; existing shared notes, tags, custom values and deals remain on Primary for explicit review.')
        ON CONFLICT DO NOTHING;
    END LOOP;

    -- Runs authored under brand-wide rules are ambiguous. Stop their queues
    -- and retain their audit history on Primary; never resume them on a newly
    -- isolated sender. Preserve their original contact and rule ownership.
    INSERT INTO channel_isolation_review(account_id, source_table, source_id, reason)
      SELECT r.account_id, 'flow_runs', r.id, 'Legacy flow used another channel. Run stopped and detached from that conversation; recreate the rule in the intended channel.'
      FROM flow_runs r JOIN conversations v ON v.id = r.conversation_id WHERE v.whatsapp_config_id = channel.id
      ON CONFLICT DO NOTHING;
    UPDATE flow_pending_executions p SET status = 'failed', conversation_id = NULL
      FROM conversations v WHERE p.conversation_id = v.id AND v.whatsapp_config_id = channel.id;
    UPDATE flow_runs r SET status = CASE WHEN r.status IN ('active', 'waiting', 'paused_by_agent') THEN 'failed' ELSE r.status END,
      conversation_id = NULL
      FROM conversations v WHERE r.conversation_id = v.id AND v.whatsapp_config_id = channel.id;
    UPDATE automation_pending_executions p SET status = 'failed',
      context = p.context - 'conversation_id'
      FROM conversations v WHERE p.context->>'conversation_id' = v.id::text AND v.whatsapp_config_id = channel.id;

    UPDATE whatsapp_config SET account_id = new_workspace, is_default = true WHERE id = channel.id;
    UPDATE message_templates SET account_id = new_workspace WHERE whatsapp_config_id = channel.id;
    UPDATE conversations v SET account_id = new_workspace, contact_id = m.new_contact_id
      FROM channel_contact_moves m WHERE v.whatsapp_config_id = channel.id
        AND m.old_contact_id = v.contact_id AND m.workspace_account_id = new_workspace;

    -- Direct conversation-owned records (private notes, notifications,
    -- product sends, AI usage, etc.) follow their conversation. Their contact
    -- references follow its new contact too. Rule-owned records were detached
    -- above and must not migrate definitions implicitly.
    FOR item IN SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'conversation_id'
      AND table_name NOT IN ('flow_runs', 'flow_pending_executions', 'conversations')
    LOOP
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = item.table_name AND column_name = 'contact_id') THEN
        EXECUTE format('UPDATE %I x SET contact_id = v.contact_id FROM conversations v WHERE x.conversation_id = v.id AND v.account_id = $1', item.table_name) USING new_workspace;
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = item.table_name AND column_name = 'account_id') THEN
        EXECUTE format('UPDATE %I x SET account_id = v.account_id FROM conversations v WHERE x.conversation_id = v.id AND v.account_id = $1', item.table_name) USING new_workspace;
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_workspace_brand_name
  ON accounts (COALESCE(parent_brand_id, id), lower(whatsapp_channel_name))
  WHERE whatsapp_channel_name IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_channel_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.parent_brand_id IS DISTINCT FROM NEW.parent_brand_id THEN
    RAISE EXCEPTION 'Channel workspace brand ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.id = NEW.parent_brand_id AND a.parent_brand_id IS NULL AND a.id <> NEW.id
  ) THEN RAISE EXCEPTION 'A channel workspace must belong directly to a brand' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_channel_parent ON accounts;
CREATE TRIGGER enforce_channel_parent BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_channel_parent();

-- Old broadcasts did not persist a sender id. Never guess which channel an
-- unsent broadcast meant to use. Preserve the rows and recipients for review.
INSERT INTO channel_isolation_review(account_id, source_table, source_id, reason)
  SELECT b.account_id, 'broadcasts', b.id, 'Legacy broadcast has no unambiguous channel assignment. Pending sending stopped; review and recreate in the intended channel.'
  FROM broadcasts b WHERE b.status IN ('draft', 'scheduled', 'sending')
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.parent_brand_id = b.account_id)
  ON CONFLICT DO NOTHING;
UPDATE broadcasts b SET status = 'failed' WHERE b.status IN ('draft', 'scheduled', 'sending')
  AND EXISTS (SELECT 1 FROM channel_isolation_review r WHERE r.source_table = 'broadcasts' AND r.source_id = b.id);

-- Account tenancy now has exactly one WhatsApp sender. This restores old
-- account-scoped senders without silently choosing between multiple numbers.
ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_account_id_key UNIQUE(account_id);

CREATE OR REPLACE FUNCTION public.allocate_channel_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE brand_id uuid; sibling record; existing_workspace uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'A WhatsApp channel cannot be moved to another workspace' USING ERRCODE = '23514';
  END IF;
  brand_id := channel_brand_id(NEW.account_id);
  PERFORM 1 FROM accounts WHERE id = brand_id FOR UPDATE;
  FOR sibling IN SELECT c.* FROM whatsapp_config c JOIN accounts a ON a.id = c.account_id
    WHERE COALESCE(a.parent_brand_id, a.id) = brand_id AND c.id IS DISTINCT FROM NEW.id
  LOOP
    IF lower(sibling.reference_name) = lower(NEW.reference_name) THEN
      RAISE EXCEPTION 'A channel with this name already exists in the brand' USING ERRCODE = '23505';
    END IF;
    IF NEW.waba_id IS NOT NULL AND sibling.waba_id = NEW.waba_id THEN
      RAISE EXCEPTION 'Use a separate Meta WABA for each isolated channel; Meta templates are shared within a WABA' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'INSERT' THEN
    -- A disconnected channel keeps its tenant/history. Reconnect into that
    -- workspace instead of creating another customer database for it.
    SELECT a.id INTO existing_workspace FROM accounts a
      WHERE COALESCE(a.parent_brand_id, a.id) = brand_id
        AND (a.channel_phone_number_id = NEW.phone_number_id OR lower(a.whatsapp_channel_name) = lower(NEW.reference_name))
        AND NOT EXISTS (SELECT 1 FROM whatsapp_config c WHERE c.account_id = a.id)
      ORDER BY (a.channel_phone_number_id = NEW.phone_number_id) DESC NULLS LAST, a.created_at LIMIT 1;
    IF existing_workspace IS NOT NULL THEN NEW.account_id := existing_workspace;
    ELSIF EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.whatsapp_channel_name IS NOT NULL)
      OR EXISTS (SELECT 1 FROM whatsapp_config WHERE account_id = NEW.account_id) THEN
      NEW.account_id := create_channel_tenant(brand_id);
    END IF;
  END IF;
  UPDATE accounts SET whatsapp_channel_name = NEW.reference_name, channel_phone_number_id = NEW.phone_number_id WHERE id = NEW.account_id;
  NEW.is_default := true;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS allocate_channel_workspace ON whatsapp_config;
CREATE TRIGGER allocate_channel_workspace BEFORE INSERT OR UPDATE ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION allocate_channel_workspace();

CREATE OR REPLACE FUNCTION public.reattach_channel_conversations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE conversations SET whatsapp_config_id = NEW.id
    WHERE account_id = NEW.account_id AND whatsapp_config_id IS NULL;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reattach_channel_conversations ON whatsapp_config;
CREATE TRIGGER reattach_channel_conversations AFTER INSERT ON whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION reattach_channel_conversations();

CREATE OR REPLACE FUNCTION public.channel_workspace_visible(target uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE brand_id uuid; selected uuid; sender_count integer;
BEGIN
  brand_id := channel_brand_id(target);
  IF NOT is_account_member(target) THEN RETURN false; END IF;
  SELECT workspace_account_id INTO selected FROM whatsapp_channel_context
    WHERE user_id = auth.uid() AND brand_account_id = brand_id;
  IF selected IS NOT NULL THEN RETURN selected = target; END IF;
  SELECT count(*) INTO sender_count FROM accounts a
    WHERE COALESCE(a.parent_brand_id, a.id) = brand_id AND a.whatsapp_channel_name IS NOT NULL;
  -- No sender yet is a setup workspace. A single sender is unambiguous.
  IF sender_count = 0 THEN RETURN target = brand_id; END IF;
  IF sender_count = 1 THEN RETURN EXISTS (SELECT 1 FROM accounts WHERE id = target AND whatsapp_channel_name IS NOT NULL); END IF;
  RETURN false;
END;
$$;

-- Add a restrictive policy to EVERY account-scoped activity table. This also
-- protects unfiltered queries, exports, RPCs using invoker rights and Realtime.
-- Shared brand membership/configuration discovery is explicitly excluded.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t USING(table_schema, table_name)
    WHERE c.table_schema = 'public' AND c.column_name = 'account_id' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('profiles', 'account_invitations', 'whatsapp_config', 'member_presence')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', item.table_name);
    EXECUTE format('DROP POLICY IF EXISTS channel_workspace_scope ON %I', item.table_name);
    EXECUTE format('CREATE POLICY channel_workspace_scope ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (channel_workspace_visible(account_id)) WITH CHECK (channel_workspace_visible(account_id))', item.table_name);
  END LOOP;
END $$;

-- Service-role background jobs bypass RLS. Enforce same-tenant references in
-- database triggers too: e.g. a Support broadcast cannot target a Primary
-- contact; a Support conversation cannot use a Primary sender/rule/pipeline.
CREATE OR REPLACE FUNCTION public.enforce_channel_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE relation record; payload jsonb := to_jsonb(NEW); scope_id uuid; referenced_scope uuid; reference_id uuid;
BEGIN
  scope_id := NULLIF(payload->>'account_id', '')::uuid;
  FOR relation IN
    SELECT local.attname AS local_column, remote.attname AS remote_column, parent.relname AS parent_table
    FROM pg_constraint fk
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_namespace ns ON ns.oid = parent.relnamespace
    JOIN pg_attribute local ON local.attrelid = fk.conrelid AND local.attnum = fk.conkey[1]
    JOIN pg_attribute remote ON remote.attrelid = fk.confrelid AND remote.attnum = fk.confkey[1]
    WHERE fk.conrelid = TG_RELID AND fk.contype = 'f' AND array_length(fk.conkey, 1) = 1
      AND ns.nspname = 'public' AND parent.relname NOT IN ('profiles', 'accounts', 'account_invitations')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = fk.confrelid AND a.attname = 'account_id' AND NOT a.attisdropped)
  LOOP
    reference_id := NULLIF(payload->>relation.local_column, '')::uuid;
    IF reference_id IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT account_id FROM %I WHERE %I = $1', relation.parent_table, relation.remote_column)
      INTO referenced_scope USING reference_id;
    IF referenced_scope IS NULL THEN CONTINUE; END IF;
    IF scope_id IS NULL THEN scope_id := referenced_scope;
    ELSIF scope_id <> referenced_scope THEN
      RAISE EXCEPTION 'Cross-channel reference refused: %.%', TG_TABLE_NAME, relation.local_column USING ERRCODE = '23514';
    END IF;
  END LOOP;
  -- SECURITY DEFINER RPCs also bypass RLS. Enforce the caller's selection
  -- here when the JWT belongs to a browser user. Provisioning a new channel
  -- may initialize an empty wallet/pricing row before that channel is selected.
  IF auth.role() = 'authenticated' AND scope_id IS NOT NULL
    AND TG_TABLE_NAME <> 'whatsapp_config'
    AND NOT (TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('account_wallets', 'account_message_pricing'))
    AND NOT channel_workspace_visible(scope_id) THEN
    RAISE EXCEPTION 'Record belongs to another WhatsApp channel' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT DISTINCT child.relname AS table_name FROM pg_class child
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    WHERE child.relkind = 'r' AND ns.nspname = 'public'
      AND child.relname NOT IN ('accounts', 'profiles', 'organization_admin_context', 'whatsapp_channel_context', 'account_invitations')
      AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = child.oid AND a.attname = 'account_id' AND NOT a.attisdropped)
        OR EXISTS (SELECT 1 FROM pg_constraint fk JOIN pg_attribute a ON a.attrelid = fk.confrelid
          WHERE fk.conrelid = child.oid AND fk.contype = 'f' AND a.attname = 'account_id' AND NOT a.attisdropped))
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_channel_references ON %I', item.table_name);
    EXECUTE format('CREATE TRIGGER enforce_channel_references BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_channel_references()', item.table_name);
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_channel_context') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_channel_context;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
