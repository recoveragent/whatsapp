import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';

let db: PGlite;
const account = '10000000-0000-0000-0000-000000000001';
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE FUNCTION is_account_member(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE accounts (id uuid PRIMARY KEY);
    CREATE TABLE account_wallets (account_id uuid REFERENCES accounts, balance integer DEFAULT 0);
    CREATE TABLE account_message_pricing (account_id uuid REFERENCES accounts, price integer DEFAULT 45);
    CREATE TABLE contacts (account_id uuid REFERENCES accounts);
    CREATE FUNCTION seed_wallet() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      INSERT INTO account_wallets(account_id) VALUES (NEW.id);
      INSERT INTO account_message_pricing(account_id) VALUES (NEW.id);
      RETURN NEW;
    END $$;
    CREATE TRIGGER seed AFTER INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION seed_wallet();
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/20261017100107_fix_brand_wallet_bootstrap.sql', 'utf8'));
  for (const table of ['account_wallets', 'account_message_pricing', 'contacts']) {
    await db.exec(`CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION enforce_account_references();`);
  }
  await db.exec('SET ROLE authenticated');
}, 20_000);
afterAll(async () => { await db?.close(); });

it('seeds a new account before membership exists', async () => {
  await db.exec(`INSERT INTO accounts VALUES ('${account}')`);
  const result = await db.query('SELECT * FROM account_wallets');
  expect(result.rows).toHaveLength(1);
  expect((await db.query('SELECT * FROM account_message_pricing')).rows).toHaveLength(1);
});

it('rejects direct wallet and pricing inserts without membership', async () => {
  for (const table of ['account_wallets', 'account_message_pricing']) {
    await expect(db.exec(`INSERT INTO ${table}(account_id) VALUES ('${account}')`))
      .rejects.toThrow('Record belongs to another account');
  }
});

it('rejects wallet and pricing updates without membership', async () => {
  await expect(db.exec('UPDATE account_wallets SET balance = 100'))
    .rejects.toThrow('Record belongs to another account');
  await expect(db.exec('UPDATE account_message_pricing SET price = 0'))
    .rejects.toThrow('Record belongs to another account');
});

it('rejects other account-scoped inserts without membership', async () => {
  await expect(db.exec(`INSERT INTO contacts VALUES ('${account}')`))
    .rejects.toThrow('Record belongs to another account');
});
