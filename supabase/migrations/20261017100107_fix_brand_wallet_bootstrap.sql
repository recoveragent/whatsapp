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
    -- Nested account-creation triggers seed these rows before membership exists.
    -- Direct inserts and all updates still require account membership.
    AND NOT (TG_OP = 'INSERT' AND pg_trigger_depth() > 1
      AND TG_TABLE_SCHEMA = 'public'
      AND TG_TABLE_NAME IN ('account_wallets', 'account_message_pricing'))
    AND NOT is_account_member(scope_id) THEN
    RAISE EXCEPTION 'Record belongs to another account' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


