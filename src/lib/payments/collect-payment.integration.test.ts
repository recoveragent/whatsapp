import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const brand = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const run = '20000000-0000-0000-0000-000000000001';
const payment = '30000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION is_account_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1::text = current_setting('app.account', true) $$;
    CREATE TABLE accounts(id uuid PRIMARY KEY);
    CREATE TABLE flow_nodes(node_type text);
    CREATE TABLE flow_runs(id uuid PRIMARY KEY, account_id uuid, flow_id uuid, user_id uuid, contact_id uuid, conversation_id uuid, current_node_key text, status text, vars jsonb DEFAULT '{}');
    CREATE TABLE flow_pending_executions(id uuid DEFAULT gen_random_uuid(), flow_run_id uuid, flow_id uuid, account_id uuid, user_id uuid, contact_id uuid, conversation_id uuid, next_node_key text, vars jsonb, run_at timestamptz, execution_kind text, source_node_key text, status text DEFAULT 'pending');
    GRANT ALL ON flow_runs, flow_pending_executions TO service_role;
    INSERT INTO accounts VALUES ('${brand}'), ('${other}');
  `);
  await db.exec(
    readFileSync(
      'supabase/migrations/20261018113952_flow_collect_payment.sql',
      'utf8'
    )
  );
}, 20_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE flow_payment_requests, flow_pending_executions, flow_runs CASCADE;
    INSERT INTO flow_runs(id, account_id, flow_id, user_id, current_node_key, status, vars) VALUES ('${run}', '${brand}', '${run}', '${run}', 'collect', 'waiting', '{"payment_url":"https://rzp.io/rzp/test","payment_status":"pending"}');
    INSERT INTO flow_payment_requests(id, account_id, flow_run_id, node_key, amount_paise, status, config, expires_at, reminder_at) VALUES ('${payment}', '${brand}', '${run}', 'collect', 19900, 'pending', '{"paid_next":"receipt","expired_next":"expired","failed_next":"failed"}', now() + interval '1 hour', now());
  `);
});

async function resolve(outcome: string) {
  return db.query<{ resolved: boolean }>(
    'SELECT resolve_flow_payment($1::uuid, $2) AS resolved',
    [payment, outcome]
  );
}

describe('payment migration and atomic continuations', () => {
  it('queues exactly one receipt on repeated callbacks and preserves the order payment state', async () => {
    await db.exec('SET ROLE service_role');
    expect((await resolve('paid')).rows[0].resolved).toBe(true);
    expect((await resolve('paid')).rows[0].resolved).toBe(false);
    const queued = await db.query<{
      next_node_key: string;
      vars: Record<string, unknown>;
      source_node_key: string;
    }>('SELECT * FROM flow_pending_executions');
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0].next_node_key).toBe('receipt');
    expect(queued.rows[0].source_node_key).toBe('collect');
    expect(queued.rows[0].vars).toMatchObject({
      payment_collection_status: 'paid',
      payment_status: 'pending',
      payment_url: 'https://rzp.io/rzp/test',
    });
  });
  it.each(['expired', 'failed'])(
    'queues the %s branch once',
    async (outcome) => {
      expect((await resolve(outcome)).rows[0].resolved).toBe(true);
      expect(
        (
          await db.query<{ next_node_key: string }>(
            'SELECT next_node_key FROM flow_pending_executions'
          )
        ).rows[0].next_node_key
      ).toBe(outcome);
    }
  );
  it('does not revive a run handed off by an agent', async () => {
    await db.exec(`UPDATE flow_runs SET status = 'handed_off'`);
    expect((await resolve('paid')).rows[0].resolved).toBe(false);
    expect(
      (await db.query('SELECT * FROM flow_pending_executions')).rows
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ status: string }>(
          'SELECT status FROM flow_payment_requests'
        )
      ).rows[0].status
    ).toBe('paid');
  });
  it('leaves early callbacks pending for reconciliation after the request is sent', async () => {
    await db.exec(`UPDATE flow_runs SET status = 'active'`);
    expect((await resolve('paid')).rows[0].resolved).toBe(false);
    expect(
      (
        await db.query<{ status: string }>(
          'SELECT status FROM flow_payment_requests'
        )
      ).rows[0].status
    ).toBe('pending');
    await db.exec(`UPDATE flow_runs SET status = 'waiting'`);
    expect((await resolve('paid')).rows[0].resolved).toBe(true);
  });
  it('rolls back resolution if no branch exists instead of losing the continuation', async () => {
    await db.exec(`UPDATE flow_payment_requests SET config = '{}'`);
    await expect(resolve('paid')).rejects.toThrow('Missing payment branch');
    expect(
      (
        await db.query<{ status: string }>(
          'SELECT status FROM flow_payment_requests'
        )
      ).rows[0].status
    ).toBe('pending');
  });
  it('enforces tenant reads, denies client writes and hides encrypted credentials', async () => {
    await db.exec(
      `SELECT set_config('app.account', '${other}', false); SET ROLE authenticated;`
    );
    expect(
      (await db.query('SELECT * FROM flow_payment_requests')).rows
    ).toHaveLength(0);
    await expect(
      db.query('SELECT * FROM account_payment_connections')
    ).rejects.toThrow('permission denied');
    await expect(resolve('paid')).rejects.toThrow('permission denied');
    await expect(
      db.exec(`UPDATE flow_payment_requests SET status = 'paid'`)
    ).rejects.toThrow('permission denied');
    await db.exec(
      `RESET ROLE; SELECT set_config('app.account', '${brand}', false); SET ROLE authenticated;`
    );
    expect(
      (await db.query('SELECT * FROM flow_payment_requests')).rows
    ).toHaveLength(1);
  });
  it('prevents duplicate collections for the same flow run and node', async () => {
    await expect(
      db.exec(
        `INSERT INTO flow_payment_requests(account_id, flow_run_id, node_key, amount_paise, config, expires_at, reminder_at) VALUES ('${brand}', '${run}', 'collect', 19900, '{}', now(), now())`
      )
    ).rejects.toThrow('duplicate key');
  });
});
