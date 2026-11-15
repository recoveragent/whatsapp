import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const account = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const conversation = '33333333-3333-4333-8333-333333333333';
const user = '44444444-4444-4444-8444-444444444444';
const token = 'a'.repeat(32);
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE accounts (id uuid PRIMARY KEY);
    CREATE TABLE conversations (id uuid PRIMARY KEY, account_id uuid, ai_autoreply_disabled boolean, ai_handoff_summary text, status text, updated_at timestamptz);
    CREATE TABLE conversation_private_notes (conversation_id uuid, account_id uuid, user_id uuid, note_text text);
    INSERT INTO accounts VALUES ('${account}'), ('${other}');
    INSERT INTO conversations (id, account_id, status) VALUES ('${conversation}', '${account}', 'closed');
  `);
  await db.exec(readFileSync('supabase/migrations/20261115180000_website_handoffs.sql', 'utf8'));
}, 60_000);
afterAll(async () => { await db.close(); });

describe('website handoff', () => {
  it('isolates accounts, transfers once, and pauses the bot', async () => {
    await db.query('INSERT INTO website_handoffs(token, account_id, transcript) VALUES ($1,$2,$3)', [token, account, 'Visitor: Help']);
    const consume = async (a: string) => (await db.query<{ ok: boolean }>('SELECT consume_website_handoff($1,$2,$3,$4) AS ok', [token, a, conversation, user])).rows[0].ok;
    expect(await consume(other)).toBe(false);
    expect(await consume(account)).toBe(true);
    expect(await consume(account)).toBe(false);
    const notes = await db.query<{ note_text: string }>('SELECT note_text FROM conversation_private_notes');
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].note_text).toContain('Visitor: Help');
    const state = await db.query<{ ai_autoreply_disabled: boolean; status: string }>('SELECT ai_autoreply_disabled, status FROM conversations');
    expect(state.rows[0]).toEqual({ ai_autoreply_disabled: true, status: 'open' });
  });
  it('rejects expired references and denies anonymous access', async () => {
    await db.query("INSERT INTO website_handoffs(token, account_id, transcript, expires_at) VALUES ($1,$2,'old', now() - interval '1 minute')", [token, account]);
    const result = await db.query<{ ok: boolean }>('SELECT consume_website_handoff($1,$2,$3,$4) AS ok', [token, account, conversation, user]);
    expect(result.rows[0].ok).toBe(false);
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM website_handoffs')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });
});
