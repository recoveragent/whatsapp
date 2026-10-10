-- Single WhatsApp number per original brand. Apply with the matching app build.
-- Existing secondary tenants remain as historical archives; never merge or
-- delete their contacts, conversations, messages, templates, or integrations.
BEGIN;

DROP TRIGGER IF EXISTS allocate_channel_workspace ON public.whatsapp_config;
DROP TRIGGER IF EXISTS reattach_channel_conversations ON public.whatsapp_config;
DROP TRIGGER IF EXISTS enforce_single_whatsapp_account ON public.whatsapp_config;

-- Retire secondary senders without deleting the rows referenced by history.
UPDATE public.whatsapp_config c
SET status = 'disconnected', access_token = '', verify_token = NULL,
    connected_at = NULL, registered_at = NULL, last_registration_error = NULL
FROM public.accounts a
WHERE a.id = c.account_id AND a.parent_brand_id IS NOT NULL;

-- Restore direct account membership. Archived child tenants are no longer
-- reachable through membership in their former parent brand.
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id uuid, min_role account_role_enum DEFAULT 'viewer'
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
        >= CASE min_role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'agent' THEN 2 WHEN 'viewer' THEN 1 END
  ) OR (
    is_org_super_admin() AND EXISTS (
      SELECT 1 FROM organization_admin_context ctx
      JOIN accounts a ON a.id = ctx.acting_account_id
      JOIN organization_members om ON om.organization_id = a.organization_id AND om.user_id = auth.uid()
      WHERE ctx.user_id = auth.uid() AND ctx.acting_account_id = target_account_id
        AND a.parent_brand_id IS NULL
    ) AND min_role <> 'owner'
  );
$$;

-- Remove only channel-selection policies. Original account-membership RLS
-- remains enabled on every table, including shared team presence.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT schemaname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'channel_workspace_scope'
  LOOP
    EXECUTE format('DROP POLICY channel_workspace_scope ON %I.%I', item.schemaname, item.tablename);
  END LOOP;
END $$;

-- Keep cross-account reference integrity, without depending on a selected
-- channel. This also protects existing SECURITY DEFINER write paths.
CREATE OR REPLACE FUNCTION public.enforce_account_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE relation record; payload jsonb := to_jsonb(NEW); scope_id uuid;
  referenced_scope uuid; reference_id uuid;
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
      RAISE EXCEPTION 'Cross-account reference refused: %.%', TG_TABLE_NAME, relation.local_column USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF current_setting('role', true) = 'authenticated' AND scope_id IS NOT NULL
    AND NOT is_account_member(scope_id) THEN
    RAISE EXCEPTION 'Record belongs to another account' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT n.nspname, c.relname, t.tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND t.tgname IN ('enforce_channel_references', 'enforce_account_references')
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %I.%I', item.tgname, item.nspname, item.relname);
    EXECUTE format('CREATE TRIGGER enforce_account_references BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_account_references()', item.nspname, item.relname);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.enforce_channel_references();

-- No new child tenants or switching state can be created. Historical account
-- metadata stays in place so archived records retain their ownership.
CREATE OR REPLACE FUNCTION public.enforce_account_archive_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_brand_id IS NOT NULL THEN
    RAISE EXCEPTION 'Additional WhatsApp workspaces are no longer supported' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.parent_brand_id IS DISTINCT FROM NEW.parent_brand_id THEN
    RAISE EXCEPTION 'Account ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_channel_parent ON public.accounts;
DROP TRIGGER IF EXISTS enforce_account_archive_parent ON public.accounts;
CREATE TRIGGER enforce_account_archive_parent BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_archive_parent();
DROP FUNCTION IF EXISTS public.enforce_channel_parent();

CREATE OR REPLACE FUNCTION public.enforce_single_whatsapp_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND parent_brand_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Only the original brand account can connect WhatsApp' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'WhatsApp account ownership cannot be changed' USING ERRCODE = '23514';
  END IF;
  NEW.reference_name := 'Primary';
  NEW.is_default := true;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_single_whatsapp_account ON public.whatsapp_config;
CREATE TRIGGER enforce_single_whatsapp_account BEFORE INSERT OR UPDATE ON public.whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION enforce_single_whatsapp_account();

-- Retain pending one-time Shopify credentials for recovery by ops; clients
-- cannot enqueue or claim imports through the retired channel-selection flow.
REVOKE ALL ON public.whatsapp_pending_shopify_imports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_channel_context FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS channel_context_own ON public.whatsapp_channel_context;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public' AND tablename = 'whatsapp_channel_context') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.whatsapp_channel_context;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.allocate_channel_workspace();
DROP FUNCTION IF EXISTS public.reattach_channel_conversations();
DROP FUNCTION IF EXISTS public.create_channel_tenant(uuid);
DROP FUNCTION IF EXISTS public.channel_workspace_visible(uuid);
DROP FUNCTION IF EXISTS public.channel_brand_id(uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;
