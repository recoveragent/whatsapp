import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const brand = '10000000-0000-0000-0000-000000000001';
const user = '20000000-0000-0000-0000-000000000001';
const primaryConfig = '30000000-0000-0000-0000-000000000001';
const supportConfig = '30000000-0000-0000-0000-000000000002';
const customer = '40000000-0000-0000-0000-000000000001';
const primaryConversation = '50000000-0000-0000-0000-000000000001';
const supportConversation = '50000000-0000-0000-0000-000000000002';

// Executable PostgreSQL tests, including service-role writes and real RLS.
// The fixture contains the relevant pre-106 table/FK shapes; migrations run
// unchanged, rather than restating their implementation in assertions.
describe('channel workspace migration and isolation', () => {
  let db: PGlite;
  let support: string;
  let supportContact: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES ('${user}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.user_id', true), '')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
      CREATE TABLE accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
        owner_user_id uuid REFERENCES auth.users(id), organization_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX idx_accounts_one_per_owner ON accounts(owner_user_id) WHERE owner_user_id IS NOT NULL;
      CREATE TABLE profiles(user_id uuid PRIMARY KEY REFERENCES auth.users(id), account_id uuid REFERENCES accounts(id), account_role account_role_enum);
      CREATE TABLE organization_admin_context(user_id uuid, acting_account_id uuid);
      CREATE TABLE organization_members(user_id uuid, organization_id uuid);
      CREATE FUNCTION is_org_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION is_account_member(uuid, account_role_enum DEFAULT 'viewer') RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), user_id uuid REFERENCES auth.users(id),
        phone text, name text, email text, company text, avatar_url text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        phone_normalized text GENERATED ALWAYS AS (regexp_replace(phone, '[^0-9]', '', 'g')) STORED,
        UNIQUE(account_id, phone_normalized));
      CREATE TABLE whatsapp_config(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), user_id uuid,
        phone_number_id text UNIQUE, reference_name text, waba_id text, created_at timestamptz DEFAULT now());
      CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), contact_id uuid REFERENCES contacts(id),
        whatsapp_config_id uuid REFERENCES whatsapp_config(id));
      CREATE TABLE message_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), whatsapp_config_id uuid REFERENCES whatsapp_config(id), name text);
      CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations(id), content_text text);
      CREATE TABLE contact_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), contact_id uuid REFERENCES contacts(id), note_text text);
      CREATE TABLE tags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), name text);
      CREATE TABLE contact_tags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid REFERENCES contacts(id), tag_id uuid REFERENCES tags(id));
      CREATE FUNCTION edit_contact_as_definer(target uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS
        $$ UPDATE contacts SET name='Changed through RPC' WHERE id=target $$;
      CREATE TABLE broadcasts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), status text);
      CREATE TABLE broadcast_recipients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), broadcast_id uuid REFERENCES broadcasts(id), contact_id uuid REFERENCES contacts(id));
      CREATE TABLE flows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id));
      CREATE TABLE flow_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), flow_id uuid REFERENCES flows(id),
        contact_id uuid REFERENCES contacts(id), conversation_id uuid REFERENCES conversations(id), status text);
      CREATE TABLE flow_pending_executions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id),
        flow_run_id uuid REFERENCES flow_runs(id), conversation_id uuid REFERENCES conversations(id), status text);
      CREATE TABLE automation_pending_executions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), context jsonb, status text);
      CREATE TABLE private_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id), contact_id uuid REFERENCES contacts(id), conversation_id uuid REFERENCES conversations(id), body text);
      INSERT INTO accounts(id, name, owner_user_id) VALUES('${brand}', 'Recover Agent', '${user}');
      INSERT INTO profiles VALUES('${user}', '${brand}', 'admin');
      INSERT INTO whatsapp_config(id, account_id, reference_name, phone_number_id, waba_id) VALUES
        ('${primaryConfig}', '${brand}', 'Primary', '111', 'WABA-1'),
        ('${supportConfig}', '${brand}', 'Support', '222', 'WABA-2');
      INSERT INTO contacts(id, account_id, user_id, phone, name) VALUES('${customer}', '${brand}', '${user}', '+919000000001', 'Customer');
      INSERT INTO conversations VALUES
        ('${primaryConversation}', '${brand}', '${customer}', '${primaryConfig}'),
        ('${supportConversation}', '${brand}', '${customer}', '${supportConfig}');
      INSERT INTO message_templates(account_id, whatsapp_config_id, name) VALUES('${brand}', '${supportConfig}', 'lead_received');
      INSERT INTO contact_notes(account_id, contact_id, note_text) VALUES('${brand}', '${customer}', 'Old shared note');
      INSERT INTO private_notes(account_id, contact_id, conversation_id, body) VALUES('${brand}', '${customer}', '${supportConversation}', 'Support only');
      INSERT INTO messages(conversation_id, content_text) VALUES('${primaryConversation}', 'Primary message'), ('${supportConversation}', 'Support message');
      INSERT INTO broadcasts(account_id, status) VALUES('${brand}', 'scheduled');
      WITH f AS (INSERT INTO flows(account_id) VALUES('${brand}') RETURNING id),
        r AS (INSERT INTO flow_runs(account_id, flow_id, contact_id, conversation_id, status)
          SELECT '${brand}', id, '${customer}', '${supportConversation}', 'waiting' FROM f RETURNING id)
      INSERT INTO flow_pending_executions(account_id, flow_run_id, conversation_id, status)
        SELECT '${brand}', id, '${supportConversation}', 'pending' FROM r;
      DO $$ DECLARE t record; BEGIN
        FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='account_id' LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.table_name);
          EXECUTE format('CREATE POLICY base_member ON %I FOR ALL TO authenticated USING (is_account_member(account_id)) WITH CHECK (is_account_member(account_id))', t.table_name);
        END LOOP;
      END $$;
      ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY messages_parent ON messages FOR ALL TO authenticated USING
        (EXISTS (SELECT 1 FROM conversations v WHERE v.id=conversation_id));
      GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    `);
    await db.exec(readFileSync('supabase/migrations/105_whatsapp_default_number.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/106_whatsapp_channel_workspaces.sql', 'utf8'));
    support = (await db.query<{ account_id: string }>(`SELECT account_id FROM whatsapp_config WHERE id='${supportConfig}'`)).rows[0].account_id;
    supportContact = (await db.query<{ contact_id: string }>(`SELECT contact_id FROM conversations WHERE id='${supportConversation}'`)).rows[0].contact_id;
  }, 120000);
  afterAll(async () => { await db?.close(); });

  async function authenticated() {
    await db.exec(`SELECT set_config('test.user_id', '${user}', false);
      SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false); SET ROLE authenticated;`);
  }
  async function serviceRole() {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
  }
  async function select(workspace: string) {
    await serviceRole();
    await authenticated();
    await db.exec(`INSERT INTO whatsapp_channel_context VALUES('${user}', '${brand}', '${workspace}')
      ON CONFLICT(user_id,brand_account_id) DO UPDATE SET workspace_account_id=excluded.workspace_account_id;`);
  }

  it('preserves messages but separates contacts, sender and template ownership', async () => {
    expect(support).not.toBe(brand);
    expect(supportContact).not.toBe(customer);
    expect((await db.query(`SELECT * FROM messages`)).rows).toHaveLength(2);
    expect((await db.query<{ account_id: string }>(`SELECT account_id FROM message_templates`)).rows[0].account_id).toBe(support);
    const note = (await db.query<{ account_id: string; contact_id: string }>(`SELECT * FROM private_notes`)).rows[0];
    expect(note.account_id).toBe(support);
    expect(note.contact_id).toBe(supportContact);
    expect((await db.query<{ account_id: string }>('SELECT * FROM contact_notes')).rows[0].account_id).toBe(brand);
  });
  it('stops ambiguous historical sends without deleting their audit rows', async () => {
    expect((await db.query<{ status: string; conversation_id: string | null }>('SELECT * FROM flow_runs')).rows[0]).toMatchObject({ status: 'failed', conversation_id: null });
    expect((await db.query<{ status: string }>('SELECT * FROM flow_pending_executions')).rows[0].status).toBe('failed');
    expect((await db.query<{ status: string }>('SELECT * FROM broadcasts')).rows[0].status).toBe('failed');
    expect((await db.query('SELECT * FROM channel_isolation_review')).rows.length).toBeGreaterThan(0);
  });
  it('denies unfiltered operational reads until a channel is selected', async () => {
    await authenticated();
    expect((await db.query('SELECT * FROM contacts')).rows).toHaveLength(0);
    expect((await db.query('SELECT * FROM conversations')).rows).toHaveLength(0);
  });
  it('isolates reads, messages and contact writes in the selected channel', async () => {
    await select(support);
    expect((await db.query<{ id: string }>('SELECT * FROM contacts')).rows.map((row) => row.id)).toEqual([supportContact]);
    expect((await db.query<{ content_text: string }>('SELECT * FROM messages')).rows.map((row) => row.content_text)).toEqual(['Support message']);
    await expect(db.exec(`INSERT INTO contacts(account_id, phone) VALUES('${brand}', '+919000000003')`)).rejects.toMatchObject({ code: '42501' });
    await expect(db.exec(`SELECT edit_contact_as_definer('${customer}')`)).rejects.toThrow(/another WhatsApp channel/);
    await select(brand);
    expect((await db.query<{ id: string }>('SELECT * FROM contacts')).rows.map((row) => row.id)).toEqual([customer]);
    expect((await db.query<{ content_text: string }>('SELECT * FROM messages')).rows.map((row) => row.content_text)).toEqual(['Primary message']);
  });
  it('blocks cross-channel references even for service-role background writes', async () => {
    await serviceRole();
    await expect(db.exec(`INSERT INTO conversations(account_id,contact_id,whatsapp_config_id) VALUES('${support}', '${customer}', '${supportConfig}')`)).rejects.toThrow(/Cross-channel reference/);
    const tag = (await db.query<{ id: string }>(`INSERT INTO tags(account_id,name) VALUES('${brand}', 'Primary tag') RETURNING id`)).rows[0].id;
    await expect(db.exec(`INSERT INTO contact_tags(contact_id,tag_id) VALUES('${supportContact}','${tag}')`)).rejects.toThrow(/Cross-channel reference/);
    const broadcast = (await db.query<{ id: string }>('SELECT id FROM broadcasts')).rows[0].id;
    await expect(db.exec(`INSERT INTO broadcast_recipients(broadcast_id,contact_id) VALUES('${broadcast}', '${supportContact}')`)).rejects.toThrow(/Cross-channel reference/);
  });
  it('adds another number as an empty tenant and refuses shared Meta WABAs', async () => {
    const third = (await db.query<{ account_id: string }>(`INSERT INTO whatsapp_config(account_id,reference_name,phone_number_id,waba_id)
      VALUES('${brand}', 'Sales', '333', 'WABA-3') RETURNING account_id`)).rows[0].account_id;
    expect(third).not.toBe(brand);
    expect(third).not.toBe(support);
    expect((await db.query(`SELECT * FROM contacts WHERE account_id='${third}'`)).rows).toHaveLength(0);
    await expect(db.exec(`INSERT INTO whatsapp_config(account_id,reference_name,phone_number_id,waba_id)
      VALUES('${brand}', 'Other', '444', 'WABA-1')`)).rejects.toThrow(/separate Meta WABA/);
  });
  it('is safely repeatable', async () => {
    await db.exec(readFileSync('supabase/migrations/106_whatsapp_channel_workspaces.sql', 'utf8'));
    expect((await db.query('SELECT * FROM whatsapp_config')).rows).toHaveLength(3);
    expect((await db.query('SELECT * FROM contacts')).rows).toHaveLength(2);
  });
  it('retains the workspace and history after disconnecting, and reconnects into the same tenant', async () => {
    await db.exec(`DELETE FROM message_templates WHERE whatsapp_config_id='${supportConfig}';
      UPDATE conversations SET whatsapp_config_id=NULL WHERE whatsapp_config_id='${supportConfig}';
      DELETE FROM whatsapp_config WHERE id='${supportConfig}';`);
    await select(support);
    expect((await db.query<{ id: string }>('SELECT * FROM contacts')).rows.map((row) => row.id)).toEqual([supportContact]);
    await serviceRole();
    const reconnected = (await db.query<{ account_id: string }>(`INSERT INTO whatsapp_config(account_id,reference_name,phone_number_id,waba_id)
      VALUES('${brand}', 'Support', '222', 'WABA-2') RETURNING account_id`)).rows[0].account_id;
    expect(reconnected).toBe(support);
    expect((await db.query<{ whatsapp_config_id: string }>(`SELECT whatsapp_config_id FROM conversations WHERE id='${supportConversation}'`)).rows[0].whatsapp_config_id).toBeTruthy();
  });
});
