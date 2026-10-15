import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const own = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const migration = readFileSync(
  'supabase/migrations/20261014060149_super_admin_ai_model_controls.sql',
  'utf8'
);
describe('super-admin AI model database permissions', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
      CREATE FUNCTION public.is_account_member(account uuid, minimum text DEFAULT null)
        RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT account::text = current_setting('test.account', true)
        AND (minimum IS NULL OR current_setting('test.member_role', true) = 'admin') $$;
      CREATE TABLE ai_configs (
        account_id uuid PRIMARY KEY, created_by uuid, provider text, model text, api_key text,
        embeddings_api_key text, system_prompt text, is_active boolean DEFAULT false,
        auto_reply_enabled boolean DEFAULT false, auto_reply_max_per_conversation integer DEFAULT 3,
        handoff_agent_id uuid
      );
      INSERT INTO ai_configs(account_id, provider, model, api_key) VALUES
        ('${own}', 'openai', 'old-model', 'encrypted'), ('${other}', 'openai', 'other-model', 'encrypted');
      ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ai_configs_select ON ai_configs FOR SELECT TO authenticated USING (is_account_member(account_id));
      CREATE POLICY ai_configs_insert ON ai_configs FOR INSERT TO authenticated WITH CHECK (true);
      CREATE POLICY ai_configs_delete ON ai_configs FOR DELETE TO authenticated USING (true);
      GRANT SELECT, INSERT, UPDATE, DELETE ON ai_configs TO authenticated;
    `);
    await db.exec(migration);
    await db.exec(
      readFileSync(
        'supabase/migrations/20261015095728_separate_ai_training_model.sql',
        'utf8'
      )
    );
  }, 20_000);
  beforeEach(async () => {
    await db.exec(
      `RESET ROLE; SET test.account = '${own}'; SET test.member_role = 'admin'; SET ROLE authenticated;`
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it('allows brand admins to update behavior', async () => {
    const result = await db.query(
      `UPDATE ai_configs SET system_prompt = 'Friendly', auto_reply_enabled = true WHERE account_id = '${own}' RETURNING model`
    );
    expect(result.rows).toEqual([{ model: 'old-model' }]);
  });
  it('preserves existing chat models with training fallback after migration', async () => {
    expect(
      (
        await db.query(
          `SELECT model, training_model FROM ai_configs WHERE account_id = '${own}'`
        )
      ).rows
    ).toEqual([{ model: 'old-model', training_model: null }]);
  });
  it.each([
    'model',
    'training_model',
    'provider',
    'api_key',
    'embeddings_api_key',
  ])('denies direct brand writes to %s', async (column) => {
    await expect(
      db.exec(
        `UPDATE ai_configs SET ${column} = 'tampered' WHERE account_id = '${own}'`
      )
    ).rejects.toThrow(/permission denied/i);
  });
  it('denies brand insertion and deletion despite old RLS policies', async () => {
    await expect(
      db.exec(
        `INSERT INTO ai_configs(account_id) VALUES ('20000000-0000-0000-0000-000000000001')`
      )
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.exec(`DELETE FROM ai_configs WHERE account_id = '${own}'`)
    ).rejects.toThrow(/permission denied/i);
  });
  it('retains brand isolation for allowed behavior fields', async () => {
    expect(
      (
        await db.query(
          `UPDATE ai_configs SET system_prompt = 'Wrong brand' WHERE account_id = '${other}' RETURNING account_id`
        )
      ).rows
    ).toEqual([]);
  });
  it('denies behavior changes by non-admin members', async () => {
    await db.exec(`SET test.member_role = 'viewer';`);
    expect(
      (
        await db.query(
          `UPDATE ai_configs SET system_prompt = 'Viewer edit' WHERE account_id = '${own}' RETURNING account_id`
        )
      ).rows
    ).toEqual([]);
  });
  it('permits the authorized service-role write path', async () => {
    await db.exec(
      `RESET ROLE; SET ROLE service_role; UPDATE ai_configs SET model = 'super-admin-model', training_model = 'training-model' WHERE account_id = '${other}';`
    );
    expect(
      (
        await db.query(
          `SELECT model, training_model FROM ai_configs WHERE account_id = '${other}'`
        )
      ).rows
    ).toEqual([
      { model: 'super-admin-model', training_model: 'training-model' },
    ]);
  });
});
