import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const own = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const migration = readFileSync(
  resolve('supabase/migrations/20261014140325_brand_agent_training.sql'),
  'utf8'
);
let db: PGlite;
const faqs = [
  {
    id: 'one',
    question: 'Is shipping free?',
    answer: 'Prepaid shipping is free.',
    approved: true,
  },
  { id: 'two', question: 'Do you gift wrap?', answer: '', approved: true },
  {
    id: 'three',
    question: 'Is COD available?',
    answer: 'Only for a birth frame.',
    approved: false,
  },
];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${own}'::uuid $$;
    CREATE FUNCTION public.is_account_member(target uuid, needed text DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$
      SELECT target = nullif(current_setting('test.account', true), '')::uuid
        AND (needed IS NULL OR current_setting('test.role', true) = needed)
    $$;
    CREATE TABLE public.accounts (id uuid PRIMARY KEY);
    INSERT INTO public.accounts VALUES ('${own}'), ('${foreign}');
    CREATE TABLE public.ai_knowledge_documents (id uuid PRIMARY KEY, account_id uuid, created_by uuid, title text, content text, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.ai_knowledge_chunks (id uuid DEFAULT gen_random_uuid(), document_id uuid REFERENCES public.ai_knowledge_documents(id), account_id uuid, chunk_index integer, content text CHECK (content NOT LIKE '%FAIL_TRANSACTION%'));
    ALTER TABLE public.ai_knowledge_documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY docs ON public.ai_knowledge_documents TO authenticated USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
    CREATE POLICY chunks ON public.ai_knowledge_chunks TO authenticated USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_knowledge_documents, public.ai_knowledge_chunks TO authenticated;
  `);
  await db.exec(migration);
}, 20_000);

beforeEach(async () => {
  await db.exec(
    `RESET ROLE; TRUNCATE public.ai_knowledge_chunks, public.ai_knowledge_documents, public.ai_training_sets;`
  );
  await db.query(
    'INSERT INTO public.ai_training_sets(account_id, website_url, faqs) VALUES ($1,$2,$3),($4,$2,$3)',
    [own, 'https://gifts.example.com', JSON.stringify(faqs), foreign]
  );
  await db.exec(
    `SELECT set_config('test.account','${own}',false); SELECT set_config('test.role','admin',false); SET ROLE authenticated;`
  );
});
afterAll(async () => {
  await db?.close();
});

describe('brand-isolated training and atomic FAQ publication', () => {
  it('reads only the current brand draft', async () => {
    expect(
      (await db.query('SELECT account_id FROM public.ai_training_sets')).rows
    ).toEqual([{ account_id: own }]);
  });
  it('prevents reassignment of a training draft to another brand', async () => {
    await expect(
      db.query(
        'UPDATE public.ai_training_sets SET account_id=$1 WHERE account_id=$2',
        [foreign, own]
      )
    ).rejects.toThrow();
  });
  it('prevents foreign writes and inserts', async () => {
    expect(
      (
        await db.query(
          'UPDATE public.ai_training_sets SET website_url=$1 WHERE account_id=$2 RETURNING account_id',
          ['https://evil.example.com', foreign]
        )
      ).rows
    ).toHaveLength(0);
    await expect(
      db.query(
        'INSERT INTO public.ai_training_sets(account_id,website_url) VALUES ($1,$2)',
        ['33333333-3333-4333-8333-333333333333', 'https://evil.example.com']
      )
    ).rejects.toThrow();
  });
  it('does not give viewers a write or publish path', async () => {
    await db.exec("SELECT set_config('test.role','viewer',false)");
    expect(
      (
        await db.query(
          'UPDATE public.ai_training_sets SET revision=2 RETURNING account_id'
        )
      ).rows
    ).toHaveLength(0);
    await expect(
      db.query('SELECT public.publish_ai_training($1,1)', [own])
    ).rejects.toThrow('admin');
  });
  it('rejects anonymous table access and publication', async () => {
    await db.exec('RESET ROLE; SET ROLE anon');
    await expect(
      db.query('SELECT * FROM public.ai_training_sets')
    ).rejects.toThrow();
    await expect(
      db.query('SELECT public.publish_ai_training($1,1)', [own])
    ).rejects.toThrow();
  });
  it('rejects publishing another brand or a stale draft revision', async () => {
    await expect(
      db.query('SELECT public.publish_ai_training($1,1)', [foreign])
    ).rejects.toThrow('admin');
    await expect(
      db.query('SELECT public.publish_ai_training($1,7)', [own])
    ).rejects.toThrow('Training changed');
  });
  it('publishes only approved nonblank answers, one FAQ per chunk', async () => {
    await db.query('SELECT public.publish_ai_training($1,1)', [own]);
    const chunks = (
      await db.query<{ content: string }>(
        'SELECT content FROM public.ai_knowledge_chunks'
      )
    ).rows;
    expect(chunks).toEqual([
      { content: 'Q: Is shipping free?\nA: Prepaid shipping is free.' },
    ]);
    expect(
      (await db.query('SELECT published_revision FROM public.ai_training_sets'))
        .rows
    ).toEqual([{ published_revision: 1 }]);
  });
  it('replaces the managed FAQ without duplicating or touching manual knowledge', async () => {
    await db.query(
      'INSERT INTO public.ai_knowledge_documents(id,account_id,title,content) VALUES ($1,$2,$3,$4)',
      ['44444444-4444-4444-8444-444444444444', own, 'Manual FAQ', 'Keep this']
    );
    await db.query('SELECT public.publish_ai_training($1,1)', [own]);
    await db.query('SELECT public.publish_ai_training($1,1)', [own]);
    expect(
      (await db.query('SELECT title FROM public.ai_knowledge_documents')).rows
    ).toHaveLength(2);
    expect(
      (await db.query('SELECT content FROM public.ai_knowledge_chunks')).rows
    ).toHaveLength(1);
  });
  it('rolls back both document and chunks if publication fails midway', async () => {
    await db.query('SELECT public.publish_ai_training($1,1)', [own]);
    await db.query(
      'UPDATE public.ai_training_sets SET faqs=$1,revision=2 WHERE account_id=$2',
      [
        JSON.stringify([
          {
            question: 'Can this fail?',
            answer: 'FAIL_TRANSACTION',
            approved: true,
          },
        ]),
        own,
      ]
    );
    await expect(
      db.query('SELECT public.publish_ai_training($1,2)', [own])
    ).rejects.toThrow();
    expect(
      (
        await db.query<{ content: string }>(
          'SELECT content FROM public.ai_knowledge_documents'
        )
      ).rows[0].content
    ).toContain('Prepaid shipping is free.');
    expect(
      (
        await db.query<{ content: string }>(
          'SELECT content FROM public.ai_knowledge_chunks'
        )
      ).rows[0].content
    ).toContain('Prepaid shipping is free.');
    expect(
      (await db.query('SELECT published_revision FROM public.ai_training_sets'))
        .rows
    ).toEqual([{ published_revision: 1 }]);
  });
  it('refuses an entirely unanswered worksheet', async () => {
    await db.query(
      'UPDATE public.ai_training_sets SET faqs=$1 WHERE account_id=$2',
      [JSON.stringify([faqs[1]]), own]
    );
    await expect(
      db.query('SELECT public.publish_ai_training($1,1)', [own])
    ).rejects.toThrow('Approve at least');
  });
  it('can withdraw published training while preserving the editable draft', async () => {
    await db.query('SELECT public.publish_ai_training($1,1)', [own]);
    await db.query('SELECT public.publish_ai_training($1,1,true)', [own]);
    expect(
      (await db.query('SELECT * FROM public.ai_knowledge_chunks')).rows
    ).toHaveLength(0);
    expect(
      (await db.query('SELECT * FROM public.ai_knowledge_documents')).rows
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ faqs: unknown[] }>(
          'SELECT faqs FROM public.ai_training_sets'
        )
      ).rows[0].faqs
    ).toHaveLength(3);
  });
});
