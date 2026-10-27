import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let db: PGlite;
const brand = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const run = '20000000-0000-0000-0000-000000000001';
const payment = '30000000-0000-0000-0000-000000000001';
const recovery = '40000000-0000-0000-0000-000000000001';
const contact = '50000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE FUNCTION is_account_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1::text = current_setting('app.account', true) $$;
    CREATE TABLE accounts(id uuid PRIMARY KEY);
    CREATE TABLE contacts(id uuid PRIMARY KEY);
    CREATE TABLE flow_nodes(node_type text);
    CREATE TABLE flow_runs(id uuid PRIMARY KEY, account_id uuid, flow_id uuid, user_id uuid, contact_id uuid, conversation_id uuid, current_node_key text, status text, vars jsonb DEFAULT '{}');
    CREATE TABLE flow_pending_executions(id uuid DEFAULT gen_random_uuid(), flow_run_id uuid, flow_id uuid, account_id uuid, user_id uuid, contact_id uuid, conversation_id uuid, next_node_key text, vars jsonb, run_at timestamptz, execution_kind text, source_node_key text, status text DEFAULT 'pending');
    GRANT ALL ON flow_runs, flow_pending_executions TO service_role;
    INSERT INTO accounts VALUES ('${brand}'),('${other}'); INSERT INTO contacts VALUES ('${contact}');
  `);
  for (const file of [
    '20261018113952_flow_collect_payment.sql',
    '20261020120000_flow_payment_shopify_sync.sql',
    '20261026175011_checkout_recovery_orders.sql',
  ]) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
  }
}, 25_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`RESET ROLE; TRUNCATE shopify_checkout_recoveries, flow_payment_requests, flow_pending_executions, flow_runs CASCADE;
    INSERT INTO flow_runs(id,account_id,flow_id,user_id,current_node_key,status) VALUES ('${run}','${brand}','${run}','${run}','collect','waiting');
    INSERT INTO shopify_checkout_recoveries(id,account_id,checkout_id,contact_id,status,amount_paise,payment_request_id) VALUES ('${recovery}','${brand}','checkout-1','${contact}','quoted',25000,'${payment}');
    INSERT INTO flow_payment_requests(id,account_id,flow_run_id,node_key,amount_paise,status,config,expires_at,reminder_at,checkout_recovery_id,shopify_sync_status) VALUES ('${payment}','${brand}','${run}','collect',25000,'pending','{"paid_next":"receipt","expired_next":"expired","failed_next":"assistance"}',now()+interval '1 hour',now(),'${recovery}','pending');
  `);
});

describe('checkout payment confirmation transaction', () => {
  it('records verified payment but holds the confirmation until the Shopify order exists', async () => {
    await db.exec('SET ROLE service_role');
    await db.query('select resolve_flow_payment($1,$2)', [payment, 'paid']);
    expect(
      (await db.query('select * from flow_pending_executions')).rows
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ status: string }>(
          'select status from flow_payment_requests'
        )
      ).rows[0].status
    ).toBe('paid');
    await db.exec(
      `UPDATE flow_payment_requests SET shopify_sync_status='synced'`
    );
    expect(
      (
        await db.query<{ ready: boolean }>(
          'select resume_checkout_payment($1) ready',
          [payment]
        )
      ).rows[0].ready
    ).toBe(false);
    await db.exec(
      `UPDATE shopify_checkout_recoveries SET status='placed',shopify_order_id='99',order_name='#1099'`
    );
    await db.query('select resume_checkout_payment($1)', [payment]);
    await db.query('select resume_checkout_payment($1)', [payment]);
    const queued = (
      await db.query<{ next_node_key: string; vars: Record<string, unknown> }>(
        'select * from flow_pending_executions'
      )
    ).rows;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      next_node_key: 'receipt',
      vars: {
        shopify_order_id: '99',
        order_number: '#1099',
        payment_collection_status: 'paid',
      },
    });
  });
  it('routes a paid order sync failure to assistance without calling the payment failed', async () => {
    await db.query('select resolve_flow_payment($1,$2)', [payment, 'paid']);
    await db.exec(
      `UPDATE flow_payment_requests SET shopify_sync_status='failed',shopify_sync_error='Needs manual review'`
    );
    await db.query('select resume_checkout_payment($1)', [payment]);
    expect(
      (
        await db.query<{
          next_node_key: string;
          vars: Record<string, unknown>;
        }>('select * from flow_pending_executions')
      ).rows[0]
    ).toMatchObject({
      next_node_key: 'assistance',
      vars: {
        payment_collection_status: 'paid',
        checkout_recovery_error: 'Needs manual review',
      },
    });
  });
  it('does not revive a stopped flow after payment or order completion', async () => {
    await db.exec(`UPDATE flow_runs SET status='handed_off'`);
    await db.query('select resolve_flow_payment($1,$2)', [payment, 'paid']);
    await db.exec(
      `UPDATE flow_payment_requests SET shopify_sync_status='failed'`
    );
    await db.query('select resume_checkout_payment($1)', [payment]);
    expect(
      (await db.query('select * from flow_pending_executions')).rows
    ).toHaveLength(0);
  });
  it('keeps expiry branching unchanged and duplicate callbacks harmless', async () => {
    await db.query('select resolve_flow_payment($1,$2)', [payment, 'expired']);
    await db.query('select resolve_flow_payment($1,$2)', [payment, 'expired']);
    expect(
      (
        await db.query<{ next_node_key: string }>(
          'select * from flow_pending_executions'
        )
      ).rows
    ).toMatchObject([{ next_node_key: 'expired' }]);
  });
  it('allows members to read only their own brand and never write recovery orders', async () => {
    await db.exec(`SET ROLE authenticated; SET app.account='${other}'`);
    expect(
      (await db.query('select * from shopify_checkout_recoveries')).rows
    ).toHaveLength(0);
    await db.exec(`SET app.account='${brand}'`);
    expect(
      (await db.query('select * from shopify_checkout_recoveries')).rows
    ).toHaveLength(1);
    await expect(
      db.exec(`UPDATE shopify_checkout_recoveries SET status='placed'`)
    ).rejects.toThrow('permission denied');
    await expect(
      db.query('select resume_checkout_payment($1)', [payment])
    ).rejects.toThrow('permission denied');
  });
});
