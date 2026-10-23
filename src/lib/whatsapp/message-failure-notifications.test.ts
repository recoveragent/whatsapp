import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE accounts(id uuid PRIMARY KEY, parent_brand_id uuid);
    CREATE TABLE profiles(user_id uuid, account_id uuid, account_role text);
    CREATE TABLE contacts(id uuid PRIMARY KEY, name text);
    CREATE TABLE conversations(id uuid PRIMARY KEY, account_id uuid, contact_id uuid, assigned_agent_id uuid);
    CREATE TABLE messages(id uuid PRIMARY KEY, conversation_id uuid, sender_type text, status text, error_message text);
    CREATE TABLE notifications(id uuid DEFAULT gen_random_uuid(), account_id uuid, user_id uuid, type text
      CONSTRAINT notifications_type_check CHECK(type IN ('conversation_assigned')),
      conversation_id uuid, contact_id uuid, title text, body text, read_at timestamptz);
    INSERT INTO accounts VALUES ('${id(1)}',NULL), ('${id(2)}',NULL), ('${id(3)}','${id(1)}');
    INSERT INTO profiles VALUES ('${id(11)}','${id(1)}','owner'), ('${id(12)}','${id(1)}','admin'),
      ('${id(13)}','${id(1)}','agent'), ('${id(14)}','${id(1)}','agent'),
      ('${id(15)}','${id(2)}','owner'), ('${id(16)}','${id(1)}','viewer');
    INSERT INTO contacts VALUES ('${id(21)}','Customer');
    INSERT INTO conversations VALUES ('${id(31)}','${id(1)}','${id(21)}','${id(13)}'),
      ('${id(32)}','${id(3)}','${id(21)}','${id(13)}');
  `);
  await db.exec(
    readFileSync(
      'supabase/migrations/20261023073935_message_failure_notifications.sql',
      'utf8'
    )
  );
}, 20_000);
beforeEach(async () => {
  await db.exec('TRUNCATE notifications, messages CASCADE');
});
afterAll(async () => {
  await db?.close();
});

async function message(status = 'sent', sender = 'bot', conversation = 31) {
  await db.query(`INSERT INTO messages VALUES ($1,$2,$3,$4,$5)`, [
    id(41),
    id(conversation),
    sender,
    status,
    '[131042] Business eligibility payment issue: currency is not configured',
  ]);
}
describe('message failure alerts', () => {
  it('notifies only brand admins and the assigned agent after asynchronous failure', async () => {
    await message();
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      0
    );
    await db.exec(`UPDATE messages SET status='failed'`);
    const { rows } = await db.query<{
      user_id: string;
      body: string;
      conversation_id: string;
    }>('SELECT * FROM notifications ORDER BY user_id');
    expect(rows.map((row) => row.user_id)).toEqual([id(11), id(12), id(13)]);
    expect(rows[0].body).toContain('131042');
    expect(rows[0].body).toContain('currency');
    expect(rows[0].body).toContain('Meta Business Manager');
    expect(rows[0].conversation_id).toBe(id(31));
  });
  it('handles failures at insertion and does not duplicate alerts even after a stale status update', async () => {
    await message('failed');
    await db.exec(
      `UPDATE messages SET status='failed'; UPDATE messages SET status='sent'; UPDATE messages SET status='failed';`
    );
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      3
    );
  });
  it('notifies parent-brand staff for child channels without leaking to another brand', async () => {
    await message('failed', 'agent', 32);
    const { rows } = await db.query<{ account_id: string; user_id: string }>(
      'SELECT * FROM notifications'
    );
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.account_id === id(3) && row.user_id !== id(15))
    ).toBe(true);
  });
  it('ignores incoming messages and successful delivery statuses', async () => {
    await message('failed', 'customer');
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      0
    );
    await db.exec('DELETE FROM messages');
    await message('delivered');
    await db.exec("UPDATE messages SET status='failed'");
    expect((await db.query('SELECT * FROM notifications')).rows).toHaveLength(
      0
    );
  });
  it('keeps the trigger function inaccessible to public API callers', async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      `SELECT has_function_privilege('authenticated', 'private.notify_message_failure()', 'EXECUTE') AS allowed`
    );
    expect(rows[0].allowed).toBe(false);
  });
});
