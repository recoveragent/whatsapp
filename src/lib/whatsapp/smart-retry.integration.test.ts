import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const account = '10000000-0000-4000-8000-000000000001';
const config = '20000000-0000-4000-8000-000000000001';
const otherConfig = '20000000-0000-4000-8000-000000000002';
const recovery = '30000000-0000-4000-8000-000000000001';

describe('Smart Retry database migration', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE accounts(id uuid PRIMARY KEY);
      CREATE TABLE whatsapp_config(id uuid PRIMARY KEY, account_id uuid REFERENCES accounts(id));
      CREATE TABLE message_templates(id uuid PRIMARY KEY);
      INSERT INTO accounts VALUES('${account}');
      INSERT INTO whatsapp_config VALUES('${config}', '${account}'), ('${otherConfig}', '${account}');
    `);
    await db.exec(
      readFileSync(
        'supabase/migrations/20261103060121_smart_retry_131049.sql',
        'utf8'
      )
    );
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it('allows only one prompt per recipient per number per rolling 24 hours', async () => {
    const claim = async (channel = config) =>
      (
        await db.query<{ claimed: boolean }>(
          'SELECT claim_smart_retry_prompt($1, $2) AS claimed',
          [channel, '919876543210']
        )
      ).rows[0]!.claimed;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    expect(await claim(otherConfig)).toBe(true);
    await db.query(
      "UPDATE smart_retry_cooldowns SET prompted_at = now() - interval '25 hours' WHERE whatsapp_config_id = $1",
      [config]
    );
    expect(await claim()).toBe(true);
  });

  it('enforces RLS and denies browser roles recovery records and RPC access', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(
          db.query('SELECT * FROM smart_retry_messages')
        ).rejects.toThrow(/permission denied/);
        await expect(
          db.query('SELECT claim_smart_retry_prompt($1, $2)', [config, '123'])
        ).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec('RESET ROLE');
      }
    }
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE relname IN ('smart_retry_settings','smart_retry_messages','smart_retry_cooldowns')"
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('lets service_role persist recovery and claims but rejects duplicate original snapshots', async () => {
    await db.exec('SET ROLE service_role');
    try {
      await db.query(
        'INSERT INTO smart_retry_messages(id, account_id, whatsapp_config_id, recipient, original_message_id, payload) VALUES($1,$2,$3,$4,$5,$6)',
        [
          recovery,
          account,
          config,
          '919876543210',
          'wamid-original',
          JSON.stringify({ template: { name: 'offer' } }),
        ]
      );
      await expect(
        db.query(
          "INSERT INTO smart_retry_messages(account_id, whatsapp_config_id, recipient, original_message_id, payload) VALUES($1,$2,'919876543210','wamid-original','{}')",
          [account, config]
        )
      ).rejects.toThrow(/duplicate key/);
      const { rows } = await db.query<{ claimed: boolean }>(
        'SELECT claim_smart_retry_prompt($1, $2) AS claimed',
        [config, 'different-recipient']
      );
      expect(rows[0]!.claimed).toBe(true);
    } finally {
      await db.exec('RESET ROLE');
    }
  });

  it('claims acceptance once and refuses expired or misrouted requests', async () => {
    await db.query(
      "UPDATE smart_retry_messages SET status = 'awaiting_acceptance', prompt_message_id = 'prompt-wamid' WHERE id = $1",
      [recovery]
    );
    const accept = (channel = config) =>
      db.query(
        "UPDATE smart_retry_messages SET status = 'retrying' WHERE id = $1 AND whatsapp_config_id = $2 AND account_id = $3 AND status = 'awaiting_acceptance' AND expires_at > now() RETURNING id",
        [recovery, channel, account]
      );
    expect((await accept(otherConfig)).rows).toHaveLength(0);
    expect((await accept()).rows).toHaveLength(1);
    expect((await accept()).rows).toHaveLength(0);
    await db.query(
      "UPDATE smart_retry_messages SET status = 'awaiting_acceptance', expires_at = now() - interval '1 hour' WHERE id = $1",
      [recovery]
    );
    expect((await accept()).rows).toHaveLength(0);
  });
});
