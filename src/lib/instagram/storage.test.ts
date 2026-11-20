import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('Instagram message storage', () => {
  it('deduplicates retries and preserves newest preview for out-of-order messages', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.accounts(id uuid PRIMARY KEY); CREATE FUNCTION public.is_account_member(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';`);
      await db.exec(readFileSync('supabase/migrations/20261119173500_instagram_messaging.sql', 'utf8'));
      const account = '00000000-0000-0000-0000-000000000001';
      const connection = '00000000-0000-0000-0000-000000000002';
      await db.query('INSERT INTO accounts(id) VALUES ($1)', [account]);
      await db.query('INSERT INTO instagram_connections(id,account_id,instagram_id,username,client_business_id,access_token) VALUES ($1,$2,$3,$4,$5,$6)', [connection, account, '123', 'store', '321', 'encrypted']);
      const insert = (id: string, message: string, at: string) => db.query('SELECT instagram_record_message($1,$2,$3,$4,$5,$6)', [connection, 'person', id, 'inbound', message, at]);
      await insert('m1', 'new', '2026-01-02T00:00:00Z');
      await insert('m1', 'new', '2026-01-02T00:00:00Z');
      await insert('m2', 'old', '2026-01-01T00:00:00Z');
      const messages = await db.query('SELECT count(*)::int AS count FROM instagram_messages');
      const threads = await db.query('SELECT last_message_text FROM instagram_threads');
      expect(messages.rows).toEqual([{ count: 2 }]);
      expect(threads.rows).toEqual([{ last_message_text: 'new' }]);
      await db.exec(readFileSync('supabase/migrations/20261120012205_instagram_disconnect.sql', 'utf8'));
      await db.query('UPDATE instagram_connections SET access_token = NULL WHERE id = $1', [connection]);
      expect((await db.query('SELECT count(*)::int AS count FROM instagram_messages')).rows).toEqual([{ count: 2 }]);
      const other = '00000000-0000-0000-0000-000000000003';
      await db.query('INSERT INTO accounts(id) VALUES ($1)', [other]);
      await db.query("INSERT INTO instagram_connections(account_id,instagram_id,username,client_business_id,access_token) VALUES ($1,'123','store','321','encrypted')", [other]);
      await expect(db.query("UPDATE instagram_connections SET access_token = 'encrypted' WHERE id = $1", [connection])).rejects.toThrow();
    } finally { await db.close(); }
  }, 20000);
});
