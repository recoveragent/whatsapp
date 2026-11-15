import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const own = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE accounts (id uuid PRIMARY KEY);
    INSERT INTO accounts VALUES ('${own}'), ('${other}');
    CREATE FUNCTION is_account_member(target uuid) RETURNS boolean LANGUAGE sql AS $$
      SELECT target = nullif(current_setting('test.account', true), '')::uuid
    $$;
  `);
  await db.exec(readFileSync('supabase/migrations/20261115190000_website_chat_inbox.sql', 'utf8'));
  await db.exec(`
    INSERT INTO website_chat_sessions(account_id, session_hash, last_message_text) VALUES ('${own}', repeat('a',64), 'mine'), ('${other}', repeat('b',64), 'other');
    INSERT INTO website_chat_messages(session_id, account_id, role, content)
      SELECT id, account_id, 'user', last_message_text FROM website_chat_sessions;
  `);
}, 60_000);
afterAll(async () => { await db.close(); });

describe('website chat inbox isolation', () => {
  it('only exposes the current account to authenticated members', async () => {
    await db.exec(`SET test.account = '${own}'; SET ROLE authenticated`);
    const sessions = await db.query<{ last_message_text: string }>('SELECT last_message_text FROM website_chat_sessions');
    const messages = await db.query<{ content: string }>('SELECT content FROM website_chat_messages');
    expect(sessions.rows.map((row) => row.last_message_text)).toEqual(['mine']);
    expect(messages.rows.map((row) => row.content)).toEqual(['mine']);
    await expect(db.query(`INSERT INTO website_chat_sessions(account_id,session_hash) VALUES ('${own}', repeat('c',64))`)).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
  it('does not grant visitors direct access', async () => {
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM website_chat_messages')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
});
