import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';

let db: PGlite;
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-0000-0000-000000000000`;
const ORG = id(1);
const NEW_USER = id(2);
const COMPANY = id(3);
const LINKED_USER = id(4);
const LINKED_ACCOUNT = id(5);
const INVITED_USER = id(6);
const STAFF_USER = id(7);
const OTHER_USER = id(8);
const WOO_USER = id(9);
const WOO_COMPANY = id(10);

const provision = async (user: string, company: string, name = 'Asha Stores', platform = 'shopify') =>
  (await db.query<{ r: Record<string, unknown> }>(
    'SELECT provision_dashboard_signup_workspace($1, $2, $3, $4) AS r',
    [user, company, name, platform],
  )).rows[0].r;

const profile = async (user: string) =>
  (await db.query<{ account_id: string | null; account_role: string | null }>(
    'SELECT account_id, account_role FROM profiles WHERE user_id = $1', [user],
  )).rows[0];

const count = async (table: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE TYPE ecommerce_platform_enum AS ENUM ('shopify', 'woocommerce');
    CREATE TYPE brand_category_enum AS ENUM ('lead_gen', 'ecommerce');
    CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE organization_members (organization_id uuid, user_id uuid);
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
      organization_id uuid NOT NULL, owner_user_id uuid,
      brand_category brand_category_enum NOT NULL DEFAULT 'lead_gen',
      ecommerce_platform ecommerce_platform_enum
    );
    CREATE TABLE profiles (
      user_id uuid PRIMARY KEY, full_name text NOT NULL, email text NOT NULL,
      account_id uuid, account_role account_role_enum
    );
    CREATE TABLE account_invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invited_email text,
      accepted_at timestamptz, expires_at timestamptz
    );
    CREATE TABLE account_wallets (account_id uuid PRIMARY KEY);
    CREATE FUNCTION seed_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO account_wallets VALUES (NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER accounts_ensure_wallet AFTER INSERT ON accounts
      FOR EACH ROW EXECUTE FUNCTION seed_wallet();
    -- The live guard: only a direct update as 'authenticated' is refused.
    CREATE FUNCTION enforce_profile_privilege_columns() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF (NEW.account_role IS DISTINCT FROM OLD.account_role OR NEW.account_id IS DISTINCT FROM OLD.account_id)
         AND current_user = 'authenticated' THEN
        RAISE EXCEPTION 'cannot change directly' USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER enforce_profile_privilege_columns BEFORE UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION enforce_profile_privilege_columns();

    INSERT INTO organizations VALUES ('${ORG}');
    INSERT INTO accounts (id, name, organization_id) VALUES ('${LINKED_ACCOUNT}', 'Existing brand', '${ORG}');
    INSERT INTO auth.users VALUES
      ('${NEW_USER}', 'new@example.com', '{"full_name":"Asha Rao"}'),
      ('${OTHER_USER}', 'other@example.com', '{}'),
      ('${WOO_USER}', 'woo@example.com', '{}');
    INSERT INTO profiles (user_id, full_name, email, account_id, account_role) VALUES
      ('${LINKED_USER}', '', 'linked@example.com', '${LINKED_ACCOUNT}', 'agent'),
      ('${INVITED_USER}', '', 'Invited@Example.com ', NULL, NULL),
      ('${STAFF_USER}', '', 'staff@example.com', NULL, NULL),
      ('${OTHER_USER}', '', 'other@example.com', NULL, NULL);
    INSERT INTO organization_members VALUES ('${ORG}', '${STAFF_USER}');
    INSERT INTO account_invitations (invited_email, expires_at)
      VALUES ('invited@example.com', now() + interval '7 days');
  `);
  await db.exec(readFileSync('supabase/migrations/20261106100000_dashboard_signup_workspace.sql', 'utf8'));
}, 20_000);

afterAll(async () => { await db?.close(); });

it('creates a workspace and links the user as owner, as an accepted invite does', async () => {
  const before = await count('accounts');
  const result = await provision(NEW_USER, COMPANY, '  Asha Stores  ');
  expect(result.created).toBe(true);
  expect(await count('accounts')).toBe(before + 1);

  const linked = await profile(NEW_USER);
  expect(linked.account_role).toBe('owner');
  const account = (await db.query<Record<string, unknown>>(
    'SELECT * FROM accounts WHERE id = $1', [linked.account_id],
  )).rows[0];
  expect(account).toMatchObject({
    name: 'Asha Stores', organization_id: ORG, owner_user_id: NEW_USER,
    brand_category: 'ecommerce', ecommerce_platform: 'shopify', dashboard_company_id: COMPANY,
  });
  expect((await db.query('SELECT 1 FROM account_wallets WHERE account_id = $1', [linked.account_id])).rows).toHaveLength(1);
});

it('is safe to call again and creates nothing new', async () => {
  const before = await count('accounts');
  const first = await profile(NEW_USER);
  const result = await provision(NEW_USER, COMPANY);
  expect(result).toMatchObject({ account_id: first.account_id, created: false });
  expect(await count('accounts')).toBe(before);
});

it('keeps WooCommerce as the platform', async () => {
  await provision(WOO_USER, WOO_COMPANY, 'Woo Store', 'woocommerce');
  const { account_id } = await profile(WOO_USER);
  const row = (await db.query<{ ecommerce_platform: string }>(
    'SELECT ecommerce_platform FROM accounts WHERE id = $1', [account_id],
  )).rows[0];
  expect(row.ecommerce_platform).toBe('woocommerce');
});

it('never moves someone who already has a workspace', async () => {
  const before = await count('accounts');
  const result = await provision(LINKED_USER, id(20));
  expect(result).toMatchObject({ account_id: LINKED_ACCOUNT, created: false });
  expect(await profile(LINKED_USER)).toEqual({ account_id: LINKED_ACCOUNT, account_role: 'agent' });
  expect(await count('accounts')).toBe(before);
});

it('leaves a pending invitation to be accepted instead of creating a second workspace', async () => {
  const before = await count('accounts');
  expect(await provision(INVITED_USER, id(21))).toEqual({ skipped: 'pending_invitation' });
  expect((await profile(INVITED_USER)).account_id).toBeNull();
  expect(await count('accounts')).toBe(before);
});

it('does not give platform staff their own workspace', async () => {
  expect(await provision(STAFF_USER, id(22))).toEqual({ skipped: 'organization_member' });
  expect((await profile(STAFF_USER)).account_id).toBeNull();
});

it("refuses another user claiming a company's workspace", async () => {
  await expect(provision(OTHER_USER, COMPANY)).rejects.toMatchObject({ code: '42501' });
  expect((await profile(OTHER_USER)).account_id).toBeNull();
});

it.each([
  ['a blank name', NEW_USER, id(23), '   ', 'shopify'],
  ['an unknown platform', OTHER_USER, id(24), 'Store', 'magento'],
  ['an unknown user', id(25), id(26), 'Store', 'shopify'],
])('refuses %s', async (_label, user, company, name, platform) => {
  const before = await count('accounts');
  await expect(provision(user, company, name, platform)).rejects.toMatchObject({ code: '22023' });
  expect(await count('accounts')).toBe(before);
});

it('stops rather than guessing when there is more than one organization', async () => {
  await db.exec(`INSERT INTO organizations VALUES ('${id(30)}')`);
  await expect(provision(OTHER_USER, id(27))).rejects.toThrow(/exactly one organization/);
  expect((await profile(OTHER_USER)).account_id).toBeNull();
  await db.exec(`DELETE FROM organizations WHERE id = '${id(30)}'`);
});

it.each(['anon', 'authenticated'])('cannot be called by %s', async (role) => {
  await db.exec(`SET ROLE ${role}`);
  await expect(provision(OTHER_USER, id(28))).rejects.toThrow(/permission denied/);
  await db.exec('RESET ROLE');
});

it('can be called by the server role', async () => {
  const { rows } = await db.query<{ ok: boolean }>(
    "SELECT has_function_privilege('service_role', 'provision_dashboard_signup_workspace(uuid,uuid,text,text)', 'EXECUTE') AS ok",
  );
  expect(rows[0].ok).toBe(true);
});
