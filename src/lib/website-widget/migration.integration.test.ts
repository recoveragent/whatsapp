import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const own = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const migration = readFileSync(
  resolve('supabase/migrations/20261105120000_website_widget.sql'),
  'utf8'
);
let db: PGlite;

async function claim(account = own): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    'SELECT public.claim_website_widget_reply($1) AS ok',
    [account]
  );
  return rows[0].ok;
}

const asMember = (role: string) =>
  db.exec(
    `SET test.account='${own}'; SET test.role='${role}'; SET ROLE authenticated;`
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
    CREATE FUNCTION public.is_account_member(target uuid, needed text DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$
      SELECT target = nullif(current_setting('test.account', true), '')::uuid
        AND (needed IS NULL OR current_setting('test.role', true) = needed)
    $$;
    CREATE TABLE public.accounts (id uuid PRIMARY KEY);
    INSERT INTO public.accounts VALUES ('${own}'), ('${foreign}');
  `);
  await db.exec(migration);
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    SET test.account=''; SET test.role='';
    TRUNCATE public.website_widget_config;
    INSERT INTO public.website_widget_config (account_id, enabled, daily_reply_limit)
    VALUES ('${own}', true, 2), ('${foreign}', true, 2);
  `);
});

afterAll(async () => {
  await db.close();
});

describe('website widget migration', () => {
  it('generates a key in the format the public routes accept', async () => {
    const { rows } = await db.query<{ public_key: string }>(
      'SELECT public_key FROM public.website_widget_config'
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.public_key).toMatch(/^wgt_[0-9a-f]{32}$/);
    expect(rows[0].public_key).not.toBe(rows[1].public_key);
  });

  it('stops at the daily limit, per brand', async () => {
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    expect(await claim(foreign)).toBe(true);
  });

  it('starts counting again on a new day', async () => {
    await db.exec(
      `UPDATE public.website_widget_config SET replies_today = 2, replies_day = CURRENT_DATE - 1`
    );
    expect(await claim()).toBe(true);
    const { rows } = await db.query<{ replies_today: number }>(
      'SELECT replies_today FROM public.website_widget_config WHERE account_id = $1',
      [own]
    );
    expect(rows[0].replies_today).toBe(1);
  });

  it('spends nothing for a disabled widget', async () => {
    await db.exec(`UPDATE public.website_widget_config SET enabled = false`);
    expect(await claim()).toBe(false);
  });

  it('keeps visitors out: anon cannot read config or spend replies', async () => {
    await db.exec('SET ROLE anon');
    await expect(
      db.query('SELECT * FROM public.website_widget_config')
    ).rejects.toThrow(/permission denied/);
    await expect(claim()).rejects.toThrow(/permission denied/);
  });

  it('stops signed-in members from spending replies directly', async () => {
    await asMember('admin');
    await expect(claim()).rejects.toThrow(/permission denied/);
  });

  it('shows members only their own brand', async () => {
    await asMember('agent');
    const { rows } = await db.query<{ account_id: string }>(
      'SELECT account_id FROM public.website_widget_config'
    );
    expect(rows.map((row) => row.account_id)).toEqual([own]);
  });

  it('only lets admins change settings', async () => {
    await asMember('agent');
    const agent = await db.query(
      `UPDATE public.website_widget_config SET title = 'x' RETURNING 1`
    );
    expect(agent.rows).toHaveLength(0);

    await asMember('admin');
    const admin = await db.query(
      `UPDATE public.website_widget_config SET title = 'x' RETURNING account_id`
    );
    expect(admin.rows).toEqual([{ account_id: own }]);
  });

  it('rejects values the widget could not render safely', async () => {
    await expect(
      db.exec(`UPDATE public.website_widget_config SET accent_color = 'red;}'`)
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.exec(`UPDATE public.website_widget_config SET whatsapp_number = '+91 abc'`)
    ).rejects.toThrow(/check constraint/);
  });
});
