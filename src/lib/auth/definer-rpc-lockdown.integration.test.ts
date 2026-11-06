import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The migration is real and the functions are stand-ins: their signatures
// match the live database, and the bodies do just enough to show a call got
// through. What is under test is who may call them, not what they do.

const account = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';

const migration = readFileSync(
  resolve(
    'supabase/migrations/20261106100000_lock_down_security_definer_rpcs.sql'
  ),
  'utf8'
);

const SERVER_ONLY = [
  '_bcast_bump(uuid,text,integer)',
  'claim_ai_reply_slot(uuid,integer)',
  'credit_wallet_for_recharge(uuid,text)',
  'debit_wallet_for_message(uuid,message_pricing_category_enum,text,text)',
  'ensure_account_wallet(uuid)',
  'increment_contact_lead_duplicate_count(uuid,uuid)',
  'merge_duplicate_contacts()',
  'merge_duplicate_conversations()',
  'recompute_broadcast_counts(uuid)',
  'record_webhook_failure(uuid,integer)',
];
const TRIGGER_ONLY = [
  'broadcast_recipient_aggregate_trigger()',
  'enforce_account_references()',
  'handle_new_user()',
  'notify_conversation_assigned()',
  'trg_accounts_ensure_wallet()',
];
const SIGNED_IN = [
  'claim_super_admin(text)',
  'complete_brand_admin_invite(uuid,text)',
  'contacts_by_last_message_activity(text[],timestamp with time zone)',
  'create_brand_with_admin_invite(text,text,text,timestamp with time zone)',
  'create_brand_with_admin_invite(text,text,text,timestamp with time zone,brand_category_enum)',
  'create_brand_with_admin_invite(text,text,text,timestamp with time zone,brand_category_enum,ecommerce_platform_enum)',
  'get_super_admin_acting_account_id()',
  'redeem_invitation(text)',
  'remove_account_member(uuid)',
  'resend_brand_admin_invite(uuid,text,text,timestamp with time zone)',
  'set_member_role(uuid,account_role_enum)',
  'set_super_admin_acting_brand(uuid)',
  'touch_presence(text)',
  'transfer_account_ownership(uuid)',
];
const KEEPS_ANON = [
  'current_organization_id()',
  'is_account_member(uuid,account_role_enum)',
  'is_org_super_admin()',
  'peek_invitation(text)',
];
const ALREADY_LOCKED = 'bump_conversation_on_inbound(uuid,text)';

let db: PGlite;

/** Runs as `role`, as PostgREST would after reading the JWT. */
const as = (role: string, uid: string | null = null) =>
  db.exec(`RESET ROLE; SET test.uid='${uid ?? ''}'; SET ROLE ${role};`);

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<{ v: T }>(`SELECT ${sql} AS v`, params);
  return rows[0].v;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE ROLE supabase_auth_admin;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;

    -- Supabase's default privileges. These direct grants are why revoking
    -- from PUBLIC alone left the functions open.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    GRANT INSERT ON auth.users TO supabase_auth_admin;

    CREATE TYPE public.account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
    CREATE TYPE public.message_pricing_category_enum AS ENUM ('utility', 'marketing', 'authentication');
    CREATE TYPE public.brand_category_enum AS ENUM ('lead_gen', 'ecommerce');
    CREATE TYPE public.ecommerce_platform_enum AS ENUM ('shopify', 'woocommerce');

    CREATE TABLE public.accounts (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.account_wallets (account_id uuid PRIMARY KEY, balance_paise bigint NOT NULL DEFAULT 0);
    CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, account_id uuid);
    CREATE TABLE public.account_invitations (token_hash text PRIMARY KEY, account_id uuid, accepted_by uuid);
    CREATE TABLE public.broadcasts (id uuid PRIMARY KEY, sent_count int NOT NULL DEFAULT 0);
    CREATE TABLE public.broadcast_recipients (broadcast_id uuid);
    CREATE TABLE public.contacts (id uuid PRIMARY KEY, account_id uuid);

    CREATE FUNCTION public.ensure_account_wallet(a uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
      $$ INSERT INTO public.account_wallets (account_id) VALUES (a) ON CONFLICT DO NOTHING $$;
    CREATE FUNCTION public.credit_wallet_for_recharge(r uuid, p text) RETURNS json LANGUAGE sql SECURITY DEFINER AS
      $$ UPDATE public.account_wallets SET balance_paise = balance_paise + 100 WHERE account_id = r;
         SELECT json_build_object('already_paid', false) $$;
    CREATE FUNCTION public.debit_wallet_for_message(a uuid, c public.message_pricing_category_enum, r text, d text)
      RETURNS json LANGUAGE sql SECURITY DEFINER AS
      $$ UPDATE public.account_wallets SET balance_paise = balance_paise - 45 WHERE account_id = a;
         SELECT json_build_object('debited', true) $$;
    CREATE FUNCTION public._bcast_bump(b uuid, c text, d integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS
      $$ UPDATE public.broadcasts SET sent_count = sent_count + d WHERE id = b $$;

    CREATE FUNCTION public.is_account_member(a uuid, r public.account_role_enum DEFAULT 'viewer')
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$ SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.account_id = a) $$;
    CREATE FUNCTION public.is_org_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
    CREATE FUNCTION public.current_organization_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.get_super_admin_acting_account_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT NULL::uuid $$;

    CREATE FUNCTION public.peek_invitation(h text) RETURNS json LANGUAGE sql SECURITY DEFINER AS
      $$ SELECT CASE WHEN i.token_hash IS NULL
                     THEN json_build_object('ok', false, 'reason', 'not_found')
                     ELSE json_build_object('ok', true, 'account_name', a.name) END
         FROM (SELECT 1) one
         LEFT JOIN public.account_invitations i ON i.token_hash = h
         LEFT JOIN public.accounts a ON a.id = i.account_id $$;
    CREATE FUNCTION public.redeem_invitation(h text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
      DECLARE v uuid;
      BEGIN
        IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
        UPDATE public.account_invitations SET accepted_by = auth.uid() WHERE token_hash = h RETURNING account_id INTO v;
        INSERT INTO public.profiles (user_id, account_id) VALUES (auth.uid(), v)
          ON CONFLICT (user_id) DO UPDATE SET account_id = excluded.account_id;
        RETURN v;
      END $$;

    CREATE FUNCTION public.trg_accounts_ensure_wallet() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS
      $$ BEGIN PERFORM public.ensure_account_wallet(NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER accounts_ensure_wallet AFTER INSERT ON public.accounts
      FOR EACH ROW EXECUTE FUNCTION public.trg_accounts_ensure_wallet();
    CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS
      $$ BEGIN INSERT INTO public.profiles (user_id) VALUES (NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    CREATE FUNCTION public.broadcast_recipient_aggregate_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS
      $$ BEGIN PERFORM public._bcast_bump(NEW.broadcast_id, 'sent_count', 1); RETURN NEW; END $$;
    CREATE TRIGGER broadcast_recipients_aggregate AFTER INSERT ON public.broadcast_recipients
      FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_aggregate_trigger();

    CREATE FUNCTION public.claim_ai_reply_slot(a uuid, b integer) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    CREATE FUNCTION public.increment_contact_lead_duplicate_count(a uuid, b uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.merge_duplicate_contacts() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0 $$;
    CREATE FUNCTION public.merge_duplicate_conversations() RETURNS integer LANGUAGE sql SECURITY DEFINER AS $$ SELECT 0 $$;
    CREATE FUNCTION public.recompute_broadcast_counts(a uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.record_webhook_failure(a uuid, b integer) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.enforce_account_references() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
    CREATE FUNCTION public.notify_conversation_assigned() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
    CREATE FUNCTION public.claim_super_admin(a text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.complete_brand_admin_invite(a uuid, b text DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT a $$;
    CREATE FUNCTION public.contacts_by_last_message_activity(a text[], b timestamptz DEFAULT NULL) RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid WHERE false $$;
    CREATE FUNCTION public.create_brand_with_admin_invite(a text, b text, c text, d timestamptz) RETURNS json LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::json $$;
    CREATE FUNCTION public.create_brand_with_admin_invite(a text, b text, c text, d timestamptz, e public.brand_category_enum) RETURNS json LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::json $$;
    CREATE FUNCTION public.create_brand_with_admin_invite(a text, b text, c text, d timestamptz, e public.brand_category_enum, f public.ecommerce_platform_enum) RETURNS json LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::json $$;
    CREATE FUNCTION public.remove_account_member(a uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT a $$;
    CREATE FUNCTION public.resend_brand_admin_invite(a uuid, b text, c text, d timestamptz) RETURNS json LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::json $$;
    CREATE FUNCTION public.set_member_role(a uuid, b public.account_role_enum) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.set_super_admin_acting_brand(a uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT a $$;
    CREATE FUNCTION public.touch_presence(a text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    CREATE FUNCTION public.transfer_account_ownership(a uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;

    -- Locked down by an earlier migration, and left alone by this one.
    CREATE FUNCTION public.bump_conversation_on_inbound(a uuid, b text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(uuid, text) FROM PUBLIC, anon, authenticated;

    -- Declared without TO, like most policies on live.
    ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
    CREATE POLICY contacts_member ON public.contacts USING (public.is_account_member(account_id));
    GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
  `);
  await db.exec(migration);
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    SET test.uid='';
    TRUNCATE public.accounts, public.account_wallets, public.profiles, public.account_invitations,
      public.broadcasts, public.broadcast_recipients, public.contacts, auth.users;
    INSERT INTO public.accounts (id, name) VALUES ('${account}', 'Acme');
    UPDATE public.account_wallets SET balance_paise = 1000;
    INSERT INTO public.contacts VALUES ('${member}', '${account}');
    INSERT INTO public.account_invitations (token_hash, account_id) VALUES ('hash', '${account}');
  `);
});

afterAll(async () => {
  await db.close();
});

describe('SECURITY DEFINER lockdown', () => {
  const can = (role: string, signature: string) =>
    scalar<boolean>(
      `has_function_privilege('${role}', 'public.${signature}', 'EXECUTE')`
    );

  it.each(SERVER_ONLY)('%s is server-only', async (signature) => {
    expect(await can('anon', signature)).toBe(false);
    expect(await can('authenticated', signature)).toBe(false);
    expect(await can('service_role', signature)).toBe(true);
  });

  it.each(TRIGGER_ONLY)('%s has no direct callers', async (signature) => {
    expect(await can('anon', signature)).toBe(false);
    expect(await can('authenticated', signature)).toBe(false);
    expect(await can('service_role', signature)).toBe(false);
  });

  it.each(SIGNED_IN)('%s needs a signed-in user', async (signature) => {
    expect(await can('anon', signature)).toBe(false);
    expect(await can('authenticated', signature)).toBe(true);
  });

  it.each(KEEPS_ANON)('%s stays callable signed out', async (signature) => {
    expect(await can('anon', signature)).toBe(true);
    expect(await can('authenticated', signature)).toBe(true);
    expect(await can('service_role', signature)).toBe(true);
  });

  it('leaves anon with exactly the four functions it needs, and PUBLIC with none', async () => {
    const { rows } = await db.query<{
      signature: string;
      anon: boolean;
      public_exec: boolean;
    }>(`
      SELECT p.oid::regprocedure::text AS signature,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             EXISTS (
               SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
               WHERE acl.grantee = 0
             ) AS public_exec
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    `);
    expect(
      rows
        .filter((row) => row.anon)
        .map((row) => row.signature)
        .sort()
    ).toEqual(KEEPS_ANON);
    expect(rows.filter((row) => row.public_exec)).toEqual([]);
    expect(rows.map((row) => row.signature).sort()).toEqual(
      [
        ...SERVER_ONLY,
        ...TRIGGER_ONLY,
        ...SIGNED_IN,
        ...KEEPS_ANON,
        ALREADY_LOCKED,
      ].sort()
    );
  });

  it('can be applied twice', async () => {
    await expect(db.exec(migration)).resolves.toBeDefined();
  });
});

describe('wallets', () => {
  const balance = async () => {
    await db.exec('RESET ROLE');
    return scalar<number>(
      '(SELECT balance_paise FROM public.account_wallets WHERE account_id = $1)',
      [account]
    );
  };
  const credit = () =>
    db.query('SELECT public.credit_wallet_for_recharge($1, $2)', [
      account,
      'pay_1',
    ]);
  const debit = () =>
    db.query(
      `SELECT public.debit_wallet_for_message($1, 'utility', 'm', 'd')`,
      [account]
    );

  it.each([
    ['anon', null],
    ['authenticated', member],
  ])('refuses %s, even for its own money', async (role, uid) => {
    await as(role, uid);
    await expect(credit()).rejects.toThrow(/permission denied for function/);
    await expect(debit()).rejects.toThrow(/permission denied for function/);
    expect(await balance()).toBe(1000);
  });

  it('lets the service role credit and debit', async () => {
    await as('service_role');
    await credit();
    await debit();
    expect(await balance()).toBe(1055);
  });
});

describe('invitations', () => {
  const peek = async (hash = 'hash') =>
    scalar<{ ok: boolean; account_name?: string; reason?: string }>(
      'public.peek_invitation($1)',
      [hash]
    );
  const redeem = () => scalar<string>('public.redeem_invitation($1)', ['hash']);

  it('lets a signed-out visitor see the invite on /join', async () => {
    await as('anon');
    expect(await peek()).toEqual({ ok: true, account_name: 'Acme' });
    expect(await peek('wrong')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('refuses a signed-out redeem', async () => {
    await as('anon');
    await expect(redeem()).rejects.toThrow(/permission denied for function/);
  });

  it('completes peek then redeem once signed in', async () => {
    await as('authenticated', member);
    expect((await peek()).ok).toBe(true);
    expect(await redeem()).toBe(account);

    // Membership takes effect through the helper RLS relies on.
    const { rows } = await db.query('SELECT id FROM public.contacts');
    expect(rows).toHaveLength(1);
  });
});

describe('triggers and nested calls', () => {
  it('still creates a profile on signup, with no EXECUTE on the trigger function', async () => {
    expect(
      await scalar<boolean>(
        `has_function_privilege('supabase_auth_admin', 'public.handle_new_user()', 'EXECUTE')`
      )
    ).toBe(false);
    await as('supabase_auth_admin');
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [member]);
    await db.exec('RESET ROLE');
    const { rows } = await db.query(
      'SELECT 1 FROM public.profiles WHERE user_id = $1',
      [member]
    );
    expect(rows).toHaveLength(1);
  });

  it('still bootstraps a wallet when a signed-in user inserts an account', async () => {
    const other = '33333333-3333-4333-8333-333333333333';
    await as('authenticated', member);
    await db.query('INSERT INTO public.accounts (id) VALUES ($1)', [other]);
    await db.exec('RESET ROLE');
    const { rows } = await db.query(
      'SELECT 1 FROM public.account_wallets WHERE account_id = $1',
      [other]
    );
    expect(rows).toHaveLength(1);
  });

  it('still runs a server-only helper nested inside a trigger', async () => {
    await db.query('INSERT INTO public.broadcasts (id) VALUES ($1)', [member]);
    await as('authenticated', member);
    await db.query('INSERT INTO public.broadcast_recipients VALUES ($1)', [
      member,
    ]);
    await db.exec('RESET ROLE');
    expect(
      await scalar<number>('(SELECT sent_count FROM public.broadcasts)')
    ).toBe(1);
  });
});

describe('RLS helpers', () => {
  it('returns no rows to a signed-out read, rather than an error', async () => {
    await as('anon');
    const { rows } = await db.query('SELECT id FROM public.contacts');
    expect(rows).toEqual([]);
  });

  it('still scopes signed-in reads to the member', async () => {
    await db.query(
      'INSERT INTO public.profiles (user_id, account_id) VALUES ($1, $2)',
      [member, account]
    );
    await as('authenticated', member);
    const { rows } = await db.query('SELECT id FROM public.contacts');
    expect(rows).toHaveLength(1);
  });

  it('breaks signed-out reads if anon loses the helper, which is why it keeps it', async () => {
    await db.exec(`
      BEGIN;
      REVOKE ALL ON FUNCTION public.is_account_member(uuid, public.account_role_enum) FROM anon;
      SET LOCAL ROLE anon;
    `);
    await expect(db.query('SELECT id FROM public.contacts')).rejects.toThrow(
      /permission denied for function is_account_member/
    );
    await db.exec('ROLLBACK');
  });
});
